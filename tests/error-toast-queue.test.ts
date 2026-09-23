import { describe, expect, it } from "vitest";
import { dismissErrorToast, expireErrorToasts, pushErrorToast } from "../src/services/errorToastQueue";

describe("error toast queue", () => {
  it("adds a new toast with a source/reason stable id", () => {
    const queue = pushErrorToast([], { source: "network", reason: "refresh_failed", message: "timeout" }, 1000);

    expect(queue).toMatchObject([
      {
        id: "network:refresh_failed",
        source: "network",
        reason: "refresh_failed",
        message: "timeout",
        count: 1
      }
    ]);
  });

  it("deduplicates repeated source/reason pairs within the dedup window", () => {
    const first = pushErrorToast([], { source: "probe", reason: "x_probe_failed", message: "cold profile" }, 1000);
    const second = pushErrorToast(first, { source: "probe", reason: "x_probe_failed", message: "still cold" }, 1200);

    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ count: 2, message: "still cold", updatedAt: 1200 });
  });

  it("keeps newer toasts when the queue exceeds max size", () => {
    let queue: ReturnType<typeof pushErrorToast> = [];
    for (let index = 0; index < 4; index += 1) {
      queue = pushErrorToast(queue, { source: "runtime", reason: `reason-${index}`, message: "boom" }, 1000 + index, { maxSize: 3 });
    }

    expect(queue.map((toast) => toast.reason)).toEqual(["reason-1", "reason-2", "reason-3"]);
  });

  it("dismisses a toast by id", () => {
    const queue = pushErrorToast([], { source: "config-patch", reason: "config_update_failed", message: "400" }, 1000);

    expect(dismissErrorToast(queue, "config-patch:config_update_failed")).toEqual([]);
  });

  it("expires toasts after their dismiss window", () => {
    const queue = pushErrorToast([], { source: "network", reason: "refresh_failed", message: "timeout" }, 1000, { dismissMs: 50 });

    expect(expireErrorToasts(queue, 1049)).toHaveLength(1);
    expect(expireErrorToasts(queue, 1051)).toEqual([]);
  });
});
