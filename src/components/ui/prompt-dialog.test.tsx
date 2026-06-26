import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { PromptDialog } from "./prompt-dialog";

describe("PromptDialog", () => {
  it("submits the controlled input value", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(<PromptDialogHarness onConfirm={onConfirm} />);

    await user.type(screen.getByLabelText("名称"), "logs");
    await user.click(screen.getByRole("button", { name: "创建" }));

    expect(onConfirm).toHaveBeenCalledWith("logs");
  });

  it("disables confirmation when validation fails", () => {
    render(<PromptDialogHarness />);

    expect(screen.getByRole("button", { name: "创建" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("请填写名称。");
  });
});

function PromptDialogHarness({
  onConfirm = vi.fn(),
}: {
  onConfirm?: (value: string) => void;
}) {
  const [value, setValue] = useState("");

  return (
    <PromptDialog
      confirmLabel="创建"
      inputLabel="名称"
      onClose={vi.fn()}
      onConfirm={onConfirm}
      onValueChange={setValue}
      open
      title="新建"
      validate={(nextValue) => (nextValue.trim() ? null : "请填写名称。")}
      value={value}
    />
  );
}
