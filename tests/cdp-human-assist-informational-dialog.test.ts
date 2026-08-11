import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";
import { dismissKnownSunoInformationalDialog } from "../src/services/cdpHumanAssistDriver";

const TERMS_DIALOG_CLOSE_SELECTOR =
  '[role="dialog"]:has-text("Our Terms Are Changing") button[aria-label="Close"]';

function pageWithSelector(options: { visible: boolean }) {
  const click = vi.fn(async () => undefined);
  const locator = {
    first: () => locator,
    isVisible: async () => options.visible,
    click
  };
  const page = {
    locator: vi.fn((selector: string) => {
      expect(selector).toBe(TERMS_DIALOG_CLOSE_SELECTOR);
      return locator;
    })
  } as unknown as Page;
  return { page, click };
}

describe("dismissKnownSunoInformationalDialog", () => {
  it("closes the confirmed Terms update dialog before Create", async () => {
    const { page, click } = pageWithSelector({ visible: true });

    await expect(dismissKnownSunoInformationalDialog(page)).resolves.toBe(true);
    expect(click).toHaveBeenCalledOnce();
  });

  it("does not click when the known informational dialog is absent", async () => {
    const { page, click } = pageWithSelector({ visible: false });

    await expect(dismissKnownSunoInformationalDialog(page)).resolves.toBe(false);
    expect(click).not.toHaveBeenCalled();
  });
});
