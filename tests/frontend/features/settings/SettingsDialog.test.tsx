import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { defaultAppSettings } from "../../../../src/features/settings/settingsModel";
import { SettingsDialog } from "../../../../src/features/settings/SettingsDialog";

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
    expect(
      screen.getByRole("button", { name: /界面外观/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("基础外观")).toBeInTheDocument();
    expect(screen.getByLabelText("搜索设置")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /终端/ }));
    expect(screen.getByText("终端渲染")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /块状光标/ }),
    ).toBeInTheDocument();

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

  it("keeps the editor draft when external settings arrive while dirty", () => {
    const onSettingsChange = vi.fn();
    const externalSettings = {
      ...defaultAppSettings,
      appearance: {
        ...defaultAppSettings.appearance,
        windowOpacity: 45,
      },
    };
    const { rerender } = render(
      <SettingsDialog
        onClose={vi.fn()}
        onSettingsChange={onSettingsChange}
        open
        settings={defaultAppSettings}
      />,
    );

    fireEvent.change(screen.getByLabelText("界面透明度"), {
      target: { value: "80" },
    });
    rerender(
      <SettingsDialog
        onClose={vi.fn()}
        onSettingsChange={onSettingsChange}
        open
        settings={externalSettings}
      />,
    );

    expect(screen.getByLabelText("界面透明度")).toHaveValue("80");
    expect(
      screen.getByText("cfg: settings changed externally; editor draft kept"),
    ).toBeInTheDocument();
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        appearance: expect.objectContaining({ windowOpacity: 80 }),
      }),
    );
  });

  it("accepts external settings after the current draft is saved", async () => {
    const onSettingsChange = vi.fn();
    const savedDraftSettings = {
      ...defaultAppSettings,
      appearance: {
        ...defaultAppSettings.appearance,
        windowOpacity: 80,
      },
    };
    const externalSettings = {
      ...defaultAppSettings,
      appearance: {
        ...defaultAppSettings.appearance,
        windowOpacity: 45,
      },
    };
    const { rerender } = render(
      <SettingsDialog
        onClose={vi.fn()}
        onSettingsChange={onSettingsChange}
        open
        settings={defaultAppSettings}
      />,
    );

    fireEvent.change(screen.getByLabelText("界面透明度"), {
      target: { value: "80" },
    });
    rerender(
      <SettingsDialog
        onClose={vi.fn()}
        onSettingsChange={onSettingsChange}
        open
        saveState="saved"
        settings={savedDraftSettings}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("界面透明度")).toHaveValue("80");
    });

    rerender(
      <SettingsDialog
        onClose={vi.fn()}
        onSettingsChange={onSettingsChange}
        open
        saveState="saved"
        settings={externalSettings}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("界面透明度")).toHaveValue("45");
    });
    expect(
      screen.queryByText("cfg: settings changed externally; editor draft kept"),
    ).not.toBeInTheDocument();
  });
});
