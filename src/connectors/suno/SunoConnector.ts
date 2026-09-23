import type { SunoCreateRequest, SunoCreateResult, SunoImportResult, SunoWorkerStatus } from "../../types.js";

export interface SunoConnector {
  status(): Promise<SunoWorkerStatus>;
  create(input: SunoCreateRequest): Promise<SunoCreateResult>;
  importResults(input: { runId: string; urls: string[] }): Promise<SunoImportResult>;
}
