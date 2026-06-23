import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AiAttachment,
  AiAttachmentAssetInfo,
} from "../../../lib/aiConversationApi";
import { AiAttachmentPreviewDialog } from "./AiAttachmentPreviewDialog";
import type { AiChatAttachment } from "./aiToolContentModel";

const conversationApiMock = vi.hoisted(() => ({
  getAiConversationAttachmentAssetInfo: vi.fn(),
  openAiConversationAttachment: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

vi.mock("../../../lib/aiConversationApi", async () => {
  const actual = await vi.importActual<
    typeof import("../../../lib/aiConversationApi")
  >("../../../lib/aiConversationApi");
  return {
    ...actual,
    getAiConversationAttachmentAssetInfo:
      conversationApiMock.getAiConversationAttachmentAssetInfo,
    openAiConversationAttachment:
      conversationApiMock.openAiConversationAttachment,
  };
});

describe("AiAttachmentPreviewDialog", () => {
  beforeEach(() => {
    conversationApiMock.getAiConversationAttachmentAssetInfo.mockReset();
    conversationApiMock.openAiConversationAttachment.mockReset();
  });

  it("shows a managed image preview with storage mode metadata", async () => {
    const attachment = chatImageAttachment({ storageMode: "managedCopy" });
    conversationApiMock.getAiConversationAttachmentAssetInfo.mockResolvedValue(
      assetInfo({
        attachment: storedAttachment({ storageMode: "managedCopy" }),
        exists: true,
        previewPath: "C:/Kerminal/ai-attachments/conv-1/att-preview/original.png",
        resolvedPath:
          "C:/Kerminal/ai-attachments/conv-1/att-preview/original.png",
      }),
    );

    render(
      <AiAttachmentPreviewDialog
        attachment={attachment}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(
        document.querySelector(
          'img[src="asset://C:/Kerminal/ai-attachments/conv-1/att-preview/original.png"]',
        ),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/Kerminal 受管副本/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /系统打开/ })).toBeEnabled();
  });

  it("syncs missing linked file status and disables system open", async () => {
    const attachment = chatImageAttachment({
      originalPath: "C:/tmp/ssh-login.png",
      storageMode: "linkedFile",
    });
    conversationApiMock.getAiConversationAttachmentAssetInfo.mockResolvedValue(
      assetInfo({
        attachment: storedAttachment({
          missingReason: "deleted",
          originalPath: attachment.originalPath,
          status: "missing",
          storageMode: "linkedFile",
        }),
        exists: false,
        previewPath: null,
        resolvedPath: null,
      }),
    );

    render(
      <AiAttachmentPreviewDialog
        attachment={attachment}
        onClose={vi.fn()}
      />,
    );

    expect(
      await screen.findByText("引用原文件：文件不可用：已删除"),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/文件不可用：已删除/)).toHaveLength(2);
    const openButton = screen.getByRole("button", { name: /系统打开/ });
    expect(openButton).toBeDisabled();

    fireEvent.click(openButton);
    expect(
      conversationApiMock.openAiConversationAttachment,
    ).not.toHaveBeenCalled();
  });

  it("previews a local pending image without loading backend asset info", () => {
    render(
      <AiAttachmentPreviewDialog
        attachment={chatImageAttachment({
          id: "pending-image-local",
          localPreviewUrl: "blob:kerminal-preview",
          originalName: "clipboard.png",
        })}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("img", { name: "clipboard.png" }),
    ).toHaveAttribute("src", "blob:kerminal-preview");
    expect(
      conversationApiMock.getAiConversationAttachmentAssetInfo,
    ).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /系统打开/ })).toBeDisabled();
  });
});

function chatImageAttachment(
  overrides: Partial<AiChatAttachment> = {},
): AiChatAttachment {
  return {
    assetPath: null,
    height: 320,
    id: "att-preview",
    kind: "image",
    localPreviewUrl: null,
    mimeType: "image/png",
    missingReason: null,
    ocrText: null,
    originalName: "ssh-login.png",
    originalPath: null,
    redactionSummary: null,
    sizeBytes: 4096,
    status: "available",
    storageMode: null,
    thumbnailPath: null,
    visionUsage: "visionInput",
    width: 640,
    ...overrides,
  };
}

function assetInfo(input: AiAttachmentAssetInfo): AiAttachmentAssetInfo {
  return input;
}

function storedAttachment(overrides: Partial<AiAttachment> = {}): AiAttachment {
  return {
    assetPath: null,
    conversationId: "conv-1",
    createdAt: 1_765_000_000_000,
    height: 320,
    id: "att-preview",
    kind: "image",
    messageId: "msg-preview",
    mimeType: "image/png",
    missingReason: null,
    ocrText: null,
    originalName: "ssh-login.png",
    originalPath: null,
    redactionSummary: null,
    sha256: null,
    sizeBytes: 4096,
    sourceKind: "picker",
    status: "available",
    storageMode: "managedCopy",
    thumbnailPath: null,
    updatedAt: 1_765_000_000_000,
    visionUsage: "visionInput",
    width: 640,
    ...overrides,
  };
}
