import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { ModalShell } from "../../components/ui/modal-shell";
import { UserFacingNotice } from "../../components/ui/user-facing-notice";
import {
  ackExternalSshLaunch,
  cancelExternalSshLaunch,
  listenExternalSshLaunches,
  materializeExternalSshLaunch,
  takePendingExternalSshLaunches,
  type ExternalSshLaunchRequest,
} from "../../lib/externalLaunchApi";
import {
  buildUserFacingError,
  type UserFacingMessage,
} from "../../lib/userFacingMessage";
import { useWorkspaceStore } from "../workspace/workspaceStore";
import { ExternalLaunchResolutionDialog } from "./ExternalLaunchResolutionDialog";
import {
  applyExternalSshLaunchMaterializedTarget,
  externalSshLaunchNeedsUsername,
  externalSshLaunchSourceLabel,
  type ExternalSshLaunchResolvedRequest,
} from "./externalSshLaunchModel";

interface ExternalLaunchFailure {
  launch: ExternalSshLaunchResolvedRequest;
  message: UserFacingMessage;
}

interface ExternalLaunchNotice {
  message: UserFacingMessage;
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
  const [error, setError] = useState<UserFacingMessage | null>(null);
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
      const message = buildUserFacingError(nextError, {
        detail: "Kerminal 暂时无法读取待处理的外部 SSH 请求。",
        recoveryAction: "请重新发起连接请求。",
        title: "外部 SSH 请求未读取",
      });
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
        const message = buildUserFacingError(nextError, {
          detail: "该请求尚未打开。",
          recoveryAction: "可重试或取消该请求。",
          title: "外部 SSH 启动失败",
        });
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
        const message = buildUserFacingError(payload.message, {
          detail: "启动请求未通过接收校验。",
          recoveryAction: "请检查来源参数后重试。",
          title: "外部 SSH 请求未接收",
        });
        setError(message);
        setNotice({ message });
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
      setError(
        buildUserFacingError(nextError, {
          detail: "该外部 SSH 请求仍在待处理列表中。",
          recoveryAction: "请稍后再次取消。",
          title: "请求未取消",
        }),
      );
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
        message: buildUserFacingError(nextError, {
          detail: "该外部 SSH 请求仍在待处理列表中。",
          recoveryAction: "请稍后再次取消。",
          title: "请求未取消",
        }),
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
      <UserFacingNotice message={notice.message} />
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
      <UserFacingNotice message={message} />
    </ModalShell>
  );
}
