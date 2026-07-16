/**
 * 工作区文件不可预览状态的用户展示模型。
 *
 * @author kongweiguang
 */

import type { UserFacingMessage } from "../../lib/userFacingMessage";
import type { WorkspaceFilePreviewDecision } from "./workspaceFilePreviewPolicy";

type UnsupportedWorkspaceFilePreviewDecision = Extract<
  WorkspaceFilePreviewDecision,
  { kind: "unsupported" }
>;

/** 内容探测确认二进制时使用的稳定提示，不携带文件正文或内部错误。 */
export const BINARY_WORKSPACE_FILE_PREVIEW_NOTICE = {
  detail: "已检测到二进制内容，Kerminal 未将文件加载到文本编辑器。",
  recoveryAction: "可下载后使用对应应用打开。",
  severity: "info",
  title: "此文件不支持文本预览",
} satisfies UserFacingMessage;

/** 把打开前策略决策转换成普通用户可理解的提示。 */
export function buildWorkspaceFilePreviewUnsupportedNotice(
  decision: UnsupportedWorkspaceFilePreviewDecision,
): UserFacingMessage {
  return {
    detail: decision.message,
    severity: "info",
    title: "此文件不支持文本预览",
  };
}
