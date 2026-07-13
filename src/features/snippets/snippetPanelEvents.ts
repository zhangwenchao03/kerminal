export const SNIPPET_PANEL_OPEN_EVENT = "kerminal-open-snippet-panel";

export interface SnippetPanelOpenRequest {
  paneId?: string;
  snippetId: string;
}

let pendingRequest: SnippetPanelOpenRequest | null = null;

/** 命令提示只请求导航，不直接操作 React store 或执行片段。 */
export function requestSnippetPanelOpen(request: SnippetPanelOpenRequest): void {
  pendingRequest = request;
  window.dispatchEvent(
    new CustomEvent<SnippetPanelOpenRequest>(SNIPPET_PANEL_OPEN_EVENT, {
      detail: request,
    }),
  );
}

/**
 * 一次性消费最近的导航请求，避免右栏组件重挂载后重复展开旧片段。
 */
export function consumePendingSnippetPanelOpenRequest(): SnippetPanelOpenRequest | null {
  const request = pendingRequest;
  pendingRequest = null;
  return request;
}

/** 已挂载面板处理 live event 后清除同一请求，避免重挂载时再次展开旧片段。 */
export function acknowledgeSnippetPanelOpenRequest(
  handled: SnippetPanelOpenRequest,
): void {
  if (
    pendingRequest?.snippetId === handled.snippetId &&
    pendingRequest.paneId === handled.paneId
  ) {
    pendingRequest = null;
  }
}
