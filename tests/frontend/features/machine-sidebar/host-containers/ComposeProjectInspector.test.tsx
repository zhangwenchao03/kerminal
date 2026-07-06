import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposeProjectView } from "../../../../../src/features/machine-sidebar/host-containers/composeProjectModel";
import { ComposeProjectInspector } from "../../../../../src/features/machine-sidebar/host-containers/ComposeProjectInspector";
import { readRemoteWorkspaceTextFile } from "../../../../../src/features/sftp/remoteWorkspaceEditorTransport";

const desktopClipboardApiMocks = vi.hoisted(() => ({
  writeDesktopClipboardText: vi.fn(),
}));

vi.mock("../../../../../src/features/sftp/MonacoTextEditor", () => ({
  MonacoTextEditor: ({
    path,
    value,
  }: {
    path: string;
    value?: string;
  }) => <textarea aria-label="Compose YAML editor" readOnly value={value} data-path={path} />,
}));

vi.mock("../../../../../src/features/sftp/remoteWorkspaceEditorTransport", () => ({
  readRemoteWorkspaceTextFile: vi.fn(),
}));

vi.mock("../../../../../src/lib/desktopClipboardApi", () => ({
  writeDesktopClipboardText: (...args: unknown[]) =>
    desktopClipboardApiMocks.writeDesktopClipboardText(...args),
}));

const project: ComposeProjectView = {
  configFiles: ["compose.yaml"],
  configPaths: ["/srv/kerminal/compose.yaml"],
  containers: [],
  errorCount: 0,
  id: "docker:kerminal",
  project: "kerminal",
  runningCount: 1,
  runtime: "docker",
  runtimeFamily: "docker",
  searchText: "kerminal /srv/kerminal/compose.yaml",
  services: [],
  stoppedCount: 0,
  totalCount: 1,
  warningCount: 0,
  warnings: [],
  workingDir: "/srv/kerminal",
};

describe("ComposeProjectInspector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readRemoteWorkspaceTextFile).mockResolvedValue({
      binary: false,
      bytesRead: 64,
      content: "services:\n  api:\n    image: kerminal/api:latest\n",
      encoding: "utf-8",
      hostId: "ubuntu-dev",
      lineEnding: "\n",
      maxBytes: 256 * 1024,
      path: "/srv/kerminal/compose.yaml",
      readonly: true,
      revision: {
        contentSha256: "sha256",
        modified: "2026-06-25T10:00:00Z",
        permissions: "0644",
        permissionsMode: 0o644,
        size: 64,
      },
      truncated: false,
    });
  });

  it("renders compact YAML metadata in the fixed preview footer", async () => {
    render(
      <ComposeProjectInspector
        hostId="ubuntu-dev"
        onEnterContainer={vi.fn()}
        onOpenContainerLogs={vi.fn()}
        onRefresh={vi.fn()}
        onSelectContainer={vi.fn()}
        onTabChange={vi.fn()}
        project={project}
        tab="yaml"
      />,
    );

    await waitFor(() => {
      expect(readRemoteWorkspaceTextFile).toHaveBeenCalledWith({
        maxBytes: 256 * 1024,
        path: "/srv/kerminal/compose.yaml",
        target: { hostId: "ubuntu-dev", kind: "ssh" },
      });
    });

    const metadata = await screen.findByLabelText("Compose YAML 元数据");
    expect(metadata).toHaveTextContent("64 B");
    expect(metadata).toHaveTextContent("0644");
    expect(metadata).toHaveTextContent("UTF-8");
    expect(metadata).toHaveTextContent("LF");
    expect(metadata).toHaveTextContent("RO");
    expect(screen.getByLabelText("Compose YAML 预览")).toBeInTheDocument();
  });

  it("opens Compose YAML in the central workspace tab when the action is available", async () => {
    const onOpenWorkspaceFileTab = vi.fn();

    render(
      <ComposeProjectInspector
        hostId="ubuntu-dev"
        onEnterContainer={vi.fn()}
        onOpenContainerLogs={vi.fn()}
        onOpenWorkspaceFileTab={onOpenWorkspaceFileTab}
        onRefresh={vi.fn()}
        onSelectContainer={vi.fn()}
        onTabChange={vi.fn()}
        project={project}
        tab="yaml"
      />,
    );

    await waitFor(() => {
      expect(onOpenWorkspaceFileTab).toHaveBeenCalledWith({
        access: "readonly",
        path: "/srv/kerminal/compose.yaml",
        rootPath: "/srv/kerminal",
        source: "composeYaml",
        target: { hostId: "ubuntu-dev", kind: "ssh" },
      });
    });
    expect(readRemoteWorkspaceTextFile).not.toHaveBeenCalled();
  });

  it("copies Compose YAML paths through the desktop clipboard facade", async () => {
    const user = userEvent.setup();
    render(
      <ComposeProjectInspector
        hostId="ubuntu-dev"
        onEnterContainer={vi.fn()}
        onOpenContainerLogs={vi.fn()}
        onRefresh={vi.fn()}
        onSelectContainer={vi.fn()}
        onTabChange={vi.fn()}
        project={project}
        tab="yaml"
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "复制 Compose YAML 路径" }),
    );

    expect(desktopClipboardApiMocks.writeDesktopClipboardText).toHaveBeenCalledWith(
      "/srv/kerminal/compose.yaml",
    );
  });

  it("keeps the inspector body geometry stable across project tabs", () => {
    const inspectorProps = {
      hostId: "ubuntu-dev",
      onEnterContainer: vi.fn(),
      onOpenContainerLogs: vi.fn(),
      onRefresh: vi.fn(),
      onSelectContainer: vi.fn(),
      onTabChange: vi.fn(),
      project,
    };
    const { rerender } = render(
      <ComposeProjectInspector {...inspectorProps} tab="overview" />,
    );

    const body = screen.getByTestId("compose-project-inspector-body");
    const initialClassName = body.className;
    expect(initialClassName).toContain("overflow-y-auto");

    rerender(<ComposeProjectInspector {...inspectorProps} tab="containers" />);
    expect(screen.getByTestId("compose-project-inspector-body").className).toBe(
      initialClassName,
    );

    rerender(<ComposeProjectInspector {...inspectorProps} tab="yaml" />);
    expect(screen.getByTestId("compose-project-inspector-body").className).toBe(
      initialClassName,
    );
  });
});
