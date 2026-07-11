import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ExternalLaunchEventPayload,
  ExternalSshLaunchRequest,
} from "../../../../src/lib/externalLaunchApi";
import { ExternalLaunchHost } from "../../../../src/features/external-launch/ExternalLaunchHost";
import {
  resetWorkspaceStore,
  useWorkspaceStore,
} from "../../../../src/features/workspace/workspaceStore";

const apiMocks = vi.hoisted(() => ({
  ackExternalSshLaunch: vi.fn(),
  cancelExternalSshLaunch: vi.fn(),
  listenExternalSshLaunches: vi.fn(),
  materializeExternalSshLaunch: vi.fn(),
  takePendingExternalSshLaunches: vi.fn(),
}));

let externalLaunchListener:
  | ((payload: ExternalLaunchEventPayload) => void)
  | undefined;

vi.mock("../../../../src/lib/externalLaunchApi", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../../src/lib/externalLaunchApi")
  >()),
  ackExternalSshLaunch: (...args: unknown[]) =>
    apiMocks.ackExternalSshLaunch(...args),
  cancelExternalSshLaunch: (...args: unknown[]) =>
    apiMocks.cancelExternalSshLaunch(...args),
  listenExternalSshLaunches: (...args: unknown[]) =>
    apiMocks.listenExternalSshLaunches(...args),
  materializeExternalSshLaunch: (...args: unknown[]) =>
    apiMocks.materializeExternalSshLaunch(...args),
  takePendingExternalSshLaunches: (...args: unknown[]) =>
    apiMocks.takePendingExternalSshLaunches(...args),
}));

