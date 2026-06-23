import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiConversationSlotDescriptor } from "./aiConversationPersistence";
import type { AiConversation } from "./aiToolContentModel";
import {
  AI_HISTORY_PAGE_SIZE,
  useAiConversationHistoryList,
} from "./useAiConversationHistoryList";

const conversationApiMock = vi.hoisted(() => ({
  listAiConversations: vi.fn(),
}));

vi.mock("../../../lib/aiConversationApi", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/aiConversationApi")>(
    "../../../lib/aiConversationApi",
  );
  return {
    ...actual,
    listAiConversations: conversationApiMock.listAiConversations,
  };
});

const currentSlot: AiConversationSlotDescriptor = {
  createRequest: {
    hostId: "host-prod",
    paneId: "pane-prod",
    scopeKind: "lockedPane",
    scopeRefJson: JSON.stringify({
      kind: "pane",
      machineId: "host-prod",
      machineName: "prod-api",
      paneId: "pane-prod",
      paneTitle: "prod-api shell",
      tabId: "tab-prod",
    }),
    tabId: "tab-prod",
    targetKey: "pane:pane-prod",
    title: "prod-api shell",
  },
  routeMode: "followWorkspaceTarget",
  slotKey: "pane:pane-prod",
  targetRefJson: JSON.stringify({
    kind: "pane",
    machineId: "host-prod",
    machineName: "prod-api",
    paneId: "pane-prod",
    paneTitle: "prod-api shell",
    tabId: "tab-prod",
  }),
};

