import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalProfile } from "../../../src/lib/profileApi";
import type { MachineGroup } from "../../../src/features/workspace/types";
import { useKerminalShellRemoteActions } from "../../../src/app/useKerminalShellRemoteActions";

const profileApiMock = vi.hoisted(() => ({
  createProfile: vi.fn(),
  listProfiles: vi.fn(),
  updateProfile: vi.fn(),
}));

const remoteHostApiMock = vi.hoisted(() => ({
  createRemoteHost: vi.fn(),
  createRemoteHostGroup: vi.fn(),
  deleteRemoteHost: vi.fn(),
  deleteRemoteHostGroup: vi.fn(),
  listRemoteHostTree: vi.fn(),
  updateRemoteHost: vi.fn(),
  updateRemoteHostGroup: vi.fn(),
}));

vi.mock("../../../src/lib/connectionApi", () => ({
  openSavedRdpConnection: vi.fn(),
}));

vi.mock("../../../src/lib/profileApi", () => ({
  browserPreviewProfiles: [
    {
      args: [],
      createdAt: "test",
      env: {},
      id: "profile-preview",
      isDefault: true,
      name: "Preview",
      shell: "browser-preview",
      sortOrder: 0,
      updatedAt: "test",
    },
  ],
  createProfile: (...args: unknown[]) => profileApiMock.createProfile(...args),
  listProfiles: (...args: unknown[]) => profileApiMock.listProfiles(...args),
  updateProfile: (...args: unknown[]) => profileApiMock.updateProfile(...args),
}));

vi.mock("../../../src/lib/remoteHostApi", () => ({
  UNGROUPED_REMOTE_HOST_GROUP_ID: "__ungrouped__",
  createRemoteHost: (...args: unknown[]) =>
    remoteHostApiMock.createRemoteHost(...args),
  createRemoteHostGroup: (...args: unknown[]) =>
    remoteHostApiMock.createRemoteHostGroup(...args),
  deleteRemoteHost: (...args: unknown[]) =>
    remoteHostApiMock.deleteRemoteHost(...args),
  deleteRemoteHostGroup: (...args: unknown[]) =>
    remoteHostApiMock.deleteRemoteHostGroup(...args),
  listRemoteHostTree: (...args: unknown[]) =>
    remoteHostApiMock.listRemoteHostTree(...args),
  updateRemoteHost: (...args: unknown[]) =>
    remoteHostApiMock.updateRemoteHost(...args),
  updateRemoteHostGroup: (...args: unknown[]) =>
    remoteHostApiMock.updateRemoteHostGroup(...args),
}));

