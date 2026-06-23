import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DiagnosticsBundleCard } from "./DiagnosticsBundleCard";

const diagnosticsApiMocks = vi.hoisted(() => ({
  createDiagnosticsBundle: vi.fn(),
}));

vi.mock("../../lib/diagnosticsApi", () => ({
  createDiagnosticsBundle: (...args: unknown[]) =>
    diagnosticsApiMocks.createDiagnosticsBundle(...args),
}));

describe("DiagnosticsBundleCard", () => {
  beforeEach(() => {
    diagnosticsApiMocks.createDiagnosticsBundle.mockReset();
  });

  it("keeps the shield icon stable and shows the generated file path", async () => {
    const user = userEvent.setup();
    diagnosticsApiMocks.createDiagnosticsBundle.mockResolvedValue({
      bytesWritten: 2048,
      createdAt: "1710000000",
      fileName: "diagnostics-1710000000.json",
      id: "diagnostics-1",
      path: "C:/Users/me/.kerminal/diagnostics/diagnostics-1710000000.json",
      redacted: true,
      sections: ["app", "paths"],
    });

    render(<DiagnosticsBundleCard />);

    const createButton = screen.getByRole("button", { name: "生成诊断包" });
    expect(createButton.querySelector(".lucide-shield-check")).toBeInTheDocument();
    await user.hover(createButton);
    expect(
      await screen.findByRole("tooltip", { name: "生成诊断包" }),
    ).toBeInTheDocument();
    await user.unhover(createButton);

    await user.click(createButton);

    expect(
      await screen.findByRole("status", { name: "诊断包生成结果" }),
    ).toBeInTheDocument();
    expect(screen.getByText("诊断包已生成：diagnostics-1710000000.json")).toBeInTheDocument();
    expect(
      screen.getByText(
        "C:/Users/me/.kerminal/diagnostics/diagnostics-1710000000.json",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("大小 2.0 KB · 分区 2 个")).toBeInTheDocument();

    const retryButton = screen.getByRole("button", { name: "重新生成诊断包" });
    expect(retryButton).toBeEnabled();
    expect(retryButton.querySelector(".lucide-shield-check")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "关闭诊断包提示" }));

    expect(
      screen.queryByRole("status", { name: "诊断包生成结果" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "C:/Users/me/.kerminal/diagnostics/diagnostics-1710000000.json",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "重新生成诊断包" }),
    ).toBeEnabled();
  });
});
