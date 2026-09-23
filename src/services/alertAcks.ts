import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type AckMap = Record<string, string>;

function ackPath(root: string): string {
  return join(root, "runtime", "alert-acks.json");
}

export async function readAlertAcks(root: string): Promise<AckMap> {
  const contents = await readFile(ackPath(root), "utf8").catch(() => "");
  if (!contents) {
    return {};
  }
  return JSON.parse(contents) as AckMap;
}

export async function acknowledgeAlert(root: string, alertId: string): Promise<{ id: string; ackedAt: string }> {
  const current = await readAlertAcks(root);
  const ackedAt = new Date().toISOString();
  current[alertId] = ackedAt;
  await mkdir(join(root, "runtime"), { recursive: true });
  await writeFile(ackPath(root), `${JSON.stringify(current, null, 2)}\n`, "utf8");
  return { id: alertId, ackedAt };
}
