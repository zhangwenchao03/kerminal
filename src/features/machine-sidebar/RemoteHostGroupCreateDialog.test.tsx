import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RemoteHostGroup } from "../../lib/remoteHostApi";
import { RemoteHostGroupCreateDialog } from "./RemoteHostGroupCreateDialog";

const createdGroup: RemoteHostGroup = {
  createdAt: "now",
  id: "group-1",
  name: "实验室",
  sortOrder: 10,
  updatedAt: "now",
};

describe("RemoteHostGroupCreateDialog", () => {
  it("creates a host group", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onCreateGroup = vi.fn().mockResolvedValue(createdGroup);
    const onCreated = vi.fn();

    render(
      <RemoteHostGroupCreateDialog
        onClose={onClose}
        onCreateGroup={onCreateGroup}
        onCreated={onCreated}
        open
      />,
    );

    await user.type(screen.getByLabelText("分组名称"), "实验室");
    await user.click(screen.getByRole("button", { name: "创建分组" }));

    expect(onCreateGroup).toHaveBeenCalledWith({ name: "实验室" });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(createdGroup));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("validates the group name", async () => {
    const user = userEvent.setup();
    const onCreateGroup = vi.fn();

    render(
      <RemoteHostGroupCreateDialog
        onClose={vi.fn()}
        onCreateGroup={onCreateGroup}
        open
      />,
    );

    await user.click(screen.getByRole("button", { name: "创建分组" }));

    expect(screen.getByText("请输入分组名称。")).toBeInTheDocument();
    expect(onCreateGroup).not.toHaveBeenCalled();
  });

  it("renames an existing host group", async () => {
    const user = userEvent.setup();
    const onUpdateGroup = vi.fn().mockResolvedValue({
      ...createdGroup,
      name: "生产环境",
      updatedAt: "later",
    });
    const onCreated = vi.fn();

    render(
      <RemoteHostGroupCreateDialog
        group={{
          id: "group-1",
          machines: [],
          sortOrder: 10,
          title: "实验室",
        }}
        onClose={vi.fn()}
        onCreateGroup={vi.fn()}
        onCreated={onCreated}
        onUpdateGroup={onUpdateGroup}
        open
      />,
    );

    expect(screen.getByRole("dialog", { name: "重命名分组" })).toBeInTheDocument();

    await user.clear(screen.getByLabelText("分组名称"));
    await user.type(screen.getByLabelText("分组名称"), "生产环境");
    await user.click(screen.getByRole("button", { name: "保存分组" }));

    expect(onUpdateGroup).toHaveBeenCalledWith({
      id: "group-1",
      name: "生产环境",
      sortOrder: 10,
    });
    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith({
        ...createdGroup,
        name: "生产环境",
        updatedAt: "later",
      }),
    );
  });

  it("keeps the rename draft and blocks saving after an external group change", async () => {
    const user = userEvent.setup();
    const onUpdateGroup = vi.fn();
    const conflictMessage = "cfg: group changed externally; close + reopen";
    const group = {
      id: "group-1",
      machines: [],
      sortOrder: 10,
      title: "实验室",
      updatedAt: "1",
    };
    const { rerender } = render(
      <RemoteHostGroupCreateDialog
        group={group}
        onClose={vi.fn()}
        onCreateGroup={vi.fn()}
        onUpdateGroup={onUpdateGroup}
        open
      />,
    );

    await user.clear(screen.getByLabelText("分组名称"));
    await user.type(screen.getByLabelText("分组名称"), "草稿名称");

    rerender(
      <RemoteHostGroupCreateDialog
        externalConfigConflict={conflictMessage}
        group={{
          ...group,
          title: "外部名称",
          updatedAt: "2",
        }}
        onClose={vi.fn()}
        onCreateGroup={vi.fn()}
        onUpdateGroup={onUpdateGroup}
        open
      />,
    );

    expect(screen.getByLabelText("分组名称")).toHaveValue("草稿名称");
    expect(screen.getByRole("alert")).toHaveTextContent(conflictMessage);
    expect(screen.getByRole("button", { name: "保存分组" })).toBeDisabled();
    expect(onUpdateGroup).not.toHaveBeenCalled();
  });
});
