import { Bot, ClipboardCheck, History, Plus, Settings } from "lucide-react";
import { Button } from "../../../components/ui/button";
import type { AiCommandExecutionVisibility } from "../../../lib/aiAgentApi";
import type { AiToolAuditRecord } from "../../../lib/aiToolInvocationApi";
import {
  AiAuditManagement,
  type AiAuditContextOpenRequest,
} from "../AiAuditManagement";
import { AiConversationRouteStatus } from "./AiConversationRouteStatus";
import { CommandVisibilitySwitch } from "./AiToolContentParts";
import type { AiTerminalContextSnapshot } from "../../../lib/aiContextApi";
import type { AiConversationSlotDescriptor } from "./aiConversationPersistence";
import type {
  AiConversation,
  AuditActionState,
  LoadState,
} from "./aiToolContentModel";

export function AiToolContentHeader({
  activeConversation,
  auditActionState,
  auditClearRequested,
  auditMessage,
  auditOpen,
  commandVisibility,
  conversationSlot,
  contextError,
  contextSnapshot,
  contextState,
  historyOpen,
  newConversationDisabled,
  onCancelClearAudits,
  onCommandVisibilityChange,
  onConfirmClearAudits,
  onExportAudits,
  onOpenAiSettings,
  onOpenAuditContext,
  onRefreshAuditList,
  onRequestClearAudits,
  onStartNewConversation,
  onToggleAudit,
  onToggleHistory,
  settingsDisabled,
  terminalSessionReady,
  toolAudits,
}: {
  activeConversation?: AiConversation;
  auditActionState: AuditActionState;
  auditClearRequested: boolean;
  auditMessage: string | null;
  auditOpen: boolean;
  commandVisibility: AiCommandExecutionVisibility;
  conversationSlot: AiConversationSlotDescriptor;
  contextError: string | null;
  contextSnapshot: AiTerminalContextSnapshot | null;
  contextState: LoadState;
  historyOpen: boolean;
  newConversationDisabled: boolean;
  onCancelClearAudits: () => void;
  onCommandVisibilityChange: (value: AiCommandExecutionVisibility) => void;
  onConfirmClearAudits: () => void;
  onExportAudits: () => void;
  onOpenAiSettings: () => void;
  onOpenAuditContext?: (request: AiAuditContextOpenRequest) => void;
  onRefreshAuditList: () => void;
  onRequestClearAudits: () => void;
  onStartNewConversation: () => void;
  onToggleAudit: () => void;
  onToggleHistory: () => void;
  settingsDisabled: boolean;
  terminalSessionReady: boolean;
  toolAudits: AiToolAuditRecord[];
}) {
  return (
    <header className="kerminal-material-nav relative shrink-0 border-b px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <Bot className="h-4 w-4 text-sky-500 dark:text-sky-300" />
          <span className="truncate">Kerminal Agent</span>
        </h2>
        <div className="flex shrink-0 items-center gap-1">
          <CommandVisibilitySwitch
            value={commandVisibility}
            onChange={onCommandVisibilityChange}
          />
          <Button
            aria-label={historyOpen ? "关闭历史会话" : "查看历史会话"}
            aria-pressed={historyOpen}
            className="h-8 w-8 rounded-lg"
            onClick={onToggleHistory}
            size="icon"
            title={historyOpen ? "关闭历史会话" : "查看历史会话"}
            variant={historyOpen ? "secondary" : "ghost"}
          >
            <History className="h-4 w-4" />
          </Button>
          <Button
            aria-label="新建 AI 对话"
            className="h-8 w-8 rounded-lg"
            disabled={newConversationDisabled}
            onClick={onStartNewConversation}
            size="icon"
            title={newConversationDisabled ? "当前已有空白对话" : "新建 AI 对话"}
            variant="ghost"
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            aria-label={auditOpen ? "关闭工具审计" : "查看工具审计"}
            aria-pressed={auditOpen}
            className="h-8 w-8 rounded-lg"
            onClick={onToggleAudit}
            size="icon"
            title={auditOpen ? "关闭工具审计" : "查看工具审计"}
            variant={auditOpen ? "secondary" : "ghost"}
          >
            <ClipboardCheck className="h-4 w-4" />
          </Button>
          <Button
            aria-label="打开 AI 设置"
            className="h-8 w-8 rounded-lg"
            disabled={settingsDisabled}
            onClick={onOpenAiSettings}
            size="icon"
            title="打开 AI 设置"
            variant="ghost"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <AiConversationRouteStatus
        activeConversation={activeConversation}
        contextError={contextError}
        contextSnapshot={contextSnapshot}
        contextState={contextState}
        slot={conversationSlot}
        terminalSessionReady={terminalSessionReady}
      />

      {auditOpen ? (
        <div className="kerminal-scrollbar kerminal-floating-surface kerminal-floating-enter absolute left-3 right-3 top-[calc(100%-0.25rem)] z-30 max-h-[28rem] overflow-y-auto rounded-2xl border p-3">
          <AiAuditManagement
            actionState={auditActionState}
            audits={toolAudits}
            clearRequested={auditClearRequested}
            message={auditMessage}
            onCancelClear={onCancelClearAudits}
            onConfirmClear={onConfirmClearAudits}
            onExport={onExportAudits}
            onOpenContext={onOpenAuditContext}
            onRefresh={onRefreshAuditList}
            onRequestClear={onRequestClearAudits}
          />
        </div>
      ) : null}
    </header>
  );
}
