export const errorRunbookMap: Record<string, string> = {
  requires_explicit_live_go: "docs/ERRORS.md#requires_explicit_live_go",
  "dry-run blocks publish": "docs/ERRORS.md#dry-run-blocks-publish",
  "dry-run blocks social publish": "docs/ERRORS.md#dry-run-blocks-social-publish",
  bird_cli_not_installed: "docs/ERRORS.md#bird_cli_not_installed",
  bird_auth_expired: "docs/ERRORS.md#bird_auth_expired",
  bird_probe_failed: "docs/ERRORS.md#bird_probe_failed",
  bird_rate_limited: "docs/ERRORS.md#bird_rate_limited",
  bird_compose_failed: "docs/ERRORS.md#bird_compose_failed",
  bird_dry_run_submit_failed: "docs/ERRORS.md#bird_dry_run_submit_failed",
  instagram_auth_not_configured: "docs/ERRORS.md#instagram_auth_not_configured",
  instagram_media_invalid: "docs/ERRORS.md#instagram_media_invalid",
  instagram_business_account_not_found: "docs/ERRORS.md#instagram_business_account_not_found",
  instagram_graph_accounts_failed_401: "docs/ERRORS.md#instagram_graph_accounts_failed_401",
  instagram_graph_accounts_failed_403: "docs/ERRORS.md#instagram_graph_accounts_failed_403",
  instagram_graph_accounts_failed_429: "docs/ERRORS.md#instagram_graph_accounts_failed_429",
  instagram_graph_media_failed_429: "docs/ERRORS.md#instagram_graph_media_failed_429",
  instagram_graph_publish_failed_500: "docs/ERRORS.md#instagram_graph_publish_failed_500",
  tiktok_account_not_created: "docs/ERRORS.md#tiktok_account_not_created",
  account_not_created: "docs/ERRORS.md#account_not_created",
  budget_exhausted: "docs/ERRORS.md#budget_exhausted",
  budget_exhausted_monthly: "docs/ERRORS.md#budget_exhausted_monthly",
  playwright_create_timeout: "docs/ERRORS.md#playwright_create_timeout",
  playwright_create_network_error: "docs/ERRORS.md#playwright_create_network_error",
  playwright_create_dom_missing: "docs/ERRORS.md#playwright_create_dom_missing",
  playwright_create_login_expired: "docs/ERRORS.md#playwright_create_login_expired",
  playwright_create_rate_limited: "docs/ERRORS.md#playwright_create_rate_limited",
  gateway_token_mismatch: "docs/ERRORS.md#gateway_token_mismatch"
};

export function runbookHref(reason?: string): string | undefined {
  return reason ? errorRunbookMap[reason] : undefined;
}
