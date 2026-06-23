import { Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { ModalShell } from "../../components/ui/modal-shell";
import { cn } from "../../lib/cn";
import {
  createPortForward,
  deletePortForward,
  listPortForwards,
  startPortForward,
  stopPortForward,
  type PortForwardCreateRequest,
  type PortForwardProxyProtocol,
  type PortForwardSummary,
} from "../../lib/portForwardApi";
import { writePaneCommand } from "../terminal/terminalSessionRegistry";
import {
  clearHostNetworkAssistAutoInjection,
  getHostNetworkAssistAutoInjection,
  isHostNetworkAssistAutoInjectionEnabled,
  setHostNetworkAssistAutoInjection,
  type HostNetworkAssistAutoInjection,
} from "../terminal/terminalProxyAutoInjection";
import type { Machine, TerminalPane } from "../workspace/types";
import {
  BindAddressControl,
  CommandPreview,
  EndpointHeader,
  ExposureWarning,
  FieldInput,
  PreviewValue,
  ProtocolToggle,
  RouteEditor,
  SocksModeToggle,
} from "./port-forward/PortForwardRouteEditor";
import { PortForwardSessionList } from "./port-forward/PortForwardSessionList";
import {
  buildNetworkAssistCommand,
  buildProxyUrl,
  flowForScenario,
  opensshForScenario,
  parsePort,
  portForwardScenarioOptions,
  proxyUrlForSession,
  resolveBindHost,
  sessionProxyProtocol,
  type BindAddressMode,
  type PortForwardScenario,
  type SocksAdvancedMode,
} from "./port-forward/portForwardWorkbenchModel";

interface PortForwardToolContentProps {
  focusedPane?: TerminalPane;
  selectedMachine?: Machine;
}

type PortForwardSessionMetadata = Pick<
  PortForwardSummary,
  | "commandPreview"
  | "localBindHost"
  | "localEndpoint"
  | "origin"
  | "proxyProtocol"
  | "proxyUrl"
  | "purpose"
  | "remoteAccessScope"
  | "remoteBindHost"
  | "remoteEndpoint"
>;

export function PortForwardToolContent({
  focusedPane,
  selectedMachine,
}: PortForwardToolContentProps) {
  const selectedHostId =
    selectedMachine?.kind === "ssh" ? selectedMachine.id : undefined;
  const [error, setError] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [scenario, setScenario] =
    useState<PortForwardScenario>("hostService");
  const [sessions, setSessions] = useState<PortForwardSummary[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [sessionMetadata, setSessionMetadata] = useState<
    Record<string, PortForwardSessionMetadata>
  >({});
  const [autoInjection, setAutoInjection] = useState<
    HostNetworkAssistAutoInjection | undefined
  >(() =>
    selectedHostId
      ? getHostNetworkAssistAutoInjection(selectedHostId)
      : undefined,
  );

  const [localBindMode, setLocalBindMode] =
    useState<BindAddressMode>("loopback");
  const [localCustomBindHost, setLocalCustomBindHost] = useState("127.0.0.1");
  const [remoteBindMode, setRemoteBindMode] =
    useState<BindAddressMode>("loopback");
  const [remoteCustomBindHost, setRemoteCustomBindHost] =
    useState("127.0.0.1");

  const [localListenPort, setLocalListenPort] = useState("15432");
  const [hostTargetHost, setHostTargetHost] = useState("127.0.0.1");
  const [hostTargetPort, setHostTargetPort] = useState("5432");
  const [remoteListenPort, setRemoteListenPort] = useState("18080");
  const [localTargetHost, setLocalTargetHost] = useState("127.0.0.1");
  const [localTargetPort, setLocalTargetPort] = useState("3000");
  const [localProxyHost, setLocalProxyHost] = useState("127.0.0.1");
  const [localProxyPort, setLocalProxyPort] = useState("18081");
  const [localSocksPort, setLocalSocksPort] = useState("1080");
  const [proxyProtocol, setProxyProtocol] =
    useState<PortForwardProxyProtocol>("http");
  const [socksMode, setSocksMode] =
    useState<SocksAdvancedMode>("localDynamic");

  const localBindHost = resolveBindHost(localBindMode, localCustomBindHost);
  const remoteBindHost = resolveBindHost(remoteBindMode, remoteCustomBindHost);
  const remoteProxyPortNumber = Number(remoteListenPort);
  const networkProxyUrlPreview =
    Number.isInteger(remoteProxyPortNumber) && remoteProxyPortNumber > 0
      ? buildProxyUrl({
          bindHost: remoteBindHost,
          port: remoteProxyPortNumber,
          protocol: proxyProtocol,
        })
      : "端口有效后生成代理地址";
  const networkCommandPreview =
    typeof networkProxyUrlPreview === "string" &&
    networkProxyUrlPreview.startsWith("http")
      ? buildNetworkAssistCommand({
          protocol: proxyProtocol,
          proxyUrl: networkProxyUrlPreview,
        })
      : networkProxyUrlPreview.startsWith("socks5h://")
        ? buildNetworkAssistCommand({
            protocol: proxyProtocol,
            proxyUrl: networkProxyUrlPreview,
          })
        : "";

  const enrichedSessions = useMemo(
    () =>
      sessions.map((session) =>
        sessionMetadata[session.id]
          ? {
              ...session,
              ...sessionMetadata[session.id],
              bindHost: session.bindHost,
              sourcePort: session.sourcePort,
              status: session.status,
            }
          : session,
      ),
    [sessionMetadata, sessions],
  );

  const selectedHostSessions = useMemo(
    () =>
      selectedMachine?.kind === "ssh"
        ? enrichedSessions.filter(
            (session) => session.hostId === selectedMachine.id,
          )
        : [],
    [enrichedSessions, selectedMachine],
  );

  useEffect(() => {
    if (!selectedHostId) {
      setAutoInjection(undefined);
      return;
    }
    const current = getHostNetworkAssistAutoInjection(selectedHostId);
    if (!current) {
      setAutoInjection(undefined);
      return;
    }
    if (!sessionsLoaded) {
      setAutoInjection(current);
      return;
    }
    if (
      !selectedHostSessions.some(
        (session) =>
          session.id === current.sessionId &&
          session.status === "running" &&
          proxyUrlForSession(session),
      )
    ) {
      clearHostNetworkAssistAutoInjection(selectedHostId, current.sessionId);
      setAutoInjection(undefined);
      return;
    }
    setAutoInjection(current);
  }, [selectedHostId, selectedHostSessions, sessionsLoaded]);

  const canInjectIntoFocusedPane =
    selectedMachine?.kind === "ssh" &&
    focusedPane?.mode === "ssh" &&
    (focusedPane.remoteHostId === selectedMachine.id ||
      focusedPane.machineId === selectedMachine.id);
  const injectDisabledReason = !focusedPane
    ? "当前工具面板还未接入 focusedPane；请复制命令手动粘贴，或由主线把 focusedPane 传入端口转发面板。"
    : "当前聚焦终端不是该主机的 SSH pane，无法安全注入。";

  const refresh = useCallback(async () => {
    setLoading(true);
    setSessionsLoaded(false);
    setError(null);
    try {
      setSessions(await listPortForwards());
      setSessionsLoaded(true);
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
      <section className="kerminal-solid-surface rounded-2xl border p-4 text-sm text-zinc-500 dark:text-zinc-400">
        <h3 className="font-medium text-zinc-950 dark:text-zinc-100">
          SSH 隧道
        </h3>
        <p className="mt-2 leading-6">
          请选择 SSH 主机后再创建访问主机服务、暴露本机服务或主机网络助手。
        </p>
      </section>
    );
  }

  const remoteExposureActive =
    scenario === "localService" ||
    scenario === "hostNetwork" ||
    (scenario === "socksAdvanced" && socksMode === "remoteDynamic");
  const localExposureActive =
    scenario === "hostService" ||
    (scenario === "socksAdvanced" && socksMode === "localDynamic");

  async function handleCreate() {
    if (!selectedMachine || selectedMachine.kind !== "ssh") {
      return;
    }

    const request = buildCreateRequest(selectedMachine.id);
    if ("error" in request) {
      setError(request.error);
      return;
    }

    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const created = await createPortForward(request.value);
      const metadata = metadataFromCreateRequest(request.value);
      setSessionMetadata((current) => ({
        ...current,
        [created.id]: metadata,
      }));
      const listed = await listPortForwards();
      setSessions(
        listed.some((session) => session.id === created.id)
          ? listed
          : [...listed, created],
      );
      setNotice(
        scenario === "hostNetwork"
          ? "网络助手会话已创建，可复制代理地址或注入当前终端。"
          : "隧道会话已创建。",
      );
      setCreateDialogOpen(false);
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setLoading(false);
    }
  }

  function handleOpenCreateDialog() {
    setError(null);
    setNotice(null);
    setCreateDialogOpen(true);
  }

  function handleCloseCreateDialog() {
    setCreateDialogOpen(false);
    setError(null);
  }

  async function handleStart(forwardId: string) {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const started = await startPortForward(forwardId);
      setSessions(await listPortForwards());
      setNotice(`${started.name} 已启动。`);
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setLoading(false);
    }
  }

  async function handleStop(forwardId: string) {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      await stopPortForward(forwardId);
      if (
        selectedHostId &&
        autoInjection?.sessionId === forwardId &&
        clearHostNetworkAssistAutoInjection(selectedHostId, forwardId)
      ) {
        setAutoInjection(undefined);
      }
      setSessions(await listPortForwards());
      setNotice("隧道已停止，配置仍保留。");
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(forwardId: string) {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      await deletePortForward(forwardId);
      setSessionMetadata((current) => {
        const next = { ...current };
        delete next[forwardId];
        return next;
      });
      if (
        selectedHostId &&
        autoInjection?.sessionId === forwardId &&
        clearHostNetworkAssistAutoInjection(selectedHostId, forwardId)
      ) {
        setAutoInjection(undefined);
      }
      setSessions(await listPortForwards());
      setNotice("隧道配置已删除。");
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy(value: string) {
    if (!navigator.clipboard?.writeText) {
      setError("当前环境不支持复制到剪贴板。");
      return;
    }
    await navigator.clipboard.writeText(value);
    setNotice("已复制地址。");
  }

  async function handleInject(session: PortForwardSummary) {
    if (!focusedPane || !canInjectIntoFocusedPane) {
      setError(injectDisabledReason);
      return;
    }
    if (session.status !== "running") {
      setError("该隧道已退出，请重新启动后再注入代理环境。");
      return;
    }
    const proxyUrl = proxyUrlForSession(session);
    if (!proxyUrl) {
      setError("该会话没有可注入的代理地址。");
      return;
    }
    await writePaneCommand({
      command: buildNetworkAssistCommand({
        protocol: sessionProxyProtocol(session),
        proxyUrl,
      }),
      paneId: focusedPane.id,
      source: "tool",
    });
    setNotice("已注入当前终端，不会写入远端 profile。");
  }

  function handleToggleAutoUse(session: PortForwardSummary) {
    if (!selectedHostId) {
      return;
    }
    if (session.status !== "running") {
      setError("该隧道已退出，请重新启动后再用于新终端。");
      return;
    }
    if (
      isHostNetworkAssistAutoInjectionEnabled({
        hostId: selectedHostId,
        sessionId: session.id,
      })
    ) {
      clearHostNetworkAssistAutoInjection(selectedHostId, session.id);
      setAutoInjection(undefined);
      setNotice("已关闭后续新终端自动使用。");
      return;
    }

    const proxyUrl = proxyUrlForSession(session);
    if (!proxyUrl) {
      setError("该会话没有可用于新终端的代理地址。");
      return;
    }
    const injection: HostNetworkAssistAutoInjection = {
      command: buildNetworkAssistCommand({
        protocol: sessionProxyProtocol(session),
        proxyUrl,
      }),
      hostId: selectedHostId,
      protocol: sessionProxyProtocol(session),
      proxyUrl,
      sessionId: session.id,
    };
    setHostNetworkAssistAutoInjection(injection);
    setAutoInjection(injection);
    setNotice("同主机后续新 SSH 终端会自动执行代理 export，不会写入远端 profile。");
  }

  function buildCreateRequest(
    hostId: string,
  ):
    | { value: PortForwardCreateRequest }
    | { error: string } {
    const trimmedName = name.trim() || undefined;

    if (scenario === "hostService") {
      const sourcePort = parsePort(localListenPort, "本机监听端口");
      const targetPort = parsePort(hostTargetPort, "主机目标端口");
      if (!sourcePort.ok) {
        return { error: sourcePort.error };
      }
      if (!targetPort.ok) {
        return { error: targetPort.error };
      }
      return {
        value: {
          bindHost: localBindHost,
          remoteEndpoint: {
            host: hostTargetHost.trim() || "127.0.0.1",
            label: "主机服务",
            port: targetPort.port,
            protocol: "tcp",
            side: "host",
          },
          hostId,
          kind: "local",
          localBindHost,
          localEndpoint: {
            host: localBindHost,
            label: "本机监听",
            port: sourcePort.port,
            protocol: "tcp",
            side: "local",
          },
          name: trimmedName,
          sourcePort: sourcePort.port,
          targetHost: hostTargetHost.trim() || "127.0.0.1",
          targetPort: targetPort.port,
        },
      };
    }

    if (scenario === "localService") {
      const sourcePort = parsePort(remoteListenPort, "主机监听端口");
      const targetPort = parsePort(localTargetPort, "本机目标端口");
      if (!sourcePort.ok) {
        return { error: sourcePort.error };
      }
      if (!targetPort.ok) {
        return { error: targetPort.error };
      }
      return {
        value: {
          bindHost: remoteBindHost,
          remoteEndpoint: {
            host: remoteBindHost,
            label: "主机监听",
            port: sourcePort.port,
            protocol: "tcp",
            side: "host",
          },
          hostId,
          kind: "remote",
          localEndpoint: {
            host: localTargetHost.trim() || "127.0.0.1",
            label: "本机服务",
            port: targetPort.port,
            protocol: "tcp",
            side: "local",
          },
          name: trimmedName,
          remoteBindHost,
          sourcePort: sourcePort.port,
          targetHost: localTargetHost.trim() || "127.0.0.1",
          targetPort: targetPort.port,
        },
      };
    }

    if (scenario === "hostNetwork") {
      const sourcePort = parsePort(remoteListenPort, "主机代理端口");
      if (!sourcePort.ok) {
        return { error: sourcePort.error };
      }
      const proxyUrl = buildProxyUrl({
        bindHost: remoteBindHost,
        port: sourcePort.port,
        protocol: proxyProtocol,
      });
      const commandPreview = buildNetworkAssistCommand({
        protocol: proxyProtocol,
        proxyUrl,
      });
      const request: PortForwardCreateRequest = {
        bindHost: remoteBindHost,
        commandPreview,
        remoteEndpoint: {
          host: remoteBindHost,
          label: proxyProtocol === "http" ? "主机 HTTP 代理" : "主机 SOCKS 代理",
          port: sourcePort.port,
          protocol: proxyProtocol === "http" ? "http" : "socks5",
          side: "host",
        },
        hostId,
        kind: "remote",
        localEndpoint: {
          host:
            proxyProtocol === "http"
              ? localProxyHost.trim() || "127.0.0.1"
              : "OpenSSH remote dynamic",
          label: proxyProtocol === "http" ? "本机受管代理入口" : "远端动态 SOCKS",
          port: proxyProtocol === "http" ? Number(localProxyPort) : undefined,
          protocol: proxyProtocol === "http" ? "http" : "socks5",
          side: "local",
        },
        name: trimmedName,
        origin: "networkAssist",
        proxyProtocol,
        proxyUrl,
        purpose: "hostNetworkAssist",
        remoteAccessScope: remoteBindMode === "all" ? "allInterfaces" : remoteBindMode,
        remoteBindHost,
        sourcePort: sourcePort.port,
      };

      if (proxyProtocol === "http") {
        const targetPort = parsePort(localProxyPort, "本机受管代理端口");
        if (!targetPort.ok) {
          return { error: targetPort.error };
        }
        request.localBindHost = localProxyHost.trim() || "127.0.0.1";
        request.targetHost = localProxyHost.trim() || "127.0.0.1";
        request.targetPort = targetPort.port;
      }

      return { value: request };
    }

    if (socksMode === "remoteDynamic") {
      const sourcePort = parsePort(remoteListenPort, "主机 SOCKS 端口");
      if (!sourcePort.ok) {
        return { error: sourcePort.error };
      }
      const proxyUrl = buildProxyUrl({
        bindHost: remoteBindHost,
        port: sourcePort.port,
        protocol: "socks5",
      });
      return {
        value: {
          bindHost: remoteBindHost,
          commandPreview: buildNetworkAssistCommand({
            protocol: "socks5",
            proxyUrl,
          }),
          remoteEndpoint: {
            host: remoteBindHost,
            label: "主机 SOCKS",
            port: sourcePort.port,
            protocol: "socks5",
            side: "host",
          },
          hostId,
          kind: "remote",
          localEndpoint: {
            host: "OpenSSH remote dynamic",
            label: "远端动态 SOCKS",
            protocol: "socks5",
            side: "local",
          },
          name: trimmedName,
          origin: "user",
          proxyProtocol: "socks5",
          proxyUrl,
          purpose: "hostNetworkAssist",
          remoteAccessScope:
            remoteBindMode === "all" ? "allInterfaces" : remoteBindMode,
          remoteBindHost,
          sourcePort: sourcePort.port,
        },
      };
    }

    const sourcePort = parsePort(localSocksPort, "本机 SOCKS 端口");
    if (!sourcePort.ok) {
      return { error: sourcePort.error };
    }
    return {
      value: {
        bindHost: localBindHost,
        remoteEndpoint: {
          host: "主机网络出口",
          label: "主机网络出口",
          protocol: "socks5",
          side: "host",
        },
        hostId,
        kind: "dynamic",
        localBindHost,
        localEndpoint: {
          host: localBindHost,
          label: "本机 SOCKS",
          port: sourcePort.port,
          protocol: "socks5",
          side: "local",
        },
        name: trimmedName,
        sourcePort: sourcePort.port,
      },
    };
  }

  return (
    <section className="space-y-3">
      <div className="kerminal-solid-surface rounded-2xl border p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-medium text-zinc-950 dark:text-zinc-100">
              SSH 隧道
            </h3>
            <p className="mt-1 truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">
              {selectedMachine.username}@{selectedMachine.host}:
              {selectedMachine.port}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {selectedMachine.production ? (
              <span className="rounded-lg border border-amber-300/25 bg-amber-400/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-200">
                生产主机
              </span>
            ) : null}
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
              {selectedHostSessions.length} 个会话
            </span>
          </div>
        </div>

        {error ? (
          <div className="mt-3 rounded-xl border border-rose-300/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-100">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="mt-3 rounded-xl border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-100">
            {notice}
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            disabled={loading}
            onClick={handleOpenCreateDialog}
            size="sm"
            variant="primary"
          >
            <Plus className="h-4 w-4" />
            添加隧道
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

      <PortForwardSessionList
        autoInjectionSessionId={autoInjection?.sessionId}
        canInject={Boolean(canInjectIntoFocusedPane)}
        injectDisabledReason={injectDisabledReason}
        loading={loading}
        onCopy={handleCopy}
        onDelete={handleDelete}
        onInject={handleInject}
        onStart={handleStart}
        onStop={handleStop}
        onToggleAutoUse={handleToggleAutoUse}
        sessions={selectedHostSessions}
      />
      <ModalShell
        description={`${selectedMachine.username}@${selectedMachine.host}:${selectedMachine.port}`}
        footer={
          <>
            <Button
              disabled={loading}
              onClick={handleCloseCreateDialog}
              variant="secondary"
            >
              取消
            </Button>
            <Button disabled={loading} onClick={() => void handleCreate()}>
              <Plus className="h-4 w-4" />
              {scenario === "hostNetwork" ? "开启网络助手" : "开启隧道"}
            </Button>
          </>
        }
        onClose={handleCloseCreateDialog}
        open={createDialogOpen}
        size="large"
        title="添加 SSH 隧道"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {portForwardScenarioOptions.map((option) => (
              <button
                aria-pressed={scenario === option.id}
                className={cn(
                  "kerminal-focus-ring kerminal-pressable min-h-20 rounded-xl border px-3 py-2 text-left transition-colors",
                  scenario === option.id
                    ? "border-sky-400/30 bg-[var(--surface-selected)] text-sky-700 shadow-sm shadow-sky-500/10 dark:text-sky-100"
                    : "kerminal-muted-surface text-zinc-600 hover:bg-[var(--surface-hover)] dark:text-zinc-400",
                )}
                key={option.id}
                onClick={() => setScenario(option.id)}
                type="button"
              >
                <span className="flex items-center justify-between gap-2 text-xs font-semibold">
                  {option.label}
                  <span className="rounded-md bg-[var(--surface-hover)] px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 dark:text-zinc-300">
                    {option.openssh}
                  </span>
                </span>
                <span className="mt-1 block text-[11px] leading-4 text-zinc-500 dark:text-zinc-400">
                  {option.flow}
                </span>
              </button>
            ))}
          </div>

          <FieldInput
            id="forward-name"
            label="名称"
            onChange={setName}
            placeholder={
              scenario === "hostNetwork" ? "例如 主机网络助手" : "例如 PostgreSQL 隧道"
            }
            value={name}
          />

          <RouteEditor
            flow={flowForScenario(scenario, socksMode)}
            host={renderHostEndpointFields()}
            local={renderLocalEndpointFields()}
            openssh={opensshForScenario(scenario, socksMode)}
          />

          {remoteExposureActive ? (
            <ExposureWarning
              bindHost={remoteBindHost}
              production={Boolean(selectedMachine.production)}
              side="remote"
            />
          ) : null}
          {localExposureActive ? (
            <ExposureWarning
              bindHost={localBindHost}
              production={false}
              side="local"
            />
          ) : null}

          {error ? (
            <div className="rounded-xl border border-rose-300/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-100">
              {error}
            </div>
          ) : null}
        </div>
      </ModalShell>
    </section>
  );

  function renderHostEndpointFields() {
    if (scenario === "hostService") {
      return (
        <>
          <EndpointHeader
            detail="SSH 连接另一侧"
            title="主机目标服务"
          />
          <FieldInput
            id="forward-host-target-host"
            label="主机目标地址"
            onChange={setHostTargetHost}
            value={hostTargetHost}
          />
          <FieldInput
            id="forward-host-target-port"
            label="主机目标端口"
            onChange={setHostTargetPort}
            value={hostTargetPort}
          />
        </>
      );
    }

    if (scenario === "localService") {
      return (
        <>
          <EndpointHeader detail="远端打开入口" title="主机监听" />
          <BindAddressControl
            customHost={remoteCustomBindHost}
            idPrefix="forward-remote-service-bind"
            label="主机监听范围"
            mode={remoteBindMode}
            onCustomHostChange={setRemoteCustomBindHost}
            onModeChange={setRemoteBindMode}
          />
          <FieldInput
            id="forward-remote-service-port"
            label="主机监听端口"
            onChange={setRemoteListenPort}
            value={remoteListenPort}
          />
        </>
      );
    }

    if (scenario === "hostNetwork") {
      return (
        <>
          <EndpointHeader detail="远端命令使用这里" title="主机代理" />
          <ProtocolToggle
            onChange={setProxyProtocol}
            value={proxyProtocol}
          />
          <BindAddressControl
            customHost={remoteCustomBindHost}
            idPrefix="forward-network-bind"
            label="主机监听范围"
            mode={remoteBindMode}
            onCustomHostChange={setRemoteCustomBindHost}
            onModeChange={setRemoteBindMode}
          />
          <FieldInput
            id="forward-network-port"
            label="主机代理端口"
            onChange={setRemoteListenPort}
            value={remoteListenPort}
          />
          <PreviewValue label="远端代理 URL" value={networkProxyUrlPreview} />
        </>
      );
    }

    if (socksMode === "remoteDynamic") {
      return (
        <>
          <EndpointHeader detail="远端 SOCKS 代理" title="主机 SOCKS" />
          <BindAddressControl
            customHost={remoteCustomBindHost}
            idPrefix="forward-remote-socks-bind"
            label="主机监听范围"
            mode={remoteBindMode}
            onCustomHostChange={setRemoteCustomBindHost}
            onModeChange={setRemoteBindMode}
          />
          <FieldInput
            id="forward-remote-socks-port"
            label="主机 SOCKS 端口"
            onChange={setRemoteListenPort}
            value={remoteListenPort}
          />
        </>
      );
    }

    return (
      <>
        <EndpointHeader detail="SOCKS 请求经由 SSH 主机" title="主机网络出口" />
        <PreviewValue label="出口" value="主机网络" />
      </>
    );
  }

  function renderLocalEndpointFields() {
    if (scenario === "hostService") {
      return (
        <>
          <EndpointHeader detail="本机应用连接这里" title="本机监听" />
          <BindAddressControl
            customHost={localCustomBindHost}
            idPrefix="forward-local-bind"
            label="本机监听范围"
            mode={localBindMode}
            onCustomHostChange={setLocalCustomBindHost}
            onModeChange={setLocalBindMode}
          />
          <FieldInput
            id="forward-local-listen-port"
            label="本机监听端口"
            onChange={setLocalListenPort}
            value={localListenPort}
          />
        </>
      );
    }

    if (scenario === "localService") {
      return (
        <>
          <EndpointHeader detail="本机真实服务" title="本机服务" />
          <FieldInput
            id="forward-local-target-host"
            label="本机目标地址"
            onChange={setLocalTargetHost}
            value={localTargetHost}
          />
          <FieldInput
            id="forward-local-target-port"
            label="本机目标端口"
            onChange={setLocalTargetPort}
            value={localTargetPort}
          />
        </>
      );
    }

    if (scenario === "hostNetwork") {
      return (
        <>
          <EndpointHeader detail="不写远端 profile" title="本机网络出口" />
          {proxyProtocol === "http" ? (
            <>
              <FieldInput
                id="forward-local-proxy-host"
                label="本机受管代理地址"
                onChange={setLocalProxyHost}
                value={localProxyHost}
              />
              <FieldInput
                id="forward-local-proxy-port"
                label="本机受管代理端口"
                onChange={setLocalProxyPort}
                value={localProxyPort}
              />
            </>
          ) : (
            <PreviewValue
              label="本机侧"
              value="OpenSSH remote dynamic SOCKS，无本机目标服务"
            />
          )}
          {networkCommandPreview ? (
            <CommandPreview value={networkCommandPreview} />
          ) : null}
        </>
      );
    }

    return (
      <>
        <EndpointHeader detail="本机应用配置 SOCKS" title="本机 SOCKS" />
        <SocksModeToggle onChange={setSocksMode} value={socksMode} />
        {socksMode === "localDynamic" ? (
          <>
            <BindAddressControl
              customHost={localCustomBindHost}
              idPrefix="forward-local-socks-bind"
              label="本机监听范围"
              mode={localBindMode}
              onCustomHostChange={setLocalCustomBindHost}
              onModeChange={setLocalBindMode}
            />
            <FieldInput
              id="forward-local-socks-port"
              label="本机 SOCKS 端口"
              onChange={setLocalSocksPort}
              value={localSocksPort}
            />
          </>
        ) : (
          <PreviewValue
            label="远端注入"
            value={buildNetworkAssistCommand({
              protocol: "socks5",
              proxyUrl: buildProxyUrl({
                bindHost: remoteBindHost,
                port: Number(remoteListenPort) || 0,
                protocol: "socks5",
              }),
            }).split("\n")[0]}
          />
        )}
      </>
    );
  }
}

function metadataFromCreateRequest(
  request: PortForwardCreateRequest,
): PortForwardSessionMetadata {
  return {
    commandPreview: request.commandPreview,
    localBindHost: request.localBindHost,
    localEndpoint: request.localEndpoint,
    origin: request.origin,
    proxyProtocol: request.proxyProtocol,
    proxyUrl: request.proxyUrl,
    purpose: request.purpose,
    remoteAccessScope: request.remoteAccessScope,
    remoteBindHost: request.remoteBindHost,
    remoteEndpoint: request.remoteEndpoint,
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
