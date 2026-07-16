import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  DeleteConfirmationDialog,
  resolveShellLayout,
} from "../../../src/app/KerminalShell.helpers.tsx";

describe("resolveShellLayout", () => {
  it("fully removes the left sidebar column when collapsed", () => {
    const layout = resolveShellLayout({
      activeToolOpen: false,
      leftFilePanelOpen: false,
      leftFilePanelWidth: 340,
      leftPanelCollapsed: true,
      leftPanelWidth: 280,
      toolPanelWidth: 320,
      viewportWidth: 1280,
    });

    expect(layout.effectiveLeftPanelCollapsed).toBe(true);
    expect(layout.effectiveLeftFilePanelOpen).toBe(false);
    expect(layout.leftPanelColumnWidth).toBe(0);
    expect(layout.leftFilePanelColumnWidth).toBe(0);
    expect(layout.gridTemplateColumns).toBe(
      "0px 0px 0px 0px minmax(0, 1fr) 0px 44px",
    );
  });

  it("keeps the left sidebar column on wide expanded layouts", () => {
    const layout = resolveShellLayout({
      activeToolOpen: true,
      leftFilePanelOpen: false,
      leftFilePanelWidth: 340,
      leftPanelCollapsed: false,
      leftPanelWidth: 280,
      toolPanelWidth: 320,
      viewportWidth: 1280,
    });

    expect(layout.effectiveLeftPanelCollapsed).toBe(false);
    expect(layout.effectiveLeftFilePanelOpen).toBe(false);
    expect(layout.leftPanelColumnWidth).toBe(280);
    expect(layout.leftFilePanelColumnWidth).toBe(0);
    expect(layout.gridTemplateColumns).toBe(
      "280px 0px 0px 0px minmax(0, 1fr) 0px 320px",
    );
  });

  it("opens the left file panel between the sidebar and workspace", () => {
    const layout = resolveShellLayout({
      activeToolOpen: false,
      leftFilePanelOpen: true,
      leftFilePanelWidth: 340,
      leftPanelCollapsed: false,
      leftPanelWidth: 280,
      toolPanelWidth: 320,
      viewportWidth: 1280,
    });

    expect(layout.effectiveLeftPanelCollapsed).toBe(false);
    expect(layout.effectiveLeftFilePanelOpen).toBe(true);
    expect(layout.leftPanelColumnWidth).toBe(280);
    expect(layout.leftFilePanelColumnWidth).toBe(340);
    expect(layout.gridTemplateColumns).toBe(
      "280px 0px 340px 0px minmax(0, 1fr) 0px 44px",
    );
  });

  it("keeps the file panel open when the host sidebar is collapsed", () => {
    const layout = resolveShellLayout({
      activeToolOpen: false,
      leftFilePanelOpen: true,
      leftFilePanelWidth: 340,
      leftPanelCollapsed: true,
      leftPanelWidth: 280,
      toolPanelWidth: 320,
      viewportWidth: 1280,
    });

    expect(layout.effectiveLeftPanelCollapsed).toBe(true);
    expect(layout.effectiveLeftFilePanelOpen).toBe(true);
    expect(layout.leftPanelColumnWidth).toBe(0);
    expect(layout.leftFilePanelColumnWidth).toBe(340);
    expect(layout.gridTemplateColumns).toBe(
      "0px 0px 340px 0px minmax(0, 1fr) 0px 44px",
    );
  });

  it("keeps delete errors concise while preserving hidden diagnostics", () => {
    render(
      <DeleteConfirmationDialog
        deleteError={{
          detail: "本地保存的配置没有被删除。",
          recoveryAction: "请检查配置目录权限后重试。",
          severity: "error",
          technicalDetail: 'permission denied password="[已隐藏]"',
          title: "连接未删除",
        }}
        deleting={false}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        pendingDelete={{
          id: "host-1",
          title: "生产主机",
          type: "machine",
        }}
      />,
    );

    expect(screen.getByText("连接未删除")).toBeVisible();
    expect(screen.getByText(/permission denied/)).not.toBeVisible();
  });
});
