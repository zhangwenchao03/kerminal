import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceFileTabSurface } from "../../../../src/features/workspace/WorkspaceFileTabSurface";
import type { WorkspaceFileTab } from "../../../../src/features/workspace/types";

const transportMocks = vi.hoisted(() => ({
  readRemoteWorkspaceTextFile: vi.fn(),
  writeRemoteWorkspaceTextFile: vi.fn(),
}));

const monacoEditorMocks = vi.hoisted(() => {
  const editor = {
    addCommand: vi.fn(),
    focus: vi.fn(),
    getAction: vi.fn((id: string) => ({ run: vi.fn(), id })),
    getModel: vi.fn(() => ({ getValueInRange: vi.fn(() => "port") })),
    getSelection: vi.fn(() => ({
      endColumn: 5,
      endLineNumber: 1,
      isEmpty: vi.fn(() => false),
      positionColumn: 5,
      positionLineNumber: 1,
      selectionStartColumn: 1,
      selectionStartLineNumber: 1,
      startColumn: 1,
      startLineNumber: 1,
    })),
    hasTextFocus: vi.fn(() => true),
    trigger: vi.fn(),
  };

  return {
    editor,
    keyCode: {
      Insert: 52,
      KeyA: 31,
      KeyC: 33,
      KeyF: 36,
      KeyH: 38,
      KeyS: 49,
      KeyV: 55,
      KeyX: 56,
      KeyY: 57,
      KeyZ: 58,
    },
    keyMod: {
      CtrlCmd: 2048,
      Shift: 1024,
    },
    reset: () => {
      Object.values(editor).forEach((value) => {
        if (typeof value === "function" && "mockClear" in value) {
          value.mockClear();
        }
      });
    },
  };
});

vi.mock("../../../../src/features/sftp/MonacoTextEditor", () => ({
  MonacoTextEditor: ({
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
      KeyCode: monacoEditorMocks.keyCode,
      KeyMod: monacoEditorMocks.keyMod,
      editor: { defineTheme: vi.fn() },
    };
    beforeMount?.(monaco);
    onMount?.(monacoEditorMocks.editor, monaco);
    return (
      <textarea
        aria-label="Monaco 编辑器"
        onChange={(event) => onChange?.(event.target.value)}
        value={value ?? ""}
      />
    );
  },
}));

vi.mock(
  "../../../../src/features/sftp/remoteWorkspaceEditorTransport",
  () => ({
    readRemoteWorkspaceTextFile: (...args: unknown[]) =>
      transportMocks.readRemoteWorkspaceTextFile(...args),
    writeRemoteWorkspaceTextFile: (...args: unknown[]) =>
      transportMocks.writeRemoteWorkspaceTextFile(...args),
  }),
);

const editableTab: WorkspaceFileTab = {
  access: "editable",
  id: "tab-workspace-file-app",
  kind: "workspaceFile",
  machineId: "host-prod",
  path: "/etc/app.conf",
  source: "sftp",
  target: { hostId: "host-prod", kind: "ssh" },
  title: "app.conf",
};

describe("WorkspaceFileTabSurface", () => {
  beforeEach(() => {
    transportMocks.readRemoteWorkspaceTextFile.mockReset();
    transportMocks.writeRemoteWorkspaceTextFile.mockReset();
    monacoEditorMocks.reset();
    transportMocks.readRemoteWorkspaceTextFile.mockResolvedValue({
      binary: false,
      bytesRead: 10,
      content: "port=8080\n",
      encoding: "utf-8",
      lineEnding: "lf",
      maxBytes: 10 * 1024 * 1024,
      path: "/etc/app.conf",
      readonly: false,
      revision: {
        contentSha256: "sha-a",
        modified: "Jul 05 12:00",
        permissions: "-rw-r--r--",
        permissionsMode: 420,
        size: 10,
      },
      truncated: false,
    });
  });

  it("opens the Kerminal editor menu on right click instead of the browser menu", async () => {
    render(<WorkspaceFileTabSurface active tab={editableTab} />);
    const editor = await screen.findByLabelText("Monaco 编辑器");

    const contextMenuEvent = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 64,
      clientY: 72,
    });
    editor.dispatchEvent(contextMenuEvent);

    expect(contextMenuEvent.defaultPrevented).toBe(true);
    expect(
      await screen.findByRole("menu", { name: "app.conf 编辑菜单" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /复制/ })).not.toBeDisabled();
  });

  it("keeps write commands disabled in read-only workspace file tabs", async () => {
    transportMocks.readRemoteWorkspaceTextFile.mockResolvedValueOnce({
      binary: false,
      bytesRead: 10,
      content: "port=8080\n",
      encoding: "utf-8",
      lineEnding: "lf",
      maxBytes: 10 * 1024 * 1024,
      path: "/etc/app.conf",
      readonly: true,
      revision: {
        contentSha256: "sha-a",
        modified: "Jul 05 12:00",
        permissions: "-r--r--r--",
        permissionsMode: 292,
        size: 10,
      },
      truncated: false,
    });

    render(
      <WorkspaceFileTabSurface
        active
        tab={{ ...editableTab, access: "readonly" }}
      />,
    );
    const editor = await screen.findByLabelText("Monaco 编辑器");

    fireEvent.contextMenu(editor, { clientX: 24, clientY: 32 });

    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: /剪切/ })).toBeDisabled(),
    );
    expect(screen.getByRole("menuitem", { name: /粘贴/ })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: /复制/ })).not.toBeDisabled();
  });
});
