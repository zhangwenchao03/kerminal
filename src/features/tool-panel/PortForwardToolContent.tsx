import { Network, Plus, Square, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/cn";
import {
  closePortForward,
  createPortForward,
  listPortForwards,
  type PortForwardKind,
  type PortForwardSummary,
} from "../../lib/portForwardApi";
import type { Machine } from "../workspace/types";

interface PortForwardToolContentProps {
  selectedMachine?: Machine;
}

const forwardKindOptions: Array<{
  label: string;
  value: PortForwardKind;
  helper: string;
}> = [
  {
    helper: "本机端口转到远端服务",
    label: "本地 -L",
    value: "local",
  },
  {
    helper: "远端端口转回本机服务",
    label: "远程 -R",
    value: "remote",
  },
  {
    helper: "本机 SOCKS 代理",
    label: "动态 -D",
    value: "dynamic",
  },
];

export function PortForwardToolContent({
  selectedMachine,
}: PortForwardToolContentProps) {
  const [bindHost, setBindHost] = useState("127.0.0.1");
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<PortForwardKind>("local");
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [sessions, setSessions] = useState<PortForwardSummary[]>([]);
  const [sourcePort, setSourcePort] = useState("15432");
  const [targetHost, setTargetHost] = useState("127.0.0.1");
  const [targetPort, setTargetPort] = useState("5432");

  const selectedHostSessions = useMemo(
    () =>
      selectedMachine?.kind === "ssh"
        ? sessions.filter((session) => session.hostId === selectedMachine.id)
        : [],
    [selectedMachine, sessions],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSessions(await listPortForwards());
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!selectedMachine || selectedMachine.kind !== "ssh") {
    return (
      <section className="rounded-2xl border border-white/8 bg-white/6 p-4 text-sm text-zinc-400">
        <h3 className="font-medium text-zinc-100">端口转发</h3>
        <p className="mt-2 leading-6">
          当前终端连接到 SSH 主机后，可以创建本地、远程或动态 SOCKS 转发。
        </p>
      </section>
    );
  }

  async function handleCreate() {
    if (!selectedMachine || selectedMachine.kind !== "ssh") {
      return;
    }
    const parsedSourcePort = Number(sourcePort);
    const parsedTargetPort = Number(targetPort);
    if (!Number.isInteger(parsedSourcePort) || parsedSourcePort <= 0) {
      setError("监听端口必须是大于 0 的整数。");
      return;
    }
    if (
      kind !== "dynamic" &&
      (!Number.isInteger(parsedTargetPort) || parsedTargetPort <= 0)
    ) {
      setError("目标端口必须是大于 0 的整数。");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await createPortForward({
        bindHost,
        hostId: selectedMachine.id,
        kind,
        name,
        sourcePort: parsedSourcePort,
        targetHost: kind === "dynamic" ? undefined : targetHost,
        targetPort: kind === "dynamic" ? undefined : parsedTargetPort,
      });
      setSessions(await listPortForwards());
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setLoading(false);
    }
  }

  async function handleClose(forwardId: string) {
    setLoading(true);
    setError(null);
    try {
      await closePortForward(forwardId);
      setSessions(await listPortForwards());
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="space-y-3">
      <div className="rounded-2xl border border-white/8 bg-white/6 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-medium text-zinc-100">端口转发</h3>
            <p className="mt-1 truncate font-mono text-xs text-zinc-500">
              {selectedMachine.username}@{selectedMachine.host}:{selectedMachine.port}
            </p>
          </div>
          <span
            className={cn(
              "rounded-lg border px-2 py-1 text-xs",
              selectedMachine.production
                ? "border-amber-300/20 bg-amber-400/10 text-amber-200"
                : "border-white/8 bg-black/20 text-zinc-400",
            )}
          >
            {selectedMachine.production ? "生产主机" : "开发主机"}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          {forwardKindOptions.map((option) => (
            <button
              aria-pressed={kind === option.value}
              className={cn(
                "rounded-xl border px-2 py-2 text-left transition",
                kind === option.value
                  ? "border-sky-300/40 bg-sky-400/10 text-sky-100"
                  : "border-white/8 bg-black/20 text-zinc-400 hover:bg-white/8",
              )}
              key={option.value}
              onClick={() => setKind(option.value)}
              type="button"
            >
              <span className="block text-xs font-medium">{option.label}</span>
              <span className="mt-1 block text-[11px] leading-4 text-zinc-500">
                {option.helper}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-3">
          <label className="block text-xs text-zinc-500" htmlFor="forward-name">
            名称
          </label>
          <input
            className="h-9 w-full rounded-xl border border-white/8 bg-black/20 px-3 text-sm text-zinc-100 outline-none focus:border-sky-400/50"
            id="forward-name"
            onChange={(event) => setName(event.currentTarget.value)}
            placeholder="例如 PostgreSQL 隧道"
            value={name}
          />

          <div className="grid grid-cols-2 gap-3">
            <FieldInput
              id="forward-bind-host"
              label="监听地址"
              onChange={setBindHost}
              value={bindHost}
            />
            <FieldInput
              id="forward-source-port"
              label={kind === "remote" ? "远端监听端口" : "本机监听端口"}
              onChange={setSourcePort}
              value={sourcePort}
            />
          </div>

          {kind !== "dynamic" ? (
            <div className="grid grid-cols-2 gap-3">
              <FieldInput
                id="forward-target-host"
                label={kind === "remote" ? "本机目标地址" : "远端目标地址"}
                onChange={setTargetHost}
                value={targetHost}
              />
              <FieldInput
                id="forward-target-port"
                label={kind === "remote" ? "本机目标端口" : "远端目标端口"}
                onChange={setTargetPort}
                value={targetPort}
              />
            </div>
          ) : null}
        </div>

        {error ? (
          <div className="mt-3 rounded-xl border border-rose-300/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        <div className="mt-4 flex gap-2">
          <Button disabled={loading} onClick={() => void handleCreate()} size="sm">
            <Plus className="h-4 w-4" />
            创建转发
          </Button>
          <Button
            disabled={loading}
            onClick={() => void refresh()}
            size="sm"
            variant="secondary"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            刷新
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-white/8 bg-white/6 p-2">
        {selectedHostSessions.length === 0 ? (
          <div className="px-2 py-8 text-center text-sm text-zinc-500">
            当前主机暂无端口转发。
          </div>
        ) : (
          <div className="space-y-2">
            {selectedHostSessions.map((session) => (
              <PortForwardSessionRow
                key={session.id}
                onClose={handleClose}
                session={session}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function FieldInput({
  id,
  label,
  onChange,
  value,
}: {
  id: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="block text-xs text-zinc-500" htmlFor={id}>
      {label}
      <input
        className="mt-1 h-9 w-full rounded-xl border border-white/8 bg-black/20 px-3 text-sm text-zinc-100 outline-none focus:border-sky-400/50"
        id={id}
        onChange={(event) => onChange(event.currentTarget.value)}
        value={value}
      />
    </label>
  );
}

function PortForwardSessionRow({
  onClose,
  session,
}: {
  onClose: (forwardId: string) => Promise<void>;
  session: PortForwardSummary;
}) {
  return (
    <div className="rounded-xl bg-black/20 p-3">
      <div className="flex items-start gap-3">
        <Network className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-zinc-100">
            {session.name}
          </div>
          <div className="mt-1 font-mono text-xs text-zinc-500">
            {forwardDescription(session)}
          </div>
        </div>
        <span
          className={cn(
            "rounded-lg px-2 py-1 text-xs",
            session.status === "running"
              ? "bg-emerald-400/10 text-emerald-200"
              : "bg-zinc-500/10 text-zinc-400",
          )}
        >
          {session.status === "running" ? "运行中" : "已退出"}
        </span>
      </div>
      <Button
        className="mt-3 w-full"
        onClick={() => void onClose(session.id)}
        size="sm"
        variant="secondary"
      >
        <Square className="h-4 w-4" />
        停止转发
      </Button>
    </div>
  );
}

function forwardDescription(session: PortForwardSummary) {
  if (session.kind === "dynamic") {
    return `${session.bindHost}:${session.sourcePort} SOCKS`;
  }
  const arrow = session.kind === "remote" ? "<-" : "->";
  return `${session.bindHost}:${session.sourcePort} ${arrow} ${session.targetHost}:${session.targetPort}`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
