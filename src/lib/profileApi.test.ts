import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const isTauriMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}));

describe("profileApi", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    isTauriMock.mockReset();
  });

  it("lists profiles through Tauri", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue([
      {
        args: [],
        createdAt: "now",
        env: {},
        id: "profile-1",
        isDefault: true,
        name: "PowerShell",
        shell: "powershell.exe",
        sortOrder: 10,
        updatedAt: "now",
      },
    ]);
    const { listProfiles } = await import("./profileApi");

    const profiles = await listProfiles();

    expect(profiles[0].name).toBe("PowerShell");
    expect(invokeMock).toHaveBeenCalledWith("profile_list");
  });

  it("normalizes create profile requests", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      args: [],
      createdAt: "now",
      env: {},
      id: "profile-1",
      isDefault: false,
      name: "bash",
      shell: "/bin/bash",
      sortOrder: 10,
      updatedAt: "now",
    });
    const { createProfile } = await import("./profileApi");

    await createProfile({ name: "bash", shell: "/bin/bash" });

    expect(invokeMock).toHaveBeenCalledWith("profile_create", {
      request: {
        args: [],
        cwd: undefined,
        env: {},
        name: "bash",
        setDefault: false,
        shell: "/bin/bash",
      },
    });
  });

  it("normalizes update profile requests", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      args: [],
      createdAt: "now",
      env: {},
      id: "profile-1",
      isDefault: false,
      name: "bash",
      shell: "/bin/bash",
      sortOrder: 20,
      updatedAt: "later",
    });
    const { updateProfile } = await import("./profileApi");

    await updateProfile({
      id: "profile-1",
      name: "bash",
      shell: "/bin/bash",
      sortOrder: 20,
    });

    expect(invokeMock).toHaveBeenCalledWith("profile_update", {
      request: {
        args: [],
        cwd: undefined,
        env: {},
        id: "profile-1",
        name: "bash",
        setDefault: false,
        shell: "/bin/bash",
        sortOrder: 20,
      },
    });
  });

  it("updates browser preview profiles outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const { updateProfile } = await import("./profileApi");

    await expect(
      updateProfile({
        args: ["-NoLogo"],
        id: "profile-browser-preview",
        name: "Preview PowerShell",
        shell: "pwsh.exe",
        sortOrder: 10,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        args: ["-NoLogo"],
        id: "profile-browser-preview",
        name: "Preview PowerShell",
        shell: "pwsh.exe",
      }),
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("uses browser preview profiles outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const { createProfile, detectShells, listProfiles } = await import("./profileApi");

    await expect(listProfiles()).resolves.toEqual([
      expect.objectContaining({
        id: "profile-browser-preview",
        name: "浏览器预览终端",
      }),
    ]);
    await expect(detectShells()).resolves.toEqual([
      expect.objectContaining({
        id: "browser-preview",
        shell: "browser-preview",
      }),
    ]);
    await expect(
      createProfile({ name: "Preview Bash", shell: "bash.exe" }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^profile-browser-preview-/),
        name: "Preview Bash",
        shell: "bash.exe",
      }),
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
