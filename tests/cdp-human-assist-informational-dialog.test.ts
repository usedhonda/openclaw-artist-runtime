import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";
import { dismissSafeSunoBlockingDialog } from "../src/services/cdpHumanAssistDriver";

const DIALOG_SELECTOR = '[role="dialog"]';
const CLOSE_SELECTOR = 'button[aria-label="Close"]';
const SENSITIVE_CONTROL_SELECTOR = "input, textarea, select, iframe";

function pageWithDialog(options: {
  text: string;
  visible?: boolean;
  closeVisible?: boolean;
  sensitiveControlCount?: number;
}) {
  const click = vi.fn(async () => undefined);
  const closeButton = {
    first: () => closeButton,
    isVisible: async () => options.closeVisible ?? true,
    click
  };
  const sensitiveControls = {
    count: async () => options.sensitiveControlCount ?? 0
  };
  const dialog = {
    isVisible: async () => options.visible ?? true,
    innerText: async () => options.text,
    locator: vi.fn((selector: string) => {
      if (selector === CLOSE_SELECTOR) return closeButton;
      expect(selector).toBe(SENSITIVE_CONTROL_SELECTOR);
      return sensitiveControls;
    })
  };
  const dialogs = {
    count: async () => 1,
    nth: () => dialog
  };
  const page = {
    locator: vi.fn((selector: string) => {
      expect(selector).toBe(DIALOG_SELECTOR);
      return dialogs;
    })
  } as unknown as Page;
  return { page, click };
}

describe("dismissSafeSunoBlockingDialog", () => {
  it("closes the confirmed Terms update dialog before Create", async () => {
    const { page, click } = pageWithDialog({ text: "Our Terms Are Changing" });

    await expect(dismissSafeSunoBlockingDialog(page)).resolves.toBe(true);
    expect(click).toHaveBeenCalledOnce();
  });

  it("closes a future non-transactional news or upsell dialog through Close", async () => {
    const { page, click } = pageWithDialog({ text: "New creation tools are available. Learn more." });

    await expect(dismissSafeSunoBlockingDialog(page)).resolves.toBe(true);
    expect(click).toHaveBeenCalledOnce();
  });

  it.each([
    "Please log in to continue",
    "Verify you are human",
    "Enter payment details to check out",
    "Accept the updated terms to continue"
  ])("leaves sensitive dialog fail-closed: %s", async (text) => {
    const { page, click } = pageWithDialog({ text });

    await expect(dismissSafeSunoBlockingDialog(page)).resolves.toBe(false);
    expect(click).not.toHaveBeenCalled();
  });

  it("does not close a dialog containing form or challenge controls", async () => {
    const { page, click } = pageWithDialog({ text: "Notice", sensitiveControlCount: 1 });

    await expect(dismissSafeSunoBlockingDialog(page)).resolves.toBe(false);
    expect(click).not.toHaveBeenCalled();
  });
});
