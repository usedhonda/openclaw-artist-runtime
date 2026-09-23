import type { AuthorityDecision, SocialAuthorityInput } from "../types.js";

export function decideSocialAuthority(input: SocialAuthorityInput): AuthorityDecision {
  const requestedAction = input.requestedAction ?? "publish";
  if (input.dryRun) {
    return { allowed: false, reason: "dry-run blocks social publish", policyDecision: "deny_dry_run" };
  }
  if (input.capabilityAvailable === false || input.capabilityAvailable === "unknown") {
    return { allowed: false, reason: `${input.platform} capability is unavailable`, policyDecision: "deny_capability" };
  }
  if (input.authority === "disabled" || input.authority === "draft_only") {
    return { allowed: false, reason: `${input.platform} authority blocks live publishing`, policyDecision: "deny_authority" };
  }
  const requireApprovalForHighRisk = input.requireApprovalForHighRisk ?? true;
  if (requestedAction === "reply") {
    if (input.risk === "high" && requireApprovalForHighRisk) {
      return {
        allowed: false,
        reason: "high-risk social reply requires producer intervention",
        requiresApproval: true,
        policyDecision: "require_approval"
      };
    }
    if (input.authority === "auto_publish_and_low_risk_replies" || input.authority === "auto_posts_and_low_risk_replies" || input.authority === "full_social_autonomy") {
      return { allowed: true, reason: `allowed ${input.platform}:reply`, policyDecision: "allow_reply" };
    }
    return { allowed: false, reason: `${input.platform} authority does not allow replies`, policyDecision: "deny_reply" };
  }
  if (input.risk === "high" && requireApprovalForHighRisk) {
    return {
      allowed: false,
      reason: "high-risk social action requires producer intervention",
      requiresApproval: true,
      policyDecision: "require_approval"
    };
  }
  return { allowed: true, reason: `allowed ${input.platform}:${input.postType}`, policyDecision: "allow_publish" };
}
