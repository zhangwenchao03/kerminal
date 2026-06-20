import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CSSProperties, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteWorkspaceEditor } from "./RemoteWorkspaceEditor";

type MockTreeNode = {
  children?: MockTreeNode[];
  error: string | null;
  id: string;
  kind: string;
  loaded: boolean;
  loading: boolean;
  name: string;
  path: string;
};

const sftpApiMocks = vi.hoisted(() => ({
  listSftpDirectory: vi.fn(),
  readSftpTextFile: vi.fn(),
  writeSftpTextFile: vi.fn(),
}));

const containerFilesApiMocks = vi.hoisted(() => ({
  listDockerContainerDirectory: vi.fn(),
  readDockerContainerTextFile: vi.fn(),
  writeDockerContainerTextFile: vi.fn(),
}));

vi.mock("@monaco-editor/react", () => ({
  default: ({
    beforeMount,
    onChange,
    onMount,
    value,
  }: {
    beforeMount?: (monaco: unknown) => void;
    onChange?: (value: string) => void;
    onMount?: (editor: unknown, monaco: unknown) => void;
    value?: string;
  }) => {
    const monaco = {
      KeyCode: { KeyS: 49 },
      KeyMod: { CtrlCmd: 2048 },
      editor: { defineTheme: vi.fn() },
    };
    beforeMount?.(monaco);
    onMount?.(
      {
        addCommand: vi.fn(),
        focus: vi.fn(),
        getAction: () => ({ run: vi.fn() }),
      },
      monaco,
    );
    return (
      <textarea
        aria-label="Monaco 编辑器"
        onChange={(event) => onChange?.(event.target.value)}
        value={value ?? ""}
      />
    );
  },
}));

vi.mock("../../lib/monacoSetup", () => ({}));

vi.mock("react-arborist", () => {
  const renderNodes = (
    nodes: MockTreeNode[],
    children: (props: {
      node: {
        data: MockTreeNode;
        isOpen: boolean;
        toggle: () => void;
      };
      style: CSSProperties;
    }) => ReactNode,
  ): ReactNode =>
    nodes.map((node) => (
      <div key={node.id}>
        {children({
          node: {
            data: node,
            isOpen: true,
            toggle: vi.fn(),
          },
          style: {},
        })}
        {node.children ? renderNodes(node.children, children) : null}
      </div>
    ));

  return {
    Tree: ({
      children,
      data,
    }: {
      children: (props: {
        node: {
          data: MockTreeNode;
          isOpen: boolean;
          toggle: () => void;
        };
        style: CSSProperties;
      }) => ReactNode;
      data: MockTreeNode[];
    }) => <div role="tree">{renderNodes(data, children)}</div>,
  };
});

vi.mock("../../lib/sftpApi", () => ({
  listSftpDirectory: (...args: unknown[]) =>
    sftpApiMocks.listSftpDirectory(...args),
  readSftpTextFile: (...args: unknown[]) =>
    sftpApiMocks.readSftpTextFile(...args),
  writeSftpTextFile: (...args: unknown[]) =>
    sftpApiMocks.writeSftpTextFile(...args),
}));

vi.mock("../../lib/containerFilesApi", () => ({
  listDockerContainerDirectory: (...args: unknown[]) =>
    containerFilesApiMocks.listDockerContainerDirectory(...args),
  readDockerContainerTextFile: (...args: unknown[]) =>
    containerFilesApiMocks.readDockerContainerTextFile(...args),
  writeDockerContainerTextFile: (...args: unknown[]) =>
    containerFilesApiMocks.writeDockerContainerTextFile(...args),
}));

