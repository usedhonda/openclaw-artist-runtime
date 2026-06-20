import { mkdir, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callAiProvider, decodeJwtExpMs } from "../src/services/aiProviderClient";
import { proposePersonaFields } from "../src/services/personaProposer";

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-ai-provider-"));
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function makeJwt(expSeconds: number): string {
  return [
    encodeBase64Url(JSON.stringify({ alg: "none", typ: "JWT" })),
    encodeBase64Url(JSON.stringify({ exp: expSeconds })),
    "signature"
  ].join(".");
}

async function writeCodexCliAuthFixture(root: string, accessToken: string): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "auth.json"),
    `${JSON.stringify({
      auth_mode: "chatgpt",
      tokens: {
        access_token: accessToken,
        account_id: "acct_fixture",
        id_token: "id_fixture",
        refresh_token: "refresh_fixture"
      }
    })}\n`,
    "utf8"
  );
}

async function writeOpenClawAuthFixture(
  root: string,
  options: { access?: string; expires?: number } = {}
): Promise<{ configPath: string; authProfilesPath: string }> {
  await mkdir(root, { recursive: true });
  const configPath = join(root, "openclaw.json");
  const authProfilesPath = join(root, "auth-profiles.json");
  await writeFile(
    configPath,
    `${JSON.stringify({
      agents: { defaults: { model: { primary: "openai-codex/gpt-5.5" } } },
      auth: { profiles: { "openai-codex:test@example.invalid": {} } }
    })}\n`,
    "utf8"
  );
  await writeFile(
    authProfilesPath,
    `${JSON.stringify({
      version: 1,
      profiles: {
        "openai-codex:test@example.invalid": {
          type: "oauth",
          provider: "openai-codex",
          access: options.access ?? "placeholder-access",
          expires: options.expires ?? Date.now() + 60_000
        }
      }
    })}\n`,
    "utf8"
  );
  return { configPath, authProfilesPath };
}

