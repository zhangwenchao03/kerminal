import { useMemo, useState } from "react";
import { Network, Plus } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Select, type SelectOption } from "../../../components/ui/select";
import type {
  RemoteHostAuthType,
  SshJumpHostOptions,
  SshOptions,
} from "../../../lib/remoteHostApi";
import type { Machine } from "../../workspace/types";
import { authOptions } from "./model";
import {
  moveAt,
  normalizeJumpHostDraft,
  optionalNumber,
  removeAt,
  trimOptional,
  trimText,
} from "./request-builders";
import type { SshOptionsSetter } from "./ssh-network-panels";
import {
  ConfigList,
  ConfigListItem,
  EmptyConfigState,
  FieldRow,
  inputClassName,
  ListReorderActions,
} from "./shared-ui";

export function SshJumpPanel({
  options,
  setOptions,
  sshMachines,
}: {
  options: SshOptions;
  setOptions: SshOptionsSetter;
  sshMachines: Machine[];
}) {
  const [draft, setDraft] = useState<SshJumpHostOptions>({
    authType: "agent",
    credentialRef: undefined,
    host: "",
    name: "",
    port: 22,
    username: "",
  });
  const [draftError, setDraftError] = useState<string | null>(null);
  const [selectedHostId, setSelectedHostId] = useState("");
  const existingHostOptions = useMemo<SelectOption[]>(
    () => [
      { label: "手动填写", value: "" },
      ...sshMachines.map((machine) => ({
        description: formatSshMachineDescription(machine),
        label: machine.name,
        value: machine.id,
      })),
    ],
    [sshMachines],
  );
  const selectExistingHost = (hostId: string) => {
    setSelectedHostId(hostId);
    if (!hostId) {
      return;
    }
    const selectedHost = sshMachines.find((machine) => machine.id === hostId);
    if (!selectedHost) {
      return;
    }
    setDraft(jumpHostDraftFromMachine(selectedHost));
    setDraftError(null);
  };
  const updateDraft = (nextDraft: Partial<SshJumpHostOptions>) => {
    setSelectedHostId("");
    setDraft((current) => ({ ...current, ...nextDraft }));
  };
  const addJumpHost = () => {
    if (!draft.host.trim()) {
      setDraftError("跳板机主机不能为空。");
      return;
    }
    if (!draft.username.trim()) {
      setDraftError("跳板机用户名不能为空。");
      return;
    }
    setDraftError(null);
    setOptions((current) => ({
      ...current,
      jumpHosts: [...current.jumpHosts, normalizeJumpHostDraft(draft)],
    }));
    setDraft({
      authType: "agent",
      credentialRef: undefined,
      host: "",
      name: "",
      port: 22,
      username: "",
    });
    setSelectedHostId("");
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3">
        <FieldRow label="已有主机">
          <div className="space-y-1">
            <Select
              aria-label="已有跳板机主机"
              buttonClassName="h-10"
              disabled={sshMachines.length === 0}
              onValueChange={selectExistingHost}
              options={existingHostOptions}
              value={selectedHostId}
            />
            <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
              {sshMachines.length > 0
                ? "选择已有 SSH 主机会自动回填下面的跳板机信息，回填后仍可修改。"
                : "当前没有可选的已有 SSH 主机，可继续手动填写。"}
            </p>
          </div>
        </FieldRow>
        <FieldRow label="名称">
          <input
            aria-label="跳板机名称"
            className={inputClassName}
            onChange={(event) => {
              const value = event.currentTarget.value;
              updateDraft({ name: value });
            }}
            placeholder="可选，例如 bastion"
            value={draft.name}
          />
        </FieldRow>
        <FieldRow label="主机">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_136px]">
            <input
              aria-label="跳板机主机"
              className={inputClassName}
              onChange={(event) => {
                const value = event.currentTarget.value;
                updateDraft({ host: value });
              }}
              placeholder="bastion.internal"
              value={draft.host}
            />
            <input
              aria-label="跳板机端口"
              className={inputClassName}
              inputMode="numeric"
              onChange={(event) => {
                const value = optionalNumber(event.currentTarget.value) ?? 22;
                updateDraft({ port: value });
              }}
              value={draft.port}
            />
          </div>
        </FieldRow>
        <FieldRow label="用户">
          <input
            aria-label="跳板机用户名"
            className={inputClassName}
            onChange={(event) => {
              const value = event.currentTarget.value;
              updateDraft({ username: value });
            }}
            placeholder="ops"
            value={draft.username}
          />
        </FieldRow>
        <FieldRow label="认证">
          <div className="grid gap-3 md:grid-cols-[184px_minmax(0,1fr)]">
            <Select
              aria-label="跳板机认证方式"
              buttonClassName="h-10"
              onValueChange={(value) =>
                updateDraft({ authType: value as RemoteHostAuthType })
              }
              options={authOptions.map((option) => ({
                label: option.label,
                value: option.value,
              }))}
              value={draft.authType}
            />
            <input
              aria-label="跳板机凭据引用"
              className={inputClassName}
              onChange={(event) => {
                const value = event.currentTarget.value;
                updateDraft({ credentialRef: value });
              }}
              placeholder="可选；credential:ssh/bastion/key 或私钥路径"
              value={draft.credentialRef ?? ""}
            />
          </div>
        </FieldRow>
        <div className="flex justify-end">
          <Button onClick={addJumpHost} type="button" variant="secondary">
            <Plus className="h-4 w-4" />
            添加跳板机
          </Button>
        </div>
        {draftError ? (
          <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">
            {draftError}
          </p>
        ) : null}
      </div>
      {options.jumpHosts.length === 0 ? (
        <EmptyConfigState
          icon={<Network className="h-5 w-5" />}
          text="还没有跳板机。多级 SSH 会按列表顺序依次跳转。"
        />
      ) : (
        <ConfigList>
          {options.jumpHosts.map((jumpHost, index) => (
            <ConfigListItem
              key={`${jumpHost.host}-${jumpHost.port}-${index}`}
              actions={
                <ListReorderActions
                  canMoveDown={index < options.jumpHosts.length - 1}
                  canMoveUp={index > 0}
                  onDelete={() =>
                    setOptions((current) => ({
                      ...current,
                      jumpHosts: removeAt(current.jumpHosts, index),
                    }))
                  }
                  onMoveDown={() =>
                    setOptions((current) => ({
                      ...current,
                      jumpHosts: moveAt(current.jumpHosts, index, index + 1),
                    }))
                  }
                  onMoveUp={() =>
                    setOptions((current) => ({
                      ...current,
                      jumpHosts: moveAt(current.jumpHosts, index, index - 1),
                    }))
                  }
                />
              }
              meta={`${jumpHost.username}@${jumpHost.host}:${jumpHost.port} · ${jumpHost.authType}`}
              title={jumpHost.name || jumpHost.host}
            />
          ))}
        </ConfigList>
      )}
    </div>
  );
}

export function formatSshMachineDescription(machine: Machine) {
  const username = trimText(machine.username) || "未设置用户";
  const host = trimText(machine.host) || machine.description;
  const port = machine.port ?? 22;
  return `${username}@${host}:${port}`;
}

export function jumpHostDraftFromMachine(machine: Machine): SshJumpHostOptions {
  return {
    authType: machine.authType ?? "agent",
    credentialRef: trimOptional(machine.credentialRef),
    host: trimText(machine.host),
    name: machine.name,
    port: machine.port ?? 22,
    username: trimText(machine.username),
  };
}
