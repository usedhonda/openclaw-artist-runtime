import { describe, expect, it } from "vitest";
import { resolveProducerConsoleShortcut } from "../src/services/keyboardShortcutMap";

describe("keyboard shortcut map", () => {
  it("maps producer console global shortcuts", () => {
    expect(resolveProducerConsoleShortcut({ key: "r" })).toBe("refresh");
    expect(resolveProducerConsoleShortcut({ key: "P" })).toBe("probe-x");
    expect(resolveProducerConsoleShortcut({ key: "Escape" })).toBe("clear-filters");
    expect(resolveProducerConsoleShortcut({ key: "?" })).toBe("toggle-help");
  });

  it("ignores shortcuts when modifier keys are active", () => {
    expect(resolveProducerConsoleShortcut({ key: "r", metaKey: true })).toBeUndefined();
    expect(resolveProducerConsoleShortcut({ key: "p", ctrlKey: true })).toBeUndefined();
    expect(resolveProducerConsoleShortcut({ key: "?", altKey: true })).toBeUndefined();
  });

  it("ignores shortcuts from editable targets", () => {
    expect(resolveProducerConsoleShortcut({ key: "r", targetTagName: "input" })).toBeUndefined();
    expect(resolveProducerConsoleShortcut({ key: "p", targetTagName: "textarea" })).toBeUndefined();
    expect(resolveProducerConsoleShortcut({ key: "?", targetContentEditable: true })).toBeUndefined();
  });

  it("ignores IME composition and unmapped keys", () => {
    expect(resolveProducerConsoleShortcut({ key: "r", isComposing: true })).toBeUndefined();
    expect(resolveProducerConsoleShortcut({ key: "x" })).toBeUndefined();
  });
});