beforeEach(() => {
  vi.stubEnv("OPENCLAW_CODEX_AUTH_FROM_CLI", "off");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("ai provider client", () => {
  it("keeps mock provider behavior local", async () => {
    await expect(callAiProvider("hello", { provider: "mock" })).resolves.toBe("Mock provider: hello");
  });

  it("calls OpenAI Responses for openai-codex with a local OpenClaw auth profile", async () => {
    const root = makeRoot();
    const { configPath, authProfilesPath } = await writeOpenClawAuthFixture(root);
    const fetchImpl = vi.fn(async () =>
      new Response([
        "event: response.output_text.delta",
        "data: {\"type\":\"response.output_text.delta\",\"delta\":\"artistName: Signal Teeth (origin: model)\"}",
        "",
        "event: response.completed",
        "data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\"}}",
        ""
      ].join("\n"), { status: 200, headers: { "content-type": "text/event-stream" } })
    );

    const result = await callAiProvider("artistName: draft this", {
      provider: "openai-codex",
      configPath,
      authProfilesPath,
      fetchImpl
    });

    expect(result).toBe("artistName: Signal Teeth (origin: model)");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://chatgpt.com/backend-api/codex/responses");
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({
      "content-type": "application/json",
      authorization: "Bearer placeholder-access"
    });
    const body = JSON.parse(fetchImpl.mock.calls[0][1]?.body as string);
    expect(body).toMatchObject({
      model: "gpt-5.5",
      stream: true,
      store: false
    });
    expect(body.input[0].content[0].text).toBe("artistName: draft this");
  });

  it("prefers fresh Codex CLI auth over a local OpenClaw auth profile", async () => {
    const root = makeRoot();
    const codexHome = join(root, "codex-home");
    const liveToken = makeJwt(Math.floor(Date.now() / 1000) + 3600);
    await writeCodexCliAuthFixture(codexHome, liveToken);
    const { configPath, authProfilesPath } = await writeOpenClawAuthFixture(root, { access: "static-access" });
    vi.stubEnv("OPENCLAW_CODEX_AUTH_FROM_CLI", "on");
    vi.stubEnv("CODEX_HOME", codexHome);
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ output_text: "artistName: Live Codex (origin: model)" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    const result = await callAiProvider("artistName: draft this", {
      provider: "openai-codex",
      configPath,
      authProfilesPath,
      fetchImpl
    });

    expect(result).toBe("artistName: Live Codex (origin: model)");
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({
      authorization: `Bearer ${liveToken}`
    });
  });

  it("falls back to a fresh OpenClaw profile when the Codex CLI token is expired", async () => {
    const root = makeRoot();
    const codexHome = join(root, "codex-home");
    await writeCodexCliAuthFixture(codexHome, makeJwt(Math.floor(Date.now() / 1000) - 60));
    const { configPath, authProfilesPath } = await writeOpenClawAuthFixture(root, { access: "static-access" });
    vi.stubEnv("OPENCLAW_CODEX_AUTH_FROM_CLI", "on");
    vi.stubEnv("CODEX_HOME", codexHome);
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ output_text: "artistName: Static Fallback (origin: model)" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    const result = await callAiProvider("artistName: draft this", {
      provider: "openai-codex",
      configPath,
      authProfilesPath,
      fetchImpl
    });

    expect(result).toBe("artistName: Static Fallback (origin: model)");
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({
      authorization: "Bearer static-access"
    });
  });

  it("returns not configured when both Codex CLI and OpenClaw profiles are expired", async () => {
    const root = makeRoot();
    const codexHome = join(root, "codex-home");
    await writeCodexCliAuthFixture(codexHome, makeJwt(Math.floor(Date.now() / 1000) - 60));
    const { configPath, authProfilesPath } = await writeOpenClawAuthFixture(root, {
      access: "static-access",
      expires: Date.now() - 60_000
    });
    vi.stubEnv("OPENCLAW_CODEX_AUTH_FROM_CLI", "on");
    vi.stubEnv("CODEX_HOME", codexHome);
    const fetchImpl = vi.fn();

    const result = await callAiProvider("field: draft", {
      provider: "openai-codex",
      configPath,
      authProfilesPath,
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    expect(result).toContain("not configured");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses the OpenClaw profile when Codex CLI auth is absent", async () => {
    const root = makeRoot();
    const codexHome = join(root, "codex-home");
    const { configPath, authProfilesPath } = await writeOpenClawAuthFixture(root, { access: "static-access" });
    vi.stubEnv("OPENCLAW_CODEX_AUTH_FROM_CLI", "on");
    vi.stubEnv("CODEX_HOME", codexHome);
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ output_text: "artistName: Static Missing CLI (origin: model)" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    const result = await callAiProvider("artistName: draft this", {
      provider: "openai-codex",
      configPath,
      authProfilesPath,
      fetchImpl
    });

    expect(result).toBe("artistName: Static Missing CLI (origin: model)");
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({
      authorization: "Bearer static-access"
    });
  });

  it("honors OPENCLAW_CODEX_AUTH_FROM_CLI=off", async () => {
    const root = makeRoot();
    const codexHome = join(root, "codex-home");
    await writeCodexCliAuthFixture(codexHome, makeJwt(Math.floor(Date.now() / 1000) + 3600));
    const { configPath, authProfilesPath } = await writeOpenClawAuthFixture(root, { access: "static-access" });
    vi.stubEnv("OPENCLAW_CODEX_AUTH_FROM_CLI", "off");
    vi.stubEnv("CODEX_HOME", codexHome);
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ output_text: "artistName: Static Disabled CLI (origin: model)" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    const result = await callAiProvider("artistName: draft this", {
      provider: "openai-codex",
      configPath,
      authProfilesPath,
      fetchImpl
    });

    expect(result).toBe("artistName: Static Disabled CLI (origin: model)");
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({
      authorization: "Bearer static-access"
    });
  });

  it("decodes JWT exp values from Codex CLI access tokens", () => {
    expect(decodeJwtExpMs(makeJwt(1234))).toBe(1234000);
    expect(decodeJwtExpMs("not-a-jwt")).toBeUndefined();
  });

  it("keeps parsing JSON response payloads for unit-level transport mocks", async () => {
    const root = makeRoot();
    const { configPath, authProfilesPath } = await writeOpenClawAuthFixture(root);
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ output_text: "artistName: JSON Wire (origin: model)" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    const result = await callAiProvider("artistName: draft this", {
      provider: "openai-codex",
      configPath,
      authProfilesPath,
      fetchImpl
    });

    expect(result).toBe("artistName: JSON Wire (origin: model)");
  });

  it("falls back to a mock placeholder on provider HTTP failure", async () => {
    const root = makeRoot();
    const { configPath, authProfilesPath } = await writeOpenClawAuthFixture(root);
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 500 }));

    const result = await callAiProvider("field: draft", {
      provider: "openai-codex",
      configPath,
      authProfilesPath,
      fetchImpl
    });

    expect(result).toContain("Mock provider fallback (500): field: draft");
  });

  it("falls back to a mock placeholder on timeout", async () => {
    const root = makeRoot();
    const { configPath, authProfilesPath } = await writeOpenClawAuthFixture(root);
    const fetchImpl = vi.fn(() => new Promise<Response>(() => undefined));

    const result = await callAiProvider("field: draft", {
      provider: "openai-codex",
      configPath,
      authProfilesPath,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 1
    });

    expect(result).toContain("Mock provider fallback (request failed): field: draft");
  });

  it("returns not configured when no openai-codex auth profile is present", async () => {
    const root = makeRoot();
    const configPath = join(root, "openclaw.json");
    const authProfilesPath = join(root, "auth-profiles.json");
    await writeFile(configPath, "{}\n", "utf8");
    await writeFile(authProfilesPath, `${JSON.stringify({ version: 1, profiles: {} })}\n`, "utf8");

    await expect(callAiProvider("field: draft", { provider: "openai-codex", configPath, authProfilesPath })).resolves.toContain(
      "not configured"
    );
  });

  it("blocks secret-like prompts before HTTP", async () => {
    const root = makeRoot();
    const { configPath, authProfilesPath } = await writeOpenClawAuthFixture(root);
    const fetchImpl = vi.fn();

    const result = await callAiProvider("API_KEY=do-not-send", {
      provider: "openai-codex",
      configPath,
      authProfilesPath,
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    expect(result).toContain("Mock provider fallback (secret-like prompt blocked)");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("lets persona proposer parse an openai-codex response through the real provider path", async () => {
    const root = makeRoot();
    const { configPath, authProfilesPath } = await writeOpenClawAuthFixture(root);
    vi.stubEnv("OPENCLAW_CONFIG", configPath);
    vi.stubEnv("OPENCLAW_AUTH_PROFILES", authProfilesPath);
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response([
        "event: response.output_text.delta",
        `data: ${JSON.stringify({
          type: "response.output_text.delta",
          delta: [
            "obsessions: public transit ghosts and broken neon (origin: model)",
            "socialVoice: short, dry, and unsalesy (origin: model)"
          ].join("\n")
        })}`,
        "",
        "event: response.completed",
        "data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\"}}",
        ""
      ].join("\n"), { status: 200, headers: { "content-type": "text/event-stream" } })
    ));

    const result = await proposePersonaFields({
      fields: ["obsessions", "socialVoice"],
      source: {
        artistMd: "# ARTIST.md\n\n## Voice\n\nImported voice.",
        soulMd: "# SOUL.md\n\nDirect.",
        customSections: ["Voice"]
      }
    }, { aiReviewProvider: "openai-codex" });

    expect(result.provider).toBe("openai-codex");
    expect(result.drafts).toEqual([
      {
        field: "obsessions",
        draft: "public transit ghosts and broken neon",
        reasoning: "model",
        status: "proposed"
      },
      {
        field: "socialVoice",
        draft: "short, dry, and unsalesy",
        reasoning: "model",
        status: "proposed"
      }
    ]);
  });
});
