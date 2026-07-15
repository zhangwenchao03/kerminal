import { statLocalPath } from "../../../lib/localFilesApi";
import {
  type SftpArchiveDownloadRequest,
  type SftpArchiveUploadRequest,
  statSftpPath,
  type SftpManagedTransferRequest,
  type SftpRemoteCopyRequest,
} from "../../../lib/sftpApi";
import type { SftpRemoteCopyPlan } from "./sftpRemoteTransferModel";
import type { SftpTransferActionBatchPlan } from "./sftpTransferActionPlan";

type SftpTransferConflictPreflightItem =
  | SftpArchiveDownloadRequest
  | SftpArchiveUploadRequest
  | SftpManagedTransferRequest
  | SftpRemoteCopyRequest
  | {
      request: SftpArchiveDownloadRequest | SftpArchiveUploadRequest | SftpManagedTransferRequest;
    };

export type SftpTransferConflictPreflightInput =
  | SftpTransferConflictPreflightItem
  | SftpTransferConflictPreflightItem[]
  | SftpRemoteCopyPlan
  | SftpTransferActionBatchPlan;

type SftpTransferConflictPreflightStats = {
  statLocalPath?: typeof statLocalPath;
  statSftpPath?: typeof statSftpPath;
};

export type SftpTransferConflictPreflightProgress = {
  checked: number;
  conflicts: number;
  inFlight: number;
  queued: number;
  total: number;
};

export type SftpTransferConflictPreflightOptions = {
  concurrency?: number;
  localRootPath?: string;
  onProgress?: (progress: SftpTransferConflictPreflightProgress) => void;
  signal?: AbortSignal;
  stats?: SftpTransferConflictPreflightStats;
};

export const DEFAULT_SFTP_TRANSFER_CONFLICT_PREFLIGHT_CONCURRENCY = 8;
const MAX_SFTP_TRANSFER_CONFLICT_PREFLIGHT_CONCURRENCY = 16;

class SftpTransferConflictPreflightCanceledError extends Error {
  constructor() {
    super("SFTP 传输冲突预检已取消");
    this.name = "AbortError";
  }
}

export async function countSftpTransferConflicts(
  input: SftpTransferConflictPreflightInput,
  options: SftpTransferConflictPreflightOptions = {},
): Promise<number> {
  const requests = transferRequestsFromPreflightInput(input);
  const stats = {
    statLocalPath,
    statSftpPath,
    ...options.stats,
  };

  if (requests.length === 0) {
    options.onProgress?.({
      checked: 0,
      conflicts: 0,
      inFlight: 0,
      queued: 0,
      total: 0,
    });
    return 0;
  }

  throwIfPreflightAborted(options.signal);

  const concurrency = normalizePreflightConcurrency(options.concurrency);
  let checked = 0;
  let conflicts = 0;
  let inFlight = 0;
  let nextIndex = 0;
  let stopped = false;

  const emitProgress = () => {
    options.onProgress?.({
      checked,
      conflicts,
      inFlight,
      queued: Math.max(0, requests.length - checked - inFlight),
      total: requests.length,
    });
  };

  emitProgress();

  const runWorker = async () => {
    while (!stopped) {
      throwIfPreflightAborted(options.signal);
      const requestIndex = nextIndex;
      nextIndex += 1;
      if (requestIndex >= requests.length) {
        return;
      }

      inFlight += 1;
      emitProgress();
      try {
        if (
          await transferRequestConflicts(requests[requestIndex], {
            localRootPath: options.localRootPath,
            stats,
          })
        ) {
          conflicts += 1;
        }
      } catch (error) {
        stopped = true;
        throw error;
      } finally {
        inFlight -= 1;
      }
      throwIfPreflightAborted(options.signal);
      checked += 1;
      emitProgress();
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, requests.length) }, () =>
      runWorker(),
    ),
  );

  return conflicts;
}

function transferRequestsFromPreflightInput(
  input: SftpTransferConflictPreflightInput,
): Array<
  | SftpArchiveDownloadRequest
  | SftpArchiveUploadRequest
  | SftpManagedTransferRequest
  | SftpRemoteCopyRequest
> {
  if (Array.isArray(input)) {
    return input.map(transferRequestFromPreflightItem);
  }

  if ("items" in input) {
    return input.items.map((item) => item.request);
  }
  if ("requests" in input) {
    return [...input.requests];
  }

  return [transferRequestFromPreflightItem(input)];
}

async function transferRequestConflicts(
  request:
    | SftpArchiveDownloadRequest
    | SftpArchiveUploadRequest
    | SftpManagedTransferRequest
    | SftpRemoteCopyRequest,
  {
    localRootPath,
    stats,
  }: {
    localRootPath?: string;
    stats: Required<SftpTransferConflictPreflightStats>;
  },
): Promise<boolean> {
  try {
    if ("targetRemotePath" in request) {
      await stats.statSftpPath({
        hostId: "targetHostId" in request ? request.targetHostId : request.hostId,
        path: request.targetRemotePath,
      });
      return true;
    }
    if ("targetLocalPath" in request) {
      const stat = await stats.statLocalPath({
        path: request.targetLocalPath,
        rootPath: localRootPath,
      });
      return stat.exists;
    }
    if (request.direction === "upload") {
      await stats.statSftpPath({
        hostId: request.hostId,
        path: request.remotePath,
      });
      return true;
    }

    const stat = await stats.statLocalPath({
      path: request.localPath,
      rootPath: localRootPath,
    });
    return stat.exists;
  } catch (error) {
    if (isSftpTransferStatNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

function isSftpTransferStatNotFoundError(error: unknown): boolean {
  const message = statErrorMessage(error).toLowerCase();
  if (!message) {
    return false;
  }

  return (
    message.includes("not found") ||
    message.includes("no such file") ||
    message.includes("nosuchfile") ||
    message.includes("no such path") ||
    message.includes("不存在")
  );
}

function statErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message : "";
  }
  return "";
}

export function isSftpTransferConflictPreflightCanceledError(
  error: unknown,
): boolean {
  return (
    error instanceof SftpTransferConflictPreflightCanceledError ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function normalizePreflightConcurrency(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SFTP_TRANSFER_CONFLICT_PREFLIGHT_CONCURRENCY;
  }
  return Math.min(
    MAX_SFTP_TRANSFER_CONFLICT_PREFLIGHT_CONCURRENCY,
    Math.max(1, Math.floor(value ?? 1)),
  );
}

function throwIfPreflightAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw new SftpTransferConflictPreflightCanceledError();
  }
}

function transferRequestFromPreflightItem(
  item: SftpTransferConflictPreflightItem,
):
  | SftpArchiveDownloadRequest
  | SftpArchiveUploadRequest
  | SftpManagedTransferRequest
  | SftpRemoteCopyRequest {
  return "request" in item ? item.request : item;
}
