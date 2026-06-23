import { useMemo, useSyncExternalStore } from "react";
import { MachineSidebar } from "../features/machine-sidebar/MachineSidebar";
import type { MachineSidebarProps } from "../features/machine-sidebar/MachineSidebar.shared";
import type {
  SftpTransferCreatedHostTarget,
  SftpTransferCreateHostRequest,
} from "../features/sftp/SftpTransferWorkbench";
import type {
  InterfaceDensity,
  ResolvedTheme,
  TerminalAppearance,
  AppSettings,
} from "../features/settings/settingsModel";
import { LazySftpTransferWorkbench as SftpTransferWorkbench } from "../features/sftp/LazySftpTransferWorkbench";
import {
  type BroadcastCommandRequest,
  type BroadcastCommandResult,
  TerminalWorkspace,
} from "../features/terminal/TerminalWorkspace";
import { ToolPanel } from "../features/tool-panel/ToolPanel";
import type {
  MachineGroup,
  TerminalSplitDirection,
  ToolId,
} from "../features/workspace/types";
import { isSftpTransferWorkspaceTab } from "../features/workspace/types";
import {
  tools,
  useWorkspaceStore,
  type AddTerminalTabOptions,
} from "../features/workspace/workspaceStore";
import type { SettingsSectionId } from "../features/settings/SettingsToolContent";
import {
  buildOpenMachineIdsSnapshot,
  buildToolPanelWorkspaceContext,
  buildToolPanelWorkspaceSnapshot,
  parseOpenMachineIdsSnapshot,
} from "./KerminalShell.workspaceSelectors";

type WorkspaceTerminalSurfaceProps = {
  contentRightInset: number;
  createdSftpHostTarget?: SftpTransferCreatedHostTarget;
  interfaceDensity: InterfaceDensity;
  machineGroups: MachineGroup[];
  onBroadcastCommand: (
    request: BroadcastCommandRequest,
  ) => Promise<BroadcastCommandResult>;
  onCreateSftpHost?: (request: SftpTransferCreateHostRequest) => void;
  onOpenAiTool: () => void;
  onOpenConnection: () => void;
  onOpenLogs: () => void;
  reserveRightTitleBarControls: boolean;
  resolvedTheme: ResolvedTheme;
  terminalAppearance: TerminalAppearance;
};

type MachineSidebarStoreBridgeProps = Omit<
  MachineSidebarProps,
  "openMachineIds"
>;

interface ToolPanelStoreBridgeProps {
  activeTool: ToolId | null;
  defaultRemoteGroupId?: string;
  defaultRemoteHostId?: string;
  machineGroups: MachineGroup[];
  onActiveToolChange: (toolId: ToolId) => void;
  onCreateTerminal?: (options?: AddTerminalTabOptions) => void;
  onFocusTab?: (tabId: string) => void;
  onOpenSettingsSection?: (sectionId: SettingsSectionId) => void;
  onOpenSshTerminal?: (hostId: string) => void;
  onRemoteHostCreated?: () => void | Promise<void>;
  onSettingsChange?: (settings: AppSettings) => void;
  onSplitPane?: (direction: TerminalSplitDirection) => void;
  settings: AppSettings;
}

const subscribeToWorkspaceStore = (onStoreChange: () => void) =>
  useWorkspaceStore.subscribe(onStoreChange);

const getOpenMachineIdsSnapshot = () =>
  buildOpenMachineIdsSnapshot(useWorkspaceStore.getState());

const getToolPanelWorkspaceSnapshot = () =>
  buildToolPanelWorkspaceSnapshot(useWorkspaceStore.getState());

