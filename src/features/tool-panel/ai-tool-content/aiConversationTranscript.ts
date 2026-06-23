import type { AiChatHistoryMessage } from "../../../lib/aiAgentApi";
import type { AiChatAttachment, AiChatMessage } from "./aiToolContentModel";

const TRANSCRIPT_MESSAGE_LIMIT = 10;
const TRANSCRIPT_CHAR_LIMIT = 6000;

export function buildAiChatHistory(
  previousMessages: AiChatMessage[],
): AiChatHistoryMessage[] {
  const transcriptMessages = previousMessages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-TRANSCRIPT_MESSAGE_LIMIT)
    .map(formatAiChatHistoryMessage);

  let remainingChars = TRANSCRIPT_CHAR_LIMIT;
  return transcriptMessages
    .reverse()
    .map((message) => {
      if (remainingChars <= 0) {
        return null;
      }
      const content = trimHistoryContent(message.content, remainingChars);
      remainingChars -= content.length;
      return {
        ...message,
        content,
      };
    })
    .filter((message): message is AiChatHistoryMessage => Boolean(message))
    .reverse();
}

function formatAiChatHistoryMessage(
  message: AiChatMessage,
): AiChatHistoryMessage {
  const content = message.content.trim() || "(无文本)";
  const attachmentLines = (message.attachments ?? [])
    .map(formatAttachmentTranscriptLine)
    .filter((line) => line.length > 0);

  return {
    content:
      attachmentLines.length > 0
        ? [content, "附件上下文:", ...attachmentLines].join("\n")
        : content,
    role: message.role,
  };
}

function formatAttachmentTranscriptLine(attachment: AiChatAttachment) {
  const parts = [
    `${attachment.originalName} (${attachment.kind}/${attachment.mimeType})`,
    `status ${attachment.status}`,
    `visionUsage ${attachment.visionUsage ?? "notSent"}`,
  ];
  if (attachment.ocrText?.trim()) {
    parts.push(`OCR ${attachment.ocrText.trim()}`);
  }
  if (attachment.redactionSummary?.trim()) {
    parts.push(`redaction ${attachment.redactionSummary.trim()}`);
  }
  return `- ${parts.join("；")}`;
}

function trimHistoryContent(content: string, maxChars: number) {
  if (content.length <= maxChars) {
    return content;
  }
  return content.slice(content.length - maxChars);
}
