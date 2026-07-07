import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  listSftpTransfers,
  type SftpTransferSummary,
} from "../../../lib/sftpApi";
import { replaceTransferQueue } from "../sftpTransferModel";
import { dockerContainerTransferHostId } from "./sftpDockerDirectTransferModel";
import { isRunningInTauriWebview } from "./sftpDragDropModel";
import {
  filterSftpTransfersForHost,
  mergeSftpTransferUpdateForHost,
  resolveSftpTransferCompletionEffects,
} from "./sftpTransferSyncModel";
import { SFTP_TRANSFER_UPDATED_EVENT, type SftpFileTarget } from "./types";

interface UseSftpTransferSyncOptions {
  active: boolean;
  currentPath: string;
  fileTarget: SftpFileTarget | null;
  loadDirectory: (path: string) => Promise<void>;
  viewScope?: string | null;
}

export function useSftpTransferSync({
  active,
  currentPath,
  fileTarget,
  loadDirectory,
  viewScope,
}: UseSftpTransferSyncOptions) {
  const [transfers, setTransfers] = useState<SftpTransferSummary[]>([]);
  const completedTransferIdsRef = useRef(new Set<string>());
  const syncHostId = fileTarget?.kind === "ssh" ? fileTarget.hostId : undefined;
  const visibleHostId =
    fileTarget?.kind === "ssh"
      ? fileTarget.hostId
      : fileTarget?.kind === "dockerContainer"
        ? dockerContainerTransferHostId(fileTarget)
        : undefined;

  const visibleTransfers = useMemo(
    () => filterSftpTransfersForHost(transfers, visibleHostId, viewScope),
    [transfers, viewScope, visibleHostId],
  );

  const refreshTransfers = useCallback(async () => {
    if (!active) {
      setTransfers([]);
      return;
    }
    if (!syncHostId) {
      return;
    }
    const nextTransfers = await listSftpTransfers(
      viewScope === undefined ? undefined : { viewScope },
    );
    setTransfers(replaceTransferQueue(nextTransfers));
  }, [active, syncHostId, viewScope]);

  useEffect(() => {
    completedTransferIdsRef.current.clear();
    setTransfers([]);
  }, [viewScope, visibleHostId]);

  useEffect(() => {
    if (!active) {
      setTransfers([]);
      return undefined;
    }
    if (!syncHostId) {
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
        }
      } catch {
        if (!disposed) {
          setTransfers([]);
        }
      }
    };

    void loadTransfers();
    const intervalId = window.setInterval(loadTransfers, 900);
    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [active, syncHostId, viewScope]);

  useEffect(() => {
    if (!active || !syncHostId || !isRunningInTauriWebview()) {
      return undefined;
    }

    let disposed = false;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<SftpTransferSummary>(SFTP_TRANSFER_UPDATED_EVENT, (event) => {
          if (disposed) {
            return;
          }
          setTransfers((current) =>
            mergeSftpTransferUpdateForHost({
              hostId: syncHostId,
              transfer: event.payload,
              transfers: current,
              viewScope,
            }),
          );
        }),
      )
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
      })
      .catch(() => {
        // Polling remains the fallback when the Tauri event channel is unavailable.
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [active, syncHostId, viewScope]);

  useEffect(() => {
    const effects = resolveSftpTransferCompletionEffects({
      completedTransferIds: completedTransferIdsRef.current,
      currentPath,
      transfers: visibleTransfers,
    });
    completedTransferIdsRef.current = effects.completedTransferIds;
    if (effects.reloadPath) {
      void loadDirectory(effects.reloadPath);
    }
  }, [currentPath, loadDirectory, visibleTransfers]);

  return {
    refreshTransfers,
    setTransfers,
    transfers,
    visibleTransfers,
  };
}
