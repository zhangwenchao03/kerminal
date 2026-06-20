import { useEffect, useState, type FormEvent } from "react";
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

  useEffect(() => {
    if (open) {
      setName(group?.title ?? "");
      setError(null);
      setSaving(false);
    }
  }, [group, open]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
      description="用于整理 SSH 主机列表，例如实验室、云服务器、客户环境。"
      maxWidthClassName="max-w-lg"
      onClose={onClose}
      open={open}
      title={group ? "重命名分组" : "新建分组"}
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="rounded-2xl border border-black/8 bg-black/[0.03] p-4 dark:border-white/8 dark:bg-white/6">
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
              className="mt-1 h-9 w-full rounded-xl border border-black/10 bg-white/86 px-3 text-sm outline-none transition focus:border-sky-500/50 focus:ring-4 focus:ring-sky-500/15 dark:border-white/10 dark:bg-black/20"
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
        </div>

        <div className="flex justify-end gap-2">
          <Button onClick={onClose} type="button" variant="ghost">
            取消
          </Button>
          <Button disabled={saving} type="submit" variant="primary">
            {saving ? "保存中..." : group ? "保存分组" : "创建分组"}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}
