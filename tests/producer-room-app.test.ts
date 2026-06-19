import React from "../ui/node_modules/react/index.js";
import { renderToStaticMarkup } from "../ui/node_modules/react-dom/server.node.js";
import { describe, expect, it } from "vitest";
import { RoomHeader } from "../ui/src/ProducerRoomApp";
import type { DraftBoxNextActionSummary } from "../src/types";

function summary(overrides: Partial<DraftBoxNextActionSummary>): DraftBoxNextActionSummary {
  return {
    kind: "empty",
    currentLine: "今: 次の素案を探している",
    draftCount: 0,
    buildingCount: 0,
    nextAction: "次: 素案通知を待つ。",
    stateKey: "test",
    ...overrides
  };
}

describe("ProducerRoomApp room header", () => {
  it("renders healthy states without an operation button", () => {
    const html = renderToStaticMarkup(
      React.createElement(RoomHeader, {
        summary: summary({
          kind: "draft_idle",
          currentLine: "今: 手が空いている",
          draftCount: 2,
          nextAction: "次: 草稿箱から「作る」を押す。"
        })
      })
    );

    expect(html).toContain("Artist is:");
    expect(html).toContain("今: 手が空いている");
    expect(html).toContain("Status:");
    expect(html).toContain("健康");
    expect(html).toContain("Nothing needed");
    expect(html).not.toContain("<button");
  });

  it("renders exactly one Resume CTA for paused states", () => {
    const html = renderToStaticMarkup(
      React.createElement(RoomHeader, {
        summary: summary({
          kind: "paused",
          currentLine: "今: autopilot は停止中",
          nextAction: "次: /resume で再開できる。",
          reason: "user_paused"
        }),
        onResume: () => undefined
      })
    );

    expect(html).toContain("Status:");
    expect(html).toContain("詰まり");
    expect(html).toContain("Why:");
    expect(html).toContain("user_paused");
    expect(html.match(/<button/g)?.length).toBe(1);
    expect(html).toContain("Resume");
  });

  it("renders reauth_required as guidance without a false fix button", () => {
    const html = renderToStaticMarkup(
      React.createElement(RoomHeader, {
        summary: summary({
          kind: "reauth_required",
          currentLine: "今: 歌詞AIのトークンが失効し制作が止まっている",
          nextAction: "次: 歌詞AIの再認証が必要。/resume では直りません",
          reason: "ai_provider_not_configured: 歌詞AIのトークン失効/未設定"
        })
      })
    );

    expect(html).toContain("要再認証");
    expect(html).toContain("歌詞AIの再認証が必要 (/resume では直りません)");
    expect(html).toContain("ai_provider_not_configured");
    expect(html).not.toContain("<button");
  });
});