describe("ExternalLaunchHost", () => {
  beforeEach(() => {
    resetWorkspaceStore();
    apiMocks.ackExternalSshLaunch.mockReset();
    apiMocks.cancelExternalSshLaunch.mockReset();
    apiMocks.listenExternalSshLaunches.mockReset();
    apiMocks.materializeExternalSshLaunch.mockReset();
    apiMocks.takePendingExternalSshLaunches.mockReset();
    externalLaunchListener = undefined;
    apiMocks.ackExternalSshLaunch.mockResolvedValue(1);
    apiMocks.cancelExternalSshLaunch.mockResolvedValue(1);
    apiMocks.listenExternalSshLaunches.mockImplementation((listener) => {
      externalLaunchListener = listener as (
        payload: ExternalLaunchEventPayload,
      ) => void;
      return Promise.resolve(() => undefined);
    });
    apiMocks.materializeExternalSshLaunch.mockResolvedValue({
      authType: "agent",
      displayName: "Materialized SSH target",
      host: "materialized.internal",
      launchId: "launch-1",
      port: 2202,
      targetId: "external:launch-1",
      username: "resolved-user",
    });
  });

  it("drains pending launches, opens resolved SSH tabs, and acknowledges them", async () => {
    const openSpy = spyOnOpenExternalSshLaunch();
    apiMocks.takePendingExternalSshLaunches.mockResolvedValue([
      createLaunch({ username: "deploy" }),
    ]);

    render(<ExternalLaunchHost />);

    await waitFor(() =>
      expect(apiMocks.ackExternalSshLaunch).toHaveBeenCalledWith("launch-1"),
    );
    expect(apiMocks.materializeExternalSshLaunch).toHaveBeenCalledWith({
      launchId: "launch-1",
      username: "deploy",
    });
    expect(openSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "launch-1",
        materialized: expect.objectContaining({
          displayName: "Materialized SSH target",
          host: "materialized.internal",
          port: 2202,
          username: "resolved-user",
        }),
        target: expect.objectContaining({
          host: "materialized.internal",
          port: 2202,
          username: "resolved-user",
        }),
      }),
    );
    expect(
      apiMocks.materializeExternalSshLaunch.mock.invocationCallOrder[0],
    ).toBeLessThan(openSpy.mock.invocationCallOrder[0]);
    expect(openSpy.mock.invocationCallOrder[0]).toBeLessThan(
      apiMocks.ackExternalSshLaunch.mock.invocationCallOrder[0],
    );
    const state = useWorkspaceStore.getState();
    expect(state.terminalPanes[0]).toMatchObject({
      machineId: "external:launch-1",
      mode: "ssh",
      prompt: "resolved-user@materialized.internal:~$",
      remoteHostId: "external:launch-1",
    });
    const lastGroup = state.machineGroups[state.machineGroups.length - 1];
    expect(lastGroup?.machines[lastGroup.machines.length - 1]).toMatchObject({
      authType: "agent",
      host: "materialized.internal",
      name: "Materialized SSH target",
      port: 2202,
      username: "resolved-user",
    });
  });

  it("shows a username resolution dialog and cancels unresolved launches", async () => {
    const user = userEvent.setup();
    apiMocks.takePendingExternalSshLaunches.mockResolvedValue([
      createLaunch({ username: undefined }),
    ]);

    render(<ExternalLaunchHost />);
    await screen.findByRole("dialog", { name: "补全 SSH 用户名" });
    await user.click(screen.getByRole("button", { name: "取消" }));

    await waitFor(() =>
      expect(apiMocks.cancelExternalSshLaunch).toHaveBeenCalledWith("launch-1"),
    );
    expect(useWorkspaceStore.getState().terminalPanes).toHaveLength(0);
  });

  it("resolves missing usernames before opening and acknowledging the launch", async () => {
    const user = userEvent.setup();
    const openSpy = spyOnOpenExternalSshLaunch();
    apiMocks.takePendingExternalSshLaunches.mockResolvedValue([
      createLaunch({ username: undefined }),
    ]);

    render(<ExternalLaunchHost />);
    await user.type(await screen.findByLabelText("用户名"), "ops");
    await user.click(screen.getByRole("button", { name: "打开" }));

    await waitFor(() =>
      expect(apiMocks.ackExternalSshLaunch).toHaveBeenCalledWith("launch-1"),
    );
    expect(apiMocks.materializeExternalSshLaunch).toHaveBeenCalledWith({
      launchId: "launch-1",
      username: "ops",
    });
    expect(openSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "launch-1",
        target: expect.objectContaining({
          host: "materialized.internal",
          username: "resolved-user",
        }),
      }),
    );
    expect(
      apiMocks.materializeExternalSshLaunch.mock.invocationCallOrder[0],
    ).toBeLessThan(openSpy.mock.invocationCallOrder[0]);
    expect(openSpy.mock.invocationCallOrder[0]).toBeLessThan(
      apiMocks.ackExternalSshLaunch.mock.invocationCallOrder[0],
    );
    const state = useWorkspaceStore.getState();
    expect(state.terminalPanes[0]).toMatchObject({
      machineId: "external:launch-1",
      prompt: "resolved-user@materialized.internal:~$",
    });
  });

  it("shows a recoverable failure dialog when materialization fails", async () => {
    const user = userEvent.setup();
    const openSpy = spyOnOpenExternalSshLaunch();
    apiMocks.materializeExternalSshLaunch.mockRejectedValue(
      new Error("Unknown server key token=external-launch-secret"),
    );
    apiMocks.takePendingExternalSshLaunches.mockResolvedValue([
      createLaunch({ username: "deploy" }),
    ]);

    render(<ExternalLaunchHost />);

    await waitFor(() =>
      expect(apiMocks.materializeExternalSshLaunch).toHaveBeenCalledWith({
        launchId: "launch-1",
        username: "deploy",
      }),
    );
    expect(openSpy).not.toHaveBeenCalled();
    expect(apiMocks.ackExternalSshLaunch).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().terminalPanes).toHaveLength(0);
    expect(
      await screen.findByRole("dialog", { name: "外部 SSH 启动失败" }),
    ).toBeInTheDocument();
    expect(screen.getByText("可重试或取消该请求。")).toBeVisible();
    const technicalDetail = screen.getByText(/Unknown server key/);
    expect(technicalDetail.closest("details")).not.toHaveAttribute("open");
    expect(screen.queryByText(/external-launch-secret/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "取消该请求" }));

    await waitFor(() =>
      expect(apiMocks.cancelExternalSshLaunch).toHaveBeenCalledWith("launch-1"),
    );
  });

  it("shows visible feedback when an external launch event is rejected before pending intake", async () => {
    apiMocks.takePendingExternalSshLaunches.mockResolvedValue([]);

    render(<ExternalLaunchHost />);

    await waitFor(() => expect(externalLaunchListener).toBeDefined());
    externalLaunchListener?.({
      entrypoint: "single-instance",
      kind: "rejected",
      message: "no external SSH launch arguments detected",
      pendingCount: 0,
      sourceTool: "mobaxterm",
    });

    expect(
      await screen.findByRole("dialog", { name: "外部 SSH 启动未接收" }),
    ).toBeInTheDocument();
    expect(screen.getByText("外部 SSH 请求未接收")).toBeVisible();
    const technicalDetail = screen.getByText(
      "no external SSH launch arguments detected",
    );
    expect(technicalDetail.closest("details")).not.toHaveAttribute("open");
  });

  it("shows visible feedback when draining pending launches fails", async () => {
    apiMocks.takePendingExternalSshLaunches.mockRejectedValue(
      new Error("external launch intake unavailable"),
    );

    render(<ExternalLaunchHost />);

    expect(
      await screen.findByRole("dialog", { name: "外部 SSH 启动未接收" }),
    ).toBeInTheDocument();
    expect(screen.getByText("外部 SSH 请求未读取")).toBeVisible();
    const technicalDetail = screen.getByText(
      /external launch intake unavailable/,
    );
    expect(technicalDetail.closest("details")).not.toHaveAttribute("open");
    expect(useWorkspaceStore.getState().terminalPanes).toHaveLength(0);
  });
});

function spyOnOpenExternalSshLaunch() {
  const originalOpen = useWorkspaceStore.getState().openExternalSshLaunch;
  const openSpy = vi.fn((launch: Parameters<typeof originalOpen>[0]) =>
    originalOpen(launch),
  );
  useWorkspaceStore.setState({ openExternalSshLaunch: openSpy });
  return openSpy;
}

function createLaunch({
  username,
}: {
  username: string | undefined;
}): ExternalSshLaunchRequest {
  return {
    auth: {
      agent: false,
      hasKeyPassphrase: false,
      hasPassword: true,
      passwordFilePresent: false,
    },
    diagnostics: {
      argvRedacted: ["putty.exe", "-ssh", "example.internal"],
      parser: "putty",
      rawHash: "abc123",
      warnings: [],
    },
    id: "launch-1",
    options: {
      openSftp: false,
    },
    receivedAt: "1760000000",
    source: {
      entrypoint: "single-instance",
      tool: "putty",
    },
    target: {
      host: "example.internal",
      port: 22,
      route: [],
      username,
    },
  };
}
