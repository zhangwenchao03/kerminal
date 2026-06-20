import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { defaultAppSettings } from "./settingsModel";
import { SettingsDialog } from "./SettingsDialog";

describe("SettingsDialog", () => {
  it("renders settings in a modal dialog and closes from the close button", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <SettingsDialog
        onClose={onClose}
        onSettingsChange={vi.fn()}
        open
        settings={defaultAppSettings}
      />,
    );

    expect(screen.getByRole("dialog", { name: "设置" })).toHaveClass(
      "h-[min(780px,calc(100vh-48px))]",
    );
    expect(screen.getByText("外观")).toBeInTheDocument();
    expect(screen.getByText("终端外观")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /块状光标/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^终端$/ }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "关闭弹窗" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not render when closed", () => {
    render(
      <SettingsDialog
        onClose={vi.fn()}
        onSettingsChange={vi.fn()}
        open={false}
        settings={defaultAppSettings}
      />,
    );

    expect(screen.queryByRole("dialog", { name: "设置" })).not.toBeInTheDocument();
  });
});
