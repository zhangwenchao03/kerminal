import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Select, SelectField } from "../../../../src/components/ui/select";

const options = [
  { label: "全部", value: "" },
  { label: "本地", value: "local" },
  { label: "SSH", value: "ssh" },
];

describe("Select", () => {
  it("selects an option from the floating listbox", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();

    render(
      <Select
        aria-label="连接范围"
        onValueChange={onValueChange}
        options={options}
        value=""
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "连接范围" }));
    await user.click(screen.getByRole("option", { name: "SSH" }));

    expect(onValueChange).toHaveBeenCalledWith("ssh");
  });

  it("supports keyboard selection", async () => {
    const user = userEvent.setup();

    function ControlledSelect() {
      const [value, setValue] = useState("");
      return (
        <Select
          aria-label="连接范围"
          onValueChange={setValue}
          options={options}
          value={value}
        />
      );
    }

    render(<ControlledSelect />);

    const combobox = screen.getByRole("combobox", { name: "连接范围" });
    combobox.focus();
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{Enter}");

    expect(combobox).toHaveAttribute("data-value", "ssh");
  });

  it("can open the floating listbox above the trigger", async () => {
    const user = userEvent.setup();

    render(
      <Select
        aria-label="底部模型"
        onValueChange={vi.fn()}
        options={options}
        side="top"
        value="local"
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "底部模型" }));

    expect(screen.getByRole("listbox")).toHaveAttribute("data-side", "top");
  });

  it("renders a labeled reusable select field", () => {
    render(
      <SelectField
        description="选择监听地址范围"
        id="bind-mode"
        label="监听范围"
        onValueChange={vi.fn()}
        options={options}
        value="local"
      />,
    );

    expect(screen.getByText("监听范围")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "监听范围" })).toHaveAttribute(
      "id",
      "bind-mode",
    );
    expect(screen.getByText("选择监听地址范围")).toBeInTheDocument();
  });
});
