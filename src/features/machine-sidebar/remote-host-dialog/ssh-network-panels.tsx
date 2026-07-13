import { useState } from "react";
import { Cable, Plus } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Select } from "../../../components/ui/select";
import type {
  SshOptions,
  SshProxyProtocol,
  SshTunnelKind,
  SshTunnelOptions,
} from "../../../lib/remoteHostApi";
import { proxyProtocolOptions, tunnelKindOptions } from "./model";
import {
  moveAt,
  normalizeTunnelDraft,
  optionalNumber,
  removeAt,
} from "./request-builders";
import {
  ConfigList,
  ConfigListItem,
  EmptyConfigState,
  FieldRow,
  inputClassName,
  ListReorderActions,
} from "./shared-ui";

export type SshOptionsSetter = (
  next: SshOptions | ((current: SshOptions) => SshOptions),
) => void;

export function SshProxyPanel({
  options,
  setOptions,
}: {
  options: SshOptions;
  setOptions: SshOptionsSetter;
}) {
  const proxy = options.proxy;
  const disabled = proxy.protocol === "none";
  const updateProxy = (nextProxy: Partial<SshOptions["proxy"]>) => {
    setOptions((current) => ({
      ...current,
      proxy: {
        ...current.proxy,
        ...nextProxy,
      },
    }));
  };

  return (
    <div className="grid gap-3">
      <FieldRow label="协议">
        <Select
          aria-label="代理协议"
          buttonClassName="h-9"
          onValueChange={(value) => {
            const protocol = value as SshProxyProtocol;
            updateProxy(
              protocol === "none"
                ? {
                    credentialRef: undefined,
                    host: undefined,
                    port: undefined,
                    protocol,
                    username: undefined,
                  }
                : {
                    protocol,
                    port: proxy.port ?? (protocol === "http" ? 8080 : 1080),
                  },
            );
          }}
          options={proxyProtocolOptions}
          value={proxy.protocol}
        />
      </FieldRow>
      <FieldRow label="主机">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_136px]">
          <input
            aria-label="代理主机"
            className={inputClassName}
            disabled={disabled}
            onChange={(event) => updateProxy({ host: event.currentTarget.value })}
            placeholder="proxy.internal"
            value={proxy.host ?? ""}
          />
          <input
            aria-label="代理端口"
            className={inputClassName}
            disabled={disabled}
            inputMode="numeric"
            onChange={(event) =>
              updateProxy({ port: optionalNumber(event.currentTarget.value) })
            }
            value={proxy.port ?? ""}
          />
        </div>
      </FieldRow>
      <FieldRow label="用户名">
        <input
          aria-label="代理用户名"
          className={inputClassName}
          disabled={disabled}
          onChange={(event) => updateProxy({ username: event.currentTarget.value })}
          placeholder="可选"
          value={proxy.username ?? ""}
        />
      </FieldRow>
    </div>
  );
}

