export type RunCycleResult = {
  tickerOutcome?: string;
  blockedReason?: string | null;
};

export function runCycleFeedback(result: RunCycleResult): { reason: string; message: string } {
  const outcome = result.tickerOutcome ?? "";
  if (outcome.startsWith("skipped:")) {
    const skippedReason = outcome.slice("skipped:".length) || "unknown";
    return {
      reason: "run_cycle_skipped",
      message: `サイクルは ${skippedReason} でスキップ。paused/blocked 中は /resume が必要`
    };
  }
  if (outcome === "ran" && result.blockedReason) {
    return {
      reason: "run_cycle_blocked",
      message: `走ったが blockedReason で進まず: ${result.blockedReason} — /resume`
    };
  }
  return {
    reason: "run_cycle_ran",
    message: "サイクルを実行しました"
  };
}
