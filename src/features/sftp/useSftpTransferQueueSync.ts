/**
 * SFTP transfer queue sync facade.
 *
 * @author kongweiguang
 */

import { isTauri } from "@tauri-apps/api/core";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  listSftpTransfers,
  type SftpTransferSummary,
} from "../../lib/sftpApi";
import { sftpTransferMatchesViewScope } from "./sftp-tool-content/sftpTransferSyncModel";
import { mergeTransferSnapshot, replaceTransferQueue } from "./sftpTransferModel";

const SFTP_TRANSFER_UPDATED_EVENT = "sftp-transfer-updated";
const DEFAULT_POLL_INTERVAL_MS = 900;
const DEFAULT_EVENT_HEALTHY_POLL_INTERVAL_MS = 10_000;
const DEFAULT_EVENT_HEALTH_WINDOW_MS = 30_000;
const DEFAULT_HIDDEN_POLL_INTERVAL_MS = 10_000;

export type VisibilityChangeSubscriber = (onChange: () => void) => () => void;

export type SftpTransferUpdateListener = (
  onUpdate: (transfer: SftpTransferSummary) => void,
) => Promise<() => void>;

export interface UseSftpTransferQueueSyncOptions {
  active: boolean;
  eventChannelAvailable?: () => boolean;
  documentVisible?: () => boolean;
  eventHealthyPollIntervalMs?: number;
  eventHealthWindowMs?: number;
  hiddenPollIntervalMs?: number;
  listenToUpdates?: SftpTransferUpdateListener;
  pollIntervalMs?: number;
  subscribeToVisibilityChange?: VisibilityChangeSubscriber;
  viewScope?: string | null;
}

export interface SftpTransferQueueSyncState {
  clearQueueError: () => void;
  queueError: string | null;
  refreshTransfers: () => Promise<void>;
  setQueueError: Dispatch<SetStateAction<string | null>>;
  setTransfers: Dispatch<SetStateAction<SftpTransferSummary[]>>;
  transfers: SftpTransferSummary[];
}

const defaultEventChannelAvailable = () => isTauri();
const defaultDocumentVisible = () =>
  typeof document === "undefined" || document.visibilityState === "visible";
const defaultSubscribeToVisibilityChange: VisibilityChangeSubscriber = (
  onChange,
) => {
  if (typeof document === "undefined") {
    return () => {};
  }
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
};

const defaultListenToUpdates: SftpTransferUpdateListener = async (onUpdate) => {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<SftpTransferSummary>(SFTP_TRANSFER_UPDATED_EVENT, (event) => {
    onUpdate(event.payload);
  });
};

