/**
 * SFTP 工作台拖放拒绝原因模型。
 *
 * @author kongweiguang
 */

import type { SftpStatus } from "./types";

export type SftpCannotDropReason =
  | "localFileRequiresSshRemoteTarget"
  | "localFileToLocalPaneUnsupported";

export const SFTP_LOCAL_TO_LOCAL_DROP_UNSUPPORTED_MESSAGE =
  "暂不支持本机到本机复制，请用系统文件管理器。";

export const SFTP_LOCAL_TO_NON_SSH_DROP_UNSUPPORTED_MESSAGE =
  "本机文件只能拖放到 SSH/SFTP 远端目录。";

export function sftpCannotDropStatus(
  reason: SftpCannotDropReason,
): SftpStatus {
  return {
    kind: "error",
    message:
      reason === "localFileToLocalPaneUnsupported"
        ? SFTP_LOCAL_TO_LOCAL_DROP_UNSUPPORTED_MESSAGE
        : SFTP_LOCAL_TO_NON_SSH_DROP_UNSUPPORTED_MESSAGE,
  };
}
