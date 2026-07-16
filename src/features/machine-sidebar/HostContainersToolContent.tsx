/**
 * Host-scoped container workbench content for an SSH target.
 *
 * @author kongweiguang
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileCode2, Pin, Play, RefreshCw, Terminal } from "lucide-react";
import { Button } from "../../components/ui/button";
import { PromptDialog } from "../../components/ui/prompt-dialog";
import { UserFacingNotice } from "../../components/ui/user-facing-notice";
import { cn } from "../../lib/cn";
import {
  fetchDockerContainerStats,
  inspectDockerContainer,
  listDockerContainers,
  type DockerContainerInspectSummary,
  type DockerContainerLifecycleAction,
  type DockerContainerStatsResult,
  type DockerContainerSummary,
} from "../../lib/dockerApi";
import type { ContainerRuntime } from "../../lib/targetModel";
import {
  buildUserFacingError,
  type UserFacingMessage,
} from "../../lib/userFacingMessage";
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
  hostContainerStatusLabel,
  hostContainerLifecycleDialogCopy,
  resolveHostContainerSelection,
  type HostContainerGroupMode,
  type HostContainerInspectorTab,
  type HostContainerMetadata,
  type HostContainerSelection,
} from "./host-containers/hostContainerDialogModel";
import {
  HostContainersStateMessage as StateMessage,
  HostContainersToolbar,
  composeYamlRootPath,
  containerLifecycleActionText as lifecycleActionText,
} from "./host-containers/hostContainersPresenter";
import {
  presentContainerSummary,
  runDefaultLifecycleAction,
  type HostContainersToolContentProps,
} from "./host-containers/hostContainersToolAdapter";

export type { HostContainersToolContentProps } from "./host-containers/hostContainersToolAdapter";

export function HostContainersToolContent({
  initialContainerId,
  onEnterContainer,
  onFetchContainerStats = fetchDockerContainerStats,
  onInspectContainer = inspectDockerContainer,
  onLifecycleContainer = runDefaultLifecycleAction,
  onListDockerContainers = listDockerContainers,
  onOpenContainerLogs,
  onOpenWorkspaceFileTab,
  onPinContainer,
  presentation = "default",
  refreshRequestId,
  selectedMachine,
}: HostContainersToolContentProps) {
  const host = selectedMachine?.kind === "ssh" ? selectedMachine : undefined;
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
  const [loadError, setLoadError] = useState<UserFacingMessage | null>(null);
  const [actionError, setActionError] =
    useState<UserFacingMessage | null>(null);
  const [pinningContainerId, setPinningContainerId] = useState<string | null>(
    null,
  );
  const [activeLifecycleAction, setActiveLifecycleAction] = useState<{
    action: DockerContainerLifecycleAction;
    containerId: string;
  } | null>(null);
  const [pendingLifecycleAction, setPendingLifecycleAction] = useState<{
    action: DockerContainerLifecycleAction;
    container: HostContainerMetadata;
  } | null>(null);
  const [lifecycleConfirmValue, setLifecycleConfirmValue] = useState("");
  const [inspectorTab, setInspectorTab] =
    useState<HostContainerInspectorTab>("details");
  const [projectInspectorTab, setProjectInspectorTab] =
    useState<ComposeProjectInspectorTab>("overview");
  const [inspectorLoading, setInspectorLoading] = useState(false);
  const [inspectorError, setInspectorError] =
    useState<UserFacingMessage | null>(null);
  const [inspectSummary, setInspectSummary] =
    useState<DockerContainerInspectSummary | null>(null);
  const [statsResult, setStatsResult] =
    useState<DockerContainerStatsResult | null>(null);
  const requestSequenceRef = useRef(0);
  const inspectorSequenceRef = useRef(0);

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
  const selectedContainerHostId = selectedContainer?.hostId;
  const selectedContainerRuntime = selectedContainer?.runtime;
  const selectedProject =
    groupMode === "compose" && selection?.kind === "project"
      ? composeViewModel.projects.find(
          (project) => project.id === selection.projectId,
        )
      : undefined;
  const sidebar = presentation === "sidebar";

  const loadContainers = useCallback(async () => {
    if (!host) {
      setContainers([]);
      setSelection(null);
      setLoadError(null);
      setLoading(false);
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
      setLoadError(
        buildUserFacingError(loadError, {
          detail: "Kerminal 暂时无法获取这个主机的容器列表。",
          recoveryAction: "请确认主机连接和容器运行时可用，然后重试。",
          title: "无法读取容器",
        }),
      );
    } finally {
      if (requestSequenceRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [
    groupMode,
    host,
    includeStopped,
    initialContainerId,
    onListDockerContainers,
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
  }, [host?.id, initialContainerId, runtime]);

  useEffect(() => {
    void loadContainers();
  }, [loadContainers, refreshRequestId]);

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

  const openProjectYaml = useCallback(
    (projectId: string) => {
      setSelection({ kind: "project", projectId });
      setProjectInspectorTab("yaml");

      const project = composeViewModel.projects.find(
        (candidate) => candidate.id === projectId,
      );
      const path = project?.configPaths[0];
      if (!host || !project || !path || !onOpenWorkspaceFileTab) {
        return;
      }

      onOpenWorkspaceFileTab({
        access: "readonly",
        path,
        rootPath: composeYamlRootPath(project.workingDir, path),
        source: "composeYaml",
        target: { hostId: host.id, kind: "ssh" },
      });
    },
    [composeViewModel.projects, host, onOpenWorkspaceFileTab],
  );

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
      onEnterContainer?.(container);
    },
    [onEnterContainer, selectedContainer],
  );

  const pinContainer = useCallback(
    async (container: HostContainerMetadata) => {
      selectContainer(container.id);
      setPinningContainerId(container.id);
      setActionError(null);
      try {
        await onPinContainer?.(container);
      } catch (pinError: unknown) {
        setActionError(
          buildUserFacingError(pinError, {
            detail: `${container.name} 仍可从当前列表打开。`,
            recoveryAction: "请稍后重试固定操作。",
            title: "无法固定容器",
          }),
        );
      } finally {
        setPinningContainerId(null);
      }
    },
    [onPinContainer, selectContainer],
  );

  const runLifecycleAction = useCallback(
    async (
      action: DockerContainerLifecycleAction,
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
          buildUserFacingError(lifecycleError, {
            detail: `${container.name} 未完成${lifecycleActionText(action)}操作。`,
            recoveryAction: "请刷新状态，确认容器运行时可用后重试。",
            title: `${lifecycleActionText(action)}容器失败`,
          }),
        );
      } finally {
        setActiveLifecycleAction(null);
      }
    },
    [loadContainers, onLifecycleContainer, selectContainer],
  );

  const requestLifecycleAction = useCallback(
    (action: DockerContainerLifecycleAction, container: HostContainerMetadata) => {
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
    async (tab: HostContainerInspectorTab, container: Pick<HostContainerMetadata, "id" | "hostId" | "runtime">) => {
      const requestId = inspectorSequenceRef.current + 1;
      inspectorSequenceRef.current = requestId;
      const request = { containerId: container.id, hostId: container.hostId, runtime: container.runtime };
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
            buildUserFacingError(inspectorError, {
              detail: "当前详情或监控数据暂时不可用。",
              recoveryAction: "请确认容器仍存在，然后点击刷新重试。",
              title: "无法读取容器信息",
            }),
          );
        }
      } finally {
        if (inspectorSequenceRef.current === requestId) {
          setInspectorLoading(false);
        }
      }
    },
    [onFetchContainerStats, onInspectContainer],
  );

  const openInspector = useCallback(
    (tab: HostContainerInspectorTab, container: HostContainerMetadata) => {
      selectContainer(container.id);
      setInspectorTab(tab);
      if (selectedContainer?.id === container.id && inspectorTab === tab) {
        void loadInspector(tab, {
          id: container.id,
          hostId: container.hostId,
          runtime: container.runtime,
        });
      }
    },
    [inspectorTab, loadInspector, selectContainer, selectedContainer?.id],
  );

  const openContainerLogs = useCallback(
    (container: HostContainerMetadata) => {
      selectContainer(container.id);
      onOpenContainerLogs?.(container);
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
    if (sidebar) {
      return;
    }
    if (
      !selectedContainerId ||
      !selectedContainerHostId ||
      !selectedContainerRuntime
    ) {
      return;
    }
    setInspectorError(null);
    void loadInspector(inspectorTab, {
      id: selectedContainerId,
      hostId: selectedContainerHostId,
      runtime: selectedContainerRuntime,
    });
  }, [
    inspectorTab,
    loadInspector,
    sidebar,
    selectedContainerHostId,
    selectedContainerId,
    selectedContainerRuntime,
  ]);

  const containerSummary = presentContainerSummary({
    composeErrors: composeViewModel.errorCount,
    composeProjects: composeViewModel.projects.length,
    loadError,
    loading,
    running: viewModel.runningCount,
    standalone: composeViewModel.standaloneContainers.length,
    total: viewModel.totalCount,
  });

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
  if (!host) {
    return (
      <div className="grid gap-3" data-testid="host-containers-tool-empty">
        <StateMessage>选择 SSH 主机后查看 Docker、Podman 和 Compose。</StateMessage>
      </div>
    );
  }

  return (
    <>
      <div
        className="grid min-w-0 max-w-full gap-3"
        data-testid="host-containers-tool-content"
      >
        <HostContainersToolbar
          groupMode={groupMode}
          host={host}
          includeStopped={includeStopped}
          loading={loading}
          onGroupModeChange={setGroupMode}
          onIncludeStoppedChange={setIncludeStopped}
          onQueryChange={setQuery}
          onRefresh={() => void loadContainers()}
          onRuntimeChange={setRuntime}
          query={query}
          runtime={runtime}
          sidebar={sidebar}
          summary={containerSummary}
        />

        <section
          className={cn(
            "grid min-w-0 gap-3 overflow-hidden border border-[var(--border-subtle)] bg-[var(--surface-solid)]/78 shadow-sm shadow-black/5 dark:shadow-black/20",
            sidebar ? "min-h-[18rem] rounded-[var(--radius-control)] p-2" : "min-h-[20rem] rounded-[var(--radius-card)] p-3",
          )}
        >
          <div
            className={cn(
              "grid min-h-0 gap-3 overflow-hidden",
              sidebar ? "grid-rows-[minmax(0,1fr)]" : "grid-rows-[minmax(0,1fr)_44px]",
            )}
          >
            {loadError ? (
              <div className="flex min-h-32 items-center">
                <UserFacingNotice
                  className="w-full"
                  compact
                  message={loadError}
                />
              </div>
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
                presentation={presentation}
                projects={composeViewModel.projects}
                selectedContainerId={selectedContainer?.id}
                selectedProjectId={selectedProjectId}
                standaloneContainers={composeViewModel.standaloneContainers}
              />
            )}
            {sidebar ? null : (
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
                      <span>
                        {selectedProject.runningCount}/{selectedProject.totalCount} 运行
                      </span>
                    </>
                  ) : selectedContainer ? (
                    <>
                      <span className="font-medium text-zinc-800 dark:text-zinc-200">
                        {selectedContainer.name}
                      </span>
                      <span className="mx-2">/</span>
                      <span>{hostContainerStatusLabel(selectedContainer.status)}</span>
                    </>
                  ) : (
                    "未选择容器"
                  )}
                </div>
                <div className="grid shrink-0 grid-cols-2 justify-end gap-2">
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
            )}
          </div>
        </section>

        {sidebar ? null : (
          <section className="grid min-h-[22rem] min-w-0 gap-3 overflow-hidden">
            {!selectedProject && inspectorError ? (
              <UserFacingNotice compact message={inspectorError} />
            ) : null}
            {selectedProject ? (
              <ComposeProjectInspector
                hostId={host.id}
                onEnterContainer={enterContainer}
                onOpenContainerLogs={openContainerLogs}
                onOpenWorkspaceFileTab={onOpenWorkspaceFileTab}
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
                error={null}
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
          </section>
        )}

        {actionError ? (
          <UserFacingNotice compact message={actionError} />
        ) : null}
      </div>

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
