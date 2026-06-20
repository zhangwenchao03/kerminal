import { useCallback, useState } from "react";
import type { ConnectionOpenOptions } from "../features/machine-sidebar/MachineSidebar";
import type { LocalTerminalCreateOptions } from "../features/machine-sidebar/RemoteHostCreateDialog";
import {
  findMachine,
  localMachineIdForProfile,
  type useWorkspaceStore,
} from "../features/workspace/workspaceStore";
import type { Machine, MachineGroup } from "../features/workspace/types";
import { openSavedRdpConnection } from "../lib/connectionApi";
import {
  createProfile,
  listProfiles,
  updateProfile,
  type TerminalProfile,
} from "../lib/profileApi";
import {
  createRemoteHost,
  createRemoteHostGroup,
  deleteRemoteHost,
  deleteRemoteHostGroup,
  listRemoteHostTree,
  UNGROUPED_REMOTE_HOST_GROUP_ID,
  updateRemoteHost,
  updateRemoteHostGroup,
  type RemoteHost,
  type RemoteHostCreateRequest,
  type RemoteHostGroup,
  type RemoteHostGroupUpdateRequest,
} from "../lib/remoteHostApi";
import {
  duplicateMachineName,
  hasLocalProfileOverrides,
  isRealRemoteGroup,
  mergeProfiles,
  nextPinnedGroupSortOrder,
  nextUnpinnedGroupSortOrder,
  remoteHostCreateRequestFromMachine,
  remoteHostFromMachine,
  remoteHostUpdateRequestFromMachine,
  type PendingDelete,
} from "./KerminalShell.helpers";

type WorkspaceState = ReturnType<typeof useWorkspaceStore.getState>;
type ConnectionDialogOptions = ConnectionOpenOptions & {
  hostId?: string;
};

const DEFAULT_REMOTE_GROUP_NAME = "默认分组";

type UseKerminalShellRemoteActionsParams = {
  activeProfileId: string | null;
  addLocalProfileMachine: WorkspaceState["addLocalProfileMachine"];
  addTerminalTab: WorkspaceState["addTerminalTab"];
  defaultRemoteGroupId: string | undefined;
  machineGroups: MachineGroup[];
  moveSidebarMachine: WorkspaceState["moveSidebarMachine"];
  pinMachineGroup: WorkspaceState["pinMachineGroup"];
  profiles: TerminalProfile[];
  removeSidebarMachine: WorkspaceState["removeSidebarMachine"];
  renameMachineGroup: WorkspaceState["renameMachineGroup"];
  selectMachine: WorkspaceState["selectMachine"];
  setProfiles: WorkspaceState["setProfiles"];
  setRemoteHostTree: WorkspaceState["setRemoteHostTree"];
  updateLocalMachine: WorkspaceState["updateLocalMachine"];
};

