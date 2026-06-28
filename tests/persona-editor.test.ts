import { describe, expect, it } from "vitest";
import {
  buildPersonaArtistPatch,
  buildPersonaDraft,
  buildPersonaSnapshotPatch,
  buildPersonaSoulPatch,
  validatePersonaDraft,
  type PersonaEditorSource
} from "../ui/src/personaEditor";

function source(): PersonaEditorSource {
  return {
    artist: {
      artistName: "Glass Commuter",
      identityLine: "Turns commute damage into songs.",
      soundDna: "dry drums, low synth",
      obsessions: "station light, receipts",
      lyricsRules: "no slogans",
      socialVoice: "plain and short"
    },
    soul: {
      conversationTone: "short and precise",
      refusalStyle: "refuse weak ideas plainly"
    },
    identity: { text: "# IDENTITY\n\nraw identity\n" },
    producer: { text: "# PRODUCER\n\nraw producer\n" },
    inner: { text: "# INNER\n\nraw inner\n" },
    setup: { completed: true, needsSetup: false, reasons: [], reasonsText: "" },
    aiDraftSupported: ["artist", "soul"],
    provider: "mock"
  };
}

describe("personaEditor", () => {
  it("builds editable persona drafts and layer patches", () => {
    const draft = buildPersonaDraft(source());

    expect(buildPersonaArtistPatch(draft).artist).not.toHaveProperty("artistName");
    expect(buildPersonaArtistPatch(draft).artist.identityLine).toBe("Turns commute damage into songs.");
    expect(buildPersonaSoulPatch(draft).soul.conversationTone).toBe("short and precise");
    expect(buildPersonaSnapshotPatch(draft, "identity")).toEqual({
      identity: { text: "# IDENTITY\n\nraw identity\n" }
    });
  });

  it("validates only the requested layer", () => {
    const draft = buildPersonaDraft(source());
    draft.artist.artistName = "";
    draft.soul.refusalStyle = "short";

    expect(validatePersonaDraft(draft, "artist")).toBeNull();
    expect(validatePersonaDraft(draft, "soul")).toBe("refusalStyle must be at least 8 characters");
    expect(validatePersonaDraft(draft, "identity")).toBeNull();
  });

  it("rejects oversized snapshot text before route submission", () => {
    const draft = buildPersonaDraft(source());
    draft.snapshots.inner = "x".repeat(20_001);

    expect(validatePersonaDraft(draft, "inner")).toBe("inner text must be 20000 characters or fewer");
  });
});
