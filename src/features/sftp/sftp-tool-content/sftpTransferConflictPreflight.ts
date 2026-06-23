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

export type SftpTransferConflictPreflightItem =
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

export type SftpTransferConflictPreflightStats = {
  statLocalPath?: typeof statLocalPath;
  statSftpPath?: typeof statSftpPath;
};

export type SftpTransferConflictPreflightOptions = {
  localRootPath?: string;
  stats?: SftpTransferConflictPreflightStats;
};

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

  const results = await Promise.all(
    requests.map((request) =>
      transferRequestConflicts(request, {
        localRootPath: options.localRootPath,
        stats,
      }),
    ),
  );

  return results.filter(Boolean).length;
}

export function transferRequestsFromPreflightInput(
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

export function isSftpTransferStatNotFoundError(error: unknown): boolean {
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

function transferRequestFromPreflightItem(
  item: SftpTransferConflictPreflightItem,
):
  | SftpArchiveDownloadRequest
  | SftpArchiveUploadRequest
  | SftpManagedTransferRequest
  | SftpRemoteCopyRequest {
  return "request" in item ? item.request : item;
}