export function WorkspaceTerminalSurface({
  contentRightInset,
  createdSftpHostTarget,
  interfaceDensity,
  machineGroups,
  onBroadcastCommand,
  onCreateSftpHost,
  onOpenAiTool,
  onOpenConnection,
  onOpenLogs,
  reserveRightTitleBarControls,
  resolvedTheme,
  terminalAppearance,
}: WorkspaceTerminalSurfaceProps) {
  const activeTabId = useWorkspaceStore((state) => state.activeTabId);
  const broadcastDraft = useWorkspaceStore((state) => state.broadcastDraft);
  const closePane = useWorkspaceStore((state) => state.closePane);
  const closeTerminalTab = useWorkspaceStore((state) => state.closeTerminalTab);
  const addTerminalTab = useWorkspaceStore((state) => state.addTerminalTab);
  const focusPane = useWorkspaceStore((state) => state.focusPane);
  const focusedPaneId = useWorkspaceStore((state) => state.focusedPaneId);
  const renameTerminalTab = useWorkspaceStore((state) => state.renameTerminalTab);
  const selectTab = useWorkspaceStore((state) => state.selectTab);
  const setBroadcastDraft = useWorkspaceStore(
    (state) => state.setBroadcastDraft,
  );
  const splitFocusedPane = useWorkspaceStore((state) => state.splitFocusedPane);
  const terminalPanes = useWorkspaceStore((state) => state.terminalPanes);
  const terminalTabs = useWorkspaceStore((state) => state.terminalTabs);
  const updatePaneCurrentCwd = useWorkspaceStore(
    (state) => state.updatePaneCurrentCwd,
  );
  const updatePaneOutputHistory = useWorkspaceStore(
    (state) => state.updatePaneOutputHistory,
  );

  return (
    <TerminalWorkspace
      activeTabId={activeTabId}
      broadcastDraft={broadcastDraft}
      contentRightInset={contentRightInset}
      focusedPaneId={focusedPaneId}
      interfaceDensity={interfaceDensity}
      onBroadcastCommand={onBroadcastCommand}
      onBroadcastDraftChange={setBroadcastDraft}
      onClosePane={closePane}
      onCloseTab={closeTerminalTab}
      onCreateTerminal={() => addTerminalTab()}
      onFocusPane={focusPane}
      onOpenAiTool={onOpenAiTool}
      onOpenConnection={onOpenConnection}
      onPaneCurrentCwdChange={updatePaneCurrentCwd}
      onPaneOutputHistoryChange={updatePaneOutputHistory}
      onOpenLogs={onOpenLogs}
      onRenameTab={renameTerminalTab}
      reserveRightTitleBarControls={reserveRightTitleBarControls}
      renderCustomTab={(tab, active) =>
        isSftpTransferWorkspaceTab(tab) ? (
          <SftpTransferWorkbench
            active={active}
            createdHostTarget={createdSftpHostTarget}
            groups={machineGroups}
            initialLeftHostId={tab.leftHostId}
            initialRightHostId={tab.rightHostId}
            lockedLeftHostId={tab.lockedLeftHostId}
            onCreateSshHost={onCreateSftpHost}
            workspaceTabId={tab.id}
          />
        ) : null
      }
      onSelectTab={selectTab}
      onSplitPane={splitFocusedPane}
      panes={terminalPanes}
      resolvedTheme={resolvedTheme}
      tabs={terminalTabs}
      terminalAppearance={terminalAppearance}
    />
  );
}

export function MachineSidebarStoreBridge(props: MachineSidebarStoreBridgeProps) {
  const openMachineIdsSnapshot = useSyncExternalStore(
    subscribeToWorkspaceStore,
    getOpenMachineIdsSnapshot,
    getOpenMachineIdsSnapshot,
  );
  const openMachineIds = useMemo(
    () => parseOpenMachineIdsSnapshot(openMachineIdsSnapshot),
    [openMachineIdsSnapshot],
  );

  return <MachineSidebar {...props} openMachineIds={openMachineIds} />;
}

export function ToolPanelStoreBridge({
  machineGroups,
  ...props
}: ToolPanelStoreBridgeProps) {
  const toolPanelWorkspaceSnapshot = useSyncExternalStore(
    subscribeToWorkspaceStore,
    getToolPanelWorkspaceSnapshot,
    getToolPanelWorkspaceSnapshot,
  );
  const workspaceContext = useMemo(
    () =>
      buildToolPanelWorkspaceContext(useWorkspaceStore.getState(), machineGroups),
    [machineGroups, toolPanelWorkspaceSnapshot],
  );

  return (
    <ToolPanel
      {...props}
      activeTab={workspaceContext.activeTab}
      focusedPane={workspaceContext.focusedPane}
      selectedMachine={workspaceContext.selectedMachine}
      terminalTabs={workspaceContext.terminalTabs}
      tools={tools}
    />
  );
}
