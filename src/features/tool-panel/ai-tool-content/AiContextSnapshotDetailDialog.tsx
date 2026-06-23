import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ClipboardList, Loader2 } from "lucide-react";
import { ModalShell } from "../../../components/ui/modal-shell";
import {
  getAiContextSnapshot,
  type AiContextSnapshot,
} from "../../../lib/aiConversationSnapshotApi";
import { compactId, formatHistoryDate, isRecord } from "./aiToolContentModel";

export function AiContextSnapshotDetailDialog({
  onClose,
  onError,
  snapshotId,
}: {
  onClose: () => void;
  onError?: (message: string) => void;
  snapshotId: string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<AiContextSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setSnapshot(null);
    if (!snapshotId) {
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    void getAiContextSnapshot(snapshotId)
      .then((nextSnapshot) => {
        if (!cancelled) {
          setSnapshot(nextSnapshot);
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          const message =
            nextError instanceof Error ? nextError.message : String(nextError);
          setError(message);
          onError?.(message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [onError, snapshotId]);

  const summary = useMemo(
    () => (snapshot ? snapshotSummary(snapshot) : null),
    [snapshot],
  );

  return (
    <ModalShell
      bodyClassName="flex min-h-0 flex-col gap-3"
      description={
        snapshot
          ? `${compactId(snapshot.id)} · ${formatSnapshotTimestamp(snapshot.generatedAt)}`
          : "读取消息发送时 AI 实际看到的上下文"
      }
      onClose={onClose}
      open={Boolean(snapshotId)}
      panelClassName="h-[min(760px,calc(100vh-48px))]"
      size="large"
      title="上下文快照详情"
    >
      {loading ? (
        <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在加载上下文快照
        </div>
      ) : null}

      {!loading && error ? (
        <div
          className="rounded-xl border border-amber-400/25 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-amber-700 dark:text-amber-100"
          role="alert"
        >
          <div className="mb-1 flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" />
            快照不可用
          </div>
          {error}
        </div>
      ) : null}

      {!loading && !error && snapshot && summary ? (
        <>
          <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-field)] p-3">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <ClipboardList className="h-4 w-4 text-sky-500 dark:text-sky-300" />
              快照摘要
            </div>
            <div className="grid gap-2 text-xs sm:grid-cols-2">
              {summary.map((item) => (
                <SnapshotSummaryItem
                  key={item.label}
                  label={item.label}
                  value={item.value}
                />
              ))}
            </div>
          </section>
          <div className="kerminal-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            <SnapshotJsonSection
              jsonText={snapshot.scopeRefJson}
              title="Scope 引用"
            />
            <SnapshotJsonSection
              jsonText={snapshot.targetRefJson}
              title="目标引用"
            />
            <SnapshotJsonSection
              jsonText={snapshot.terminalContextJson}
              title="终端上下文"
            />
            <SnapshotJsonSection
              jsonText={snapshot.applicationContextJson}
              title="应用上下文"
            />
            <SnapshotJsonSection
              jsonText={snapshot.attachmentRefsJson}
              title="附件引用"
            />
            <SnapshotJsonSection
              jsonText={snapshot.policyJson}
              title="上下文策略"
            />
          </div>
        </>
      ) : null}
    </ModalShell>
  );
}

function SnapshotSummaryItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-overlay)] px-3 py-2">
      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-1 truncate font-mono text-xs text-zinc-900 dark:text-zinc-100" title={value}>
        {value}
      </div>
    </div>
  );
}

function SnapshotJsonSection({
  jsonText,
  title,
}: {
  jsonText?: string | null;
  title: string;
}) {
  const formatted = formatJsonText(jsonText);
  return (
    <section className="overflow-hidden rounded-xl border border-[var(--border-subtle)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-field)] px-3 py-2">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {title}
        </h3>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {formatted.status}
        </span>
      </div>
      <pre className="kerminal-scrollbar max-h-56 overflow-auto whitespace-pre-wrap bg-[var(--surface-overlay)] px-3 py-2 font-mono text-xs leading-5 text-zinc-700 dark:text-zinc-200">
        {formatted.value}
      </pre>
    </section>
  );
}

function snapshotSummary(snapshot: AiContextSnapshot) {
  const targetRef = parseJsonRecord(snapshot.targetRefJson);
  const scopeRef = parseJsonRecord(snapshot.scopeRefJson);
  const terminalContext = parseJsonRecord(snapshot.terminalContextJson);
  const attachments = parseJsonArray(snapshot.attachmentRefsJson);
  return [
    { label: "Snapshot", value: snapshot.id },
    { label: "会话", value: snapshot.conversationId },
    { label: "消息", value: snapshot.messageId ?? "未关联消息" },
    { label: "Scope", value: snapshot.scopeKind },
    { label: "路由", value: snapshot.routeMode ?? "未记录" },
    { label: "目标", value: firstText(targetRef, scopeRef, "machineName", "paneTitle", "tabTitle", "kind") ?? "未记录" },
    { label: "Session", value: firstText(terminalContext, "sessionId", "session_id") ?? "未记录" },
    { label: "附件", value: `${attachments.length} 个` },
    { label: "生成时间", value: formatSnapshotTimestamp(snapshot.generatedAt) },
    { label: "创建时间", value: formatSnapshotTimestamp(snapshot.createdAt) },
  ];
}

function formatSnapshotTimestamp(timestamp: number) {
  const normalized = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
  return formatHistoryDate(normalized);
}

function formatJsonText(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) {
    return { status: "空", value: "未记录" };
  }
  try {
    return {
      status: "JSON",
      value: JSON.stringify(JSON.parse(normalized), null, 2),
    };
  } catch {
    return { status: "原始文本", value: normalized };
  }
}

function parseJsonRecord(value: string | null | undefined) {
  const parsed = parseJsonValue(value);
  return isRecord(parsed) ? parsed : null;
}

function parseJsonArray(value: string | null | undefined) {
  const parsed = parseJsonValue(value);
  return Array.isArray(parsed) ? parsed : [];
}

function parseJsonValue(value: string | null | undefined): unknown {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }
  try {
    return JSON.parse(normalized);
  } catch {
    return null;
  }
}

function firstText(
  ...values: Array<Record<string, unknown> | string | null>
): string | null {
  const records = values.filter(isRecord);
  const keys = values.filter((value): value is string => typeof value === "string");
  for (const record of records) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        return value;
      }
    }
  }
  return null;
}
