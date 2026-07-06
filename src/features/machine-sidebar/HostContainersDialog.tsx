import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileCode2, Pin, Play, RefreshCw, Search, Terminal } from "lucide-react";
import { Button } from "../../components/ui/button";
import { ModalShell } from "../../components/ui/modal-shell";
import { PromptDialog } from "../../components/ui/prompt-dialog";
import { Select } from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import type {
  DockerContainerInfoRequest,
  DockerContainerInspectSummary,
  DockerContainerListRequest,
  DockerContainerStatsRequest,
  DockerContainerStatsResult,
  DockerContainerSummary,
} from "../../lib/dockerApi";
import type { ContainerRuntime } from "../../lib/targetModel";
import { cn } from "../../lib/cn";
import type { Machine } from "../workspace/types";
import { buildComposeProjectViews } from "./host-containers/composeProjectModel";
import {
  ComposeProjectInspector,
  type ComposeProjectInspectorTab,
} from "./host-containers/ComposeProjectInspector";
import { HostContainerInspector } from "./host-containers/HostContainerInspector";
import { HostContainerList } from "./host-containers/HostContainerList";
import {
  buildHostContainerDialogViewModel,
  canEnterHostContainer,
  canRunHostContainerLifecycleAction,
  hostContainerLifecycleDialogCopy,
  resolveHostContainerSelection,
  type HostContainerGroupMode,
  type HostContainerInspectorTab,
  type HostContainerLifecycleAction,
  type HostContainerMetadata,
  type HostContainerSelection,
} from "./host-containers/hostContainerDialogModel";

interface HostContainersDialogProps {
  host: Machine;
  initialContainerId?: string;
  onClose: () => void;
  onEnterContainer: (container: DockerContainerSummary) => void;
  onFetchContainerStats: (
    request: DockerContainerStatsRequest,
  ) => Promise<DockerContainerStatsResult>;
  onInspectContainer: (
    request: DockerContainerInfoRequest,
  ) => Promise<DockerContainerInspectSummary>;
  onLifecycleContainer: (
    action: HostContainerLifecycleAction,
    container: DockerContainerSummary,
    options?: { force?: boolean },
  ) => void | Promise<void>;
  onListDockerContainers: (
    request: DockerContainerListRequest,
  ) => Promise<DockerContainerSummary[]>;
  onOpenContainerLogs: (container: DockerContainerSummary) => void;
  onPinContainer: (container: DockerContainerSummary) => void | Promise<void>;
  open: boolean;
}

const runtimeOptions = [
  { label: "Docker", value: "docker" },
  { label: "Podman", value: "podman" },
];

const groupModeOptions = [
  { label: "Compose", value: "compose" },
  { label: "状态", value: "status" },
  { label: "平铺", value: "flat" },
];

