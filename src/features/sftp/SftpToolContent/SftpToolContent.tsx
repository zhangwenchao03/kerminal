/**
 * @author kongweiguang
 */

import type { Dispatch, SetStateAction } from "react";
import type { Machine, WorkspaceFileDirtyState, WorkspaceFileRevealRequest, WorkspaceFileTab } from "../../workspace/contracts/index";
import type { OpenWorkspaceFileTabOptions } from "../../workspace/state/index";
import type { InterfaceDensity } from "../../settings/contracts/index";
import type { SftpWorkbenchClipboard } from "../sftpTransferClipboardModel";
import type { SftpBrowserMode } from "../sftp-tool-content/sftpBrowserModeModel";
import { useSftpTargetSessionBoundary } from "../sftp-tool-content/useSftpTargetLifecycle";
import type { SftpClipboard, SftpFileTarget, SftpTransferTarget } from "../sftp-tool-content/types";
import { SftpTargetBoundContent } from "./SftpTargetBoundContent";

export type SftpToolContentProps = {
  active?: boolean;
  compactHeader?: boolean;
  followedLocalPath?: string;
  followedRemotePath?: string;
  interfaceDensity?: InterfaceDensity;
  onCurrentPathChange?: (path: string) => void;
  onOpenWorkspaceFileTab?: (options: OpenWorkspaceFileTabOptions) => void;
  onSftpClipboardChange?: (clipboard: SftpClipboard | null) => void;
  selectedMachine?: Machine;
  showLocalTransferActions?: boolean;
  showTerminalDirectoryControls?: boolean;
  showTransferStatusBar?: boolean;
  sftpClipboard?: SftpClipboard | null;
  transferViewScope?: string | null;
  transferTarget?: SftpTransferTarget;
  workbenchClipboard?: SftpWorkbenchClipboard | null;
  sftpRevealRequest?: WorkspaceFileRevealRequest | null;
  workspaceFileDirtyState?: WorkspaceFileDirtyState;
  workspaceFileTabs?: WorkspaceFileTab[];
};

export type SftpTargetBoundContentProps = SftpToolContentProps & {
  active: boolean;
  browserMode: SftpBrowserMode;
  fileTarget: SftpFileTarget | null;
  followTerminalDirectory: boolean;
  setBrowserMode: Dispatch<SetStateAction<SftpBrowserMode>>;
  setFollowTerminalDirectory: Dispatch<SetStateAction<boolean>>;
  setShowHiddenFiles: Dispatch<SetStateAction<boolean>>;
  setSftpClipboard: (clipboard: SftpClipboard | null) => void;
  showHiddenFiles: boolean;
  sftpClipboard: SftpClipboard | null;
};

/** 保留跨目标视图偏好，并按 active 与资源身份隔离远端会话状态。 */
export function SftpToolContent(props: SftpToolContentProps) {
  const active = props.active ?? true;
  const session = useSftpTargetSessionBoundary({
    active,
    controlledClipboard: props.sftpClipboard,
    onClipboardChange: props.onSftpClipboardChange,
    selectedMachine: props.selectedMachine,
  });

  return (
    <SftpTargetBoundContent
      {...props}
      active={active}
      browserMode={session.browserMode}
      fileTarget={session.fileTarget}
      followTerminalDirectory={session.followTerminalDirectory}
      key={session.sessionKey}
      setBrowserMode={session.setBrowserMode}
      setFollowTerminalDirectory={session.setFollowTerminalDirectory}
      setShowHiddenFiles={session.setShowHiddenFiles}
      setSftpClipboard={session.setSftpClipboard}
      showHiddenFiles={session.showHiddenFiles}
      sftpClipboard={session.sftpClipboard}
    />
  );
}
