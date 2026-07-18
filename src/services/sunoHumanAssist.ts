/**
 * Human-assisted Suno create state machine.
 *
 * When a live create is blocked by a captcha challenge, this flow opens the CDP
 * browser, auto-fills the create form, and tries a machine submit. If the machine
 * click is met by a captcha challenge, the challenge overlay is CLOSED (never
 * solved), the window is brought to the front, the producer is alerted once, and
 * the flow waits for the producer to press Create manually. A real human click on
 * Suno's Create button passes captcha-free.
 *
 * This module is driver-agnostic and side-effect-free beyond the injected driver
 * and notifier, so the full flow (machine success / captcha -> human success /
 * timeout / error) is unit-testable without touching a real browser or Suno.
 *
 * It NEVER solves or bypasses a captcha: the only captcha action is closeChallengeOverlay.
 */

// Stable reason strings the connector maps onto autopilot handling.
export const HUMAN_ASSIST_TIMEOUT_REASON = "suno_human_assist_timeout";
export const HUMAN_ASSIST_ERROR_REASON = "suno_human_assist_error";

export interface HumanAssistSubmitOutcome {
  /**
   * "accepted": the machine click submitted and Suno accepted it (urls captured).
   * "captcha_challenge": a captcha challenge blocked the machine click.
   * "error": a non-captcha failure (login, DOM mismatch, network, etc.).
   */
  kind: "accepted" | "captcha_challenge" | "error";
  urls?: string[];
  reason?: string;
}

export interface HumanAssistWaitOutcome {
  kind: "accepted" | "timeout";
  urls?: string[];
}

export interface HumanAssistBrowserDriver {
  /** Open the CDP browser, navigate to create, and fill the form from the payload. */
  openAndFill(): Promise<void>;
  /** Attempt a machine click to submit and classify the outcome. */
  attemptMachineSubmit(): Promise<HumanAssistSubmitOutcome>;
  /** Close the captcha challenge overlay, leaving the filled form intact. Never solves it. */
  closeChallengeOverlay(): Promise<void>;
  /** Bring the browser window to the front so the producer can press Create. */
  bringToFront(): Promise<void>;
  /** Poll page/network up to timeoutMs for a producer-driven successful submit. */
  waitForHumanSubmit(timeoutMs: number): Promise<HumanAssistWaitOutcome>;
  /** Close the browser/session. Always called exactly once at the end of the flow. */
  close(): Promise<void>;
}

export interface HumanAssistNotifier {
  /** Alert the producer that a manual Create click is required. Called at most once per run. */
  awaitingHumanCreate(info: { songId: string; title: string }): void | Promise<void>;
}

export interface RunHumanAssistCreateInput {
  driver: HumanAssistBrowserDriver;
  notifier: HumanAssistNotifier;
  songId: string;
  title: string;
  timeoutMs: number;
}

export type HumanAssistCreateResult =
  | { status: "accepted"; urls: string[]; via: "machine" | "human" }
  | { status: "timeout"; reason: string }
  | { status: "error"; reason: string };

/**
 * Drive one human-assisted create attempt to a terminal result. The browser is
 * always closed exactly once before returning. The producer alert fires at most
 * once (only when the flow actually reaches the awaiting-human state), which keeps
 * re-notification to one per attempt / cycle.
 */
export async function runHumanAssistCreate(
  input: RunHumanAssistCreateInput
): Promise<HumanAssistCreateResult> {
  const { driver, notifier, songId, title, timeoutMs } = input;
  try {
    try {
      await driver.openAndFill();
    } catch (error) {
      return { status: "error", reason: describeError(error, "open_fill_failed") };
    }

    let submit: HumanAssistSubmitOutcome;
    try {
      submit = await driver.attemptMachineSubmit();
    } catch (error) {
      return { status: "error", reason: describeError(error, "machine_submit_failed") };
    }

    if (submit.kind === "accepted") {
      return { status: "accepted", urls: submit.urls ?? [], via: "machine" };
    }
    if (submit.kind === "error") {
      return { status: "error", reason: submit.reason ?? HUMAN_ASSIST_ERROR_REASON };
    }

    // captcha_challenge: close the challenge (never solve it), surface the window,
    // and hand off to the producer for a manual Create click.
    await driver.closeChallengeOverlay();
    await driver.bringToFront();
    await notifier.awaitingHumanCreate({ songId, title });

    let waited: HumanAssistWaitOutcome;
    try {
      waited = await driver.waitForHumanSubmit(timeoutMs);
    } catch (error) {
      return { status: "error", reason: describeError(error, "human_wait_failed") };
    }
    if (waited.kind === "accepted") {
      return { status: "accepted", urls: waited.urls ?? [], via: "human" };
    }
    return { status: "timeout", reason: HUMAN_ASSIST_TIMEOUT_REASON };
  } finally {
    await driver.close().catch(() => undefined);
  }
}

function describeError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message ? `${HUMAN_ASSIST_ERROR_REASON}:${fallback}:${message}` : `${HUMAN_ASSIST_ERROR_REASON}:${fallback}`;
}
