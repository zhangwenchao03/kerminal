import type { AgentSessionRecord } from "../../lib/agentLauncherApi";
import type { TerminalAgentSignal } from "../../lib/terminalApi";
import {
  AGENT_WORKFLOW_METADATA_LIMIT,
  AGENT_WORKFLOW_PREVIEW_MAX_BYTES,
  AGENT_WORKFLOW_PREVIEW_TTL_MS,
  getAgentWorkflowSessionId,
  isAgentWorkflowPreviewExpired,
  redactAgentWorkflowPreview,
  resolveAgentWorkflowSessionSnapshot,
  truncateAgentWorkflowPreview,
} from "./agentWorkflowModel";
import type {
  AgentWorkflowPromptTransportPort,
  AgentWorkflowRepositoryPort,
  AgentWorkflowTerminalSignalPort,
} from "./agentWorkflowPorts";
import type {
  AgentWorkflowControllerOptions,
  AgentWorkflowHistoryMetadata,
  AgentWorkflowPreviewKind,
  AgentWorkflowPreviewResolution,
  AgentWorkflowQueueMetadata,
  AgentWorkflowSendPreview,
  AgentWorkflowSnapshot,
} from "./agentWorkflowTypes";

type SnapshotListener = (snapshot: AgentWorkflowSnapshot) => void;

/** Agent Workflow 的派生状态控制器；所有正文仅在发送预览生命周期内短暂驻留。 */
export class AgentWorkflowController {
  private disposed = false;
  private errorCode: string | undefined;
  private history: AgentWorkflowHistoryMetadata[] = [];
  private operationGeneration = 0;
  private pendingSends = new Set<AbortController>();
  private loading = false;
  private previewSequence = 0;
  private previews = new Map<string, AgentWorkflowSendPreview>();
  private queue: AgentWorkflowQueueMetadata[] = [];
  private records: AgentSessionRecord[] = [];
  private refreshedAt: string | undefined;
  private refreshSequence = 0;
  private revision = 0;
  private signals = new Map<string, TerminalAgentSignal>();
  private stale = true;
  private listeners = new Set<SnapshotListener>();
  private readonly now: () => Date;
  private readonly historyMetadataLimit: number;
  private readonly previewMaxBytes: number;
  private readonly previewTtlMs: number;
  private readonly queueMetadataLimit: number;
  private readonly unsubscribeSignal: () => void;

  constructor(
    private readonly repository: AgentWorkflowRepositoryPort,
    terminalSignals: AgentWorkflowTerminalSignalPort,
    private readonly promptTransport: AgentWorkflowPromptTransportPort,
    options: AgentWorkflowControllerOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.historyMetadataLimit = Math.max(
      0,
      options.historyMetadataLimit ?? AGENT_WORKFLOW_METADATA_LIMIT,
    );
    this.previewMaxBytes =
      options.previewMaxBytes ?? AGENT_WORKFLOW_PREVIEW_MAX_BYTES;
    this.previewTtlMs = options.previewTtlMs ?? AGENT_WORKFLOW_PREVIEW_TTL_MS;
    this.queueMetadataLimit = Math.max(
      0,
      options.queueMetadataLimit ?? AGENT_WORKFLOW_METADATA_LIMIT,
    );
    this.unsubscribeSignal = terminalSignals.subscribe((signal) => {
      this.acceptTerminalSignal(signal);
    });
  }

  getSnapshot(): AgentWorkflowSnapshot {
    const sessions = this.records
      .map((record) =>
        resolveAgentWorkflowSessionSnapshot({
          record,
          signal: this.signals.get(getAgentWorkflowSessionId(record) ?? ""),
        }),
      )
      .filter((session) => session !== null)
      .map((session) =>
        this.stale &&
        session.statusSource === "repository" &&
        session.runtimeStatus === "running"
          ? { ...session, runtimeStatus: "stale" as const }
          : session,
      );
    return {
      disposed: this.disposed,
      errorCode: this.errorCode,
      historyMetadata: this.getHistoryMetadata(),
      loading: this.loading,
      queueMetadata: this.getQueueMetadata(),
      refreshedAt: this.refreshedAt,
      revision: this.revision,
      sessions,
      stale: this.stale,
    };
  }

