import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Dispatch, SetStateAction } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiAttachment } from "../../../lib/aiConversationApi";
import type { AiConversationSlotDescriptor } from "./aiConversationPersistence";
import { useAiPendingAttachments } from "./useAiPendingAttachments";
import type { AiConversation, ConversationState } from "./aiToolContentModel";

type DragDropHandler = (event: unknown) => void;

const conversationApiMock = vi.hoisted(() => ({
  importAiConversationAttachment: vi.fn(),
  importAiConversationAttachmentBytes: vi.fn(),
}));

const tauriWebviewMock = vi.hoisted(() => ({
  handler: undefined as DragDropHandler | undefined,
  onDragDropEvent: vi.fn(),
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
  isTauri: () => true,
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: tauriWebviewMock.onDragDropEvent,
  }),
}));

vi.mock("../../../lib/aiConversationApi", async () => {
  const actual = await vi.importActual<
    typeof import("../../../lib/aiConversationApi")
  >("../../../lib/aiConversationApi");
  return {
    ...actual,
    importAiConversationAttachment:
      conversationApiMock.importAiConversationAttachment,
    importAiConversationAttachmentBytes:
      conversationApiMock.importAiConversationAttachmentBytes,
  };
});

describe("useAiPendingAttachments native drag-drop", () => {
  beforeEach(() => {
    conversationApiMock.importAiConversationAttachment.mockReset();
    conversationApiMock.importAiConversationAttachmentBytes.mockReset();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:kerminal-preview"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    tauriWebviewMock.handler = undefined;
    tauriWebviewMock.unlisten.mockReset();
    tauriWebviewMock.onDragDropEvent.mockReset();
    tauriWebviewMock.onDragDropEvent.mockImplementation(
      async (handler: DragDropHandler) => {
        tauriWebviewMock.handler = handler;
        return tauriWebviewMock.unlisten;
      },
    );
  });

  it("imports an image dropped inside the native Tauri drop zone", async () => {
    conversationApiMock.importAiConversationAttachment.mockResolvedValue(
      storedAttachment(),
    );
    const { unmount } = render(<PendingAttachmentHarness />);
    setDropZoneRect();

    await waitFor(() => {
      expect(tauriWebviewMock.handler).toBeTypeOf("function");
    });
    await act(async () => {
      tauriWebviewMock.handler?.({
        payload: {
          paths: ["C:/tmp/ssh-login.png"],
          position: { x: 20, y: 20 },
          type: "drop",
        },
      });
    });

    await screen.findByText("ssh-login.png");
    expect(screen.getByTestId("preview-att-drag")).toHaveTextContent(
      "asset://C:/tmp/ssh-login.png",
    );
    expect(
      conversationApiMock.importAiConversationAttachment,
    ).toHaveBeenCalledWith({
      conversationId: "conv-1",
      sourceKind: "drag",
      sourcePath: "C:/tmp/ssh-login.png",
      visionUsage: "visionInput",
    });
    expect(screen.getByTestId("drop-active")).toHaveTextContent("idle");

    unmount();
    expect(tauriWebviewMock.unlisten).toHaveBeenCalled();
  });

  it("ignores native drops outside the attachment drop zone", async () => {
    render(<PendingAttachmentHarness />);
    setDropZoneRect();

    await waitFor(() => {
      expect(tauriWebviewMock.handler).toBeTypeOf("function");
    });
    await act(async () => {
      tauriWebviewMock.handler?.({
        payload: {
          paths: ["C:/tmp/ssh-login.png"],
          position: { x: 240, y: 160 },
          type: "drop",
        },
      });
    });

    expect(conversationApiMock.importAiConversationAttachment).not.toHaveBeenCalled();
    expect(screen.getByText("no attachments")).toBeInTheDocument();
  });

  it("keeps a local blob preview for pasted image bytes", async () => {
    const imported = deferred<AiAttachment>();
    conversationApiMock.importAiConversationAttachmentBytes.mockReturnValue(
      imported.promise,
    );
    render(<PendingAttachmentHarness />);

    fireEvent.paste(screen.getByTestId("attachment-drop-zone"), {
      clipboardData: fileTransfer([
        new File([new Uint8Array([137, 80, 78, 71])], "clipboard.png", {
          type: "image/png",
        }),
      ]),
    });

    expect(await screen.findByText("clipboard.png")).toBeInTheDocument();
    expect(screen.getByText(/blob:kerminal-preview/)).toBeInTheDocument();

    await act(async () => {
      imported.resolve(pastedAttachment());
    });

    expect(screen.getByTestId("preview-att-paste")).toHaveTextContent(
      "blob:kerminal-preview",
    );
  });

  it("removes an optimistic preview when image byte import fails", async () => {
    const imported = deferred<AiAttachment>();
    conversationApiMock.importAiConversationAttachmentBytes.mockReturnValue(
      imported.promise,
    );
    render(<PendingAttachmentHarness />);

    fireEvent.paste(screen.getByTestId("attachment-drop-zone"), {
      clipboardData: fileTransfer([
        new File([new Uint8Array([137, 80, 78, 71])], "clipboard.png", {
          type: "image/png",
        }),
      ]),
    });

    expect(await screen.findByText("clipboard.png")).toBeInTheDocument();
    await act(async () => {
      imported.reject(new Error("ocr timeout"));
    });
    await waitFor(() => {
      expect(screen.getByText("no attachments")).toBeInTheDocument();
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:kerminal-preview");
  });

  it("does not re-add an attachment that was removed while import was pending", async () => {
    const imported = deferred<AiAttachment>();
    conversationApiMock.importAiConversationAttachmentBytes.mockReturnValue(
      imported.promise,
    );
    render(<PendingAttachmentHarness />);

    fireEvent.paste(screen.getByTestId("attachment-drop-zone"), {
      clipboardData: fileTransfer([
        new File([new Uint8Array([137, 80, 78, 71])], "clipboard.png", {
          type: "image/png",
        }),
      ]),
    });

    expect(await screen.findByText("clipboard.png")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /remove clipboard.png/ }));

    await act(async () => {
      imported.resolve(pastedAttachment());
    });

    expect(screen.getByText("no attachments")).toBeInTheDocument();
  });
});

