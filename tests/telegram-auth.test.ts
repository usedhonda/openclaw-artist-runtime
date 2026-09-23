import { describe, expect, it } from "vitest";
import { assertOwner, getTelegramOwnerUserIds } from "../src/services/telegramAuth";

describe("telegram auth", () => {
  it("builds an owner allowlist from TELEGRAM_OWNER_USER_IDS", () => {
    const owners = getTelegramOwnerUserIds({ TELEGRAM_OWNER_USER_IDS: "123, 456 ,,789" } as NodeJS.ProcessEnv);

    expect([...owners]).toEqual(["123", "456", "789"]);
  });

  it("fails closed when the owner allowlist is empty", () => {
    expect(assertOwner(123, {} as NodeJS.ProcessEnv)).toBe(false);
  });

  it("accepts only configured owner user IDs", () => {
    const env = { TELEGRAM_OWNER_USER_IDS: "123,456" } as NodeJS.ProcessEnv;

    expect(assertOwner(123, env)).toBe(true);
    expect(assertOwner("456", env)).toBe(true);
    expect(assertOwner(789, env)).toBe(false);
  });
});