export function useSftpTransferQueueSync({
  active,
  documentVisible = defaultDocumentVisible,
  eventHealthyPollIntervalMs = DEFAULT_EVENT_HEALTHY_POLL_INTERVAL_MS,
  eventHealthWindowMs = DEFAULT_EVENT_HEALTH_WINDOW_MS,
  eventChannelAvailable = defaultEventChannelAvailable,
  hiddenPollIntervalMs = DEFAULT_HIDDEN_POLL_INTERVAL_MS,
  listenToUpdates = defaultListenToUpdates,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  subscribeToVisibilityChange = defaultSubscribeToVisibilityChange,
  viewScope,
}: UseSftpTransferQueueSyncOptions): SftpTransferQueueSyncState {
  const [transfers, setTransfers] = useState<SftpTransferSummary[]>([]);
  const [queueError, setQueueError] = useState<string | null>(null);
  const lastEventAtRef = useRef<number | null>(null);
  const reschedulePollRef = useRef<(() => void) | null>(null);

  const clearQueueError = useCallback(() => {
    setQueueError(null);
  }, []);

  const refreshTransfers = useCallback(async () => {
    if (!active) {
      return;
    }

    try {
      setTransfers(replaceTransferQueue(await listSftpTransfers(
        viewScope === undefined ? undefined : { viewScope },
      )));
      setQueueError(null);
    } catch (error) {
      setQueueError(errorMessage(error));
    }
  }, [active, viewScope]);

  useEffect(() => {
    if (!active) {
      return undefined;
    }

    let disposed = false;
    let pollInFlight = false;
    let timeoutId: number | undefined;
    lastEventAtRef.current = null;
    const loadTransfers = async () => {
      try {
        const nextTransfers = await listSftpTransfers(
          viewScope === undefined ? undefined : { viewScope },
        );
        if (!disposed) {
          setTransfers(replaceTransferQueue(nextTransfers));
          setQueueError(null);
        }
      } catch (error) {
        if (!disposed) {
          setQueueError(errorMessage(error));
        }
      }
    };

    const clearNextPoll = () => {
      if (timeoutId === undefined) {
        return;
      }
      window.clearTimeout(timeoutId);
      timeoutId = undefined;
    };
    const nextPollDelay = () =>
      sftpTransferQueuePollDelay({
        documentVisible: documentVisible(),
        eventChannelHealthy:
          eventChannelAvailable() &&
          sftpTransferEventChannelHealthy({
            eventHealthWindowMs,
            lastEventAt: lastEventAtRef.current,
            now: Date.now(),
          }),
        eventHealthyPollIntervalMs,
        hiddenPollIntervalMs,
        pollIntervalMs,
      });
    const scheduleNextPoll = () => {
      if (disposed) {
        return;
      }
      clearNextPoll();
      timeoutId = window.setTimeout(() => {
        timeoutId = undefined;
        void runPoll();
      }, nextPollDelay());
    };
    const runPoll = async () => {
      if (pollInFlight) {
        return;
      }
      pollInFlight = true;
      try {
        await loadTransfers();
      } finally {
        pollInFlight = false;
        scheduleNextPoll();
      }
    };
    const handleVisibilityChange = () => {
      clearNextPoll();
      if (documentVisible()) {
        void runPoll();
      } else {
        scheduleNextPoll();
      }
    };

    reschedulePollRef.current = scheduleNextPoll;
    void runPoll();
    const unsubscribeVisibility =
      subscribeToVisibilityChange(handleVisibilityChange);
    return () => {
      disposed = true;
      clearNextPoll();
      unsubscribeVisibility();
      if (reschedulePollRef.current === scheduleNextPoll) {
        reschedulePollRef.current = null;
      }
    };
  }, [
    active,
    documentVisible,
    eventChannelAvailable,
    eventHealthyPollIntervalMs,
    eventHealthWindowMs,
    hiddenPollIntervalMs,
    pollIntervalMs,
    subscribeToVisibilityChange,
    viewScope,
  ]);

  useEffect(() => {
    if (!active || !eventChannelAvailable()) {
      return undefined;
    }

    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenToUpdates((transfer) => {
      if (disposed) {
        return;
      }
      if (!sftpTransferMatchesViewScope(transfer, viewScope)) {
        return;
      }
      lastEventAtRef.current = Date.now();
      setTransfers((current) => mergeTransferSnapshot(current, transfer));
      reschedulePollRef.current?.();
    })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
      })
      .catch(() => {
        // Polling remains the fallback outside the Tauri event channel.
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [active, eventChannelAvailable, listenToUpdates, viewScope]);

  return {
    clearQueueError,
    queueError,
    refreshTransfers,
    setQueueError,
    setTransfers,
    transfers,
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function sftpTransferEventChannelHealthy({
  eventHealthWindowMs,
  lastEventAt,
  now,
}: {
  eventHealthWindowMs: number;
  lastEventAt: number | null;
  now: number;
}) {
  return (
    lastEventAt !== null &&
    eventHealthWindowMs > 0 &&
    now - lastEventAt <= eventHealthWindowMs
  );
}

export function sftpTransferQueuePollDelay({
  documentVisible,
  eventChannelHealthy,
  eventHealthyPollIntervalMs,
  hiddenPollIntervalMs,
  pollIntervalMs,
}: {
  documentVisible: boolean;
  eventChannelHealthy: boolean;
  eventHealthyPollIntervalMs: number;
  hiddenPollIntervalMs: number;
  pollIntervalMs: number;
}) {
  const fallbackDelay = Math.max(1, pollIntervalMs);
  const visibleDelay = eventChannelHealthy
    ? Math.max(fallbackDelay, eventHealthyPollIntervalMs)
    : fallbackDelay;

  return documentVisible
    ? visibleDelay
    : Math.max(visibleDelay, hiddenPollIntervalMs);
}
