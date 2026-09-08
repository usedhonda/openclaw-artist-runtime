import type { ArtistToolContext } from "../pluginApi.js";

export function getTelegramOwnerUserIds(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = env.TELEGRAM_OWNER_USER_IDS?.trim();
  if (!raw) {
    return new Set();
  }

  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
}

export function assertOwner(userId: string | number, env: NodeJS.ProcessEnv = process.env): boolean {
  const owners = getTelegramOwnerUserIds(env);
  if (owners.size === 0) {
    return false;
  }
  return owners.has(String(userId));
}
export function assertProducer(context: ArtistToolContext | undefined, action: string): void {
  const messageChannel = context?.messageChannel?.trim().toLowerCase();
  const deliveryChannel = context?.deliveryContext?.channel?.trim().toLowerCase();
  const telegram = messageChannel === "telegram" || deliveryChannel === "telegram";
  const conflictingChannels = messageChannel && deliveryChannel && messageChannel !== deliveryChannel;
  const authorized = telegram
    ? !conflictingChannels && typeof context?.requesterSenderId === "string" && assertOwner(context.requesterSenderId)
    : context?.senderIsOwner === true;
  if (!authorized) throw new Error(`producer-only ${action}`);
}