export function useKerminalShellRemoteActions({
  activeProfileId,
  addLocalProfileMachine,
  addTerminalTab,
  defaultRemoteGroupId,
  machineGroups,
  moveSidebarMachine,
  pinMachineGroup,
  profiles,
  removeSidebarMachine,
  renameMachineGroup,
  selectMachine,
  setProfiles,
  setRemoteHostTree,
  updateLocalMachine,
}: UseKerminalShellRemoteActionsParams) {
  const [profileLoadError, setProfileLoadError] = useState<string | null>(null);
  const [remoteHostLoadError, setRemoteHostLoadError] = useState<string | null>(null);
  const [remoteHostDialogOpen, setRemoteHostDialogOpen] = useState(false);
  const [remoteHostDefaultGroupId, setRemoteHostDefaultGroupId] = useState<string | undefined>(undefined);
  const [remoteHostDefaultMode, setRemoteHostDefaultMode] = useState<NonNullable<ConnectionOpenOptions["mode"]>>("ssh");
  const [editingRemoteHost, setEditingRemoteHost] = useState<RemoteHost | undefined>(undefined);
  const [editingLocalMachine, setEditingLocalMachine] = useState<Machine | undefined>(undefined);
  const [remoteGroupDialogOpen, setRemoteGroupDialogOpen] = useState(false);
  const [editingRemoteGroup, setEditingRemoteGroup] = useState<MachineGroup | undefined>(undefined);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);

  const refreshRemoteHostTree = useCallback(async () => {
    try {
      const remoteGroups = await listRemoteHostTree();
      setRemoteHostTree(remoteGroups);
      setRemoteHostLoadError(null);
    } catch {
      setRemoteHostLoadError("远程主机加载失败，已使用当前本地连接列表。");
    }
  }, [setRemoteHostTree]);
  const refreshProfiles = useCallback(async () => {
    const nextProfiles = await listProfiles();
    setProfiles(nextProfiles);
    setProfileLoadError(null);
    return nextProfiles;
  }, [setProfiles]);
  const handleRemoteHostCreated = useCallback(
    async (host: RemoteHost) => {
      await refreshRemoteHostTree();
      selectMachine(host.id);
    },
    [refreshRemoteHostTree, selectMachine],
  );
  const ensureDefaultRemoteGroup = useCallback(async () => {
    const existingGroup = machineGroups.find(
      (group) =>
        isRealRemoteGroup(group) && group.title.trim() === DEFAULT_REMOTE_GROUP_NAME,
    );
    if (existingGroup) {
      return existingGroup.id;
    }

    try {
      const createdGroup = await createRemoteHostGroup({
        name: DEFAULT_REMOTE_GROUP_NAME,
      });
      return createdGroup.id;
    } catch (caught) {
      const remoteGroups = await listRemoteHostTree();
      setRemoteHostTree(remoteGroups);
      const refreshedGroup = remoteGroups.find(
        (group) => group.name.trim() === DEFAULT_REMOTE_GROUP_NAME,
      );
      if (refreshedGroup) {
        return refreshedGroup.id;
      }
      throw caught;
    }
  }, [machineGroups, setRemoteHostTree]);
  const resolveTargetGroupId = useCallback(
    async (groupId: string | undefined) => {
      const requestedGroupId = groupId?.trim();
      if (
        requestedGroupId &&
        requestedGroupId !== UNGROUPED_REMOTE_HOST_GROUP_ID
      ) {
        return requestedGroupId;
      }

      return ensureDefaultRemoteGroup();
    },
    [ensureDefaultRemoteGroup],
  );
  const handleCreateRemoteHost = useCallback(
    async (request: RemoteHostCreateRequest) => {
      const groupId = await resolveTargetGroupId(request.groupId);
      return createRemoteHost({ ...request, groupId });
    },
    [resolveTargetGroupId],
  );
  const handleCreateLocalProfile = useCallback(
    async (options?: LocalTerminalCreateOptions) => {
      const groupId = await resolveTargetGroupId(options?.groupId);
      if (!options) {
        addTerminalTab({ groupId });
        return;
      }
      if (!hasLocalProfileOverrides(options)) {
        addTerminalTab({ groupId });
        return;
      }

      const baseProfile =
        profiles.find((profile) => profile.id === activeProfileId) ??
        profiles.find((profile) => profile.isDefault) ??
        profiles[0];
      const shell = options.shell?.trim() || baseProfile?.shell;
      if (!shell) {
        addTerminalTab({ ...options, groupId });
        return;
      }

      const createdProfile = await createProfile({
        args: options.args ?? baseProfile?.args ?? [],
        cwd: options.cwd ?? baseProfile?.cwd,
        env: options.env ?? baseProfile?.env ?? {},
        name: options.title?.trim() || baseProfile?.name || "本地会话",
        shell,
        setDefault: false,
      });
      let nextProfiles: TerminalProfile[];
      try {
        nextProfiles = await refreshProfiles();
        if (!nextProfiles.some((profile) => profile.id === createdProfile.id)) {
          nextProfiles = mergeProfiles(nextProfiles, createdProfile);
          setProfiles(nextProfiles);
        }
      } catch {
        setProfileLoadError("终端配置刷新失败，已显示刚创建的本地配置。");
        nextProfiles = mergeProfiles(profiles, createdProfile);
        setProfiles(nextProfiles);
      }
      const savedProfile =
        nextProfiles.find((profile) => profile.id === createdProfile.id) ??
        createdProfile;
      addTerminalTab({ groupId, profileId: savedProfile.id });
    },
    [
      activeProfileId,
      addTerminalTab,
      profiles,
      refreshProfiles,
      resolveTargetGroupId,
      setProfiles,
    ],
  );
  const handleUpdateLocalProfile = useCallback(
    async (machineId: string, options: LocalTerminalCreateOptions) => {
      const machine = findMachine(machineGroups, machineId);
      if (!machine || machine.kind !== "local") {
        setProfileLoadError("只能编辑已同步的本地终端配置。");
        return;
      }

      const groupId = await resolveTargetGroupId(
        options.groupId ?? machine.remoteGroupId,
      );
      const title = options.title?.trim() || machine.name || "本地会话";
      const shell = options.shell?.trim();
      const nextOptions: LocalTerminalCreateOptions = {
        args: options.args ?? [],
        cwd: options.cwd,
        env: options.env ?? {},
        groupId,
        shell,
        title,
      };

      if (machine.profileId) {
        const profile = profiles.find(
          (candidate) => candidate.id === machine.profileId,
        );
        const profileShell = shell || profile?.shell || machine.shell;
        if (!profileShell) {
          setProfileLoadError("本地终端缺少 Shell，无法保存。");
          return;
        }

        const updatedProfile = await updateProfile({
          args: nextOptions.args,
          cwd: nextOptions.cwd,
          env: nextOptions.env,
          id: machine.profileId,
          name: title,
          setDefault: profile?.isDefault ?? false,
          shell: profileShell,
          sortOrder: profile?.sortOrder ?? machine.sortOrder ?? 0,
        });
        let nextProfiles: TerminalProfile[];
        try {
          nextProfiles = mergeProfiles(await refreshProfiles(), updatedProfile);
          setProfiles(nextProfiles);
        } catch {
          setProfileLoadError("终端配置刷新失败，已显示刚更新的本地配置。");
          nextProfiles = mergeProfiles(profiles, updatedProfile);
          setProfiles(nextProfiles);
        }

        updateLocalMachine(machine.id, {
          args: updatedProfile.args,
          cwd: updatedProfile.cwd,
          env: updatedProfile.env,
          groupId,
          shell: updatedProfile.shell,
          title: updatedProfile.name,
        });
        selectMachine(machine.id);
        return;
      }

      updateLocalMachine(machine.id, nextOptions);
      selectMachine(machine.id);
    },
    [
      machineGroups,
      profiles,
      refreshProfiles,
      resolveTargetGroupId,
      selectMachine,
      setProfiles,
      updateLocalMachine,
    ],
  );
  const handleMoveMachineToGroup = useCallback(
    async (machineId: string, targetGroupId: string) => {
      const machine = findMachine(machineGroups, machineId);
      if (!machine) {
        setRemoteHostLoadError("主机不存在，无法移动。");
        return;
      }
      if (machine.remoteGroupId === targetGroupId) {
        return;
      }

      if (machine.kind === "local" || machine.kind === "dockerContainer") {
        moveSidebarMachine(machine.id, targetGroupId);
        selectMachine(machine.id);
        return;
      }

      if (machine.kind !== "ssh" && machine.kind !== "rdp") {
        setRemoteHostLoadError("只能移动本地、容器、SSH 或 RDP 连接。");
        return;
      }

      const groupId = await resolveTargetGroupId(targetGroupId);
      const request = remoteHostUpdateRequestFromMachine(machine, groupId);
      if (!request) {
        setRemoteHostLoadError("主机配置不完整，无法移动。");
        return;
      }

      await updateRemoteHost(request);
      await refreshRemoteHostTree();
      selectMachine(machine.id);
    },
    [
      machineGroups,
      moveSidebarMachine,
      refreshRemoteHostTree,
      resolveTargetGroupId,
      selectMachine,
    ],
  );
  const handleDuplicateMachine = useCallback(
    async (machineId: string) => {
      const machine = findMachine(machineGroups, machineId);
      if (!machine) {
        setRemoteHostLoadError("主机不存在，无法复制。");
        return;
      }
      const groupId = await resolveTargetGroupId(machine.remoteGroupId);
      const name = duplicateMachineName(machine.name);

      if (machine.kind === "local") {
        const profile = machine.profileId
          ? profiles.find((candidate) => candidate.id === machine.profileId)
          : undefined;
        const shell = machine.shell ?? profile?.shell;
        if (!shell) {
          setProfileLoadError("本地终端缺少 Shell，无法复制。");
          return;
        }

        const createdProfile = await createProfile({
          args: machine.args ?? profile?.args ?? [],
          cwd: machine.cwd ?? profile?.cwd,
          env: machine.env ?? profile?.env ?? {},
          name,
          setDefault: false,
          shell,
        });
        let nextProfiles: TerminalProfile[];
        try {
          nextProfiles = mergeProfiles(await refreshProfiles(), createdProfile);
          setProfiles(nextProfiles);
        } catch {
          setProfileLoadError("终端配置刷新失败，已显示刚复制的本地配置。");
          nextProfiles = mergeProfiles(profiles, createdProfile);
          setProfiles(nextProfiles);
        }
        const savedProfile =
          nextProfiles.find((profile) => profile.id === createdProfile.id) ??
          createdProfile;
        addLocalProfileMachine(savedProfile, groupId);
        selectMachine(localMachineIdForProfile(savedProfile.id));
        return;
      }

      if (machine.kind !== "ssh" && machine.kind !== "rdp") {
        setRemoteHostLoadError("容器连接来自宿主机发现，暂不支持复制容器卡片。");
        return;
      }

      const request = remoteHostCreateRequestFromMachine(machine, {
        groupId,
        name,
      });
      if (!request) {
        setRemoteHostLoadError("主机配置不完整，无法复制。");
        return;
      }

      const createdHost = await createRemoteHost(request);
      await refreshRemoteHostTree();
      selectMachine(createdHost.id);
    },
    [
      addLocalProfileMachine,
      machineGroups,
      profiles,
      refreshProfiles,
      refreshRemoteHostTree,
      resolveTargetGroupId,
      selectMachine,
      setProfiles,
    ],
  );
  const handlePinMachineGroup = useCallback(
    async (groupId: string, pinned = true) => {
      const group = machineGroups.find((candidate) => candidate.id === groupId);
      if (!group) {
        setRemoteHostLoadError("分组不存在，无法更新置顶状态。");
        return;
      }
      const nextSortOrder = pinned
        ? nextPinnedGroupSortOrder(machineGroups)
        : nextUnpinnedGroupSortOrder(machineGroups, group.id);

      if (group.id === UNGROUPED_REMOTE_HOST_GROUP_ID) {
        pinMachineGroup(group.id, pinned);
        return;
      }

      await updateRemoteHostGroup({
        id: group.id,
        name: group.title,
        sortOrder: nextSortOrder,
      });
      await refreshRemoteHostTree();
    },
    [machineGroups, pinMachineGroup, refreshRemoteHostTree],
  );
  const handleRemoteGroupSaved = useCallback(
    async (group: RemoteHostGroup) => {
      if (group.id !== UNGROUPED_REMOTE_HOST_GROUP_ID) {
        await refreshRemoteHostTree();
      }
    },
    [refreshRemoteHostTree],
  );
  const handleRemoteGroupUpdate = useCallback(
    async (request: RemoteHostGroupUpdateRequest) => {
      const name = request.name.trim();
      if (request.id === UNGROUPED_REMOTE_HOST_GROUP_ID) {
        renameMachineGroup(request.id, name);
        return {
          createdAt: "",
          id: request.id,
          name,
          sortOrder: request.sortOrder,
          updatedAt: "",
        };
      }

      return updateRemoteHostGroup(request);
    },
    [renameMachineGroup],
  );
  const openConnectionDialog = useCallback(
    (options?: ConnectionDialogOptions) => {
      const nextEditingMachine = options?.hostId
        ? findMachine(machineGroups, options.hostId)
        : undefined;
      const nextEditingLocalMachine =
        nextEditingMachine?.kind === "local" ? nextEditingMachine : undefined;
      const nextEditingHost = options?.hostId
        ? remoteHostFromMachine(nextEditingMachine)
        : undefined;
      const nextEditingMode =
        nextEditingMachine?.kind === "rdp"
          ? "rdp"
          : nextEditingMachine?.kind === "telnet"
            ? "telnet"
            : nextEditingMachine?.kind === "serial"
              ? "serial"
            : "ssh";

      if (options?.hostId && !nextEditingHost && !nextEditingLocalMachine) {
        setRemoteHostLoadError("只能编辑已同步的本地/SSH/RDP/Telnet/Serial 连接配置。");
        return;
      }

      setEditingRemoteHost(nextEditingHost);
      setEditingLocalMachine(nextEditingLocalMachine);
      setRemoteHostDefaultGroupId(
        nextEditingLocalMachine?.remoteGroupId ??
          nextEditingHost?.groupId ??
          options?.groupId ??
          defaultRemoteGroupId,
      );
      setRemoteHostDefaultMode(
        nextEditingLocalMachine
          ? "local"
          : nextEditingHost
            ? nextEditingMode
            : options?.mode ?? "ssh",
      );
      setRemoteHostDialogOpen(true);
    },
    [defaultRemoteGroupId, machineGroups],
  );
  const closeConnectionDialog = useCallback(() => {
    setRemoteHostDialogOpen(false);
    setEditingRemoteHost(undefined);
    setEditingLocalMachine(undefined);
  }, []);
  const openRemoteGroupDialog = useCallback(
    (groupId?: string) => {
      if (!groupId) {
        setEditingRemoteGroup(undefined);
        setRemoteGroupDialogOpen(true);
        return;
      }

      const group = machineGroups.find((candidate) => candidate.id === groupId);
      if (!group) {
        setRemoteHostLoadError("分组不存在，无法重命名。");
        return;
      }
      setEditingRemoteGroup(group);
      setRemoteGroupDialogOpen(true);
    },
    [machineGroups],
  );
  const closeRemoteGroupDialog = useCallback(() => {
    setRemoteGroupDialogOpen(false);
    setEditingRemoteGroup(undefined);
  }, []);
  const requestDeleteGroup = useCallback(
    (groupId: string) => {
      const group = machineGroups.find((candidate) => candidate.id === groupId);
      if (!group) {
        setRemoteHostLoadError("分组不存在，无法删除。");
        return;
      }
      setDeleteError(null);
      setPendingDelete({
        id: group.id,
        machineCount: group.machines.length,
        title: group.title,
        type: "group",
      });
    },
    [machineGroups],
  );
  const requestDeleteMachine = useCallback(
    (machineId: string) => {
      const machine = findMachine(machineGroups, machineId);
      if (!machine) {
        setRemoteHostLoadError("只能删除已保存的 SSH/RDP/Telnet/Serial 连接配置。");
        return;
      }
      if (machine.kind === "local" || machine.kind === "dockerContainer") {
        removeSidebarMachine(machine.id);
        return;
      }
      if (
        machine.kind !== "ssh" &&
        machine.kind !== "rdp" &&
        machine.kind !== "telnet" &&
        machine.kind !== "serial"
      ) {
        setRemoteHostLoadError("只能删除已保存的 SSH/RDP/Telnet/Serial 连接配置。");
        return;
      }
      setDeleteError(null);
      setPendingDelete({
        id: machine.id,
        title: machine.name,
        type: "machine",
      });
    },
    [machineGroups, removeSidebarMachine],
  );
  const openSavedRdpMachine = useCallback(
    async (machineId: string) => {
      const machine = findMachine(machineGroups, machineId);
      if (!machine || machine.kind !== "rdp") {
        setRemoteHostLoadError("只能打开已保存的 RDP 连接配置。");
        return;
      }

      try {
        await openSavedRdpConnection(machine.id);
        setRemoteHostLoadError(null);
      } catch (caught) {
        setRemoteHostLoadError(caught instanceof Error ? caught.message : String(caught));
      }
    },
    [machineGroups],
  );
  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) {
      return;
    }

    setDeleteSaving(true);
    setDeleteError(null);
    try {
      if (pendingDelete.type === "group") {
        if (pendingDelete.id === UNGROUPED_REMOTE_HOST_GROUP_ID) {
          const groupId = await ensureDefaultRemoteGroup();
          const group = machineGroups.find(
            (candidate) => candidate.id === pendingDelete.id,
          );
          const hosts = group?.machines
            .map(remoteHostFromMachine)
            .filter((host): host is RemoteHost => Boolean(host)) ?? [];
          await Promise.all(
            hosts.map((host) =>
              updateRemoteHost({
                ...host,
                groupId,
              }),
            ),
          );
        } else {
          await deleteRemoteHostGroup(pendingDelete.id);
        }
      } else {
        await deleteRemoteHost(pendingDelete.id);
      }
      await refreshRemoteHostTree();
      setPendingDelete(null);
    } catch (caught) {
      setDeleteError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setDeleteSaving(false);
    }
  }, [
    ensureDefaultRemoteGroup,
    machineGroups,
    pendingDelete,
    refreshRemoteHostTree,
  ]);

  return {
    closeConnectionDialog,
    closeRemoteGroupDialog,
    confirmDelete,
    deleteError,
    deleteSaving,
    editingLocalMachine,
    editingRemoteGroup,
    editingRemoteHost,
    handleCreateLocalProfile,
    handleCreateRemoteHost,
    handleDuplicateMachine,
    handleMoveMachineToGroup,
    handlePinMachineGroup,
    handleRemoteGroupSaved,
    handleRemoteGroupUpdate,
    handleRemoteHostCreated,
    handleUpdateLocalProfile,
    openConnectionDialog,
    openRemoteGroupDialog,
    openSavedRdpMachine,
    pendingDelete,
    profileLoadError,
    refreshRemoteHostTree,
    remoteGroupDialogOpen,
    remoteHostDefaultGroupId,
    remoteHostDefaultMode,
    remoteHostDialogOpen,
    remoteHostLoadError,
    requestDeleteGroup,
    requestDeleteMachine,
    resolveTargetGroupId,
    setDeleteError,
    setPendingDelete,
    setProfileLoadError,
  };
}