function PendingAttachmentHarness() {
  const pendingAttachments = useAiPendingAttachments({
    activeConversation: activeConversation(),
    conversationPersistenceEnabled: false,
    conversationSlot: conversationSlot(),
    setChatError: vi.fn(),
    setConversationState: vi.fn() as Dispatch<SetStateAction<ConversationState>>,
  });

  return (
    <div
      data-testid="attachment-drop-zone"
      ref={pendingAttachments.attachmentDropZoneRef}
      onPaste={pendingAttachments.handleAttachmentPaste}
    >
      <span data-testid="drop-active">
        {pendingAttachments.attachmentDropActive ? "active" : "idle"}
      </span>
      {pendingAttachments.pendingAttachments.length === 0 ? (
        <span>no attachments</span>
      ) : null}
      {pendingAttachments.pendingAttachments.map((attachment) => (
        <span key={attachment.id}>
          {attachment.originalName}
          <button
            aria-label={`remove ${attachment.originalName}`}
            onClick={() =>
              pendingAttachments.removePendingAttachment(attachment.id)
            }
            type="button"
          >
            remove
          </button>
          <span data-testid={`preview-${attachment.id}`}>
            {attachment.localPreviewUrl ?? "no-preview"}
          </span>
        </span>
      ))}
    </div>
  );
}

function setDropZoneRect() {
  const element = screen.getByTestId("attachment-drop-zone");
  element.getBoundingClientRect = () =>
    ({
      bottom: 100,
      height: 100,
      left: 0,
      right: 200,
      top: 0,
      width: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
}

function activeConversation(): AiConversation {
  return { id: "conv-1" } as AiConversation;
}

function conversationSlot(): AiConversationSlotDescriptor {
  return {
    createRequest: { scopeKind: "noContext" },
    routeMode: "followWorkspaceTarget",
    slotKey: "pane:pane-1",
    targetRefJson: "{}",
  };
}

function storedAttachment(overrides: Partial<AiAttachment> = {}): AiAttachment {
  return {
    assetPath: "ai-attachments/conv-1/att-drag/original.png",
    conversationId: "conv-1",
    createdAt: 1_765_000_000_000,
    height: 320,
    id: "att-drag",
    kind: "image",
    messageId: null,
    mimeType: "image/png",
    missingReason: null,
    ocrText: null,
    originalName: "ssh-login.png",
    originalPath: "C:/tmp/ssh-login.png",
    redactionSummary: null,
    sha256: null,
    sizeBytes: 4096,
    sourceKind: "drag",
    status: "available",
    storageMode: "managedCopy",
    thumbnailPath: null,
    updatedAt: 1_765_000_000_000,
    visionUsage: "visionInput",
    width: 640,
    ...overrides,
  };
}

function pastedAttachment() {
  return storedAttachment({
    assetPath: "ai-attachments/conv-1/att-paste/original.png",
    id: "att-paste",
    originalName: "clipboard.png",
    originalPath: null,
    sourceKind: "paste",
  });
}

function fileTransfer(files: File[]) {
  return {
    files,
    items: files.map((file) => ({
      getAsFile: () => file,
      kind: "file",
    })),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}
