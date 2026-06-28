import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { applyConfigDefaults } from "../config/schema.js";
import type { ArtistRuntimeConfig, SocialAssetRecord, SocialPlatform } from "../types.js";
import { readSongState, updateSongState } from "./artistState.js";
import { appendPromptLedger, createPromptLedgerEntry, getSongPromptLedgerPath } from "./promptLedger.js";

export interface PrepareSocialAssetsInput {
  workspaceRoot: string;
  songId: string;
  config?: Partial<ArtistRuntimeConfig>;
}

function captionPath(root: string, songId: string, platform: SocialPlatform): string {
  const suffix = platform === "x" ? "post" : "caption";
  return join(root, "songs", songId, "social", `${platform}-${suffix}.md`);
}

function buildCopy(platform: SocialPlatform, title: string, reason?: string, takeId?: string): string {
  const lead = platform === "x" ? title : `${title}\n`;
  return [
    lead,
    reason ?? "The signal stayed after the room went dark.",
    takeId ? `Source take: ${takeId}` : "Source take: pending selection",
    "Public note: direct, observant, never salesy."
  ].join("\n");
}

function defaultPostType(platform: SocialPlatform): string {
  return platform === "x" ? "observation" : platform === "instagram" ? "lyric_card" : "hook_clip";
}

export async function prepareSocialAssets(input: PrepareSocialAssetsInput): Promise<SocialAssetRecord[]> {
  const config = applyConfigDefaults(input.config);
  if (config.distribution.dailySharing === "off") {
    throw new Error("daily_sharing_off");
  }
  const song = await readSongState(input.workspaceRoot, input.songId);
  if (!song.selectedTakeId) {
    throw new Error(`cannot prepare social assets before take selection for ${input.songId}`);
  }

  const enabledPlatforms = (Object.entries(config.distribution.platforms) as Array<[SocialPlatform, ArtistRuntimeConfig["distribution"]["platforms"][SocialPlatform]]>)
    .filter(([, platform]) => platform.enabled)
    .map(([platform]) => platform);
  const targets = (enabledPlatforms.length > 0 ? enabledPlatforms : (["x"] as SocialPlatform[]))
    .filter((platform) => config.distribution.platforms[platform].autoPostTypes.includes(defaultPostType(platform)));
  if (targets.length === 0) {
    throw new Error("no_enabled_auto_post_types");
  }

  const records: SocialAssetRecord[] = [];
  await mkdir(join(input.workspaceRoot, "songs", input.songId, "social"), { recursive: true });
  for (const platform of targets) {
    const textPath = captionPath(input.workspaceRoot, input.songId, platform);
    const copy = buildCopy(platform, song.title, song.lastReason, song.selectedTakeId);
    await writeFile(textPath, `${copy}\n`, "utf8");
    records.push({
      songId: input.songId,
      platform,
      postType: defaultPostType(platform),
      textPath,
      mediaRefs: [],
      sourceTakeId: song.selectedTakeId
    });
  }

  await writeFile(
    join(input.workspaceRoot, "songs", input.songId, "social", "assets.json"),
    `${JSON.stringify(records, null, 2)}\n`,
    "utf8"
  );
  await appendPromptLedger(
    getSongPromptLedgerPath(input.workspaceRoot, input.songId),
    createPromptLedgerEntry({
      stage: "social_asset_prepare",
      songId: input.songId,
      actor: "artist",
      inputRefs: [join(input.workspaceRoot, "songs", input.songId, "suno", "selected-take.json")],
      outputRefs: records.map((record) => record.textPath),
      outputSummary: records.map((record) => `${record.platform}:${record.postType}`).join(", ")
    })
  );
  await updateSongState(input.workspaceRoot, input.songId, {
    status: "social_assets",
    reason: "social assets prepared"
  });

  return records;
}