export function SshTunnelPanel({
  options,
  setOptions,
}: {
  options: SshOptions;
  setOptions: SshOptionsSetter;
}) {
  const [draft, setDraft] = useState<SshTunnelOptions>({
    bindHost: "127.0.0.1",
    bindPort: 15432,
    kind: "local",
    name: "",
    targetHost: "127.0.0.1",
    targetPort: 5432,
  });
  const [draftError, setDraftError] = useState<string | null>(null);
  const addTunnel = () => {
    if (!draft.bindPort) {
      setDraftError("监听端口不能为空。");
      return;
    }
    if (draft.kind !== "dynamic" && (!draft.targetHost || !draft.targetPort)) {
      setDraftError("Local/Remote 隧道需要目标主机和端口。");
      return;
    }
    setDraftError(null);
    setOptions((current) => ({
      ...current,
      tunnels: [...current.tunnels, normalizeTunnelDraft(draft)],
    }));
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3">
        <FieldRow label="类型">
          <Select
            aria-label="隧道类型"
            buttonClassName="h-9"
            onValueChange={(value) =>
              setDraft((current) => ({
                ...current,
                kind: value as SshTunnelKind,
              }))
            }
            options={tunnelKindOptions}
            value={draft.kind}
          />
        </FieldRow>
        <FieldRow label="名称">
          <input
            aria-label="隧道名称"
            className={inputClassName}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setDraft((current) => ({ ...current, name: value }));
            }}
            placeholder="可选，例如 PostgreSQL"
            value={draft.name}
          />
        </FieldRow>
        <FieldRow label="监听">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_136px]">
            <input
              aria-label="隧道监听地址"
              className={inputClassName}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setDraft((current) => ({
                  ...current,
                  bindHost: value,
                }));
              }}
              placeholder="127.0.0.1"
              value={draft.bindHost}
            />
            <input
              aria-label="隧道监听端口"
              className={inputClassName}
              inputMode="numeric"
              onChange={(event) => {
                const value = optionalNumber(event.currentTarget.value);
                setDraft((current) => ({
                  ...current,
                  bindPort: value,
                }));
              }}
              value={draft.bindPort ?? ""}
            />
          </div>
        </FieldRow>
        <FieldRow label="目标">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_136px]">
            <input
              aria-label="隧道目标主机"
              className={inputClassName}
              disabled={draft.kind === "dynamic"}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setDraft((current) => ({
                  ...current,
                  targetHost: value,
                }));
              }}
              placeholder="db.internal"
              value={draft.kind === "dynamic" ? "" : draft.targetHost}
            />
            <input
              aria-label="隧道目标端口"
              className={inputClassName}
              disabled={draft.kind === "dynamic"}
              inputMode="numeric"
              onChange={(event) => {
                const value = optionalNumber(event.currentTarget.value);
                setDraft((current) => ({
                  ...current,
                  targetPort: value,
                }));
              }}
              value={draft.kind === "dynamic" ? "" : draft.targetPort ?? ""}
            />
          </div>
        </FieldRow>
        <div className="flex justify-end">
          <Button onClick={addTunnel} type="button" variant="secondary">
            <Plus className="h-4 w-4" />
            添加隧道
          </Button>
        </div>
        {draftError ? (
          <p className="rounded-[var(--radius-control)] border border-red-500/20 bg-red-500/10 px-3 py-2 text-[13px] leading-5 text-red-600 dark:text-red-300">
            {draftError}
          </p>
        ) : null}
      </div>
      <SshTunnelList options={options} setOptions={setOptions} />
    </div>
  );
}

export function SshTunnelList({
  options,
  setOptions,
}: {
  options: SshOptions;
  setOptions: SshOptionsSetter;
}) {
  if (options.tunnels.length === 0) {
    return (
      <EmptyConfigState
        icon={<Cable className="h-5 w-5" />}
        text="暂无隧道。可添加内网、Web 或 SOCKS。"
      />
    );
  }
  return (
    <ConfigList>
      {options.tunnels.map((tunnel, index) => (
        <ConfigListItem
          key={`${tunnel.kind}-${tunnel.bindHost}-${tunnel.bindPort}-${index}`}
          actions={
            <ListReorderActions
              canMoveDown={index < options.tunnels.length - 1}
              canMoveUp={index > 0}
              onDelete={() =>
                setOptions((current) => ({
                  ...current,
                  tunnels: removeAt(current.tunnels, index),
                }))
              }
              onMoveDown={() =>
                setOptions((current) => ({
                  ...current,
                  tunnels: moveAt(current.tunnels, index, index + 1),
                }))
              }
              onMoveUp={() =>
                setOptions((current) => ({
                  ...current,
                  tunnels: moveAt(current.tunnels, index, index - 1),
                }))
              }
            />
          }
          meta={
            tunnel.kind === "dynamic"
              ? `${tunnel.bindHost || "127.0.0.1"}:${tunnel.bindPort} SOCKS`
              : `${tunnel.bindHost || "127.0.0.1"}:${tunnel.bindPort} -> ${tunnel.targetHost}:${tunnel.targetPort}`
          }
          title={`${tunnel.name || "未命名隧道"} · ${tunnel.kind}`}
        />
      ))}
    </ConfigList>
  );
}
