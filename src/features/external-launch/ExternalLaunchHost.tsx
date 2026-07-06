import { AlertTriangle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { ModalShell } from "../../components/ui/modal-shell";
import {
  ackExternalSshLaunch,
  cancelExternalSshLaunch,
  listenExternalSshLaunches,
  materializeExternalSshLaunch,
  takePendingExternalSshLaunches,
  type ExternalSshLaunchRequest,
} from "../../lib/externalLaunchApi";
import { useWorkspaceStore } from "../workspace/workspaceStore";
import { ExternalLaunchResolutionDialog } from "./ExternalLaunchResolutionDialog";
import {
  applyExternalSshLaunchMaterializedTarget,
  externalSshLaunchNeedsUsername,
  externalSshLaunchSourceLabel,
  formatExternalSshLaunchError,
  type ExternalSshLaunchResolvedRequest,
} from "./externalSshLaunchModel";

interface ExternalLaunchFailure {
  launch: ExternalSshLaunchResolvedRequest;
  message: string;
}

interface ExternalLaunchNotice {
  message: string;
}

export function ExternalLaunchHost() {
  const openExternalSshLaunch = useWorkspaceStore(
    (state) => state.openExternalSshLaunch,
  );
  const [queue, setQueue] = useState<ExternalSshLaunchRequest[]>([]);
  const [resolutionLaunch, setResolutionLaunch] =
    useState<ExternalSshLaunchRequest | null>(null);
  const [failedLaunch, setFailedLaunch] = useState<ExternalLaunchFailure | null>(
    null,
  );
  const [notice, setNotice] = useState<ExternalLaunchNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const processingLaunchIdRef = useRef<string | null>(null);
  const enqueueLaunches = useCallback(
    (launches: ExternalSshLaunchRequest[]) => {
      if (launches.length === 0) {
        return;
      }
      setQueue((current) => {
        const existing = new Set(current.map((launch) => launch.id));
        return [
          ...current,
          ...launches.filter((launch) => !existing.has(launch.id)),
        ];
      });
    },
    [],
  );

  const drainPendingLaunches = useCallback(async () => {
    try {
      enqueueLaunches(await takePendingExternalSshLaunches());
    } catch (nextError) {
      const message = formatExternalSshLaunchError(nextError);
      setError(message);
      setNotice({ message });
    }
  }, [enqueueLaunches]);

  const openAndAckLaunch = useCallback(
    async (launch: ExternalSshLaunchResolvedRequest) => {
      processingLaunchIdRef.current = launch.id;
      setBusy(true);
      setError(null);
      setFailedLaunch(null);
      setNotice(null);
      try {
        const materialized = await materializeExternalSshLaunch({
          launchId: launch.id,
          username: launch.target.username,
        });
        openExternalSshLaunch(
          applyExternalSshLaunchMaterializedTarget(launch, materialized),
        );
        await ackExternalSshLaunch(launch.id);
      } catch (nextError) {
        const message = formatExternalSshLaunchError(nextError);
        setError(message);
        setFailedLaunch({ launch, message });
      } finally {
        processingLaunchIdRef.current = null;
        setBusy(false);
      }
    },
    [openExternalSshLaunch],
  );

  useEffect(() => {
    void drainPendingLaunches();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenExternalSshLaunches((payload) => {
      if (payload.kind === "queued") {
        void drainPendingLaunches();
      } else if (payload.message) {
        setError(payload.message);
        setNotice({ message: payload.message });
      }
    }).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten();
        return;
      }
      unlisten = nextUnlisten;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [drainPendingLaunches]);

  useEffect(() => {
    if (
      busy ||
      resolutionLaunch ||
      queue.length === 0 ||
      processingLaunchIdRef.current
    ) {
      return;
    }
    const nextLaunch = queue[0];
    if (!nextLaunch) {
      return;
    }
    setQueue(queue.slice(1));
    setError(null);
    setFailedLaunch(null);
    setNotice(null);
    if (externalSshLaunchNeedsUsername(nextLaunch)) {
      setResolutionLaunch(nextLaunch);
      return;
    }
    void openAndAckLaunch(nextLaunch as ExternalSshLaunchResolvedRequest);
  }, [busy, openAndAckLaunch, queue, resolutionLaunch]);

  const cancelResolution = useCallback(async () => {
    if (!resolutionLaunch || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await cancelExternalSshLaunch(resolutionLaunch.id);
      setResolutionLaunch(null);
    } catch (nextError) {
      setError(formatExternalSshLaunchError(nextError));
    } finally {
      setBusy(false);
    }
  }, [busy, resolutionLaunch]);

  const resolveLaunch = useCallback(
    (launch: ExternalSshLaunchResolvedRequest) => {
      setResolutionLaunch(null);
      setNotice(null);
      void openAndAckLaunch(launch);
    },
    [openAndAckLaunch],
  );

  const retryFailedLaunch = useCallback(() => {
    if (!failedLaunch || busy) {
      return;
    }
    const launch = failedLaunch.launch;
    setFailedLaunch(null);
    setNotice(null);
    void openAndAckLaunch(launch);
  }, [busy, failedLaunch, openAndAckLaunch]);

  const cancelFailedLaunch = useCallback(async () => {
    if (!failedLaunch || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await cancelExternalSshLaunch(failedLaunch.launch.id);
      setFailedLaunch(null);
    } catch (nextError) {
      setFailedLaunch({
        ...failedLaunch,
        message: formatExternalSshLaunchError(nextError),
      });
    } finally {
      setBusy(false);
    }
  }, [busy, failedLaunch]);

  return (
    <>
      <ExternalLaunchResolutionDialog
        busy={busy}
        error={resolutionLaunch ? error : null}
        launch={resolutionLaunch}
        onCancel={() => void cancelResolution()}
        onResolve={resolveLaunch}
        open={Boolean(resolutionLaunch)}
      />
      <ExternalLaunchFailureDialog
        busy={busy}
        failure={failedLaunch}
        onCancel={() => void cancelFailedLaunch()}
        onRetry={retryFailedLaunch}
      />
      <ExternalLaunchNoticeDialog
        notice={notice}
        onClose={() => setNotice(null)}
      />
    </>
  );
}

function ExternalLaunchNoticeDialog({
  notice,
  onClose,
}: {
  notice: ExternalLaunchNotice | null;
  onClose: () => void;
}) {
  if (!notice) {
    return null;
  }

  return (
    <ModalShell
      footer={
        <Button onClick={onClose} size="sm" type="button">
          知道了
        </Button>
      }
      maxWidthClassName="max-w-lg"
      onClose={onClose}
      open
      size="small"
      title="外部 SSH 启动未接收"
    >
      <div className="flex gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-field)] p-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500 dark:text-amber-300" />
        <p className="min-w-0 text-sm leading-5 text-zinc-700 dark:text-zinc-200">
          {notice.message}
        </p>
      </div>
    </ModalShell>
  );
}

function ExternalLaunchFailureDialog({
  busy,
  failure,
  onCancel,
  onRetry,
}: {
  busy: boolean;
  failure: ExternalLaunchFailure | null;
  onCancel: () => void;
  onRetry: () => void;
}) {
  if (!failure) {
    return null;
  }
  const { launch, message } = failure;
  const description = `${externalSshLaunchSourceLabel(launch)} · ${launch.target.username}@${launch.target.host}:${launch.target.port}`;

  return (
    <ModalShell
      description={description}
      footer={
        <>
          <Button disabled={busy} onClick={onCancel} size="sm" variant="ghost">
            取消该请求
          </Button>
          <Button disabled={busy} onClick={onRetry} size="sm" type="button">
            重试
          </Button>
        </>
      }
      maxWidthClassName="max-w-lg"
      onClose={onCancel}
      open
      size="small"
      title="外部 SSH 启动失败"
    >
      <div className="flex gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-field)] p-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500 dark:text-amber-300" />
        <p className="min-w-0 text-sm leading-5 text-zinc-700 dark:text-zinc-200">
          {message}
        </p>
      </div>
    </ModalShell>
  );
}