describe("RemoteWorkspaceEditor", () => {
  beforeEach(() => {
    sftpApiMocks.listSftpDirectory.mockReset();
    sftpApiMocks.readSftpTextFile.mockReset();
    sftpApiMocks.writeSftpTextFile.mockReset();
    containerFilesApiMocks.listDockerContainerDirectory.mockReset();
    containerFilesApiMocks.readDockerContainerTextFile.mockReset();
    containerFilesApiMocks.writeDockerContainerTextFile.mockReset();

    sftpApiMocks.listSftpDirectory.mockImplementation(
      async ({ hostId, path }: { hostId: string; path: string }) => {
        if (path === "/etc") {
          return {
            entries: [
              {
                kind: "file",
                modified: "Jun 18 16:30",
                name: "app.conf",
                path: "/etc/app.conf",
                permissions: "-rw-r--r--",
                raw: "-rw-r--r-- app.conf",
                size: 10,
              },
            ],
            hostId,
            parentPath: "/",
            path,
          };
        }
        return {
          entries: [
            {
              kind: "directory",
              modified: "Jun 18 16:00",
              name: "etc",
              path: "/etc",
              permissions: "drwxr-xr-x",
              raw: "drwxr-xr-x etc",
              size: 4096,
            },
            {
              kind: "file",
              modified: "Jun 18 16:00",
              name: "README.md",
              path: "/README.md",
              permissions: "-rw-r--r--",
              raw: "-rw-r--r-- README.md",
              size: 12,
            },
          ],
          hostId,
          path: "/",
        };
      },
    );
    sftpApiMocks.readSftpTextFile.mockResolvedValue({
      binary: false,
      bytesRead: 10,
      content: "port=8080\n",
      encoding: "utf-8",
      hostId: "prod-api",
      lineEnding: "lf",
      maxBytes: 1024,
      path: "/etc/app.conf",
      readonly: false,
      revision: {
        contentSha256: "sha-a",
        modified: "Jun 18 16:30",
        permissions: "-rw-r--r--",
        permissionsMode: 420,
        size: 10,
      },
      truncated: false,
    });
    sftpApiMocks.writeSftpTextFile.mockResolvedValue({
      bytesWritten: 10,
      encoding: "utf-8",
      hostId: "prod-api",
      lineEnding: "lf",
      path: "/etc/app.conf",
      revision: {
        contentSha256: "sha-b",
        modified: "Jun 18 16:31",
        permissions: "-rw-r--r--",
        permissionsMode: 420,
        size: 10,
      },
    });
    containerFilesApiMocks.listDockerContainerDirectory.mockResolvedValue({
      containerId: "container-api",
      entries: [
        {
          kind: "file",
          modified: "Jun 18 16:00",
          name: "package.json",
          path: "/app/package.json",
          permissions: "-rw-r--r--",
          raw: "-rw-r--r-- package.json",
          size: 18,
        },
      ],
      hostId: "prod-api",
      path: "/app",
    });
    containerFilesApiMocks.readDockerContainerTextFile.mockResolvedValue({
      binary: false,
      bytesRead: 18,
      containerId: "container-api",
      content: "{\"name\":\"api\"}\n",
      encoding: "utf-8",
      hostId: "prod-api",
      lineEnding: "lf",
      maxBytes: 1024,
      path: "/app/package.json",
      readonly: false,
      revision: {
        contentSha256: "container-sha-a",
        modified: "Jun 18 16:00",
        permissions: "-rw-r--r--",
        permissionsMode: 420,
        size: 18,
      },
      truncated: false,
    });
    containerFilesApiMocks.writeDockerContainerTextFile.mockResolvedValue({
      bytesWritten: 19,
      containerId: "container-api",
      encoding: "utf-8",
      hostId: "prod-api",
      lineEnding: "lf",
      path: "/app/package.json",
      revision: {
        contentSha256: "container-sha-b",
        modified: "Jun 18 16:01",
        permissions: "-rw-r--r--",
        permissionsMode: 420,
        size: 19,
      },
    });
  });

  it("loads a remote tree, opens a text file, and saves edits", async () => {
    const user = userEvent.setup();
    const onStatus = vi.fn();

    render(
      <RemoteWorkspaceEditor
        hostId="prod-api"
        onStatus={onStatus}
        rootPath="/"
      />,
    );

    await user.click(await screen.findByRole("button", { name: "etc" }));
    await user.click(await screen.findByRole("button", { name: "app.conf" }));
    const editor = await screen.findByLabelText("Monaco 编辑器");
    await user.clear(editor);
    await user.type(editor, "port=9090\n");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(sftpApiMocks.writeSftpTextFile).toHaveBeenCalledWith({
        content: "port=9090\n",
        create: false,
        encoding: "utf-8",
        expectedRevision: {
          contentSha256: "sha-a",
          modified: "Jun 18 16:30",
          permissions: "-rw-r--r--",
          permissionsMode: 420,
          size: 10,
        },
        hostId: "prod-api",
        overwriteOnConflict: false,
        path: "/etc/app.conf",
      }),
    );
    expect(onStatus).toHaveBeenLastCalledWith({
      kind: "success",
      message: "已保存：/etc/app.conf",
    });
  });

  it("uses container file APIs when editing a container workspace", async () => {
    const user = userEvent.setup();

    render(
      <RemoteWorkspaceEditor
        rootPath="/app"
        target={{
          containerId: "container-api",
          hostId: "prod-api",
          kind: "dockerContainer",
          runtime: "docker",
        }}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "package.json" }),
    );
    const editor = await screen.findByLabelText("Monaco 编辑器");
    await user.clear(editor);
    fireEvent.change(editor, { target: { value: "{\"name\":\"api2\"}\n" } });
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(
        containerFilesApiMocks.writeDockerContainerTextFile,
      ).toHaveBeenCalledWith({
        containerId: "container-api",
        content: "{\"name\":\"api2\"}\n",
        create: false,
        encoding: "utf-8",
        expectedRevision: {
          contentSha256: "container-sha-a",
          modified: "Jun 18 16:00",
          permissions: "-rw-r--r--",
          permissionsMode: 420,
          size: 18,
        },
        hostId: "prod-api",
        overwriteOnConflict: false,
        path: "/app/package.json",
        runtime: "docker",
      }),
    );
    expect(sftpApiMocks.writeSftpTextFile).not.toHaveBeenCalled();
  });

  it("offers overwrite save after a remote revision conflict", async () => {
    const user = userEvent.setup();
    sftpApiMocks.writeSftpTextFile
      .mockRejectedValueOnce(new Error("远端文件已变更，请重新加载或选择覆盖后再保存"))
      .mockResolvedValueOnce({
        bytesWritten: 10,
        encoding: "utf-8",
        hostId: "prod-api",
        lineEnding: "lf",
        path: "/etc/app.conf",
        revision: {
          contentSha256: "sha-c",
          modified: "Jun 18 16:32",
          permissions: "-rw-r--r--",
          permissionsMode: 420,
          size: 10,
        },
      });

    render(<RemoteWorkspaceEditor hostId="prod-api" rootPath="/" />);

    await user.click(await screen.findByRole("button", { name: "etc" }));
    await user.click(await screen.findByRole("button", { name: "app.conf" }));
    const editor = await screen.findByLabelText("Monaco 编辑器");
    await user.clear(editor);
    await user.type(editor, "port=9090\n");
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("远端文件已变更");
    await user.click(screen.getByRole("button", { name: "覆盖保存" }));

    await waitFor(() =>
      expect(sftpApiMocks.writeSftpTextFile).toHaveBeenLastCalledWith(
        expect.objectContaining({
          overwriteOnConflict: true,
          path: "/etc/app.conf",
        }),
      ),
    );
  });

  it("confirms before closing a dirty tab and can save before closing", async () => {
    const user = userEvent.setup();

    render(<RemoteWorkspaceEditor hostId="prod-api" rootPath="/" />);

    await user.click(await screen.findByRole("button", { name: "etc" }));
    await user.click(await screen.findByRole("button", { name: "app.conf" }));
    const editor = await screen.findByLabelText("Monaco 编辑器");
    await user.clear(editor);
    await user.type(editor, "port=9090\n");
    await user.click(screen.getByLabelText("关闭 app.conf"));

    expect(
      screen.getByRole("dialog", { name: "关闭未保存文件" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "保存后关闭" }));

    await waitFor(() =>
      expect(sftpApiMocks.writeSftpTextFile).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "port=9090\n",
          path: "/etc/app.conf",
        }),
      ),
    );
    await waitFor(() =>
      expect(screen.queryByLabelText("关闭 app.conf")).not.toBeInTheDocument(),
    );
  });
});
