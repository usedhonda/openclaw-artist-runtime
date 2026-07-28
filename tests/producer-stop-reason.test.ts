import { describe, expect, it } from "vitest";
import { summarizeStopReason } from "../src/services/producerStopReason";

describe("summarizeStopReason", () => {
  it("maps known internal Suno tokens to plain JA", () => {
    expect(summarizeStopReason("playwright_live_timeout")).toContain("時間切れ");
    expect(summarizeStopReason("suno_worker_not_ready")).toContain("接続できていない");
    expect(summarizeStopReason("schema_drift detected")).toContain("画面が想定と変わっている");
    expect(summarizeStopReason("session_expired")).toContain("ログインが切れた");
    expect(summarizeStopReason("captcha_required")).toContain("captcha");
    expect(summarizeStopReason("no imported takes")).toContain("take");
    expect(summarizeStopReason("asset render failed")).toContain("素材");
  });

  it("never leaks internal identifiers for unknown reasons", () => {
    const summary = summarizeStopReason("weird_edge residual_kanji:逃:line_20 /srv/secret/path deadbeefdeadbeef00");
    expect(summary).not.toMatch(/residual_kanji/);
    expect(summary).not.toMatch(/line_\d+/);
    expect(summary).not.toMatch(/\/srv\//);
    expect(summary).not.toMatch(/deadbeefdeadbeef/);
  });

  it("caps long unknown reasons", () => {
    const summary = summarizeStopReason("x".repeat(400));
    expect(Array.from(summary).length).toBeLessThanOrEqual(100);
  });

  it("falls back to a neutral phrase for empty input", () => {
    expect(summarizeStopReason(undefined)).toContain("記録に残した");
    expect(summarizeStopReason("")).toContain("記録に残した");
  });
});
