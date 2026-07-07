import { Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { ModalShell } from "../../components/ui/modal-shell";
import { cn } from "../../lib/cn";
import { writeDesktopClipboardText } from "../../lib/desktopClipboardApi";
import {
  createPortForward,
  deletePortForward,
  listPortForwards,
  startPortForward,
  stopPortForward,
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
  buildPortForwardCreateRequest,
  metadataFromCreateRequest,
  type PortForwardSessionMetadata,
} from "./port-forward/portForwardCreateRequestModel";
import {
  buildNetworkAssistCommand,
  buildProxyUrl,
  flowForScenario,
  opensshForScenario,
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

export function PortForwardToolContent({
  focusedPane,
  selectedMachine,
}: PortForwardToolContentProps) {
  const selectedHostId =
    selectedMachine?.kind === "ssh" ? selectedMachine.id : undefined;
  const [error, setError] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
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
    ? "无法注入当前终端，请手动粘贴。"
    : "聚焦终端不是当前 SSH 主机。";

  const refresh = useCallback(async () => {
    if (!selectedHostId) {
      setSessions([]);
      setSessionsLoaded(false);
      setLoading(false);
      setError(null);
      return;
    }
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
  }, [selectedHostId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!selectedMachine || selectedMachine.kind !== "ssh") {
    const message =
      selectedMachine?.kind === "dockerContainer"
        ? "当前容器目标不支持直接创建 SSH 隧道。请切回宿主 SSH 主机管理端口转发。"
        : "请选择 SSH 主机。";
    return (
      <section className="kerminal-solid-surface rounded-2xl border p-4 text-sm text-zinc-500 dark:text-zinc-400">
        <h3 className="font-medium text-zinc-950 dark:text-zinc-100">
          SSH 隧道
        </h3>
        <p className="mt-2 leading-6">
          {message}
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

    const request = buildPortForwardCreateRequest({
      hostId: selectedMachine.id,
      hostTargetHost,
      hostTargetPort,
      localBindHost,
      localListenPort,
      localProxyHost,
      localProxyPort,
      localSocksPort,
      localTargetHost,
      localTargetPort,
      name,
      proxyProtocol,
      remoteBindHost,
      remoteBindMode,
      remoteListenPort,
      scenario,
      socksMode,
    });
    if ("error" in request) {
      setError(request.error);
      return;
    }

    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      if (editingSessionId) {
        await deletePortForward(editingSessionId);
      }
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
        editingSessionId
          ? "隧道配置已更新。"
          : scenario === "hostNetwork"
          ? "网络助手已创建，可复制或注入。"
          : "隧道会话已创建。",
      );
      setEditingSessionId(null);
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
    setEditingSessionId(null);
    setCreateDialogOpen(true);
  }

  function handleCloseCreateDialog() {
    setCreateDialogOpen(false);
    setEditingSessionId(null);
    setError(null);
  }

  function handleEdit(session: PortForwardSummary) {
    applySessionToForm(session);
    setError(null);
    setNotice(null);
    setEditingSessionId(session.id);
    setCreateDialogOpen(true);
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
    const result = await writeDesktopClipboardText(value);
    if (!result.ok) {
      setError("当前环境不支持复制到剪贴板。");
      return;
    }
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
            aria-label="添加隧道"
            className="bg-sky-500 text-white shadow-lg shadow-sky-500/25 hover:bg-sky-400 dark:bg-sky-500 dark:text-white dark:hover:bg-sky-400"
            disabled={loading}
            onClick={handleOpenCreateDialog}
            size="icon"
            title="添加隧道"
            variant="primary"
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            aria-label="刷新隧道"
            disabled={loading}
            onClick={() => void refresh()}
            size="icon"
            title="刷新隧道"
            variant="secondary"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
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
        onEdit={handleEdit}
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
            <Button
              className="bg-sky-500 text-white shadow-lg shadow-sky-500/25 hover:bg-sky-400 dark:bg-sky-500 dark:text-white dark:hover:bg-sky-400"
              disabled={loading}
              onClick={() => void handleCreate()}
            >
              <Plus className="h-4 w-4" />
              {editingSessionId
                ? "保存修改"
                : scenario === "hostNetwork"
                  ? "开启网络助手"
                  : "开启隧道"}
            </Button>
          </>
        }
        onClose={handleCloseCreateDialog}
        open={createDialogOpen}
        size="large"
        title={editingSessionId ? "编辑 SSH 隧道" : "添加 SSH 隧道"}
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
          <EndpointHeader detail="远端入口" title="主机监听" />
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
          <EndpointHeader detail="远端代理" title="主机代理" />
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
        <EndpointHeader detail="经由 SSH 主机" title="主机网络出口" />
        <PreviewValue label="出口" value="主机网络" />
      </>
    );
  }

  function applySessionToForm(session: PortForwardSummary) {
    setName(session.name);
    if (session.kind === "local") {
      setScenario("hostService");
      setLocalCustomBindHost(session.localBindHost ?? session.bindHost);
      setLocalBindMode(bindModeFromHost(session.localBindHost ?? session.bindHost));
      setLocalListenPort(String(session.sourcePort));
      setHostTargetHost(session.targetHost ?? session.remoteEndpoint?.host ?? "127.0.0.1");
      setHostTargetPort(String(session.targetPort ?? session.remoteEndpoint?.port ?? 80));
      return;
    }
    if (session.kind === "dynamic") {
      setScenario("socksAdvanced");
      setSocksMode("localDynamic");
      setLocalCustomBindHost(session.localBindHost ?? session.bindHost);
      setLocalBindMode(bindModeFromHost(session.localBindHost ?? session.bindHost));
      setLocalSocksPort(String(session.sourcePort));
      return;
    }
    if (session.purpose === "hostNetworkAssist") {
      if (session.proxyProtocol === "socks5" && !session.targetHost) {
        setScenario("socksAdvanced");
        setSocksMode("remoteDynamic");
      } else {
        setScenario("hostNetwork");
      }
      setProxyProtocol(session.proxyProtocol ?? "http");
      setRemoteCustomBindHost(session.remoteBindHost ?? session.bindHost);
      setRemoteBindMode(bindModeFromHost(session.remoteBindHost ?? session.bindHost));
      setRemoteListenPort(String(session.sourcePort));
      setLocalProxyHost(session.localEndpoint?.host ?? session.targetHost ?? "127.0.0.1");
      setLocalProxyPort(String(session.localEndpoint?.port ?? session.targetPort ?? 18081));
      return;
    }
    setScenario("localService");
    setRemoteCustomBindHost(session.remoteBindHost ?? session.bindHost);
    setRemoteBindMode(bindModeFromHost(session.remoteBindHost ?? session.bindHost));
    setRemoteListenPort(String(session.sourcePort));
    setLocalTargetHost(session.targetHost ?? session.localEndpoint?.host ?? "127.0.0.1");
    setLocalTargetPort(String(session.targetPort ?? session.localEndpoint?.port ?? 3000));
  }

  function renderLocalEndpointFields() {
    if (scenario === "hostService") {
      return (
        <>
          <EndpointHeader detail="本机入口" title="本机监听" />
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
          <EndpointHeader detail="不写 profile" title="本机网络出口" />
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
              value="OpenSSH remote dynamic SOCKS"
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function bindModeFromHost(host: string | undefined): BindAddressMode {
  const value = host?.trim();
  if (!value || value === "127.0.0.1" || value === "localhost" || value === "::1") {
    return "loopback";
  }
  if (value === "0.0.0.0" || value === "::") {
    return "all";
  }
  return "custom";
}
