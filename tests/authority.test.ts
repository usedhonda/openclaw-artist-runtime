import { describe, expect, it } from "vitest";
import { decideMusicAuthority } from "../src/services/musicAuthority";
import { decideSocialAuthority } from "../src/services/socialAuthority";

describe("music authority", () => {
  it("allows prepare even in dry-run", () => {
    expect(
      decideMusicAuthority({
        dryRun: true,
        authority: "prepare_only",
        budgetRemaining: 10,
        requestedAction: "prepare"
      }).allowed
    ).toBe(true);
  });

  it("blocks dry-run Suno create", () => {
    expect(
      decideMusicAuthority({
        dryRun: true,
        authority: "auto_create_with_budget",
        budgetRemaining: 10,
        requestedAction: "create"
      }).allowed
    ).toBe(false);
  });

  it("hard-stops on worker challenges", () => {
    const result = decideMusicAuthority({
      dryRun: false,
      authority: "auto_create_and_select_take",
      budgetRemaining: 10,
      requestedAction: "create",
      workerState: "captcha"
    });
    expect(result.allowed).toBe(false);
    expect(result.hardStop).toBe(true);
  });
});

describe("social authority", () => {
  it("blocks dry-run publish", () => {
    expect(
      decideSocialAuthority({
        dryRun: true,
        authority: "auto_publish",
        platform: "x",
        risk: "low",
        postType: "observation",
        capabilityAvailable: true
      }).allowed
    ).toBe(false);
  });

  it("requires approval for high-risk replies", () => {
    const result = decideSocialAuthority({
      dryRun: false,
      authority: "auto_publish_and_low_risk_replies",
      platform: "x",
      risk: "high",
      postType: "reply",
      requestedAction: "reply",
      capabilityAvailable: true
    });
    expect(result.allowed).toBe(false);
    expect(result.requiresApproval).toBe(true);
  });

  it("blocks unsupported platform capability", () => {
    const result = decideSocialAuthority({
      dryRun: false,
      authority: "auto_publish_visuals",
      platform: "instagram",
      risk: "low",
      postType: "lyric_card",
      capabilityAvailable: "unknown"
    });
    expect(result.allowed).toBe(false);
  });
});