describe("useKerminalShellRemoteActions local profiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    profileApiMock.createProfile.mockResolvedValue(createdProfile);
    profileApiMock.listProfiles.mockResolvedValue([baseProfile, savedProfile]);
  });

  it("adds a created local profile as a persistent sidebar machine in the target group", async () => {
    const addLocalProfileMachine = vi.fn();
    const addTerminalTab = vi.fn();
    const selectMachine = vi.fn();
    const setProfiles = vi.fn();
    const { result } = renderHook(() =>
      useKerminalShellRemoteActions({
        activeProfileId: baseProfile.id,
        addLocalProfileMachine,
        addTerminalTab,
        defaultRemoteGroupId: "group-local",
        machineGroups,
        moveSidebarMachine: vi.fn(),
        pinMachineGroup: vi.fn(),
        profiles: [baseProfile],
        removeSidebarMachine: vi.fn(),
        renameMachineGroup: vi.fn(),
        selectMachine,
        setProfiles,
        setRemoteHostTree: vi.fn(),
        updateLocalMachine: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.handleCreateLocalProfile({
        groupId: "group-local",
        shell: "pwsh.exe",
        title: "abc",
      });
    });

    expect(profileApiMock.createProfile).toHaveBeenCalledWith({
      args: baseProfile.args,
      cwd: baseProfile.cwd,
      env: baseProfile.env,
      name: "abc",
      setDefault: false,
      sidebarGroupId: "group-local",
      shell: "pwsh.exe",
    });
    expect(setProfiles).toHaveBeenCalledWith([baseProfile, savedProfile]);
    expect(addLocalProfileMachine).toHaveBeenCalledWith(
      savedProfile,
      "group-local",
    );
    expect(selectMachine).toHaveBeenCalledWith("profile:profile-created");
    expect(addTerminalTab).not.toHaveBeenCalled();
  });

  it("persists a moved local profile sidebar group", async () => {
    const moveSidebarMachine = vi.fn();
    const selectMachine = vi.fn();
    const setProfiles = vi.fn();
    const movedProfile = {
      ...savedProfile,
      sidebarGroupId: "group-tools",
    };
    profileApiMock.updateProfile.mockResolvedValue(movedProfile);
    profileApiMock.listProfiles.mockResolvedValue([baseProfile, movedProfile]);
    const { result } = renderHook(() =>
      useKerminalShellRemoteActions({
        activeProfileId: baseProfile.id,
        addLocalProfileMachine: vi.fn(),
        addTerminalTab: vi.fn(),
        defaultRemoteGroupId: "group-local",
        machineGroups: localMachineGroups,
        moveSidebarMachine,
        pinMachineGroup: vi.fn(),
        profiles: [baseProfile, savedProfile],
        removeSidebarMachine: vi.fn(),
        renameMachineGroup: vi.fn(),
        selectMachine,
        setProfiles,
        setRemoteHostTree: vi.fn(),
        updateLocalMachine: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.handleMoveMachineToGroup(
        "profile:profile-created",
        "group-tools",
      );
    });

    expect(profileApiMock.updateProfile).toHaveBeenCalledWith({
      args: savedProfile.args,
      cwd: savedProfile.cwd,
      env: savedProfile.env,
      id: savedProfile.id,
      name: savedProfile.name,
      setDefault: savedProfile.isDefault,
      sidebarGroupId: "group-tools",
      shell: savedProfile.shell,
      sortOrder: savedProfile.sortOrder,
    });
    expect(setProfiles).toHaveBeenCalledWith([baseProfile, movedProfile]);
    expect(moveSidebarMachine).toHaveBeenCalledWith(
      "profile:profile-created",
      "group-tools",
    );
    expect(selectMachine).toHaveBeenCalledWith("profile:profile-created");
  });

  it("clears the profile sidebar group when removing a local profile machine", async () => {
    const removeSidebarMachine = vi.fn();
    const setProfiles = vi.fn();
    const detachedProfile = {
      ...savedProfile,
      sidebarGroupId: undefined,
    };
    profileApiMock.updateProfile.mockResolvedValue(detachedProfile);
    profileApiMock.listProfiles.mockResolvedValue([baseProfile, detachedProfile]);
    const { result } = renderHook(() =>
      useKerminalShellRemoteActions({
        activeProfileId: baseProfile.id,
        addLocalProfileMachine: vi.fn(),
        addTerminalTab: vi.fn(),
        defaultRemoteGroupId: "group-local",
        machineGroups: localMachineGroups,
        moveSidebarMachine: vi.fn(),
        pinMachineGroup: vi.fn(),
        profiles: [baseProfile, savedProfile],
        removeSidebarMachine,
        renameMachineGroup: vi.fn(),
        selectMachine: vi.fn(),
        setProfiles,
        setRemoteHostTree: vi.fn(),
        updateLocalMachine: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.requestDeleteMachine("profile:profile-created");
    });

    expect(profileApiMock.updateProfile).toHaveBeenCalledWith({
      args: savedProfile.args,
      cwd: savedProfile.cwd,
      env: savedProfile.env,
      id: savedProfile.id,
      name: savedProfile.name,
      setDefault: savedProfile.isDefault,
      sidebarGroupId: "",
      shell: savedProfile.shell,
      sortOrder: savedProfile.sortOrder,
    });
    expect(setProfiles).toHaveBeenCalledWith([baseProfile, detachedProfile]);
    expect(removeSidebarMachine).toHaveBeenCalledWith("profile:profile-created");
  });
});

const baseProfile: TerminalProfile = {
  args: ["-NoLogo"],
  createdAt: "2026-06-25 20:00:00",
  cwd: "C:\\dev\\rust\\kerminal",
  env: { TERM: "xterm-256color" },
  id: "profile-base",
  isDefault: true,
  name: "PowerShell 7",
  shell: "pwsh.exe",
  sortOrder: 10,
  updatedAt: "2026-06-25 20:00:00",
};

const createdProfile: TerminalProfile = {
  ...baseProfile,
  id: "profile-created",
  name: "abc",
  sidebarGroupId: "group-local",
  sortOrder: 20,
};

const savedProfile: TerminalProfile = {
  ...createdProfile,
  updatedAt: "2026-06-25 20:01:00",
};

const machineGroups: MachineGroup[] = [
  {
    id: "group-local",
    machines: [],
    pinned: true,
    sortOrder: -10,
    title: "local",
  },
];

const localMachineGroups: MachineGroup[] = [
  {
    ...machineGroups[0],
    machines: [
      {
        args: savedProfile.args,
        cwd: savedProfile.cwd,
        description: "pwsh.exe",
        env: savedProfile.env,
        id: "profile:profile-created",
        kind: "local",
        name: savedProfile.name,
        profileId: savedProfile.id,
        remoteGroupId: "group-local",
        shell: savedProfile.shell,
        sortOrder: savedProfile.sortOrder,
        status: "offline",
        tags: ["local"],
      },
    ],
  },
  {
    id: "group-tools",
    machines: [],
    sortOrder: 10,
    title: "tools",
  },
];
