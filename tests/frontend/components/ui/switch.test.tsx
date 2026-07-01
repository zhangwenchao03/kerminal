import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Switch } from "../../../../src/components/ui/switch";

describe("Switch", () => {
  it("reports checked changes from the Apple-style control", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();

    render(
      <Switch
        aria-label="启用背景"
        checked={false}
        onCheckedChange={onCheckedChange}
      />,
    );

    await user.click(screen.getByRole("switch", { name: "启用背景" }));

    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});
