// Shared Suno take-count constant. Suno always produces exactly two takes per
// generation, so this is the single source of truth for both the DOM create
// driver (sunoPlaywrightDriver) and the driver-agnostic take-URL delivery path
// (sunoTakeUrls). Keeping it here lets sunoTakeUrls avoid importing the large
// playwright driver just for a constant.
export const PLAYWRIGHT_EXPECTED_CREATE_CARD_COUNT = 2;
