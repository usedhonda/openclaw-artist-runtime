import { describe, expect, it } from "vitest";
import { isPublishBlockedByDryRun } from "../src/services/autopilotService.js";

describe("isPublishBlockedByDryRun", () => {
  it("returns false when the publish result was accepted", () => {
    expect(
      isPublishBlockedByDryRun(
        { accepted: true, dryRun: false },
        { policyDecision: undefined }
      )
    ).toBe(false);
  });

  it("returns true when result.dryRun is set even if reason wording changes", () => {
    expect(
      isPublishBlockedByDryRun(
        { accepted: false, dryRun: true },
        { policyDecision: { allowed: false, reason: "blocked by policy" } as never }
      )
    ).toBe(true);
  });

  it("returns true when policyDecision is deny_dry_run even if result.dryRun is undefined", () => {
    expect(
      isPublishBlockedByDryRun(
        { accepted: false, dryRun: undefined as never },
        { policyDecision: { allowed: false, reason: "dry-run blocks social publish", policyDecision: "deny_dry_run" } as never }
      )
    ).toBe(true);
  });

  it("returns false when neither dryRun nor deny_dry_run signal is present", () => {
    expect(
      isPublishBlockedByDryRun(
        { accepted: false, dryRun: false },
        { policyDecision: { allowed: false, reason: "rate limited", policyDecision: "deny_capability" } as never }
      )
    ).toBe(false);
  });
});
