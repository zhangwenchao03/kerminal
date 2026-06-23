import { isTauri } from "@tauri-apps/api/core";
import {
  browserCancelTransfer,
  browserChmodSftpPath,
  browserClassifyLocalPaths,
  browserClearCompletedTransfers,
  browserCreateSftpDirectory,
  browserDeleteSftpPath,
  browserDownloadSftpDirectory,
  browserDownloadSftpFile,
  browserEnqueueArchiveDownload,
  browserEnqueueArchiveUpload,
  browserEnqueueClipboardDownload,
  browserEnqueueRemoteCopy,
  browserEnqueueTransfer,
  browserListTransfers,
  browserPreviewFile,
  browserPreviewListing,
  browserReadSftpLocalFileClipboard,
  browserReadTextFile,
  browserRenameSftpPath,
  browserStatPath,
  browserTrustHostKey,
  browserUploadSftpDirectory,
  browserUploadSftpFile,
  browserWriteTextFile,
} from "./sftpApi.preview";
import {
  tauriCancelSftpTransfer,
  tauriChmodSftpPath,
  tauriClassifySftpLocalPaths,
  tauriClearCompletedSftpTransfers,
  tauriCreateSftpDirectory,
  tauriDeleteSftpPath,
  tauriDownloadSftpDirectory,
  tauriDownloadSftpFile,
  tauriEnqueueSftpArchiveDownload,
  tauriEnqueueSftpArchiveUpload,
  tauriEnqueueSftpClipboardDownload,
  tauriEnqueueSftpRemoteCopy,
  tauriEnqueueSftpTransfer,
  tauriListSftpDirectory,
  tauriListSftpTransfers,
  tauriPreviewSftpFile,
  tauriReadSftpLocalFileClipboard,
  tauriReadSftpTextFile,
  tauriRenameSftpPath,
  tauriStatSftpPath,
  tauriTrustSftpHostKey,
  tauriUploadSftpDirectory,
  tauriUploadSftpFile,
  tauriWriteSftpTextFile,
} from "./sftpApi.tauriTransport";
import type * as SftpTypes from "./sftpApiTypes";

export type {
  SftpArchiveDownloadRequest,
  SftpArchiveUploadRequest,
  SftpChmodRequest,
  SftpClassifyLocalPathsRequest,
  SftpClipboardDownloadRequest,
  SftpDeleteRequest,
  SftpDirectoryListing,
  SftpEntry,
  SftpEntryKind,
  SftpFilePreview,
  SftpFileRevision,
  SftpHostKeyTrustSummary,
  SftpListDirectoryRequest,
  SftpLocalPathInfo,
  SftpLocalPathKind,
  SftpManagedTransferRequest,
  SftpPathRequest,
  SftpPathStat,
  SftpPreviewRequest,
  SftpReadTextFileRequest,
  SftpReadTextFileResponse,
  SftpRemoteCopyRequest,
  SftpRenameRequest,
  SftpTransferCancelRequest,
  SftpTransferConflictPolicy,
  SftpTransferDirection,
  SftpTransferEndpoint,
  SftpTransferKind,
  SftpTransferOperation,
  SftpTransferRequest,
  SftpTransferScopeRequest,
  SftpTransferStatus,
  SftpTransferSummary,
  SftpTransferTransportMode,
  SftpTrustHostKeyRequest,
  SftpWriteTextFileRequest,
  SftpWriteTextFileResponse,
} from "./sftpApiTypes";

export async function listSftpDirectory(
  request: SftpTypes.SftpListDirectoryRequest,
): Promise<SftpTypes.SftpDirectoryListing> {
  return isTauri()
    ? tauriListSftpDirectory(request)
    : browserPreviewListing(request);
}

export async function createSftpDirectory(
  request: SftpTypes.SftpPathRequest,
): Promise<boolean> {
  return isTauri()
    ? tauriCreateSftpDirectory(request)
    : browserCreateSftpDirectory(request);
}

export async function deleteSftpPath(
  request: SftpTypes.SftpDeleteRequest,
): Promise<boolean> {
  return isTauri()
    ? tauriDeleteSftpPath(request)
    : browserDeleteSftpPath(request);
}

export async function renameSftpPath(
  request: SftpTypes.SftpRenameRequest,
): Promise<boolean> {
  return isTauri()
    ? tauriRenameSftpPath(request)
    : browserRenameSftpPath(request);
}

export async function previewSftpFile(
  request: SftpTypes.SftpPreviewRequest,
): Promise<SftpTypes.SftpFilePreview> {
  return isTauri() ? tauriPreviewSftpFile(request) : browserPreviewFile(request);
}

export async function readSftpTextFile(
  request: SftpTypes.SftpReadTextFileRequest,
): Promise<SftpTypes.SftpReadTextFileResponse> {
  return isTauri()
    ? tauriReadSftpTextFile(request)
    : browserReadTextFile(request);
}

