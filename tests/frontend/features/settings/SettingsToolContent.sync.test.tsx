import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsToolContent } from "../../../../src/features/settings/SettingsToolContent";
import { defaultAppSettings, type AppSettings } from "../../../../src/features/settings/settingsModel";

const fileDialogMock = vi.hoisted(() => ({
  selectLocalFile: vi.fn(),
}));
const terminalSuggestionApiMock = vi.hoisted(() => ({
  cleanupTerminalSuggestionDiagnostics: vi.fn(),
  getTerminalSuggestionTelemetrySummary: vi.fn(),
}));
const workspaceSyncApiMock = vi.hoisted(() => ({
  getWorkspaceSyncStatus: vi.fn(),
  readVaultKeyContent: vi.fn(),
  runWorkspaceSync: vi.fn(),
  saveVaultKeyContent: vi.fn(),
}));

vi.mock("../../../../src/lib/fileDialogApi", () => ({
  selectLocalFile: fileDialogMock.selectLocalFile,
}));
vi.mock("../../../../src/lib/terminalSuggestionApi", () => terminalSuggestionApiMock);
vi.mock("../../../../src/lib/workspaceSyncApi", () => workspaceSyncApiMock);
vi.mock("../../../../src/lib/desktopNotificationApi", () => ({
  currentDesktopNotificationVisibility: vi.fn(() => "hidden"),
  sendDesktopNotification: vi.fn(),
}));
vi.mock("../../../../src/lib/mcpServerApi", () => ({
  getMcpHttpServerStatus: vi.fn(),
  startMcpHttpServer: vi.fn(),
  stopMcpHttpServer: vi.fn(),
}));
vi.mock("../../../../src/lib/updaterApi", () => ({
  checkForAppUpdate: vi.fn(),
  installPendingAppUpdate: vi.fn(),
  relaunchApp: vi.fn(),
}));

