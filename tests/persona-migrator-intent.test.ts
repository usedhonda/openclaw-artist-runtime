import { mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatPersonaMigratePlan, executePersonaMigrate, planPersonaMigrate } from "../src/services/personaMigrator";
import { artistPersonaBlockStart, readArtistPersonaSummary } from "../src/services/personaFileBuilder";
import { readSoulPersonaSummary, soulPersonaBlockStart } from "../src/services/soulFileBuilder";
import { readResolvedConfig } from "../src/services/runtimeConfig";

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "artist-runtime-persona-migrate-intent-"));
}

async function writePersonaWithMissingFields(root: string): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "ARTIST.md"),
    [
      "# ARTIST.md",
      "",
      "## Public Identity",
      "",
      "Artist name: Intent Artist",
      "",
      "An artist imported from a notebook with enough identity to keep.",
      "",
      "## Current Artist Core",
      "",
      "- Core obsessions:",
      "  - radio",
      "- Emotional weather:",
      "  - focused",
      "",
      "## Sound",
      "",
      "- Frosted station folk with close vocal and rusted percussion.",
      "",
      "## Lyrics",
      "",
      "- Avoid glossy slogans and direct voice cloning.",
      "",
      "## Voice",
      "",
      "- Custom voice material that should remain outside the marker."
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    join(root, "SOUL.md"),
    [
      "<!-- custom imported soul header -->",
      "",
      "# SOUL.md",
      "",
      "## Producer (relationship in music-making)",
      "",
      "### Producer call",
      "- producer_callname: Producer",
      "",
      "Keep the operator close, but do not turn soft."
    ].join("\n"),
    "utf8"
  );
}

describe("persona migrate operator intent", () => {
  it("adds mock draft proposals for missing or thin fields and writes them on confirm", async () => {
    const root = makeRoot();
    await writePersonaWithMissingFields(root);

    const plan = await planPersonaMigrate(root, {
      intent: [
        "obsessions: 日本社会の風刺、批評、皮肉",
        "socialVoice: 短く、刺さるように、過剰な売り込みは避ける",
        "soul-tone: 御大に対しては率直、ぶっきらぼう、必要なら反論",
        "soul-refusal: できないことは「できない」と即答、言い訳しない"
      ].join("\n"),
      aiReviewProvider: "mock"
    });
    const preview = formatPersonaMigratePlan(plan);

    expect(plan.operatorIntent).toContain("日本社会の風刺");
    expect(plan.aiProvider).toBe("mock");
    expect(plan.proposedDrafts.map((draft) => draft.field)).toEqual(expect.arrayContaining(["socialVoice", "soul-tone", "soul-refusal"]));
    expect(preview).toContain("Operator intent:");
    expect(preview).toContain("Proposed drafts (AI provider=mock):");
    expect(preview).toContain("socialVoice: 短く、刺さるように、過剰な売り込みは避ける");

    await executePersonaMigrate(root, plan);
    const artist = await readFile(join(root, "ARTIST.md"), "utf8");
    const soul = await readFile(join(root, "SOUL.md"), "utf8");
    const artistSummary = await readArtistPersonaSummary(root);
    const soulSummary = await readSoulPersonaSummary(root);
    const config = await readResolvedConfig(root);

    expect(artist).toContain(artistPersonaBlockStart);
    expect(soul).toContain(soulPersonaBlockStart);
    expect(artist).not.toContain("[mock proposal based on operator intent:");
    expect(soul).not.toContain("[mock proposal based on operator intent:");
    expect(artistSummary.obsessions).toBe("日本社会の風刺, 批評, 皮肉");
    expect(artistSummary.socialVoice).toBe("短く, 刺さるように, 過剰な売り込みは避ける");
    expect(soulSummary.conversationTone).toBe("御大に対しては率直、ぶっきらぼう、必要なら反論");
    expect(soulSummary.refusalStyle).toBe("できないことは「できない」と即答、言い訳しない");
    expect(config.artist.identity).toMatchObject({ displayName: "Intent Artist", producerCallname: "Producer" });
    expect(soul).toContain("custom imported soul header");
  });

  it("honors field-specific skip directives in the preview", async () => {
    const root = makeRoot();
    await writePersonaWithMissingFields(root);

    const plan = await planPersonaMigrate(root, {
      intent: [
        "socialVoice: keep as-is, skip",
        "soul-refusal: できないことは「できない」と即答、言い訳しない"
      ].join("\n"),
      aiReviewProvider: "mock"
    });
    const socialVoiceDraft = plan.proposedDrafts.find((draft) => draft.field === "socialVoice");

    expect(socialVoiceDraft).toMatchObject({ status: "skipped", reason: "skip per operator intent" });
    expect(formatPersonaMigratePlan(plan)).toContain("- socialVoice: skip per operator intent");
  });
});
