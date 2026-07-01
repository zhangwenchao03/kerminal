import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LocalRenameDialog } from "../../../../src/features/sftp/LocalRenameDialog";

const entry = {
  kind: "file" as const,
  name: "notes.md",
  path: "C:\\Users\\24052\\notes.md",
  raw: "file C:\\Users\\24052\\notes.md",
  size: 2048,
};

describe("LocalRenameDialog", () => {
  it("renders the selected local entry name", () => {
    render(
      <LocalRenameDialog
        busy={false}
        entry={entry}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "重命名本机项目" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("新名称")).toHaveValue("notes.md");
  });

  it("closes without confirming when cancelled", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onConfirm = vi.fn();

    render(
      <LocalRenameDialog
        busy={false}
        entry={entry}
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByRole("button", { name: "取消" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("keeps confirmation disabled for blank or unchanged names", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <LocalRenameDialog
        busy={false}
        entry={entry}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    const nameInput = screen.getByLabelText("新名称");
    const confirmButton = screen.getByRole("button", { name: "确认重命名" });

    expect(confirmButton).toBeDisabled();
    await user.clear(nameInput);
    expect(confirmButton).toBeDisabled();
    await user.click(confirmButton);

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("confirms with the trimmed new name", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <LocalRenameDialog
        busy={false}
        entry={entry}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    const nameInput = screen.getByLabelText("新名称");
    await user.clear(nameInput);
    await user.type(nameInput, "  renamed.md  ");
    await user.click(screen.getByRole("button", { name: "确认重命名" }));

    expect(onConfirm).toHaveBeenCalledWith("renamed.md");
  });
});