describe("SettingsToolContent sync page", () => {
  beforeEach(() => {
    fileDialogMock.selectLocalFile.mockReset();
    fileDialogMock.selectLocalFile.mockResolvedValue(null);
    terminalSuggestionApiMock.cleanupTerminalSuggestionDiagnostics.mockReset();
    terminalSuggestionApiMock.getTerminalSuggestionTelemetrySummary.mockReset();
    terminalSuggestionApiMock.getTerminalSuggestionTelemetrySummary.mockResolvedValue({
      generatedAtUnixMs: 1760000000100,
      providers: [],
      startedAtUnixMs: 1760000000000,
      totalCandidateCount: 0,
      totalQueryCount: 0,
    });
    workspaceSyncApiMock.getWorkspaceSyncStatus.mockReset();
    workspaceSyncApiMock.getWorkspaceSyncStatus.mockResolvedValue(syncStatus(true));
    workspaceSyncApiMock.readVaultKeyContent.mockReset();
    workspaceSyncApiMock.readVaultKeyContent.mockResolvedValue(sampleKeyToml());
    workspaceSyncApiMock.runWorkspaceSync.mockReset();
    workspaceSyncApiMock.runWorkspaceSync.mockResolvedValue({
      pulled: true,
      committed: true,
      skippedRemote: false,
      commitHash: "abc1234",
      message: "已拉取远程内容并提交本地变更。",
      status: "success",
    });
    workspaceSyncApiMock.saveVaultKeyContent.mockReset();
    workspaceSyncApiMock.saveVaultKeyContent.mockResolvedValue({
      keyId: "workspace-default",
      dryRun: false,
      entryCount: 0,
      backupCreated: true,
    });
  });

  it("renders only Git initialization status and editable key content", async () => {
    render(<ControlledSyncSettings />);

    expect(await screen.findByRole("heading", { name: "同步" })).toBeInTheDocument();
    expect(screen.getByText("Git 状态")).toBeInTheDocument();
    expect(screen.getByText("已初始化")).toBeInTheDocument();
    expect(screen.getByText("密钥文件")).toBeInTheDocument();
    expect(screen.getByText("C:\\Users\\dev\\.kerminal\\secrets\\vault-key.toml")).toBeInTheDocument();
    expect(await screen.findByLabelText("密钥文件内容")).toHaveValue(sampleKeyToml());
    expect(screen.getByRole("button", { name: /^同步$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^保存$/ })).toBeInTheDocument();
    expect(screen.queryByText("keyctl")).not.toBeInTheDocument();
    expect(screen.queryByText("dry-run")).not.toBeInTheDocument();
    expect(screen.queryByText("export")).not.toBeInTheDocument();
    expect(screen.queryByText("rotate")).not.toBeInTheDocument();
  });

  it("runs workspace sync when Git is initialized", async () => {
    const user = userEvent.setup();
    render(<ControlledSyncSettings />);

    await user.click(await screen.findByRole("button", { name: /^同步$/ }));

    expect(workspaceSyncApiMock.runWorkspaceSync).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("已拉取远程内容并提交本地变更。")).toBeInTheDocument();
    expect(screen.getByText("最近提交：")).toBeInTheDocument();
    expect(screen.getByText("abc1234")).toBeInTheDocument();
  });

  it("does not show sync button before Git is initialized", async () => {
    workspaceSyncApiMock.getWorkspaceSyncStatus.mockResolvedValue(syncStatus(false));

    render(<ControlledSyncSettings />);

    expect(await screen.findByText("未初始化")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^同步$/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^保存$/ })).toBeInTheDocument();
  });

  it("saves edited key content with validation feedback", async () => {
    const user = userEvent.setup();
    render(<ControlledSyncSettings />);

    const keyInput = await screen.findByLabelText("密钥文件内容");
    await waitFor(() => {
      expect(keyInput).toBeEnabled();
      expect(keyInput).toHaveValue(sampleKeyToml());
    });
    await user.clear(keyInput);
    await user.type(keyInput, editedKeyToml());
    await user.click(screen.getByRole("button", { name: /^保存$/ }));

    expect(workspaceSyncApiMock.saveVaultKeyContent).toHaveBeenCalledWith(editedKeyToml());
    expect(await screen.findByText("密钥已保存，并已为旧文件创建备份。")).toBeInTheDocument();
  });

  it("rejects empty key content before calling the backend", async () => {
    const user = userEvent.setup();
    render(<ControlledSyncSettings />);

    const keyInput = await screen.findByLabelText("密钥文件内容");
    await waitFor(() => {
      expect(keyInput).toBeEnabled();
      expect(keyInput).toHaveValue(sampleKeyToml());
    });
    await user.clear(keyInput);
    await user.click(screen.getByRole("button", { name: /^保存$/ }));

    expect(workspaceSyncApiMock.saveVaultKeyContent).not.toHaveBeenCalled();
    expect(await screen.findByText("密钥内容不能为空。")).toBeInTheDocument();
  });

  it("keeps unknown sync failures in collapsed technical details", async () => {
    const user = userEvent.setup();
    workspaceSyncApiMock.runWorkspaceSync.mockRejectedValueOnce(
      new Error(
        'git runtime failed at C:\\private\\sync.json with "token": "sync-secret"',
      ),
    );

    render(<ControlledSyncSettings />);
    await user.click(await screen.findByRole("button", { name: /^同步$/ }));

    expect(await screen.findByText("同步失败")).toBeVisible();
    expect(screen.getByText("请检查同步配置后重试。")).toBeVisible();
    const detail = screen.getByText(/git runtime failed/);
    expect(detail.closest("details")).not.toHaveAttribute("open");
    expect(detail).not.toHaveTextContent("sync-secret");

    await user.click(screen.getByText("技术详情"));
    expect(detail.closest("details")).toHaveAttribute("open");
  });
});

function ControlledSyncSettings() {
  const [settings, setSettings] = useState<AppSettings>(defaultAppSettings);

  return (
    <SettingsToolContent
      initialSectionId="settings-sync"
      onSettingsChange={setSettings}
      settings={settings}
    />
  );
}

function syncStatus(initialized: boolean) {
  return {
    workspaceRoot: "C:\\Users\\dev\\.kerminal",
    git: {
      available: true,
      executable: "git",
      repositoryInitialized: initialized,
      status: "available",
    },
    gitignore: {
      path: "C:\\Users\\dev\\.kerminal\\.gitignore",
      present: true,
      hasRequiredRules: true,
      missingRules: [],
    },
    vault: {
      secretsDir: "C:\\Users\\dev\\.kerminal\\secrets",
      vaultPath: "C:\\Users\\dev\\.kerminal\\secrets\\vault.toml",
      vaultPresent: true,
      vaultKeyPath: "C:\\Users\\dev\\.kerminal\\secrets\\vault-key.toml",
      vaultKeyPresent: true,
      keyId: "workspace-default",
      entryCount: 0,
      status: "keyPresent",
    },
  };
}

function sampleKeyToml() {
  return [
    "schema_version = 1",
    'key_id = "workspace-default"',
    'algorithm = "xchacha20poly1305"',
    'created_at = "0"',
    'master_key = "sample"',
    "",
  ].join("\n");
}

function editedKeyToml() {
  return [
    "schema_version = 1",
    'key_id = "workspace-default"',
    'algorithm = "xchacha20poly1305"',
    'created_at = "1"',
    'master_key = "edited"',
    "",
  ].join("\n");
}
