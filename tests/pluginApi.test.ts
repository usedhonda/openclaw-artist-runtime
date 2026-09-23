import { describe, expect, it } from "vitest";
import { safeRegisterService } from "../src/pluginApi.js";

describe("safeRegisterService", () => {
  it("stops the exact instance start() created, not a freshly built second instance", async () => {
    let createCount = 0;
    const startedInstances: number[] = [];
    const stoppedInstances: number[] = [];

    let capturedStart: (() => unknown | Promise<unknown>) | undefined;
    let capturedStop: (() => unknown | Promise<unknown>) | undefined;

    const api = {
      registerService: (definition: { start?: () => unknown | Promise<unknown>; stop?: () => unknown | Promise<unknown> }) => {
        capturedStart = definition.start;
        capturedStop = definition.stop;
      }
    };

    safeRegisterService(api, {
      name: "probe",
      create: () => {
        createCount += 1;
        const id = createCount;
        return {
          start: () => {
            startedInstances.push(id);
          },
          stop: () => {
            stoppedInstances.push(id);
          }
        };
      }
    });

    await capturedStart?.();
    await capturedStop?.();

    // Before the fix: stop() called service.create() a second time, so
    // stoppedInstances would record instance 2 while startedInstances recorded
    // instance 1 — the running instance was never actually stopped.
    expect(createCount).toBe(1);
    expect(startedInstances).toEqual([1]);
    expect(stoppedInstances).toEqual([1]);
  });

  it("stop() is a no-op when start() was never called", async () => {
    let capturedStop: (() => unknown | Promise<unknown>) | undefined;
    const api = {
      registerService: (definition: { stop?: () => unknown | Promise<unknown> }) => {
        capturedStop = definition.stop;
      }
    };

    safeRegisterService(api, {
      name: "probe",
      create: () => ({ start: () => undefined, stop: () => { throw new Error("should not be called"); } })
    });

    await expect(capturedStop?.()).resolves.toBeUndefined();
  });

  it("is a no-op when the api does not implement registerService", () => {
    expect(() => safeRegisterService({}, { name: "probe", create: () => ({}) })).not.toThrow();
  });
});
