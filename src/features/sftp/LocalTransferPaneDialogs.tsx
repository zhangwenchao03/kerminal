/**
 * 本地传输面板的对话框组。
 *
 * @author kongweiguang
 */

import { PromptDialog } from "../../components/ui/prompt-dialog";
import type { LocalDirectoryEntry } from "../../lib/fileDialogApi";
import type { SftpTransferConflictPolicy } from "../../lib/sftpApi";
import { LocalDeleteConfirmDialog } from "./LocalDeleteConfirmDialog";
import { LocalRenameDialog } from "./LocalRenameDialog";
import { SftpTransferConflictDialog } from "./SftpTransferConflictDialog";

export function LocalTransferPaneDialogs({
  busy,
  createDirectoryDialogOpen,
  createDirectoryNameDraft,
  deleteEntry,
  listingPath,
  onCloseCreateDirectory,
  onCloseDelete,
  onCloseRename,
  onCloseTransferConflict,
  onConfirmCreateDirectory,
  onConfirmDelete,
  onConfirmRename,
  onConfirmTransferConflictPolicy,
  onCreateDirectoryNameDraftChange,
  pendingConflictCount,
  pendingConflictOpen,
  renameEntry,
}: {
  busy: boolean;
  createDirectoryDialogOpen: boolean;
  createDirectoryNameDraft: string;
  deleteEntry: LocalDirectoryEntry | null;
  listingPath: string | undefined;
  onCloseCreateDirectory: () => void;
  onCloseDelete: () => void;
  onCloseRename: () => void;
  onCloseTransferConflict: () => void;
  onConfirmCreateDirectory: (name: string) => void;
  onConfirmDelete: (confirmName: string) => void;
  onConfirmRename: (name: string) => void;
  onConfirmTransferConflictPolicy: (policy: SftpTransferConflictPolicy) => void;
  onCreateDirectoryNameDraftChange: (value: string) => void;
  pendingConflictCount: number;
  pendingConflictOpen: boolean;
  renameEntry: LocalDirectoryEntry | null;
}) {
  return (
    <>
      <LocalDeleteConfirmDialog
        busy={busy}
        entry={deleteEntry}
        onClose={onCloseDelete}
        onConfirm={onConfirmDelete}
      />
      <PromptDialog
        busy={busy}
        confirmLabel="创建"
        description={listingPath}
        inputLabel="文件夹名称"
        onClose={onCloseCreateDirectory}
        onConfirm={onConfirmCreateDirectory}
        onValueChange={onCreateDirectoryNameDraftChange}
        open={createDirectoryDialogOpen && Boolean(listingPath)}
        placeholder="new-folder"
        title="新建文件夹"
        validate={(value) => (value.trim() ? null : "请填写文件夹名称。")}
        value={createDirectoryNameDraft}
      />
      <LocalRenameDialog
        busy={busy}
        entry={renameEntry}
        onClose={onCloseRename}
        onConfirm={onConfirmRename}
      />
      <SftpTransferConflictDialog
        conflictCount={pendingConflictCount}
        onClose={onCloseTransferConflict}
        onConfirm={onConfirmTransferConflictPolicy}
        open={pendingConflictOpen}
      />
    </>
  );
}
