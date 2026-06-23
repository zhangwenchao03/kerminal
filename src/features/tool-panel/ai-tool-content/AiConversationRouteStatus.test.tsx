import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Machine, TerminalPane, TerminalTab } from "../../workspace/types";
import { buildAiConversationSlotDescriptor } from "./aiConversationPersistence";
import { AiConversationRouteStatus } from "./AiConversationRouteStatus";

const activeTab: TerminalTab = {
  id: "tab-prod",
  layout: { paneId: "pane-prod", type: "pane" },
  machineId: "host-prod",
  title: "prod-api tab",
};

const focusedPane: TerminalPane = {
  id: "pane-prod",
  latencyMs: 2,
  lines: [],
  machineId: "host-prod",
  mode: "ssh",
  prompt: "$",
  status: "online",
  title: "prod-api shell",
};

const selectedMachine: Machine = {
  description: "生产 SSH 主机",
  id: "host-prod",
  kind: "ssh",
  name: "prod-api",
  production: true,
  status: "online",
  tags: ["prod"],
};

describe("AiConversationRouteStatus", () => {
  it("shows the pane, host, slot, and active conversation for a pane route", () => {
    const slot = buildAiConversationSlotDescriptor({
      activeTab,
      focusedPane,
      selectedMachine,
    });

    render(
      <AiConversationRouteStatus
        activeConversation={{
          createdAt: 1,
          id: "conv-prod",
          messages: [],
          title: "生产排障",
          updatedAt: 2,
        }}
        slot={slot}
      />,
    );

    const status = screen.getByRole("status", { name: "AI 会话绑定目标" });
    expect(status).toHaveTextContent("AI 当前绑定");
    expect(status).toHaveTextContent("窗格会话");
    expect(status).toHaveTextContent("prod-api shell");
    expect(status).toHaveTextContent("主机 prod-api");
    expect(status).toHaveTextContent("标签 prod-api tab");
    expect(status).toHaveTextContent("槽位 pane:pane-prod");
    expect(status).toHaveTextContent("当前对话 生产排障");
  });

  it("shows an explicit no-context route instead of implying a host binding", () => {
    const slot = buildAiConversationSlotDescriptor({});

    render(<AiConversationRouteStatus slot={slot} terminalSessionReady={false} />);

    const status = screen.getByRole("status", { name: "AI 会话绑定目标" });
    expect(status).toHaveTextContent("普通会话");
    expect(status).toHaveTextContent("未绑定终端上下文");
    expect(status).toHaveTextContent("普通 AI 会话，不读取主机或终端");
    expect(status).toHaveTextContent("槽位 no-context");
    expect(status).not.toHaveTextContent("终端会话未就绪");
  });

  it("warns when a pane route has no readable terminal session", () => {
    const slot = buildAiConversationSlotDescriptor({
      activeTab,
      focusedPane,
      selectedMachine,
    });

    render(<AiConversationRouteStatus slot={slot} terminalSessionReady={false} />);

    const status = screen.getByRole("status", { name: "AI 会话绑定目标" });
    expect(status).toHaveTextContent("窗格会话");
    expect(status).toHaveTextContent("prod-api shell");
    expect(status).toHaveTextContent(
      "终端会话未就绪，暂时不可读取终端上下文。",
    );
  });
});
