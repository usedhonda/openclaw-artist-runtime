import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

function jstDate(now = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// A deterministic X observation runner returning one fully-qualifying tweet. Use as
// `observationRunner` on runCycle so collectObservations yields real material (bypassing
// the live bird CLI and any live news fetch that would otherwise miss the cache),
// letting autopilot pipeline tests materialize a song under the observation gate.
export function validObservationRunner(): Promise<{ stdout: string }> {
  return Promise.resolve({
    stdout: "@citywatch 再開発で古いライブハウスが消え、跡地に同じ色の看板だけが増えた街の温度 https://x.com/citywatch/status/2222222222222222222 2026-05-09T08:00:00.000Z"
  });
}

// Write a today-dated X observation file with one fully-qualifying entry (full
// tweet URL + author + postedAt). Since the materialization gate now holds a
// cycle when no news/X material exists, autopilot pipeline tests that expect a
// song to be created must have real observation material present. A fresh file
// is served from cache by collectObservations (no live bird call) and read by
// the spawn proposer as a qualifying observation summary, so both the Path B
// (createSongIdea) and Path A (proposeSpawn) materialization paths proceed.
export async function seedTodayObservation(
  root: string,
  options: { now?: Date; text?: string; author?: string; url?: string } = {}
): Promise<void> {
  const now = options.now ?? new Date();
  const text = options.text ?? "再開発で古いライブハウスが消え、跡地に同じ色の看板だけが増えた街の温度";
  const author = options.author ?? "citywatch";
  const url = options.url ?? "https://x.com/citywatch/status/2222222222222222222";
  const dir = join(root, "observations");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${jstDate(now)}.md`),
    [
      `- text: ${JSON.stringify(text)}`,
      `  author: ${JSON.stringify(author)}`,
      `  url: ${JSON.stringify(url)}`,
      `  postedAt: "2026-05-09T08:00:00.000Z"`,
      ""
    ].join("\n"),
    "utf8"
  );
}