export function HostContainersDialog({
  host,
  initialContainerId,
  onClose,
  onEnterContainer,
  onFetchContainerStats,
  onInspectContainer,
  onLifecycleContainer,
  onListDockerContainers,
  onOpenContainerLogs,
  onPinContainer,
  open,
}: HostContainersDialogProps) {
  const [runtime, setRuntime] = useState<ContainerRuntime>("docker");
  const [includeStopped, setIncludeStopped] = useState(true);
  const [groupMode, setGroupMode] = useState<HostContainerGroupMode>("compose");
  const [query, setQuery] = useState("");
  const [containers, setContainers] = useState<DockerContainerSummary[]>([]);
  const [selection, setSelection] = useState<HostContainerSelection>(
    initialContainerId
      ? { kind: "container", containerId: initialContainerId }
      : null,
  );
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pinningContainerId, setPinningContainerId] = useState<string | null>(
    null,
  );
  const [activeLifecycleAction, setActiveLifecycleAction] = useState<{
    action: HostContainerLifecycleAction;
    containerId: string;
  } | null>(null);
  const [pendingLifecycleAction, setPendingLifecycleAction] = useState<{
    action: HostContainerLifecycleAction;
    container: HostContainerMetadata;
  } | null>(null);
  const [lifecycleConfirmValue, setLifecycleConfirmValue] = useState("");
  const [inspectorTab, setInspectorTab] =
    useState<HostContainerInspectorTab>("details");
  const [projectInspectorTab, setProjectInspectorTab] =
    useState<ComposeProjectInspectorTab>("overview");
  const [inspectorLoading, setInspectorLoading] = useState(false);
  const [inspectorError, setInspectorError] = useState<string | null>(null);
  const [inspectSummary, setInspectSummary] =
    useState<DockerContainerInspectSummary | null>(null);
  const [statsResult, setStatsResult] =
    useState<DockerContainerStatsResult | null>(null);
  const requestSequenceRef = useRef(0);
  const inspectorSequenceRef = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const hostIdentity = useMemo(() => formatHostIdentity(host), [host]);
  const selectedContainerId =
    selection?.kind === "container" ? selection.containerId : undefined;
  const selectedProjectId =
    selection?.kind === "project" ? selection.projectId : undefined;
  const viewModel = useMemo(
    () =>
      buildHostContainerDialogViewModel(
        containers,
        { groupMode, query },
        selectedContainerId,
      ),
    [containers, groupMode, query, selectedContainerId],
  );
  const composeViewModel = useMemo(
    () => buildComposeProjectViews(viewModel.containers),
    [viewModel.containers],
  );
  const selectedContainer =
    selection?.kind === "container"
      ? viewModel.containers.find(
          (container) => container.id === selection.containerId,
        )
      : undefined;
  const selectedProject =
    groupMode === "compose" && selection?.kind === "project"
      ? composeViewModel.projects.find(
          (project) => project.id === selection.projectId,
        )
      : undefined;

  const loadContainers = useCallback(async () => {
    if (!open) {
      return;
    }

    const requestId = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestId;
    setLoading(true);
    setLoadError(null);
    setActionError(null);

    try {
      const nextContainers = await onListDockerContainers({
        hostId: host.id,
        includeStopped,
        runtime,
      });
      if (requestSequenceRef.current !== requestId) {
        return;
      }
      setContainers(nextContainers);
      setSelection((current) =>
        resolveHostContainerSelection(
          nextContainers,
          groupMode,
          current,
          initialContainerId,
        ),
      );
    } catch (loadError: unknown) {
      if (requestSequenceRef.current !== requestId) {
        return;
      }
      setContainers([]);
      setSelection(null);
      setLoadError(`容器读取失败：${errorMessage(loadError)}`);
    } finally {
      if (requestSequenceRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [
    host.id,
    groupMode,
    includeStopped,
    initialContainerId,
    onListDockerContainers,
    open,
    runtime,
  ]);

  useEffect(() => {
    setQuery("");
    setSelection(
      initialContainerId
        ? { kind: "container", containerId: initialContainerId }
        : null,
    );
    setActionError(null);
    setActiveLifecycleAction(null);
    setPendingLifecycleAction(null);
    setLifecycleConfirmValue("");
    setInspectorTab("details");
    setProjectInspectorTab("overview");
    setInspectorError(null);
    setInspectSummary(null);
    setStatsResult(null);
  }, [host.id, initialContainerId, runtime]);

  useEffect(() => {
    if (open) {
      void loadContainers();
    }
  }, [loadContainers, open]);

  useEffect(() => {
    if (selection?.kind !== "project") {
      return;
    }
    if (
      groupMode !== "compose" ||
      !composeViewModel.projects.some(
        (project) => project.id === selection.projectId,
      )
    ) {
      setSelection(
        resolveHostContainerSelection(
          viewModel.containers,
          groupMode,
          null,
          initialContainerId,
        ),
      );
    }
  }, [
    composeViewModel.projects,
    groupMode,
    initialContainerId,
    selection,
    viewModel.containers,
  ]);

  const selectContainer = useCallback((containerId: string) => {
    setSelection({ kind: "container", containerId });
  }, []);

  const selectProject = useCallback((projectId: string) => {
    setSelection({ kind: "project", projectId });
    setProjectInspectorTab("overview");
  }, []);

  const openProjectYaml = useCallback((projectId: string) => {
    setSelection({ kind: "project", projectId });
    setProjectInspectorTab("yaml");
  }, []);

  const refreshProject = useCallback(
    (projectId: string) => {
      setSelection({ kind: "project", projectId });
      void loadContainers();
    },
    [loadContainers],
  );

  const enterContainer = useCallback(
    (container: HostContainerMetadata | undefined = selectedContainer) => {
      if (!container || !canEnterHostContainer(container)) {
        return;
      }
      onEnterContainer(container);
      onClose();
    },
    [onClose, onEnterContainer, selectedContainer],
  );

  const pinContainer = useCallback(
    async (container: HostContainerMetadata) => {
      selectContainer(container.id);
      setPinningContainerId(container.id);
      setActionError(null);
      try {
        await onPinContainer(container);
      } catch (pinError: unknown) {
        setActionError(`固定容器失败：${errorMessage(pinError)}`);
      } finally {
        setPinningContainerId(null);
      }
    },
    [onPinContainer, selectContainer],
  );

  const runLifecycleAction = useCallback(
    async (
      action: HostContainerLifecycleAction,
      container: HostContainerMetadata,
      options?: { force?: boolean },
    ) => {
      selectContainer(container.id);
      setActiveLifecycleAction({ action, containerId: container.id });
      setActionError(null);
      try {
        await onLifecycleContainer(action, container, options);
        await loadContainers();
      } catch (lifecycleError: unknown) {
        setActionError(
          `${lifecycleActionText(action)}容器失败：${errorMessage(lifecycleError)}`,
        );
      } finally {
        setActiveLifecycleAction(null);
      }
    },
    [loadContainers, onLifecycleContainer, selectContainer],
  );

  const requestLifecycleAction = useCallback(
    (
      action: HostContainerLifecycleAction,
      container: HostContainerMetadata,
    ) => {
      selectContainer(container.id);
      setActionError(null);
      if (!canRunHostContainerLifecycleAction(container, action)) {
        return;
      }
      if (action === "start") {
        void runLifecycleAction(action, container);
        return;
      }
      setLifecycleConfirmValue("");
      setPendingLifecycleAction({ action, container });
    },
    [runLifecycleAction, selectContainer],
  );

  const loadInspector = useCallback(
    async (
      tab: HostContainerInspectorTab,
      container: HostContainerMetadata,
    ) => {
      if (!open) {
        return;
      }
      const requestId = inspectorSequenceRef.current + 1;
      inspectorSequenceRef.current = requestId;
      const request = {
        containerId: container.id,
        hostId: container.hostId,
        runtime: container.runtime,
      };
      setInspectorLoading(true);
      setInspectorError(null);
      try {
        if (tab === "details") {
          const summary = await onInspectContainer(request);
          if (inspectorSequenceRef.current === requestId) {
            setInspectSummary(summary);
          }
          return;
        }
        const stats = await onFetchContainerStats(request);
        if (inspectorSequenceRef.current === requestId) {
          setStatsResult(stats);
        }
      } catch (inspectorError: unknown) {
        if (inspectorSequenceRef.current === requestId) {
          setInspectorError(
            `容器信息读取失败：${errorMessage(inspectorError)}`,
          );
        }
      } finally {
        if (inspectorSequenceRef.current === requestId) {
          setInspectorLoading(false);
        }
      }
    },
    [onFetchContainerStats, onInspectContainer, open],
  );

  const openInspector = useCallback(
    (tab: HostContainerInspectorTab, container: HostContainerMetadata) => {
      selectContainer(container.id);
      setInspectorTab(tab);
      if (selectedContainer?.id === container.id && inspectorTab === tab) {
        void loadInspector(tab, container);
      }
    },
    [inspectorTab, loadInspector, selectContainer, selectedContainer?.id],
  );

  const openContainerLogs = useCallback(
    (container: HostContainerMetadata) => {
      selectContainer(container.id);
      onOpenContainerLogs(container);
    },
    [onOpenContainerLogs, selectContainer],
  );

  const confirmLifecycleAction = useCallback(async () => {
    if (!pendingLifecycleAction) {
      return;
    }
    const { action, container } = pendingLifecycleAction;
    setPendingLifecycleAction(null);
    setLifecycleConfirmValue("");
    await runLifecycleAction(action, container, { force: false });
  }, [pendingLifecycleAction, runLifecycleAction]);

  useEffect(() => {
    if (!open || !selectedContainer) {
      return;
    }
    setInspectorError(null);
    void loadInspector(inspectorTab, selectedContainer);
  }, [
    inspectorTab,
    loadInspector,
    open,
    selectedContainer?.id,
    selectedContainer?.runtime,
  ]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && key === "f") {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (modifier && key === "r") {
        event.preventDefault();
        void loadContainers();
        return;
      }
      if (event.key !== "Enter" || isTypingTarget(event.target)) {
        return;
      }
      event.preventDefault();
      enterContainer();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [enterContainer, loadContainers, open]);

  const statusText = loading
    ? "checking"
    : loadError
      ? "failed"
      : `${viewModel.runningCount}/${viewModel.totalCount} running`;

  const lifecycleDialogCopy = pendingLifecycleAction
    ? hostContainerLifecycleDialogCopy(
        pendingLifecycleAction.action,
        pendingLifecycleAction.container,
      )
    : null;
  const selectedCanEnter = selectedContainer
    ? canEnterHostContainer(selectedContainer)
    : false;
  const selectedCanStart = selectedContainer
    ? canRunHostContainerLifecycleAction(selectedContainer, "start")
    : false;
  const selectedActionBusy =
    selectedContainer &&
    activeLifecycleAction?.containerId === selectedContainer.id;

  return (
    <>
      <ModalShell
        bodyClassName="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-3"
        description={hostIdentity}
        headerActions={
          <Button
            aria-label="刷新容器列表"
            className="h-8 w-8 rounded-lg"
            disabled={loading}
            onClick={() => void loadContainers()}
            size="icon"
            title="刷新容器列表"
            type="button"
            variant="ghost"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        }
        layout="workspace"
        onClose={onClose}
        open={open}
        title={`${host.name} / 容器`}
      >
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="grid grid-cols-4 overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-solid)]/82 shadow-sm shadow-black/5 dark:shadow-black/20">
            <SummaryMetric
              label="Compose"
              value={composeViewModel.projects.length}
            />
            <SummaryMetric
              label="独立"
              value={composeViewModel.standaloneContainers.length}
            />
            <SummaryMetric label="运行" value={viewModel.runningCount} />
            <SummaryMetric label="异常" value={composeViewModel.errorCount} />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-solid)]/82 px-3 py-2 text-xs text-zinc-500 shadow-sm shadow-black/5 dark:text-zinc-400 dark:shadow-black/20 md:min-w-48">
            <span>状态</span>
            <span className="font-mono text-zinc-700 dark:text-zinc-200">
              {statusText}
            </span>
          </div>
        </div>

        <div className="grid gap-2 lg:grid-cols-[minmax(220px,1fr)_140px_150px_132px]">
          <label className="relative min-w-0">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
              strokeWidth={1.8}
            />
            <input
              aria-label="搜索容器"
              className="kerminal-field-surface kerminal-focus-ring h-9 w-full rounded-xl border pl-9 pr-3 text-sm text-zinc-950 outline-none placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-600"
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="搜索应用、服务、镜像、端口、YAML 路径或 ID"
              ref={searchInputRef}
              value={query}
            />
          </label>
          <Select
            aria-label="容器运行时"
            onValueChange={(value) => setRuntime(value as ContainerRuntime)}
            options={runtimeOptions}
            size="sm"
            value={runtime}
          />
          <Select
            aria-label="容器分组方式"
            onValueChange={(value) =>
              setGroupMode(value as HostContainerGroupMode)
            }
            options={groupModeOptions}
            size="sm"
            value={groupMode}
          />
          <div className="kerminal-field-surface flex h-8 items-center justify-between gap-2 rounded-xl border px-2.5 text-xs text-zinc-600 dark:text-zinc-300">
            <span>停止容器</span>
            <Switch
              aria-label="包含停止容器"
              checked={includeStopped}
              onCheckedChange={setIncludeStopped}
            />
          </div>
        </div>

        <div
          className="grid min-h-0 gap-3 overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-solid)]/78 p-3 shadow-sm shadow-black/5 dark:shadow-black/20 lg:grid-cols-[348px_minmax(0,1fr)] 2xl:grid-cols-[360px_minmax(0,1fr)]"
          data-testid="host-container-workbench"
        >
          <div
            className="grid min-h-0 grid-rows-[minmax(0,1fr)_44px] gap-3 overflow-hidden"
            data-testid="host-container-list-pane"
          >
            {loadError ? (
              <StateMessage tone="danger">{loadError}</StateMessage>
            ) : loading && viewModel.totalCount === 0 ? (
              <StateMessage>正在读取容器...</StateMessage>
            ) : viewModel.emptySearch ? (
              <StateMessage>没有匹配的容器。</StateMessage>
            ) : viewModel.totalCount === 0 ? (
              <StateMessage>当前主机没有可显示的容器。</StateMessage>
            ) : (
              <HostContainerList
                groupMode={groupMode}
                groups={viewModel.groups}
                onEnterContainer={enterContainer}
                onInspectAction={openInspector}
                onLifecycleAction={requestLifecycleAction}
                onOpenLogs={openContainerLogs}
                onOpenProjectYaml={openProjectYaml}
                onPinContainer={(container) => void pinContainer(container)}
                onSelectContainer={selectContainer}
                onSelectProject={selectProject}
                pinningContainerId={pinningContainerId}
                projects={composeViewModel.projects}
                selectedContainerId={selectedContainer?.id}
                selectedProjectId={selectedProjectId}
                standaloneContainers={composeViewModel.standaloneContainers}
              />
            )}

            <div className="grid h-11 min-h-11 grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-3 border-t border-[var(--border-subtle)] pt-3">
              <div
                className="min-w-0 truncate text-xs text-zinc-500 dark:text-zinc-400"
                data-testid="host-container-selection-summary"
              >
                {selectedProject ? (
                  <>
                    <span className="font-medium text-zinc-800 dark:text-zinc-200">
                      {selectedProject.project}
                    </span>
                    <span className="mx-2">/</span>
                    <span className="font-mono">
                      {selectedProject.configPaths[0] ??
                        selectedProject.workingDir ??
                        "Compose"}
                    </span>
                  </>
                ) : selectedContainer ? (
                  <>
                    <span className="font-medium text-zinc-800 dark:text-zinc-200">
                      {selectedContainer.name}
                    </span>
                    <span className="mx-2">/</span>
                    <span className="font-mono">
                      {selectedContainer.shortId}
                    </span>
                  </>
                ) : (
                  "未选择容器"
                )}
              </div>
              <div
                className="grid shrink-0 grid-cols-2 justify-end gap-2"
                data-testid="host-container-footer-actions"
              >
                {selectedProject ? (
                  <>
                    <Button
                      aria-label="打开所选 Compose YAML"
                      className="h-8 w-8 rounded-lg"
                      onClick={() => openProjectYaml(selectedProject.id)}
                      size="icon"
                      title="查看 Compose YAML"
                      type="button"
                      variant={
                        projectInspectorTab === "yaml" ? "primary" : "secondary"
                      }
                    >
                      <FileCode2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      aria-label="刷新所选 Compose 应用"
                      className="h-8 w-8 rounded-lg"
                      onClick={() => refreshProject(selectedProject.id)}
                      size="icon"
                      title="刷新 Compose 元数据"
                      type="button"
                      variant="secondary"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      aria-label={
                        selectedContainer
                          ? "固定所选容器到侧栏"
                          : "固定容器到侧栏"
                      }
                      className="h-8 w-8 rounded-lg"
                      disabled={
                        !selectedContainer ||
                        pinningContainerId === selectedContainer.id
                      }
                      onClick={() =>
                        selectedContainer && void pinContainer(selectedContainer)
                      }
                      size="icon"
                      title="固定到侧栏"
                      type="button"
                      variant="secondary"
                    >
                      <Pin className="h-3.5 w-3.5" />
                    </Button>
                    {selectedCanEnter ? (
                      <Button
                        aria-label="进入所选容器"
                        className="h-8 w-8 rounded-lg"
                        disabled={!selectedContainer}
                        onClick={() => enterContainer()}
                        size="icon"
                        title="进入容器终端"
                        type="button"
                        variant="primary"
                      >
                        <Terminal className="h-3.5 w-3.5" />
                      </Button>
                    ) : (
                      <Button
                        aria-label="启动所选容器"
                        className="h-8 w-8 rounded-lg"
                        disabled={
                          !selectedContainer ||
                          !selectedCanStart ||
                          Boolean(selectedActionBusy)
                        }
                        onClick={() =>
                          selectedContainer &&
                          requestLifecycleAction("start", selectedContainer)
                        }
                        size="icon"
                        title={
                          selectedCanStart
                            ? "启动容器"
                            : "容器未运行或正在重启"
                        }
                        type="button"
                        variant="primary"
                      >
                        {selectedActionBusy ? (
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Play className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
          <div
            className="min-h-0 overflow-hidden"
            data-testid="host-container-inspector-pane"
          >
            {selectedProject ? (
              <ComposeProjectInspector
                hostId={host.id}
                onEnterContainer={enterContainer}
                onOpenContainerLogs={openContainerLogs}
                onRefresh={() => void loadContainers()}
                onSelectContainer={(container) => {
                  selectContainer(container.id);
                  setInspectorTab("details");
                }}
                onTabChange={setProjectInspectorTab}
                project={selectedProject}
                tab={projectInspectorTab}
              />
            ) : (
              <HostContainerInspector
                container={selectedContainer}
                error={inspectorError}
                inspectSummary={inspectSummary}
                loading={inspectorLoading}
                onRefresh={() => {
                  if (selectedContainer) {
                    void loadInspector(inspectorTab, selectedContainer);
                  }
                }}
                onTabChange={setInspectorTab}
                statsResult={statsResult}
                tab={inspectorTab}
              />
            )}
          </div>
        </div>

        {actionError ? (
          <StateMessage tone="danger">{actionError}</StateMessage>
        ) : null}
      </ModalShell>
      {pendingLifecycleAction && lifecycleDialogCopy ? (
        <PromptDialog
          busy={Boolean(activeLifecycleAction)}
          confirmLabel={lifecycleDialogCopy.confirmLabel}
          confirmVariant={lifecycleDialogCopy.variant}
          description={lifecycleDialogCopy.description}
          helperText={lifecycleDialogCopy.helperText}
          inputLabel={lifecycleDialogCopy.inputLabel}
          onClose={() => {
            setPendingLifecycleAction(null);
            setLifecycleConfirmValue("");
          }}
          onConfirm={() => {
            void confirmLifecycleAction();
          }}
          onValueChange={setLifecycleConfirmValue}
          open
          placeholder={lifecycleDialogCopy.placeholder}
          title={lifecycleDialogCopy.title}
          validate={
            pendingLifecycleAction.action === "remove"
              ? (value) =>
                  value === pendingLifecycleAction.container.name
                    ? null
                    : "请输入完整容器名确认删除"
              : undefined
          }
          value={lifecycleConfirmValue}
        />
      ) : null}
    </>
  );
}

function SummaryMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-r border-[var(--border-subtle)] px-3 py-2 last:border-r-0">
      <div className="font-mono text-lg font-semibold leading-6 text-zinc-950 dark:text-zinc-50">
        {value}
      </div>
      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
    </div>
  );
}

function StateMessage({
  children,
  tone = "muted",
}: {
  children: string;
  tone?: "danger" | "muted";
}) {
  return (
    <div
      className={cn(
        "flex min-h-32 items-center justify-center rounded-2xl border px-4 py-8 text-center text-sm",
        tone === "danger"
          ? "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-200"
          : "border-dashed border-[var(--border-subtle)] text-zinc-500 dark:text-zinc-400",
      )}
    >
      {children}
    </div>
  );
}

function formatHostIdentity(host: Machine) {
  const endpoint = host.host
    ? `${host.username ? `${host.username}@` : ""}${host.host}${
        host.port ? `:${host.port}` : ""
      }`
    : host.description;
  return `${endpoint} · ${host.production ? "production" : "workspace"} · SSH`;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function lifecycleActionText(action: HostContainerLifecycleAction) {
  switch (action) {
    case "start":
      return "启动";
    case "stop":
      return "停止";
    case "restart":
      return "重启";
    case "remove":
      return "删除";
    default:
      return "处理";
  }
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" || tagName === "textarea" || target.isContentEditable
  );
}
