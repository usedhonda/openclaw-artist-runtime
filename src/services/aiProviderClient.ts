import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { AiReviewProvider } from "../types.js";
import { getOpenClawAuthProfilesPath, getOpenClawConfigPath } from "./runtimeConfig.js";

export interface AiProviderCallOptions {
  provider: AiReviewProvider;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  authProfilesPath?: string;
  configPath?: string;
  model?: string;
}

interface OpenClawConfigShape {
  agents?: {
    defaults?: {
      model?: {
        primary?: unknown;
      };
    };
  };
  auth?: {
    profiles?: Record<string, unknown>;
  };
}

interface AuthProfilesShape {
  profiles?: Record<string, {
    type?: unknown;
    provider?: unknown;
    access?: unknown;
    expires?: unknown;
    email?: unknown;
  }>;
}

interface ResolvedCodexProfile {
  accessToken: string;
  profileId: string;
  expires?: number;
}

const openAiCodexResponsesUrl = "https://chatgpt.com/backend-api/codex/responses";
const defaultCodexModel = "gpt-5.5";
const providerPromptSecretPattern = /(bot\d+:[A-Za-z0-9_-]{30,}|(?:API[_ -]?KEY|COOKIE|CREDENTIAL|PASSWORD|SECRET)\s*[=:]\s*\S+)/i;

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

export const AI_PROVIDER_MOCK_FALLBACK_PREFIXES = [
  "Mock provider fallback",
  "Mock provider:",
  "AI provider '"
] as const;

export function isAiProviderMockFallbackResponse(value: string): boolean {
  return AI_PROVIDER_MOCK_FALLBACK_PREFIXES.some((prefix) => value.startsWith(prefix));
}

export function isAiNotConfiguredResponse(raw: string): boolean {
  return /AI provider '[^']+' is not configured\./.test(raw);
}

function mockResponse(prompt: string, prefix = "Mock provider"): string {
  return `${prefix}: ${truncate(prompt, 200)}`;
}

function notConfigured(provider: AiReviewProvider): string {
  return `AI provider '${provider}' is not configured. No external model call was made.`;
}

