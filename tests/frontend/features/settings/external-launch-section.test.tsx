import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExternalLaunchSettingsSection } from "../../../../src/features/settings/settings-tool-content/external-launch-section";

const api = vi.hoisted(() => ({
  getStatus: vi.fn(),
  register: vi.fn(),
  unregister: vi.fn(),
}));

vi.mock("../../../../src/lib/externalLaunchApi", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../../src/lib/externalLaunchApi")
  >()),
  getExternalLaunchDeepLinkStatus: () => api.getStatus(),
  registerExternalLaunchDeepLink: () => api.register(),
  unregisterExternalLaunchDeepLink: () => api.unregister(),
}));

const settings = {
  acceptVendorArgs: true,
  autoOpenSftp: false,
  disabledTools: [],
  enabled: true,
};

describe("ExternalLaunchSettingsSection deep link", () => {
  beforeEach(() => {
    api.getStatus.mockReset();
    api.register.mockReset();
    api.unregister.mockReset();
    api.getStatus.mockResolvedValue({
      registered: false,
      scheme: "kerminal",
      supported: true,
    });
    api.register.mockResolvedValue({
      registered: true,
      scheme: "kerminal",
      supported: true,
    });
  });

  it("registers the opt-in Windows protocol and refreshes visible state", async () => {
    const user = userEvent.setup();
    render(
      <ExternalLaunchSettingsSection
        externalLaunch={settings}
        updateExternalLaunch={vi.fn()}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "注册协议" }));

    await waitFor(() => expect(api.register).toHaveBeenCalledTimes(1));
    expect(screen.getByText("已为当前 Windows 用户注册")).toBeVisible();
    expect(screen.getByRole("button", { name: "注销协议" })).toBeEnabled();
  });

  it("shows a redacted user-facing failure when registration fails", async () => {
    const user = userEvent.setup();
    api.register.mockRejectedValue(new Error("registry path C:\\secret"));
    render(
      <ExternalLaunchSettingsSection
        externalLaunch={settings}
        updateExternalLaunch={vi.fn()}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "注册协议" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "系统协议注册失败。",
    );
    expect(screen.queryByText(/secret/)).not.toBeInTheDocument();
  });
});
