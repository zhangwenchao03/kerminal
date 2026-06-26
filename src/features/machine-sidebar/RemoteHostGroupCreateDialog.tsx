import { useEffect, useRef, useState, type FormEvent } from "react";
import { FolderPlus } from "lucide-react";
import { Button } from "../../components/ui/button";
import { ModalShell } from "../../components/ui/modal-shell";
import type {
  RemoteHostGroup,
  RemoteHostGroupCreateRequest,
  RemoteHostGroupUpdateRequest,
} from "../../lib/remoteHostApi";
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
    setSaving(false);
  }, [group?.id, group?.title, groupTargetKey, open]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (group && externalConfigConflict) {
      setError(externalConfigConflict);
      return;
    }
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("请输入分组名称。");
      return;
    }

    setSaving(true);
    setError(null);
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
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      description="整理主机分组。"
      onClose={onClose}
      open={open}
      size="small"
      title={group ? "重命名分组" : "新建分组"}
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="kerminal-solid-surface rounded-2xl border p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <FolderPlus className="h-4 w-4 text-sky-500 dark:text-sky-300" />
            分组信息
          </div>
          <label className="mt-4 block">
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
            <p className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">
              {error}
            </p>
          ) : null}
          {externalConfigConflict ? (
            <p
              className="mt-3 rounded-xl border border-amber-300/25 bg-amber-400/10 px-3 py-2 font-mono text-xs text-amber-800 dark:border-amber-300/20 dark:bg-amber-400/10 dark:text-amber-100"
              role="alert"
            >
              {externalConfigConflict}
            </p>
          ) : null}
        </div>

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