  subscribe(listener: SnapshotListener) {
    this.assertActive();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 刷新采用 latest-wins，较慢的旧请求不得覆盖更新后的 repository 结果。 */
  async refresh() {
    this.assertActive();
    const sequence = ++this.refreshSequence;
    this.loading = true;
    this.errorCode = undefined;
    this.emit();
    try {
      const records = await this.repository.listSessions();
      if (this.disposed || sequence !== this.refreshSequence) {
        return this.getSnapshot();
      }
      this.records = records;
      this.refreshedAt = this.now().toISOString();
      this.stale = false;
    } catch {
      if (this.disposed || sequence !== this.refreshSequence) {
        return this.getSnapshot();
      }
      this.errorCode = "repository-refresh-failed";
      this.stale = true;
    } finally {
      if (!this.disposed && sequence === this.refreshSequence) {
        this.loading = false;
        this.emit();
      }
    }
    return this.getSnapshot();
  }

  markStale() {
    this.assertActive();
    if (!this.stale) {
      this.stale = true;
      this.emit();
    }
  }

  acceptTerminalSignal(signal: TerminalAgentSignal) {
    if (this.disposed || !signal.agentSessionId) {
      return;
    }
    this.signals.set(signal.agentSessionId, { ...signal });
    this.emit();
  }

  createSendPreview(input: {
    kind: AgentWorkflowPreviewKind;
    sessionId: string;
    text: string;
  }) {
    this.assertActive();
    this.purgeExpiredPreviews();
    const createdAt = this.now();
    const redaction = redactAgentWorkflowPreview(
      input.text.replace(/\r\n?/g, "\n"),
    );
    const bounded = truncateAgentWorkflowPreview(
      redaction.text,
      this.previewMaxBytes,
    );
    const preview: AgentWorkflowSendPreview = {
      byteLength: bounded.byteLength,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(
        createdAt.getTime() + this.previewTtlMs,
      ).toISOString(),
      id: `agent-workflow-preview-${++this.previewSequence}`,
      kind: input.kind,
      redacted: redaction.redacted,
      sessionId: input.sessionId,
      text: bounded.text,
      truncated: bounded.truncated,
    };
    this.previews.set(preview.id, preview);
    return { ...preview };
  }

  getSendPreview(id: string) {
    this.assertActive();
    this.purgeExpiredPreviews();
    const preview = this.previews.get(id);
    return preview ? { ...preview } : null;
  }

  async confirmSendPreview(
    id: string,
    submit = true,
  ): Promise<AgentWorkflowPreviewResolution> {
    this.assertActive();
    const preview = this.takePreview(id);
    if (!preview) {
      return { outcome: "missing" };
    }
    if (isAgentWorkflowPreviewExpired(preview, this.now())) {
      this.appendHistory(preview, submit, "expired");
      return { outcome: "expired" };
    }
    const generation = this.operationGeneration;
    const abortController = new AbortController();
    this.pendingSends.add(abortController);
    try {
      const result = await this.promptTransport.send(
        {
          sessionId: preview.sessionId,
          submit,
          text: preview.text,
        },
        { signal: abortController.signal },
      );
      if (!this.canCommitOperation(generation)) {
        return { outcome: "cancelled" };
      }
      if (!result.accepted) {
        this.appendHistory(preview, submit, "failed");
        return { outcome: "failed", errorCode: "transport-rejected" };
      }
      this.appendHistory(preview, submit, submit ? "sent" : "queued");
      return { outcome: "sent", transportId: result.transportId };
    } catch {
      if (!this.canCommitOperation(generation)) {
        return { outcome: "cancelled" };
      }
      this.appendHistory(preview, submit, "failed");
      return { outcome: "failed", errorCode: "transport-failed" };
    } finally {
      this.pendingSends.delete(abortController);
    }
  }

  cancelSendPreview(id: string): AgentWorkflowPreviewResolution {
    this.assertActive();
    const preview = this.takePreview(id);
    if (!preview) {
      return { outcome: "missing" };
    }
    if (isAgentWorkflowPreviewExpired(preview, this.now())) {
      this.appendHistory(preview, true, "expired");
      return { outcome: "expired" };
    }
    this.appendHistory(preview, true, "cancelled");
    return { outcome: "cancelled" };
  }

  /** 接收现有 queue model 的 adapter metadata，禁止把 item.text 传入或保存。 */
  recordQueueMetadata(metadata: AgentWorkflowQueueMetadata) {
    this.assertActive();
    if (this.queueMetadataLimit <= 0) {
      this.queue = [];
      this.emit();
      return;
    }
    this.queue = [...this.queue, { ...metadata }].slice(
      -this.queueMetadataLimit,
    );
    this.emit();
  }

  getQueueMetadata() {
    return this.queue.map((item) => ({ ...item }));
  }

  getHistoryMetadata() {
    return this.history.map((item) => ({ ...item }));
  }

  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.operationGeneration += 1;
    this.refreshSequence += 1;
    for (const pendingSend of this.pendingSends) {
      pendingSend.abort();
    }
    this.pendingSends.clear();
    this.unsubscribeSignal();
    this.previews.clear();
    this.signals.clear();
    this.queue = [];
    this.history = [];
    this.records = [];
    this.errorCode = undefined;
    this.refreshedAt = undefined;
    this.loading = false;
    this.stale = true;
    this.revision += 1;
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
    this.listeners.clear();
  }

  private appendHistory(
    preview: AgentWorkflowSendPreview,
    submit: boolean,
    outcome: AgentWorkflowHistoryMetadata["outcome"],
  ) {
    if (this.disposed || this.historyMetadataLimit <= 0) {
      return;
    }
    this.history = [
      {
        action: resolvePreviewHistoryAction(preview.kind, submit),
        createdAt: this.now().toISOString(),
        id: preview.id,
        outcome,
        previewKind: preview.kind,
        sessionId: preview.sessionId,
        submit,
        textBytes: preview.byteLength,
      },
      ...this.history,
    ].slice(0, this.historyMetadataLimit);
    this.emit();
  }

  private takePreview(id: string) {
    const preview = this.previews.get(id);
    this.previews.delete(id);
    return preview;
  }

  private purgeExpiredPreviews() {
    const now = this.now();
    for (const [id, preview] of this.previews) {
      if (isAgentWorkflowPreviewExpired(preview, now)) {
        this.previews.delete(id);
        this.appendHistory(preview, true, "expired");
      }
    }
  }

  private emit() {
    this.revision += 1;
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private assertActive() {
    if (this.disposed) {
      throw new Error("AgentWorkflowController has been disposed");
    }
  }

  private canCommitOperation(generation: number) {
    return !this.disposed && generation === this.operationGeneration;
  }
}

function resolvePreviewHistoryAction(
  kind: AgentWorkflowPreviewKind,
  submit: boolean,
): AgentWorkflowHistoryMetadata["action"] {
  if (!submit) {
    return "queued";
  }
  switch (kind) {
    case "commandBlock":
      return "commandBlock";
    case "selection":
      return "selection";
    case "artifact":
    case "diagnostic":
      return "context";
  }
}
