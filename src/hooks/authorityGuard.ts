import { decideMusicAuthority } from "../services/musicAuthority.js";
import { decideSocialAuthority } from "../services/socialAuthority.js";
import type { AuthorityDecision, MusicAuthorityInput, SocialAuthorityInput } from "../types.js";

export function deny(reason: string): AuthorityDecision {
  return { allowed: false, reason, hardStop: true };
}

export function allow(reason: string): AuthorityDecision {
  return { allowed: true, reason };
}

export function evaluateMusicAuthority(input: MusicAuthorityInput): AuthorityDecision {
  return decideMusicAuthority(input);
}

export function evaluateSocialAuthority(input: SocialAuthorityInput): AuthorityDecision {
  return decideSocialAuthority(input);
}
