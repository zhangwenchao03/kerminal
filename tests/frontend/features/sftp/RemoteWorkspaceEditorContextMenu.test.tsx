import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RemoteWorkspaceEditorContextMenu } from "../../../../src/features/sftp/RemoteWorkspaceEditorContextMenu";
import { buildRemoteWorkspaceEditorCommandGroups } from "../../../../src/features/sftp/remoteWorkspaceEditorCommandModel";

describe("RemoteWorkspaceEditorContextMenu", () => {
  it("renders command groups and runs enabled commands", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const { container } = render(
      <div style={{ transform: "translateX(100px)" }}>
        <RemoteWorkspaceEditorContextMenu
          groups={buildRemoteWorkspaceEditorCommandGroups({
            dirty: true,
            hasConflict: false,
            hasEditor: true,
            loading: false,
            readOnly: false,
            saving: false,
          })}
          onAction={onAction}
          onClose={vi.fn()}
          position={{ x: 24, y: 32 }}
          title="app.conf"
        />
      </div>,
    );

    const menu = screen.getByRole("menu", { name: "app.conf 编辑菜单" });

    await user.click(screen.getByRole("menuitem", { name: /复制/ }));

    expect(menu).toHaveStyle({
      left: "24px",
      top: "32px",
    });
    expect(menu.parentElement).toBe(document.body);
    expect(container).not.toContainElement(menu);
    expect(onAction).toHaveBeenCalledWith("copy");
  });

  it("disables write commands for read-only editors", () => {
    render(
      <RemoteWorkspaceEditorContextMenu
        groups={buildRemoteWorkspaceEditorCommandGroups({
          dirty: true,
          hasConflict: false,
          hasEditor: true,
          loading: false,
          readOnly: true,
          saving: false,
        })}
        onAction={vi.fn()}
        onClose={vi.fn()}
        position={{ x: 0, y: 0 }}
        title="readonly.conf"
      />,
    );

    expect(screen.getByRole("menuitem", { name: /剪切/ })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: /粘贴/ })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: /复制/ })).not.toBeDisabled();
  });

  it("closes on escape and outside click", () => {
    const onClose = vi.fn();
    render(
      <RemoteWorkspaceEditorContextMenu
        groups={buildRemoteWorkspaceEditorCommandGroups({
          dirty: false,
          hasConflict: false,
          hasEditor: true,
          loading: false,
          readOnly: false,
          saving: false,
        })}
        onAction={vi.fn()}
        onClose={onClose}
        position={{ x: 0, y: 0 }}
        title="app.conf"
      />,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(window);

    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