describe("useAiConversationHistoryList", () => {
  beforeEach(() => {
    conversationApiMock.listAiConversations.mockReset();
  });

  it("loads server-backed history with page-size plus one pagination", async () => {
    conversationApiMock.listAiConversations.mockResolvedValue(
      Array.from({ length: AI_HISTORY_PAGE_SIZE + 1 }, (_, index) =>
        summary(`conv-${index + 1}`, index),
      ),
    );

    const { result } = renderHook(() =>
      useAiConversationHistoryList({
        conversationPersistenceEnabled: true,
        conversations: [],
        currentSlot,
        open: true,
        query: " ssh ",
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(conversationApiMock.listAiConversations).toHaveBeenCalledWith({
      limit: AI_HISTORY_PAGE_SIZE + 1,
      offset: 0,
      query: " ssh ",
    });
    expect(result.current.rows).toHaveLength(AI_HISTORY_PAGE_SIZE);
    expect(result.current.rows[0]).toEqual(
      expect.objectContaining({
        model: "gpt-4.1",
        providerId: "openai-prod",
        providerLabel: "openai-prod",
        status: "waiting",
      }),
    );
    expect(result.current.canNextPage).toBe(true);

    act(() => result.current.setFilter("currentTarget"));
    await waitFor(() => {
      expect(conversationApiMock.listAiConversations).toHaveBeenLastCalledWith(
        expect.objectContaining({
          limit: AI_HISTORY_PAGE_SIZE + 1,
          offset: 0,
          query: " ssh ",
          targetKey: "pane:pane-prod",
        }),
      );
    });

    act(() => result.current.setPage(2));
    await waitFor(() => {
      expect(conversationApiMock.listAiConversations).toHaveBeenLastCalledWith(
        expect.objectContaining({
          offset: AI_HISTORY_PAGE_SIZE,
          targetKey: "pane:pane-prod",
        }),
      );
    });
  });

  it("uses the target ref host for server current-host filtering", async () => {
    conversationApiMock.listAiConversations.mockResolvedValue([]);
    const slotWithoutRequestHost: AiConversationSlotDescriptor = {
      ...currentSlot,
      createRequest: {
        ...currentSlot.createRequest,
        hostId: undefined,
      },
    };

    const { result } = renderHook(() =>
      useAiConversationHistoryList({
        conversationPersistenceEnabled: true,
        conversations: [],
        currentSlot: slotWithoutRequestHost,
        open: true,
        query: "",
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setFilter("currentHost"));

    await waitFor(() => {
      expect(conversationApiMock.listAiConversations).toHaveBeenLastCalledWith(
        expect.objectContaining({
          hostId: "host-prod",
          limit: AI_HISTORY_PAGE_SIZE + 1,
          offset: 0,
        }),
      );
    });
  });

  it("uses tab id for server current-target filtering when the slot has no pane", async () => {
    conversationApiMock.listAiConversations.mockResolvedValue([]);
    const tabSlot: AiConversationSlotDescriptor = {
      createRequest: {
        hostId: "host-prod",
        scopeKind: "lockedPane",
        scopeRefJson: JSON.stringify({
          kind: "tab",
          machineId: "host-prod",
          machineName: "prod-api",
          tabId: "tab-prod",
          tabTitle: "prod deploy",
        }),
        tabId: "tab-prod",
        title: "prod deploy",
      },
      routeMode: "followWorkspaceTarget",
      slotKey: "tab:tab-prod",
      targetRefJson: JSON.stringify({
        kind: "tab",
        machineId: "host-prod",
        machineName: "prod-api",
        tabId: "tab-prod",
        tabTitle: "prod deploy",
      }),
    };

    const { result } = renderHook(() =>
      useAiConversationHistoryList({
        conversationPersistenceEnabled: true,
        conversations: [],
        currentSlot: tabSlot,
        open: true,
        query: "",
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setFilter("currentTarget"));

    await waitFor(() => {
      expect(conversationApiMock.listAiConversations).toHaveBeenLastCalledWith(
        expect.objectContaining({
          limit: AI_HISTORY_PAGE_SIZE + 1,
          offset: 0,
          tabId: "tab-prod",
        }),
      );
    });
  });

  it("falls back to target ref tab id for server current-target filtering", async () => {
    conversationApiMock.listAiConversations.mockResolvedValue([]);
    const tabSlotWithoutRequestTab: AiConversationSlotDescriptor = {
      ...currentSlot,
      createRequest: {
        scopeKind: "lockedPane",
        scopeRefJson: JSON.stringify({ kind: "tab", tabId: "tab-from-ref" }),
        title: "tab from ref",
      },
      slotKey: "tab:tab-from-ref",
      targetRefJson: JSON.stringify({ kind: "tab", tabId: "tab-from-ref" }),
    };

    const { result } = renderHook(() =>
      useAiConversationHistoryList({
        conversationPersistenceEnabled: true,
        conversations: [],
        currentSlot: tabSlotWithoutRequestTab,
        open: true,
        query: "",
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setFilter("currentTarget"));

    await waitFor(() => {
      expect(conversationApiMock.listAiConversations).toHaveBeenLastCalledWith(
        expect.objectContaining({
          tabId: "tab-from-ref",
        }),
      );
    });
  });

  it("falls back to local rows when backend listing fails", async () => {
    conversationApiMock.listAiConversations.mockRejectedValue(
      new Error("storage unavailable"),
    );

    const { result } = renderHook(() =>
      useAiConversationHistoryList({
        conversationPersistenceEnabled: true,
        conversations: [
          localConversation({
            content: "请检查 rsync 部署脚本。",
            id: "conv-local",
            title: "发布策略",
          }),
        ],
        currentSlot,
        open: true,
        query: "rsync",
      }),
    );

    await waitFor(() => expect(result.current.error).toContain("storage unavailable"));
    expect(result.current.usingRemoteRows).toBe(false);
    expect(result.current.rows).toEqual([
      expect.objectContaining({
        id: "conv-local",
        title: "发布策略",
      }),
    ]);
  });

  it("derives status and provider model metadata from local cached messages", () => {
    const { result } = renderHook(() =>
      useAiConversationHistoryList({
        conversationPersistenceEnabled: false,
        conversations: [
          {
            ...localConversation({
              id: "conv-local-running",
              title: "本地模型会话",
            }),
            messages: [
              {
                content: "检查当前 SSH 截图",
                createdAt: 1_100,
                id: "conv-local-running-user",
                role: "user",
              },
              {
                content: "正在整理结果",
                createdAt: 1_200,
                id: "conv-local-running-assistant",
                model: "gpt-4.1",
                providerName: "OpenAI",
                role: "assistant",
                status: "streaming",
              },
            ],
          },
        ],
        currentSlot,
        open: true,
        query: "",
      }),
    );

    expect(result.current.rows).toEqual([
      expect.objectContaining({
        id: "conv-local-running",
        model: "gpt-4.1",
        providerLabel: "OpenAI",
        status: "running",
      }),
    ]);
  });

  it("filters local cache by the current host when browser preview is active", () => {
    const { result } = renderHook(() =>
      useAiConversationHistoryList({
        conversationPersistenceEnabled: false,
        conversations: [
          localConversation({
            hostId: "host-prod",
            id: "conv-prod",
            title: "生产排障",
          }),
          localConversation({
            hostId: "host-other",
            id: "conv-other",
            title: "其他主机",
          }),
        ],
        currentSlot,
        open: true,
        query: "",
      }),
    );

    act(() => result.current.setFilter("currentHost"));
    expect(result.current.rows).toEqual([
      expect.objectContaining({ id: "conv-prod" }),
    ]);
  });

  it("filters local cache by current target instead of mixing same-host tabs", () => {
    const { result } = renderHook(() =>
      useAiConversationHistoryList({
        conversationPersistenceEnabled: false,
        conversations: [
          localConversation({
            hostId: "host-prod",
            id: "conv-prod-pane",
            paneId: "pane-prod",
            tabId: "tab-prod",
            targetKey: "pane:pane-prod",
            title: "当前生产 Pane",
          }),
          localConversation({
            hostId: "host-prod",
            id: "conv-prod-other-pane",
            paneId: "pane-other",
            tabId: "tab-other",
            targetKey: "pane:pane-other",
            title: "同主机另一个 Pane",
          }),
          localConversation({
            hostId: "host-other",
            id: "conv-other",
            paneId: "pane-other-host",
            tabId: "tab-other-host",
            targetKey: "pane:pane-other-host",
            title: "其他主机",
          }),
        ],
        currentSlot,
        open: true,
        query: "",
      }),
    );

    act(() => result.current.setFilter("currentTarget"));
    expect(result.current.rows).toEqual([
      expect.objectContaining({ id: "conv-prod-pane" }),
    ]);
  });

  it("keeps attachment-only local conversations visible and searchable", () => {
    const { result } = renderHook(() =>
      useAiConversationHistoryList({
        conversationPersistenceEnabled: false,
        conversations: [
          localConversation({
            attachments: [
              {
                id: "attachment-ssh-screenshot",
                kind: "image",
                mimeType: "image/png",
                ocrText: "ssh deploy@prod.example.com -p 2222",
                originalName: "ssh-screenshot.png",
                sizeBytes: 2048,
                status: "available",
                storageMode: "managedCopy",
                visionUsage: "visionInput",
              },
            ],
            content: "",
            id: "conv-attachment-only",
            title: "SSH 截图",
          }),
        ],
        currentSlot,
        open: true,
        query: "2222",
      }),
    );

    expect(result.current.rows).toEqual([
      expect.objectContaining({
        attachmentCount: 1,
        id: "conv-attachment-only",
      }),
    ]);
  });
});

function summary(id: string, index: number) {
  return {
    archivedAt: null,
    attachmentCount: index === 0 ? 1 : 0,
    createdAt: 1_000 - index,
    hostId: "host-prod",
    id,
    lastMessageAt: 2_000 - index,
    messageCount: 1,
    model: index === 0 ? "gpt-4.1" : null,
    paneId: "pane-prod",
    providerId: index === 0 ? "openai-prod" : null,
    scopeKind: "lockedPane",
    scopeRefJson: currentSlot.targetRefJson,
    status: index === 0 ? "waiting" : "idle",
    summary: null,
    tabId: "tab-prod",
    targetKey: "pane:pane-prod",
    title: `历史 ${id}`,
    updatedAt: 2_000 - index,
  };
}

function localConversation(input: {
  attachments?: NonNullable<AiConversation["messages"][number]["attachments"]>;
  content?: string;
  hostId?: string;
  id: string;
  paneId?: string;
  tabId?: string;
  targetKey?: string;
  title: string;
}): AiConversation {
  const hostId = input.hostId ?? "host-prod";
  const paneId = input.paneId ?? "pane-prod";
  const tabId = input.tabId ?? "tab-prod";
  const targetKey = input.targetKey ?? "pane:pane-prod";
  return {
    createdAt: 1_000,
    hostId,
    id: input.id,
    messages: [
      {
        content: input.content ?? "systemctl status 报错",
        createdAt: 1_100,
        id: `${input.id}-message`,
        ...(input.attachments ? { attachments: input.attachments } : {}),
        role: "user",
      },
    ],
    paneId,
    scopeKind: "lockedPane",
    scopeRefJson: JSON.stringify({
      kind: "pane",
      machineId: hostId,
      paneId,
      tabId,
    }),
    tabId,
    targetKey,
    title: input.title,
    updatedAt: 1_200,
  };
}