export async function writeSftpTextFile(
  request: SftpTypes.SftpWriteTextFileRequest,
): Promise<SftpTypes.SftpWriteTextFileResponse> {
  return isTauri()
    ? tauriWriteSftpTextFile(request)
    : browserWriteTextFile(request);
}

export async function statSftpPath(
  request: SftpTypes.SftpPathRequest,
): Promise<SftpTypes.SftpPathStat> {
  return isTauri() ? tauriStatSftpPath(request) : browserStatPath(request);
}

export async function chmodSftpPath(
  request: SftpTypes.SftpChmodRequest,
): Promise<boolean> {
  return isTauri() ? tauriChmodSftpPath(request) : browserChmodSftpPath(request);
}

export async function uploadSftpFile(
  request: SftpTypes.SftpTransferRequest,
): Promise<boolean> {
  return isTauri() ? tauriUploadSftpFile(request) : browserUploadSftpFile(request);
}

export async function uploadSftpDirectory(
  request: SftpTypes.SftpTransferRequest,
): Promise<boolean> {
  return isTauri()
    ? tauriUploadSftpDirectory(request)
    : browserUploadSftpDirectory(request);
}

export async function downloadSftpFile(
  request: SftpTypes.SftpTransferRequest,
): Promise<boolean> {
  return isTauri()
    ? tauriDownloadSftpFile(request)
    : browserDownloadSftpFile(request);
}

export async function downloadSftpDirectory(
  request: SftpTypes.SftpTransferRequest,
): Promise<boolean> {
  return isTauri()
    ? tauriDownloadSftpDirectory(request)
    : browserDownloadSftpDirectory(request);
}

export async function enqueueSftpTransfer(
  request: SftpTypes.SftpManagedTransferRequest,
): Promise<SftpTypes.SftpTransferSummary> {
  return isTauri()
    ? tauriEnqueueSftpTransfer(request)
    : browserEnqueueTransfer(request);
}

export async function enqueueSftpRemoteCopy(
  request: SftpTypes.SftpRemoteCopyRequest,
): Promise<SftpTypes.SftpTransferSummary> {
  return isTauri()
    ? tauriEnqueueSftpRemoteCopy(request)
    : browserEnqueueRemoteCopy(request);
}

export async function enqueueSftpArchiveDownload(
  request: SftpTypes.SftpArchiveDownloadRequest,
): Promise<SftpTypes.SftpTransferSummary> {
  return isTauri()
    ? tauriEnqueueSftpArchiveDownload(request)
    : browserEnqueueArchiveDownload(request);
}

export async function enqueueSftpArchiveUpload(
  request: SftpTypes.SftpArchiveUploadRequest,
): Promise<SftpTypes.SftpTransferSummary> {
  return isTauri()
    ? tauriEnqueueSftpArchiveUpload(request)
    : browserEnqueueArchiveUpload(request);
}

export async function enqueueSftpClipboardDownload(
  request: SftpTypes.SftpClipboardDownloadRequest,
): Promise<SftpTypes.SftpTransferSummary> {
  return isTauri()
    ? tauriEnqueueSftpClipboardDownload(request)
    : browserEnqueueClipboardDownload(request);
}

export async function listSftpTransfers(
  request?: SftpTypes.SftpTransferScopeRequest,
): Promise<
  SftpTypes.SftpTransferSummary[]
> {
  return isTauri()
    ? tauriListSftpTransfers(request)
    : browserListTransfers(request);
}

export async function cancelSftpTransfer(
  request: SftpTypes.SftpTransferCancelRequest,
): Promise<SftpTypes.SftpTransferSummary> {
  return isTauri()
    ? tauriCancelSftpTransfer(request)
    : browserCancelTransfer(request);
}

export async function clearCompletedSftpTransfers(
  request?: SftpTypes.SftpTransferScopeRequest,
): Promise<
  SftpTypes.SftpTransferSummary[]
> {
  return isTauri()
    ? tauriClearCompletedSftpTransfers(request)
    : browserClearCompletedTransfers(request);
}

export async function classifySftpLocalPaths(
  request: SftpTypes.SftpClassifyLocalPathsRequest,
): Promise<SftpTypes.SftpLocalPathInfo[]> {
  return isTauri()
    ? tauriClassifySftpLocalPaths(request)
    : browserClassifyLocalPaths(request);
}

export async function readSftpLocalFileClipboard(): Promise<
  SftpTypes.SftpLocalPathInfo[]
> {
  return isTauri()
    ? tauriReadSftpLocalFileClipboard()
    : browserReadSftpLocalFileClipboard();
}

export async function trustSftpHostKey(
  request: SftpTypes.SftpTrustHostKeyRequest,
): Promise<SftpTypes.SftpHostKeyTrustSummary> {
  return isTauri()
    ? tauriTrustSftpHostKey(request)
    : browserTrustHostKey(request);
}
