import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { AiToolAuditRecord } from "../../lib/aiToolInvocationApi";
import { AiAuditManagement } from "./AiAuditManagement";

describe("AiAuditManagement", () => {
  it("renders audit context and searches by conversation, host and attachments", async () => {
    const user = userEvent.setup();
    renderAuditManagement([
      auditRecord({
        auditContext: {
          assistantMessageId: "msg-assistant-prod",
          attachmentIds: ["att-ssh-screenshot", "att-host-config"],
          contextSnapshotId: "ctx-prod-snapshot",
          conversationId: "conversation-prod",
          hostId: "host-prod",
          paneId: "pane-prod",
          routeMode: "followWorkspaceTarget",
          scopeKind: "lockedPane",
          tabId: "tab-prod",
          targetKey: "pane:pane-prod",
          userMessageId: "msg-user-prod",
        },
        id: "audit-prod",
        toolId: "remote_host.create",
        toolTitle: "创建远程主机",
      }),
      auditRecord({
        auditContext: null,
        id: "audit-local",
        toolId: "settings.update_theme",
        toolTitle: "更新主题",
      }),
    ]);

    expect(screen.getByText("会话: conversation-prod")).toBeInTheDocument();
    expect(screen.getByText("主机: host-prod")).toBeInTheDocument();
    expect(screen.getByText("Tab: tab-prod")).toBeInTheDocument();
    expect(screen.getByText("Pane: pane-prod")).toBeInTheDocument();
    expect(screen.getByText("快照: ctx-prod-snapshot")).toBeInTheDocument();
    expect(screen.getByText("用户消息: msg-user-prod")).toBeInTheDocument();
    expect(screen.getByText("AI消息: msg-assistant-prod")).toBeInTheDocument();
    expect(screen.getByText("附件: 2 个")).toHaveAttribute(
      "title",
      "att-ssh-screenshot, att-host-config",
    );
    expect(screen.getByText("无会话上下文")).toBeInTheDocument();

    const searchbox = screen.getByRole("searchbox", { name: "搜索工具审计" });
    await user.type(searchbox, "host-prod");
    expect(screen.getByText("创建远程主机")).toBeInTheDocument();
    expect(screen.queryByText("更新主题")).not.toBeInTheDocument();

    await user.clear(searchbox);
    await user.type(searchbox, "att-ssh-screenshot");
    expect(screen.getByText("创建远程主机")).toBeInTheDocument();
    expect(screen.queryByText("更新主题")).not.toBeInTheDocument();

    await user.clear(searchbox);
    await user.type(searchbox, "conversation-prod");
    expect(screen.getByText("创建远程主机")).toBeInTheDocument();
    expect(screen.queryByText("更新主题")).not.toBeInTheDocument();
  });

  it("opens audit context chips through an explicit callback", async () => {
    const user = userEvent.setup();
    const onOpenContext = vi.fn();
    const prodAudit = auditRecord({
      auditContext: {
        assistantMessageId: "msg-assistant-prod",
        attachmentIds: ["att-ssh-screenshot", "att-host-config"],
        contextSnapshotId: "ctx-prod-snapshot",
        conversationId: "conversation-prod",
        hostId: "host-prod",
        paneId: "pane-prod",
        routeMode: "followWorkspaceTarget",
        scopeKind: "lockedPane",
        tabId: "tab-prod",
        targetKey: "pane:pane-prod",
        userMessageId: "msg-user-prod",
      },
      id: "audit-prod",
    });

    renderAuditManagement([prodAudit], { onOpenContext });

    await user.click(
      screen.getByRole("button", {
        name: "打开审计上下文 会话 conversation-prod",
      }),
    );
    expect(onOpenContext).toHaveBeenLastCalledWith({
      audit: prodAudit,
      context: prodAudit.auditContext,
      target: "conversation",
    });

    await user.click(
      screen.getByRole("button", {
        name: "打开审计上下文 快照 ctx-prod-snapshot",
      }),
    );
    expect(onOpenContext).toHaveBeenLastCalledWith({
      audit: prodAudit,
      context: prodAudit.auditContext,
      target: "contextSnapshot",
    });

    await user.click(
      screen.getByRole("button", {
        name: "打开审计上下文 附件 att-ssh-screenshot, att-host-config",
      }),
    );
    expect(onOpenContext).toHaveBeenLastCalledWith({
      attachmentIds: ["att-ssh-screenshot", "att-host-config"],
      audit: prodAudit,
      context: prodAudit.auditContext,
      target: "attachments",
    });
  });
});

function renderAuditManagement(
  audits: AiToolAuditRecord[],
  props: Partial<ComponentProps<typeof AiAuditManagement>> = {},
) {
  return render(
    <AiAuditManagement
      actionState="idle"
      audits={audits}
      clearRequested={false}
      message={null}
      onCancelClear={vi.fn()}
      onConfirmClear={vi.fn()}
      onExport={vi.fn()}
      onRefresh={vi.fn()}
      onRequestClear={vi.fn()}
      {...props}
    />,
  );
}

function auditRecord(
  overrides: Partial<AiToolAuditRecord> & Pick<AiToolAuditRecord, "id">,
): AiToolAuditRecord {
  const { id, ...rest } = overrides;
  return {
    argumentsSummary: "host=prod.example.com, username=deploy",
    auditContext: null,
    completedAt: "1761111111",
    confirmation: "always",
    createdAt: "1761111100",
    error: null,
    id,
    invocationId: `invocation-${id}`,
    resultSummary: "工具调用已执行。",
    risk: "remote",
    riskSummary: null,
    status: "succeeded",
    toolId: "remote_host.create",
    toolTitle: "创建远程主机",
    ...rest,
  };
}
