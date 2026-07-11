import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "../../components/ui/button";
import { ModalShell } from "../../components/ui/modal-shell";
import { UserFacingNotice } from "../../components/ui/user-facing-notice";
import type {
  RemoteHostGroup,
  RemoteHostGroupCreateRequest,
  RemoteHostGroupUpdateRequest,
} from "../../lib/remoteHostApi";
import {
  buildUserFacingError,
  type UserFacingMessage,
} from "../../lib/userFacingMessage";
import type { MachineGroup } from "../workspace/types";

interface RemoteHostGroupCreateDialogProps {
  externalConfigConflict?: string;
  group?: MachineGroup;
  open: boolean;
  onClose: () => void;
  onCreateGroup: (
    request: RemoteHostGroupCreateRequest,
  ) => Promise<RemoteHostGroup>;
  onUpdateGroup?: (
    request: RemoteHostGroupUpdateRequest,
  ) => Promise<RemoteHostGroup>;
  onCreated?: (group: RemoteHostGroup) => void | Promise<void>;
}

export function RemoteHostGroupCreateDialog({
  externalConfigConflict,
  group,
  onClose,
  onCreateGroup,
  onUpdateGroup,
  onCreated,
  open,
}: RemoteHostGroupCreateDialogProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [operationError, setOperationError] =
    useState<UserFacingMessage | null>(null);
  const [saving, setSaving] = useState(false);
  const initializedGroupTargetRef = useRef<string | null>(null);
  const groupTargetKey = group?.id ?? "__create__";

  useEffect(() => {
    if (!open) {
      initializedGroupTargetRef.current = null;
      return;
    }
    if (initializedGroupTargetRef.current === groupTargetKey) {
      return;
    }
    initializedGroupTargetRef.current = groupTargetKey;
    setName(group?.title ?? "");
    setError(null);
    setOperationError(null);
    setSaving(false);
  }, [group?.id, group?.title, groupTargetKey, open]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (group && externalConfigConflict) {
      return;
    }
    const trimmedName = name.trim();
    if (!trimmedName) {
      setOperationError(null);
      setError("请输入分组名称。");
      return;
    }

    setSaving(true);
    setError(null);
    setOperationError(null);
    try {
      const savedGroup =
        group && onUpdateGroup
          ? await onUpdateGroup({
              id: group.id,
              name: trimmedName,
              sortOrder: group.sortOrder ?? 0,
            })
          : await onCreateGroup({ name: trimmedName });
      await onCreated?.(savedGroup);
      onClose();
    } catch (caught) {
      setOperationError(
        buildUserFacingError(caught, {
          detail: group ? "分组名称尚未更新。" : "新分组尚未保存。",
          recoveryAction: "请检查名称后重试。",
          title: group ? "分组未重命名" : "分组未创建",
        }),
      );
    } finally {
      setSaving(false);
    }
  };
  const conflictNotice = externalConfigConflict
    ? buildUserFacingError(externalConfigConflict, {
        detail: "当前名称草稿已保留，但不能覆盖外部修改。",
        recoveryAction: "请关闭并重新打开分组后再编辑。",
        severity: "warning",
        title: "分组已在外部更新",
      })
    : null;

  return (
    <ModalShell
      onClose={onClose}
      open={open}
      size="small"
      title={group ? "重命名分组" : "新建分组"}
    >
      <form className="space-y-4" onSubmit={submit}>
        <label className="block">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            分组名称
          </span>
          <input
            autoFocus
            className="kerminal-field-surface mt-1 h-9 w-full rounded-xl border px-3 text-sm"
            onChange={(event) => setName(event.currentTarget.value)}
            placeholder="例如：开发环境"
            value={name}
          />
        </label>
        {error ? (
          <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">
            {error}
          </p>
        ) : null}
        {operationError ? (
          <UserFacingNotice compact message={operationError} />
        ) : null}
        {conflictNotice ? (
          <UserFacingNotice compact message={conflictNotice} />
        ) : null}

        <div className="flex justify-end gap-2">
          <Button onClick={onClose} type="button" variant="ghost">
            取消
          </Button>
          <Button
            disabled={saving || Boolean(externalConfigConflict)}
            type="submit"
            variant="primary"
          >
            {saving ? "保存中..." : group ? "保存分组" : "创建分组"}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}
