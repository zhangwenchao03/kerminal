import {
  useCallback,
  type Dispatch,
  type DragEvent as ReactDragEvent,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { SftpEntry } from "../../../lib/sftpApi";
import { buildRemoteDownloadDragStartPlan } from "./sftpRemoteTransferModel";

type UseSftpRemoteDownloadDragActionsArgs = {
  downloadEntriesToLocalTarget: (
    entriesToDownload: SftpEntry[],
    emptyMessage: string,
  ) => Promise<void>;
  remoteDragEntriesRef: MutableRefObject<SftpEntry[]>;
  selectedEntryPaths: ReadonlySet<string>;
  setRemoteDownloadDragActive: Dispatch<SetStateAction<boolean>>;
  setRemoteDownloadDropActive: Dispatch<SetStateAction<boolean>>;
  setSelectedEntryPath: Dispatch<SetStateAction<string | null>>;
  setSelectedEntryPaths: Dispatch<SetStateAction<Set<string>>>;
  sourceHostId?: string;
  sourceHostLabel?: string;
  transferableSelectedEntries: SftpEntry[];
};

export function useSftpRemoteDownloadDragActions({
  downloadEntriesToLocalTarget,
  remoteDragEntriesRef,
  selectedEntryPaths,
  setRemoteDownloadDragActive,
  setRemoteDownloadDropActive,
  setSelectedEntryPath,
  setSelectedEntryPaths,
  sourceHostId,
  sourceHostLabel,
  transferableSelectedEntries,
}: UseSftpRemoteDownloadDragActionsArgs) {
  const startRemoteEntryDrag = useCallback(
    (event: ReactDragEvent<HTMLElement>, entry: SftpEntry) => {
      const plan = buildRemoteDownloadDragStartPlan({
        entry,
        selectedEntryPaths,
        sourceHostId,
        sourceHostLabel,
        transferableSelectedEntries,
      });
      if (!plan) {
        event.preventDefault();
        return;
      }

      if (plan.selectOnlyEntryPath) {
        setSelectedEntryPath(plan.selectOnlyEntryPath);
        setSelectedEntryPaths(new Set([plan.selectOnlyEntryPath]));
      }

      remoteDragEntriesRef.current = plan.entriesToDrag;
      event.dataTransfer.effectAllowed = "copy";
      for (const item of plan.dataTransferItems) {
        event.dataTransfer.setData(item.type, item.value);
      }
      setRemoteDownloadDragActive(true);
      setRemoteDownloadDropActive(false);
    },
    [
      remoteDragEntriesRef,
      selectedEntryPaths,
      setRemoteDownloadDragActive,
      setRemoteDownloadDropActive,
      setSelectedEntryPath,
      setSelectedEntryPaths,
      sourceHostId,
      sourceHostLabel,
      transferableSelectedEntries,
    ],
  );

  const finishRemoteEntryDrag = useCallback(() => {
    remoteDragEntriesRef.current = [];
    setRemoteDownloadDragActive(false);
    setRemoteDownloadDropActive(false);
  }, [
    remoteDragEntriesRef,
    setRemoteDownloadDragActive,
    setRemoteDownloadDropActive,
  ]);

  const handleRemoteDownloadDragEnter = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      if (remoteDragEntriesRef.current.length === 0) {
        return;
      }
      event.preventDefault();
      setRemoteDownloadDropActive(true);
    },
    [remoteDragEntriesRef, setRemoteDownloadDropActive],
  );

  const handleRemoteDownloadDragOver = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      if (remoteDragEntriesRef.current.length === 0) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setRemoteDownloadDropActive(true);
    },
    [remoteDragEntriesRef, setRemoteDownloadDropActive],
  );

  const handleRemoteDownloadDragLeave = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      const nextTarget = event.relatedTarget;
      if (
        nextTarget instanceof Node &&
        event.currentTarget.contains(nextTarget)
      ) {
        return;
      }
      setRemoteDownloadDropActive(false);
    },
    [setRemoteDownloadDropActive],
  );

  const handleRemoteDownloadDrop = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      const entriesToDownload = remoteDragEntriesRef.current;
      if (entriesToDownload.length === 0) {
        return;
      }
      event.preventDefault();
      remoteDragEntriesRef.current = [];
      setRemoteDownloadDragActive(false);
      setRemoteDownloadDropActive(false);
      void downloadEntriesToLocalTarget(
        entriesToDownload,
        "请先拖拽可下载的远程项目。",
      );
    },
    [
      downloadEntriesToLocalTarget,
      remoteDragEntriesRef,
      setRemoteDownloadDragActive,
      setRemoteDownloadDropActive,
    ],
  );

  return {
    finishRemoteEntryDrag,
    handleRemoteDownloadDragEnter,
    handleRemoteDownloadDragLeave,
    handleRemoteDownloadDragOver,
    handleRemoteDownloadDrop,
    startRemoteEntryDrag,
  };
}
