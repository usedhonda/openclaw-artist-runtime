import { mkdir, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createInProcessGateway } from "./harness/inProcessGateway.js";

async function createArtifact(root: string, index: number): Promise<void> {
  const runId = `run-${String(index).padStart(3, "0")}`;
  const dir = join(root, "runtime", "suno", runId);
  const path = join(dir, `track-${String(index).padStart(3, "0")}.mp3`);
  await mkdir(dir, { recursive: true });
  await writeFile(path, `mp3-${index}`, "utf8");
  const mtime = new Date(Date.UTC(2026, 3, 25, 0, 0, index));
  await utimes(path, mtime, mtime);
}

async function createArtifacts(root: string, count: number): Promise<void> {
  await Promise.all(Array.from({ length: count }, (_, index) => createArtifact(root, index + 1)));
}

describe("Suno artifacts pagination route", () => {
  it("returns the default first page with total count and hasMore", async () => {
    const gateway = await createInProcessGateway();
    try {
      await createArtifacts(gateway.workspaceRoot, 25);

      const response = await gateway.request<{
        artifacts: unknown[];
        totalCount: number;
        offset: number;
        limit: number;
        hasMore: boolean;
      }>("GET", "/plugins/artist-runtime/api/suno/artifacts");

      expect(response.body.artifacts).toHaveLength(20);
      expect(response.body.totalCount).toBe(25);
      expect(response.body.offset).toBe(0);
      expect(response.body.limit).toBe(20);
      expect(response.body.hasMore).toBe(true);
    } finally {
      await gateway.teardown();
    }
  });

  it("returns later pages without hasMore when the end is reached", async () => {
    const gateway = await createInProcessGateway();
    try {
      await createArtifacts(gateway.workspaceRoot, 25);

      const response = await gateway.request<{ artifacts: unknown[]; totalCount: number; offset: number; limit: number; hasMore: boolean }>(
        "GET",
        "/plugins/artist-runtime/api/suno/artifacts?offset=20&limit=20"
      );

      expect(response.body.artifacts).toHaveLength(5);
      expect(response.body.totalCount).toBe(25);
      expect(response.body.offset).toBe(20);
      expect(response.body.limit).toBe(20);
      expect(response.body.hasMore).toBe(false);
    } finally {
      await gateway.teardown();
    }
  });

  it("clamps over-large limits to 100", async () => {
    const gateway = await createInProcessGateway();
    try {
      await createArtifacts(gateway.workspaceRoot, 105);

      const response = await gateway.request<{ artifacts: unknown[]; totalCount: number; limit: number; hasMore: boolean }>(
        "GET",
        "/plugins/artist-runtime/api/suno/artifacts?limit=500"
      );

      expect(response.body.artifacts).toHaveLength(100);
      expect(response.body.totalCount).toBe(105);
      expect(response.body.limit).toBe(100);
      expect(response.body.hasMore).toBe(true);
    } finally {
      await gateway.teardown();
    }
  });

  it("sanitizes negative offset and zero limit", async () => {
    const gateway = await createInProcessGateway();
    try {
      await createArtifacts(gateway.workspaceRoot, 3);

      const response = await gateway.request<{ artifacts: unknown[]; offset: number; limit: number }>(
        "GET",
        "/plugins/artist-runtime/api/suno/artifacts?offset=-10&limit=0"
      );

      expect(response.body.artifacts).toHaveLength(1);
      expect(response.body.offset).toBe(0);
      expect(response.body.limit).toBe(1);
    } finally {
      await gateway.teardown();
    }
  });

  it("keeps the status Suno artifact surface capped at eight entries", async () => {
    const gateway = await createInProcessGateway();
    try {
      await createArtifacts(gateway.workspaceRoot, 12);

      const response = await gateway.request<{ artifacts?: unknown[] }>("GET", "/plugins/artist-runtime/api/suno/status");

      expect(response.body.artifacts).toHaveLength(8);
    } finally {
      await gateway.teardown();
    }
  });
});
