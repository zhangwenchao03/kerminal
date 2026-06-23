/**
 * SFTP transfer queue sync facade.
 *
 * @author kongweiguang
 */

import { isTauri } from "@tauri-apps/api/core";
import {
  useCallback,
  useEffect,
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

export type SftpTransferUpdateListener = (
  onUpdate: (transfer: SftpTransferSummary) => void,
) => Promise<() => void>;

export interface UseSftpTransferQueueSyncOptions {
  active: boolean;
  eventChannelAvailable?: () => boolean;
  listenToUpdates?: SftpTransferUpdateListener;
  pollIntervalMs?: number;
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

const defaultListenToUpdates: SftpTransferUpdateListener = async (onUpdate) => {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<SftpTransferSummary>(SFTP_TRANSFER_UPDATED_EVENT, (event) => {
    onUpdate(event.payload);
  });
};

export function useSftpTransferQueueSync({
  active,
  eventChannelAvailable = defaultEventChannelAvailable,
  listenToUpdates = defaultListenToUpdates,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  viewScope,
}: UseSftpTransferQueueSyncOptions): SftpTransferQueueSyncState {
  const [transfers, setTransfers] = useState<SftpTransferSummary[]>([]);
  const [queueError, setQueueError] = useState<string | null>(null);

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

    void loadTransfers();
    const intervalId = window.setInterval(loadTransfers, pollIntervalMs);
    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [active, pollIntervalMs, viewScope]);

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
      setTransfers((current) => mergeTransferSnapshot(current, transfer));
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
