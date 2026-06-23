import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Machine, TerminalPane, TerminalTab } from "../../workspace/types";
import {
  buildAiChatAttachmentContexts,
  buildCurrentAiApplicationContext,
  buildCurrentAiTerminalContext,
  buildCurrentAiTerminalSnapshotRequest,
  buildAiToolAuditContext,
} from "./aiToolContentRuntime";

const sessionRegistryMock = vi.hoisted(() => ({
  getTerminalPaneSession: vi.fn(),
}));

vi.mock("../../terminal/terminalSessionRegistry", () => sessionRegistryMock);

const activeTab: TerminalTab = {
  id: "tab-prod",
  layout: { paneId: "pane-prod", type: "pane" },
  machineId: "ssh-prod",
  title: "生产终端",
};

const focusedPane: TerminalPane = {
  id: "pane-prod",
  latencyMs: 12,
  lines: [],
  machineId: "ssh-prod",
  mode: "ssh",
  prompt: "$",
  status: "online",
  title: "prod-api",
};

const sshMachine: Machine = {
  description: "生产 SSH",
  id: "ssh-prod",
  kind: "ssh",
  latencyMs: 12,
  name: "prod-api",
  production: true,
  status: "online",
  tags: ["prod"],
};

describe("aiToolContentRuntime", () => {
  beforeEach(() => {
    sessionRegistryMock.getTerminalPaneSession.mockReset();
  });

  it("resolves a focused pane with a ready session for terminal and app context", () => {
    sessionRegistryMock.getTerminalPaneSession.mockReturnValue("session-prod");

    expect(
      buildCurrentAiTerminalContext({
        activeTab,
        focusedPane,
        selectedMachine: sshMachine,
      }),
    ).toMatchObject({
      machineId: "ssh-prod",
      machineKind: "ssh",
      machineName: "prod-api",
      paneId: "pane-prod",
      sessionId: "session-prod",
      tabId: "tab-prod",
    });
    expect(
      buildCurrentAiTerminalSnapshotRequest({
        activeTab,
        focusedPane,
        selectedMachine: sshMachine,
      }),
    ).toMatchObject({
      machineId: "ssh-prod",
      paneId: "pane-prod",
      sessionId: "session-prod",
      tabId: "tab-prod",
    });

    expect(
      buildCurrentAiApplicationContext({
        activeTab,
        focusedPane,
        selectedMachine: sshMachine,
      }),
    ).toEqual({
      activeToolId: "ai",
      activeTab: {
        id: "tab-prod",
        machineId: "ssh-prod",
        title: "生产终端",
      },
      focusedPane: {
        id: "pane-prod",
        machineId: "ssh-prod",
        mode: "ssh",
        sessionId: "session-prod",
        status: "online",
        title: "prod-api",
      },
      selectedMachine: {
        id: "ssh-prod",
        kind: "ssh",
        name: "prod-api",
        production: true,
        status: "online",
      },
    });
  });

  it("keeps focused pane readiness metadata when no session is registered", () => {
    sessionRegistryMock.getTerminalPaneSession.mockReturnValue(undefined);

    expect(
      buildCurrentAiTerminalContext({
        activeTab,
        focusedPane,
        selectedMachine: sshMachine,
      }),
    ).toBeUndefined();
    expect(
      buildCurrentAiTerminalSnapshotRequest({
        activeTab,
        focusedPane,
        selectedMachine: sshMachine,
      }),
    ).toMatchObject({
      machineId: "ssh-prod",
      paneId: "pane-prod",
      sessionId: undefined,
      tabId: "tab-prod",
    });
    expect(
      buildCurrentAiApplicationContext({
        activeTab,
        focusedPane,
        selectedMachine: sshMachine,
      }),
    ).toMatchObject({
      activeTab: {
        id: "tab-prod",
      },
      focusedPane: {
        id: "pane-prod",
        sessionId: undefined,
        status: "online",
      },
      selectedMachine: {
        id: "ssh-prod",
      },
    });
  });

  it("resolves tab-only context without probing a terminal session", () => {
    expect(buildCurrentAiTerminalContext({ activeTab })).toBeUndefined();
    expect(buildCurrentAiTerminalSnapshotRequest({ activeTab })).toMatchObject({
      sessionId: undefined,
      tabId: "tab-prod",
      tabTitle: "生产终端",
    });
    expect(buildCurrentAiApplicationContext({ activeTab })).toEqual({
      activeToolId: "ai",
      activeTab: {
        id: "tab-prod",
        machineId: "ssh-prod",
        title: "生产终端",
      },
      focusedPane: undefined,
      selectedMachine: undefined,
    });
    expect(sessionRegistryMock.getTerminalPaneSession).not.toHaveBeenCalled();
  });

  it("resolves host-only context without terminal context", () => {
    expect(
      buildCurrentAiTerminalContext({ selectedMachine: sshMachine }),
    ).toBeUndefined();
    expect(
      buildCurrentAiTerminalSnapshotRequest({ selectedMachine: sshMachine }),
    ).toMatchObject({
      machineId: "ssh-prod",
      machineKind: "ssh",
      machineName: "prod-api",
      sessionId: undefined,
    });
    expect(
      buildCurrentAiApplicationContext({ selectedMachine: sshMachine }),
    ).toMatchObject({
      activeToolId: "ai",
      selectedMachine: {
        id: "ssh-prod",
        production: true,
      },
    });
  });

  it("resolves no-context requests without terminal metadata", () => {
    expect(buildCurrentAiTerminalContext({})).toBeUndefined();
    expect(buildCurrentAiTerminalSnapshotRequest({})).toMatchObject({
      machineId: undefined,
      paneId: undefined,
      sessionId: undefined,
      tabId: undefined,
    });
    expect(buildCurrentAiApplicationContext({})).toEqual({
      activeToolId: "ai",
      activeTab: undefined,
      focusedPane: undefined,
      selectedMachine: undefined,
    });
  });

  it("keeps explicit image vision input and falls back to metadata context", () => {
    expect(
      buildAiChatAttachmentContexts([
        {
          height: 720,
          id: "att-image",
          kind: "image",
          mimeType: "image/png",
          ocrText: "ssh deploy@10.0.0.12 -p 2222",
          originalName: "screen.png",
          redactionSummary: "已隐藏截图里的 token",
          sizeBytes: 1024,
          status: "available",
          visionUsage: "notSent",
          width: 1280,
        },
        {
          id: "att-vision",
          kind: "image",
          mimeType: "image/png",
          originalName: "diagram.png",
          sizeBytes: 3072,
          status: "available",
          storageMode: "managedCopy",
          visionUsage: "visionInput",
        },
        {
          id: "att-ocr",
          kind: "image",
          mimeType: "image/jpeg",
          originalName: "ocr.jpg",
          sizeBytes: 4096,
          status: "available",
          storageMode: "managedCopy",
          visionUsage: "ocrOnly",
        },
        {
          id: "att-bmp",
          kind: "image",
          mimeType: "image/bmp",
          originalName: "legacy.bmp",
          sizeBytes: 2048,
          status: "available",
          storageMode: "managedCopy",
          visionUsage: "visionInput",
        },
        {
          id: "att-linked",
          kind: "image",
          mimeType: "image/png",
          originalName: "linked.png",
          sizeBytes: 2048,
          status: "available",
          storageMode: "linkedFile",
          visionUsage: "visionInput",
        },
        {
          id: "att-redacted",
          kind: "image",
          mimeType: "image/png",
          originalName: "secret.png",
          sizeBytes: 2048,
          status: "redacted",
          visionUsage: "visionInput",
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        id: "att-image",
        ocrText: "ssh deploy@10.0.0.12 -p 2222",
        redactionSummary: "已隐藏截图里的 token",
        status: "available",
        visionUsage: "metadataOnly",
      }),
      expect.objectContaining({
        id: "att-vision",
        status: "available",
        visionUsage: "visionInput",
      }),
      expect.objectContaining({
        id: "att-ocr",
        status: "available",
        visionUsage: "visionInput",
      }),
      expect.objectContaining({
        id: "att-bmp",
        status: "available",
        visionUsage: "metadataOnly",
      }),
      expect.objectContaining({
        id: "att-linked",
        status: "available",
        visionUsage: "metadataOnly",
      }),
      expect.objectContaining({
        id: "att-redacted",
        status: "redacted",
        visionUsage: "notSent",
      }),
    ]);
  });

  it("links tool audit context to the active conversation message and attachments", () => {
    const auditContext = buildAiToolAuditContext({
      conversation: {
        createdAt: 1,
        hostId: "ssh-prod",
        id: "conversation-prod",
        messages: [
          {
            attachments: [
              {
                id: "att-ssh",
                kind: "image",
                mimeType: "image/png",
                originalName: "ssh.png",
                sizeBytes: 1024,
                status: "available",
              },
            ],
            content: "这张图里有 SSH 地址，帮我配置主机",
            contextSnapshotId: "ctx-prod",
            createdAt: 1,
            id: "msg-user",
            role: "user",
            status: "complete",
          },
          {
            content: "我会通过受控工具创建主机。",
            createdAt: 2,
            id: "msg-assistant",
            pendingInvocations: [
              {
                argumentsSummary: "name=prod-api",
                audit: "summary",
                confirmation: "always",
                createdAt: "2",
                id: "tool-call-1",
                requiresConfirmation: true,
                risk: "remote",
                status: "pending",
                toolId: "remote_host.create",
                toolTitle: "创建远程主机",
              },
            ],
            role: "assistant",
            status: "complete",
          },
        ],
        paneId: "pane-prod",
        scopeKind: "lockedPane",
        scopeRefJson: "{\"paneId\":\"pane-prod\"}",
        tabId: "tab-prod",
        targetKey: "pane:pane-prod",
        title: "prod-api",
        updatedAt: 2,
      },
      conversationSlot: {
        createRequest: {
          hostId: "ssh-prod",
          paneId: "pane-prod",
          scopeKind: "lockedPane",
          scopeRefJson: "{\"paneId\":\"pane-prod\"}",
          tabId: "tab-prod",
          targetKey: "pane:pane-prod",
        },
        routeMode: "followWorkspaceTarget",
        slotKey: "pane:pane-prod",
        targetRefJson: "{\"kind\":\"pane\"}",
      },
      invocationId: "tool-call-1",
    });

    expect(auditContext).toEqual({
      assistantMessageId: "msg-assistant",
      attachmentIds: ["att-ssh"],
      contextSnapshotId: "ctx-prod",
      conversationId: "conversation-prod",
      hostId: "ssh-prod",
      paneId: "pane-prod",
      routeMode: "followWorkspaceTarget",
      scopeKind: "lockedPane",
      scopeRefJson: "{\"paneId\":\"pane-prod\"}",
      tabId: "tab-prod",
      targetKey: "pane:pane-prod",
      targetRefJson: "{\"kind\":\"pane\"}",
      userMessageId: "msg-user",
    });
  });
});
