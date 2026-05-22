import React from "../ui/node_modules/react/index.js";
import { renderToStaticMarkup } from "../ui/node_modules/react-dom/server.node.js";
import { describe, expect, it, vi } from "vitest";
import { ProducerReviewButtons } from "../ui/src/components/SongDetailCard";

describe("SongDetailCard producer review buttons", () => {
  it("renders archive/discard buttons with plain JA action labels", () => {
    const html = renderToStaticMarkup(
      React.createElement(ProducerReviewButtons, {
        onArchive: vi.fn(),
        onDiscard: vi.fn()
      })
    );

    expect(html).toContain("採用して次の曲へ");
    expect(html).toContain("破棄して次の曲へ");
    expect(html).not.toMatch(/publish|SNS|artist voice/i);
  });
});