function isCodexProvider(provider: AiReviewProvider): boolean {
  return provider === "openai-codex";
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function candidateConfigPaths(explicit?: string): string[] {
  const cwd = process.cwd();
  const candidates = [
    explicit,
    getOpenClawConfigPath(),
    join(cwd, ".local", "openclaw", "config", "openclaw.json"),
    join(cwd, "..", "config", "openclaw.json"),
    join(cwd, "config", "openclaw.json")
  ].filter(Boolean) as string[];
  return [...new Set(candidates.map((path) => resolve(path)))];
}

function candidateAuthProfilePaths(explicit?: string, configPath?: string): string[] {
  const cwd = process.cwd();
  const configRoot = configPath ? dirname(dirname(resolve(configPath))) : undefined;
  const candidates = [
    explicit,
    getOpenClawAuthProfilesPath(),
    configRoot ? join(configRoot, "state", "agents", "main", "agent", "auth-profiles.json") : undefined,
    join(cwd, ".local", "openclaw", "state", "agents", "main", "agent", "auth-profiles.json"),
    join(cwd, "..", "state", "agents", "main", "agent", "auth-profiles.json"),
    join(cwd, "state", "agents", "main", "agent", "auth-profiles.json")
  ].filter(Boolean) as string[];
  return [...new Set(candidates.map((path) => resolve(path)))];
}

async function readFirstJson<T>(paths: string[]): Promise<{ path: string; value: T } | undefined> {
  for (const path of paths) {
    const raw = await readFile(path, "utf8").catch(() => undefined);
    if (!raw) {
      continue;
    }
    const value = parseJson(raw);
    if (value !== undefined) {
      return { path, value: value as T };
    }
  }
  return undefined;
}

function resolveModel(config: OpenClawConfigShape | undefined, explicit?: string): string {
  if (explicit) {
    return explicit.includes("/") ? explicit.split("/").pop() ?? defaultCodexModel : explicit;
  }
  const primary = config?.agents?.defaults?.model?.primary;
  if (typeof primary === "string" && primary.trim()) {
    return primary.includes("/") ? primary.split("/").pop() ?? defaultCodexModel : primary;
  }
  return defaultCodexModel;
}

function profileKeysFromConfig(config: OpenClawConfigShape | undefined): string[] {
  const keys = config?.auth?.profiles && isRecord(config.auth.profiles)
    ? Object.keys(config.auth.profiles)
    : [];
  return [
    ...keys.filter((key) => key.startsWith("openai-codex:")),
    "openai-codex:honda@ofinventi.one"
  ];
}

function selectCodexProfile(
  profiles: AuthProfilesShape | undefined,
  config: OpenClawConfigShape | undefined
): ResolvedCodexProfile | undefined {
  const profileMap = profiles?.profiles;
  if (!profileMap || !isRecord(profileMap)) {
    return undefined;
  }
  const preferred = profileKeysFromConfig(config);
  const fallback = Object.keys(profileMap).filter((key) => {
    const profile = profileMap[key];
    return profile?.provider === "openai-codex";
  });
  for (const profileId of [...preferred, ...fallback]) {
    const profile = profileMap[profileId];
    if (!profile || profile.provider !== "openai-codex" || typeof profile.access !== "string") {
      continue;
    }
    return {
      profileId,
      accessToken: profile.access,
      expires: typeof profile.expires === "number" ? profile.expires : undefined
    };
  }
  return undefined;
}

async function resolveCodexAuth(options: AiProviderCallOptions): Promise<{
  model: string;
  profile?: ResolvedCodexProfile;
}> {
  const configRead = await readFirstJson<OpenClawConfigShape>(candidateConfigPaths(options.configPath));
  const authRead = await readFirstJson<AuthProfilesShape>(
    candidateAuthProfilePaths(options.authProfilesPath, configRead?.path)
  );
  return {
    model: resolveModel(configRead?.value, options.model),
    profile: selectCodexProfile(authRead?.value, configRead?.value)
  };
}

function extractResponseText(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  if (typeof payload.output_text === "string") {
    return payload.output_text;
  }
  const output = Array.isArray(payload.output) ? payload.output : [];
  const parts: string[] = [];
  for (const item of output) {
    if (!isRecord(item)) {
      continue;
    }
    const content = Array.isArray(item.content) ? item.content : [];
    for (const contentItem of content) {
      if (isRecord(contentItem) && typeof contentItem.text === "string") {
        parts.push(contentItem.text);
      }
    }
  }
  return parts.length > 0 ? parts.join("\n").trim() : undefined;
}

function extractSseResponseText(streamText: string): string | undefined {
  const deltas: string[] = [];
  let completed: string | undefined;
  for (const line of streamText.split(/\r?\n/)) {
    if (!line.startsWith("data:")) {
      continue;
    }
    const raw = line.slice("data:".length).trim();
    if (!raw || raw === "[DONE]") {
      continue;
    }
    const event = parseJson(raw);
    if (!isRecord(event)) {
      continue;
    }
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      deltas.push(event.delta);
      continue;
    }
    if (event.type === "response.output_item.done" && isRecord(event.item)) {
      const content = Array.isArray(event.item.content) ? event.item.content : [];
      for (const contentItem of content) {
        if (isRecord(contentItem) && contentItem.type === "output_text" && typeof contentItem.text === "string") {
          completed = contentItem.text;
        }
      }
    }
  }
  const parts = completed ? [completed] : deltas;
  return parts.join("").trim() || undefined;
}

async function callOpenAiResponses(
  prompt: string,
  auth: ResolvedCodexProfile,
  model: string,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<string> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const request = fetchImpl(openAiCodexResponsesUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${auth.accessToken}`
      },
      body: JSON.stringify({
        model,
        instructions: "Return concise, field-oriented persona draft text. Do not include secrets.",
        input: [{
          role: "user",
          content: [{
            type: "input_text",
            text: prompt
          }]
        }],
        stream: true,
        store: false
      }),
      signal: controller.signal
    });
    const response = await Promise.race([
      request,
      new Promise<Response>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error("ai_provider_timeout"));
        }, timeoutMs);
      })
    ]);
    if (!response.ok) {
      return mockResponse(prompt, `Mock provider fallback (${response.status})`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = await response.json().catch(() => undefined);
      return extractResponseText(payload) ?? mockResponse(prompt, "Mock provider fallback (empty response)");
    }
    const streamText = await response.text().catch(() => "");
    return extractSseResponseText(streamText) ?? mockResponse(prompt, "Mock provider fallback (empty response)");
  } catch {
    return mockResponse(prompt, "Mock provider fallback (request failed)");
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export async function callAiProvider(prompt: string, options: AiProviderCallOptions): Promise<string> {
  if (options.provider === "mock") {
    return mockResponse(prompt);
  }
  if (!isCodexProvider(options.provider)) {
    return notConfigured(options.provider);
  }
  if (providerPromptSecretPattern.test(prompt)) {
    return mockResponse(prompt, "Mock provider fallback (secret-like prompt blocked)");
  }
  const auth = await resolveCodexAuth(options);
  if (!auth.profile) {
    return notConfigured(options.provider);
  }
  if (auth.profile.expires && auth.profile.expires <= Date.now()) {
    return notConfigured(options.provider);
  }
  return callOpenAiResponses(
    prompt,
    auth.profile,
    auth.model,
    options.fetchImpl ?? fetch,
    options.timeoutMs ?? 120000
  );
}
