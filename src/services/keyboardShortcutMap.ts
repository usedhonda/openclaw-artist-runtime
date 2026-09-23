export type ProducerConsoleShortcutAction = "refresh" | "probe-x" | "clear-filters" | "toggle-help";

export interface ShortcutEventLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
  targetTagName?: string;
  targetContentEditable?: boolean;
}

function isEditableTarget(event: ShortcutEventLike): boolean {
  if (event.targetContentEditable) {
    return true;
  }
  const tag = event.targetTagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

export function resolveProducerConsoleShortcut(event: ShortcutEventLike): ProducerConsoleShortcutAction | undefined {
  if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing || isEditableTarget(event)) {
    return undefined;
  }

  switch (event.key) {
    case "r":
    case "R":
      return "refresh";
    case "p":
    case "P":
      return "probe-x";
    case "Escape":
      return "clear-filters";
    case "?":
      return "toggle-help";
    default:
      return undefined;
  }
}
