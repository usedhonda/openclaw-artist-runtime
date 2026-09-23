import type { AuthorityDecision, MusicAuthorityInput } from "../types.js";

const workerHardStops = new Map([
  ["login_challenge", "Suno login challenge detected"],
  ["captcha", "Suno CAPTCHA detected"],
  ["payment_prompt", "Suno payment prompt detected"],
  ["ui_mismatch", "Suno UI mismatch detected"],
  ["quota_exhausted", "Suno quota exhausted"]
]);

export function decideMusicAuthority(input: MusicAuthorityInput): AuthorityDecision {
  const hardStopReason = input.workerState ? workerHardStops.get(input.workerState) : undefined;
  if (hardStopReason) {
    return { allowed: false, reason: hardStopReason, hardStop: true, policyDecision: "stop_on_worker_hard_stop" };
  }
  if (input.dryRun && input.requestedAction !== "prepare") {
    return { allowed: false, reason: "dry-run blocks Suno create/select actions", policyDecision: "deny_dry_run" };
  }
  if (input.requestedAction === "prepare") {
    return { allowed: true, reason: "prompt-pack preparation is allowed", policyDecision: "allow_prepare" };
  }
  if (input.authority === "prepare_only") {
    return { allowed: false, reason: "Suno authority is prepare_only", policyDecision: "deny_authority" };
  }
  if (input.requestedAction === "create" && input.authority === "autofill_only") {
    return { allowed: false, reason: "Suno authority is autofill_only", policyDecision: "deny_authority" };
  }
  if (input.budgetRemaining <= 0) {
    return { allowed: false, reason: "Suno budget exhausted", hardStop: true, policyDecision: "stop_budget_exhausted" };
  }
  if (input.requestedAction === "select_take" && input.authority !== "auto_create_and_select_take") {
    return { allowed: false, reason: "Suno authority does not allow automatic take selection", policyDecision: "deny_take_selection" };
  }
  return { allowed: true, reason: "within music authority", policyDecision: "allow" };
}
