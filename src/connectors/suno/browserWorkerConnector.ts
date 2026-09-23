import type { ArtistRuntimeConfig, SunoCreateRequest, SunoCreateResult, SunoImportResult } from "../../types.js";
import { SunoBrowserWorker } from "../../services/sunoBrowserWorker.js";
import type { SunoConnector } from "./SunoConnector.js";

type WorkerMethods = Pick<SunoBrowserWorker, "status" | "startCreate" | "importRun">;
type ConnectorOptions = {
  config?: Partial<ArtistRuntimeConfig>;
  worker?: WorkerMethods;
};

function isWorkerMethods(value: ConnectorOptions | WorkerMethods | undefined): value is WorkerMethods {
  return Boolean(
    value
      && "status" in value
      && typeof value.status === "function"
      && "startCreate" in value
      && typeof value.startCreate === "function"
      && "importRun" in value
      && typeof value.importRun === "function"
  );
}

export class BrowserWorkerSunoConnector implements SunoConnector {
  private readonly worker: WorkerMethods;

  constructor(private readonly workspaceRoot = ".", options: ConnectorOptions | WorkerMethods = {}) {
    if (isWorkerMethods(options)) {
      this.worker = options;
      return;
    }

    this.worker = options.worker ?? new SunoBrowserWorker(workspaceRoot, { config: options.config });
  }

  async status() {
    return this.worker.status();
  }

  async create(input: SunoCreateRequest): Promise<SunoCreateResult> {
    const result = await this.worker.startCreate(input, { dryRun: input.dryRun });
    return {
      ...result,
      pendingTakeUrl: result.pendingTakeUrl ?? result.urls.find(Boolean)
    };
  }

  async importResults(input: { runId: string; urls: string[] }): Promise<SunoImportResult> {
    return this.worker.importRun(input.runId, input.urls);
  }
}
