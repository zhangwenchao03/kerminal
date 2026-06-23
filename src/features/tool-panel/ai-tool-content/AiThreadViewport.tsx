import { ThreadPrimitive } from "@assistant-ui/react";
import { ChatMessageBubble, EmptyChatState } from "./AiToolContentParts";
import type { AiChatAttachment, AiConversation } from "./aiToolContentModel";

export function AiThreadViewport({
  activeConversation,
  highlightedMessageId,
  onOpenAttachment,
}: {
  activeConversation?: AiConversation;
  highlightedMessageId?: string | null;
  onOpenAttachment: (attachment: AiChatAttachment) => void;
}) {
  return (
    <ThreadPrimitive.Viewport
      aria-label="AI 对话消息"
      autoScroll
      className="kerminal-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-5"
    >
      <ThreadPrimitive.Empty>
        <EmptyChatState />
      </ThreadPrimitive.Empty>
      <ThreadPrimitive.Messages>
        {({ message }) => {
          const chatMessage = activeConversation?.messages.find(
            (item) => item.id === message.id,
          );
          if (!chatMessage) {
            return null;
          }
          return (
            <ChatMessageBubble
              highlighted={chatMessage.id === highlightedMessageId}
              message={chatMessage}
              onOpenAttachment={onOpenAttachment}
            />
          );
        }}
      </ThreadPrimitive.Messages>
    </ThreadPrimitive.Viewport>
  );
}
