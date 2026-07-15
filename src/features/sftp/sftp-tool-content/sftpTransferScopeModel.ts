/**
 * SFTP transfer view scope helpers.
 *
 * @author kongweiguang
 */

export function withSftpTransferViewScope<TRequest extends { viewScope?: string | null }>(
  request: TRequest,
  viewScope?: string | null,
): TRequest {
  if (viewScope === undefined) {
    return request;
  }
  return { ...request, viewScope };
}

export function sftpSidebarTransferViewScope({
  hostId,
  tabId,
}: {
  hostId?: string;
  tabId?: string;
}) {
  return `sftp-sidebar:${tabId?.trim() || "global"}:${hostId?.trim() || "none"}`;
}

export function sftpWorkbenchTransferViewScope({
  fallbackId,
  workspaceTabId,
}: {
  fallbackId: string;
  workspaceTabId?: string;
}) {
  return `sftp-workbench:${workspaceTabId?.trim() || fallbackId}`;
}
