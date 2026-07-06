import { useEffect, useMemo, useState } from "react";
import {
  Box,
  ChevronDown,
  ChevronRight,
  FileCode2,
  Layers,
  Pin,
  Play,
  ScrollText,
  Terminal,
} from "lucide-react";
import { Button } from "../../../components/ui/button";
import { cn } from "../../../lib/cn";
import type {
  ComposeProjectView,
  ComposeStandaloneContainerView,
} from "./composeProjectModel";
import { HostContainerActionsMenu } from "./HostContainerActionsMenu";
import {
  canEnterHostContainer,
  canRunHostContainerLifecycleAction,
  containerComposeService,
  containerProjectName,
  type HostContainerGroupMode,
  hostContainerStatusLabel,
  hostContainerStatusTone,
  type HostContainerGroupView,
  type HostContainerInspectorTab,
  type HostContainerLifecycleAction,
  type HostContainerMetadata,
} from "./hostContainerDialogModel";

interface HostContainerListProps {
  groupMode: HostContainerGroupMode;
  groups: HostContainerGroupView[];
  onEnterContainer: (container: HostContainerMetadata) => void;
  onLifecycleAction: (
    action: HostContainerLifecycleAction,
    container: HostContainerMetadata,
  ) => void;
  onInspectAction: (
    tab: HostContainerInspectorTab,
    container: HostContainerMetadata,
  ) => void;
  onPinContainer: (container: HostContainerMetadata) => void;
  onOpenLogs: (container: HostContainerMetadata) => void;
  onOpenProjectYaml: (projectId: string) => void;
  onSelectContainer: (containerId: string) => void;
  onSelectProject: (projectId: string) => void;
  pinningContainerId?: string | null;
  selectedContainerId?: string;
  selectedProjectId?: string;
  projects: ComposeProjectView[];
  presentation?: "default" | "sidebar";
  standaloneContainers: ComposeStandaloneContainerView[];
}

const statusToneClassNames = {
  attention: {
    chip: "bg-amber-500/10 text-amber-700 dark:text-amber-200",
    dot: "bg-amber-400",
  },
  danger: {
    chip: "bg-red-500/10 text-red-700 dark:text-red-200",
    dot: "bg-red-500",
  },
  muted: {
    chip: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-300",
    dot: "bg-zinc-400",
  },
  running: {
    chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-200",
    dot: "bg-emerald-400",
  },
} as const;

const rowIconButtonClassName =
  "h-8 w-8 rounded-lg text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50";

export function HostContainerList({
  groupMode,
  groups,
  onEnterContainer,
  onInspectAction,
  onLifecycleAction,
  onOpenLogs,
  onOpenProjectYaml,
  onPinContainer,
  onSelectContainer,
  onSelectProject,
  pinningContainerId,
  selectedContainerId,
  selectedProjectId,
  projects,
  presentation = "default",
  standaloneContainers,
}: HostContainerListProps) {
  const sidebar = presentation === "sidebar";
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(
    () => new Set(),
  );
  const projectIds = useMemo(
    () => new Set(projects.map((project) => project.id)),
    [projects],
  );

  useEffect(() => {
    if (groupMode !== "compose") {
      return;
    }
    setExpandedProjectIds((current) => {
      const next = new Set(
        [...current].filter((projectId) => projectIds.has(projectId)),
      );
      return areSetsEqual(current, next) ? current : next;
    });
  }, [groupMode, projectIds]);

  const toggleProject = (projectId: string) => {
    setExpandedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };

  if (groupMode !== "compose") {
    return (
      <ContainerGroupList
        groups={groups}
        onEnterContainer={onEnterContainer}
        onInspectAction={onInspectAction}
        onLifecycleAction={onLifecycleAction}
        onOpenLogs={onOpenLogs}
        onPinContainer={onPinContainer}
        onSelectContainer={onSelectContainer}
        pinningContainerId={pinningContainerId}
        presentation={presentation}
        selectedContainerId={selectedContainerId}
      />
    );
  }

  return (
    <div
      aria-label="容器列表"
      className={cn(
        "scrollbar-none flex min-h-0 flex-1 flex-col overflow-y-auto",
        sidebar ? "gap-2 pr-0.5" : "gap-3 pr-1",
      )}
      role="listbox"
    >
      {projects.length > 0 ? (
        <section className="min-w-0">
          <SectionHeader
            countLabel={`${projects.length} 项`}
            icon="compose"
            title="Compose 应用"
          />
          <div className="mt-1 grid gap-1.5">
            {projects.map((project) => {
              const expanded = expandedProjectIds.has(project.id);
              return (
                <div
                  className={cn(
                    "overflow-hidden border border-[var(--border-subtle)] bg-[var(--surface-solid)]/64 shadow-sm shadow-black/5 dark:shadow-black/20",
                    sidebar ? "rounded-xl" : "rounded-2xl",
                  )}
                  key={project.id}
                >
                  <ComposeProjectRow
                    expanded={expanded}
                    onOpenProjectYaml={onOpenProjectYaml}
                    onSelectProject={onSelectProject}
                    onToggleProject={toggleProject}
                    presentation={presentation}
                    project={project}
                    selected={project.id === selectedProjectId}
                  />
                  {expanded ? (
                    <div className="grid gap-1 border-t border-[var(--border-subtle)] bg-black/[0.018] p-1.5 dark:bg-white/[0.026]">
                      {project.containers.map((item) => (
                        <HostContainerRow
                          compact
                          container={item.container}
                          displayName={item.service}
                          key={item.id}
                          onEnterContainer={onEnterContainer}
                          onInspectAction={onInspectAction}
                          onLifecycleAction={onLifecycleAction}
                          onOpenLogs={onOpenLogs}
                          onPinContainer={onPinContainer}
                          onSelectContainer={onSelectContainer}
                          pinning={pinningContainerId === item.id}
                          presentation={presentation}
                          selected={item.id === selectedContainerId}
                          showComposeMetadata={false}
                          subtitle={`${item.name} · ${item.image}`}
                          supportingParts={[
                            item.containerNumber
                              ? `#${item.containerNumber}`
                              : item.container.shortId,
                            item.ports.length
                              ? item.ports.join(", ")
                              : "无端口映射",
                          ]}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {standaloneContainers.length > 0 ? (
        <section className="min-w-0">
          <SectionHeader
            countLabel={`${standaloneContainers.length} 个`}
            icon="container"
            title="独立容器"
          />
          <div className="mt-1 grid gap-1.5">
            {standaloneContainers.map((item) => (
              <HostContainerRow
                container={item.container}
                key={item.id}
                onEnterContainer={onEnterContainer}
                onInspectAction={onInspectAction}
                onLifecycleAction={onLifecycleAction}
                onOpenLogs={onOpenLogs}
                onPinContainer={onPinContainer}
                onSelectContainer={onSelectContainer}
                pinning={pinningContainerId === item.id}
                presentation={presentation}
                selected={item.id === selectedContainerId}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ContainerGroupList({
  groups,
  onEnterContainer,
  onInspectAction,
  onLifecycleAction,
  onOpenLogs,
  onPinContainer,
  onSelectContainer,
  pinningContainerId,
  presentation = "default",
  selectedContainerId,
}: Pick<
  HostContainerListProps,
  | "groups"
  | "onEnterContainer"
  | "onInspectAction"
  | "onLifecycleAction"
  | "onOpenLogs"
  | "onPinContainer"
  | "onSelectContainer"
  | "pinningContainerId"
  | "presentation"
  | "selectedContainerId"
>) {
  const sidebar = presentation === "sidebar";

  return (
    <div
      aria-label="容器列表"
      className={cn(
        "scrollbar-none flex min-h-0 flex-1 flex-col overflow-y-auto",
        sidebar ? "gap-2 pr-0.5" : "gap-3 pr-1",
      )}
      role="listbox"
    >
      {groups.map((group) => (
        <section className="min-w-0" key={group.id}>
          <SectionHeader
            countLabel={`${group.runningCount}/${group.totalCount} 运行`}
            icon="container"
            title={group.title}
          />
          <div className="mt-1 grid gap-1.5">
            {group.containers.map((container) => (
              <HostContainerRow
                container={container}
                key={container.id}
                onEnterContainer={onEnterContainer}
                onInspectAction={onInspectAction}
                onLifecycleAction={onLifecycleAction}
                onOpenLogs={onOpenLogs}
                onPinContainer={onPinContainer}
                onSelectContainer={onSelectContainer}
                pinning={pinningContainerId === container.id}
                presentation={presentation}
                selected={container.id === selectedContainerId}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function SectionHeader({
  countLabel,
  icon,
  title,
}: {
  countLabel: string;
  icon: "compose" | "container";
  title: string;
}) {
  const Icon = icon === "compose" ? Layers : Box;
  return (
    <div className="sticky top-0 z-10 flex h-8 items-center justify-between gap-3 rounded-xl bg-[var(--surface-overlay)] px-2 text-xs backdrop-blur-xl">
      <div className="flex min-w-0 items-center gap-2">
        <Icon
          className="h-3.5 w-3.5 shrink-0 text-zinc-400"
          strokeWidth={1.8}
        />
        <span className="truncate font-medium text-zinc-700 dark:text-zinc-200">
          {title}
        </span>
      </div>
      <span className="shrink-0 text-[11px] text-zinc-500 dark:text-zinc-400">
        {countLabel}
      </span>
    </div>
  );
}

function ComposeProjectRow({
  expanded,
  onOpenProjectYaml,
  onSelectProject,
  onToggleProject,
  presentation = "default",
  project,
  selected,
}: {
  expanded: boolean;
  onOpenProjectYaml: (projectId: string) => void;
  onSelectProject: (projectId: string) => void;
  onToggleProject: (projectId: string) => void;
  presentation?: HostContainerListProps["presentation"];
  project: ComposeProjectView;
  selected: boolean;
}) {
  const sidebar = presentation === "sidebar";
  const statusTone =
    project.errorCount > 0
      ? statusToneClassNames.danger.dot
      : project.runningCount > 0
        ? statusToneClassNames.running.dot
        : statusToneClassNames.muted.dot;
  const primaryPath =
    project.workingDir ?? project.configPaths[0] ?? "未发现 Compose YAML 路径";
  const selectProject = () => onSelectProject(project.id);
  const toggleProject = () => onToggleProject(project.id);

  return (
    <div
      aria-expanded={expanded}
      aria-label={`Compose 应用 ${project.project}`}
      aria-selected={selected}
      className={cn(
        "kerminal-focus-ring grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 text-left outline-none transition",
        sidebar ? "px-2.5 py-2" : "px-3 py-2.5",
        selected
          ? "bg-[var(--surface-selected)] shadow-sm shadow-sky-500/10"
          : "hover:bg-[var(--surface-hover)]",
      )}
      onClick={selectProject}
      onDoubleClick={toggleProject}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          selectProject();
          return;
        }
        if (event.key === " ") {
          event.preventDefault();
          toggleProject();
        }
      }}
      role="option"
      tabIndex={0}
    >
      <button
        aria-label={`${expanded ? "折叠" : "展开"} Compose 应用 ${project.project}`}
        className="kerminal-pressable kerminal-focus-ring -ml-1 inline-flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-black/5 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-zinc-100"
        onClick={(event) => {
          event.stopPropagation();
          toggleProject();
        }}
        title={expanded ? "折叠项目容器" : "展开项目容器"}
        type="button"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
      </button>
      <div className="grid min-w-0 gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className={cn("h-2 w-2 shrink-0 rounded-full", statusTone)}
          />
          <span className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50">
            {project.project}
          </span>
          {sidebar ? null : (
            <span className="shrink-0 rounded-full bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:text-sky-200">
              Compose
            </span>
          )}
          <span className="shrink-0 rounded-full bg-zinc-500/10 px-2 py-0.5 font-mono text-[11px] text-zinc-600 dark:text-zinc-300">
            {project.runningCount}/{project.totalCount}
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
          <FileCode2 className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
          <span className="truncate font-mono" title={primaryPath}>
            {primaryPath}
          </span>
        </div>
      </div>
      <div className="grid w-8 shrink-0 grid-cols-1 items-center justify-end gap-1">
        <Button
          aria-label={`打开 Compose YAML ${project.project}`}
          className={rowIconButtonClassName}
          onClick={(event) => {
            event.stopPropagation();
            onOpenProjectYaml(project.id);
          }}
          size="icon"
          title="查看 Compose YAML"
          type="button"
          variant="ghost"
        >
          <FileCode2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function HostContainerRow({
  compact = false,
  container,
  displayName,
  onEnterContainer,
  onInspectAction,
  onLifecycleAction,
  onOpenLogs,
  onPinContainer,
  onSelectContainer,
  pinning,
  presentation = "default",
  selected,
  showComposeMetadata = true,
  subtitle,
  supportingParts,
}: {
  compact?: boolean;
  container: HostContainerMetadata;
  displayName?: string;
  onEnterContainer: (container: HostContainerMetadata) => void;
  onInspectAction: (
    tab: HostContainerInspectorTab,
    container: HostContainerMetadata,
  ) => void;
  onLifecycleAction: (
    action: HostContainerLifecycleAction,
    container: HostContainerMetadata,
  ) => void;
  onOpenLogs: (container: HostContainerMetadata) => void;
  onPinContainer: (container: HostContainerMetadata) => void;
  onSelectContainer: (containerId: string) => void;
  pinning: boolean;
  presentation?: HostContainerListProps["presentation"];
  selected: boolean;
  showComposeMetadata?: boolean;
  subtitle?: string;
  supportingParts?: string[];
}) {
  const project = containerProjectName(container);
  const service = containerComposeService(container);
  const tone = hostContainerStatusTone(container.status);
  const toneClassNames = statusToneClassNames[tone];
  const canEnter = canEnterHostContainer(container);
  const canStart = canRunHostContainerLifecycleAction(container, "start");
  const sidebar = presentation === "sidebar";
  const portLabel =
    container.ports.length > 0 ? container.ports.join(", ") : "无端口映射";
  const metadataParts =
    supportingParts ??
    [
      container.shortId,
      portLabel,
      showComposeMetadata && project ? `project:${project}` : "",
      showComposeMetadata && service ? `service:${service}` : "",
    ].filter(Boolean);

  const selectContainer = () => onSelectContainer(container.id);
  const rowActionButtonClassName = cn(
    rowIconButtonClassName,
    sidebar && "h-7 w-7",
  );
  const enterContainer = () => {
    selectContainer();
    if (canEnter) {
      onEnterContainer(container);
    }
  };

  return (
    <div
      aria-selected={selected}
      className={cn(
        "kerminal-focus-ring group grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3 text-left outline-none transition",
        compact
          ? "rounded-xl border border-transparent px-2 py-1.5"
          : "rounded-2xl border px-3 py-2.5",
        sidebar && !compact && "rounded-xl px-2.5 py-2",
        selected
          ? "border-sky-500/40 bg-[var(--surface-selected)] shadow-sm shadow-sky-500/10"
          : compact
            ? "hover:border-[var(--border-subtle)] hover:bg-[var(--surface-hover)]"
            : "border-[var(--border-subtle)] bg-[var(--surface-solid)]/72 hover:bg-[var(--surface-hover)]",
      )}
      onClick={selectContainer}
      onDoubleClick={enterContainer}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          enterContainer();
        }
      }}
      role="option"
      tabIndex={0}
    >
      <div className="grid min-w-0 gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className={cn("h-2 w-2 shrink-0 rounded-full", toneClassNames.dot)}
          />
          <span className="truncate text-sm font-medium text-zinc-950 dark:text-zinc-50">
            {displayName ?? container.name}
          </span>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
              toneClassNames.chip,
            )}
          >
            {hostContainerStatusLabel(container.status)}
          </span>
        </div>
        <div className="min-w-0 truncate text-xs text-zinc-500 dark:text-zinc-400">
          {subtitle ?? `${container.image}${container.statusText ? ` · ${container.statusText}` : ""}`}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-400 dark:text-zinc-500">
          {metadataParts.map((part, index) => (
            <span
              className={cn(index === 0 && "font-mono", "min-w-0 truncate")}
              key={`${container.id}:${part}`}
            >
              {part}
            </span>
          ))}
        </div>
      </div>
      <div
        className={cn(
          "grid shrink-0 items-center justify-end gap-1 self-center",
          sidebar ? "w-[3.75rem] grid-cols-2" : "w-[8.75rem] grid-cols-4",
        )}
      >
        {canEnter ? (
          <Button
            aria-label={`进入容器 ${container.name}`}
            className={cn(
              rowActionButtonClassName,
              selected && "text-white hover:text-white",
            )}
            onClick={(event) => {
              event.stopPropagation();
              enterContainer();
            }}
            size="icon"
            title="进入容器终端"
            type="button"
            variant={selected ? "primary" : "secondary"}
          >
            <Terminal className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            aria-label={`启动容器 ${container.name}`}
            className={cn(
              rowActionButtonClassName,
              selected && canStart && "text-white hover:text-white",
            )}
            disabled={!canStart}
            onClick={(event) => {
              event.stopPropagation();
              selectContainer();
              onLifecycleAction("start", container);
            }}
            size="icon"
            title={canStart ? "启动容器" : "容器正在重启"}
            type="button"
            variant={selected && canStart ? "primary" : "secondary"}
          >
            <Play className="h-4 w-4" />
          </Button>
        )}
        {sidebar ? null : (
          <>
            <Button
              aria-label={`查看容器 ${container.name} 日志`}
              className={rowActionButtonClassName}
              onClick={(event) => {
                event.stopPropagation();
                selectContainer();
                onOpenLogs(container);
              }}
              size="icon"
              title="打开实时日志终端"
              type="button"
              variant="ghost"
            >
              <ScrollText className="h-4 w-4" />
            </Button>
            <Button
              aria-label={`固定容器 ${container.name} 到侧栏`}
              className={rowActionButtonClassName}
              disabled={pinning}
              onClick={(event) => {
                event.stopPropagation();
                selectContainer();
                onPinContainer(container);
              }}
              size="icon"
              title="固定到侧栏"
              type="button"
              variant="ghost"
            >
              <Pin className="h-4 w-4" />
            </Button>
          </>
        )}
        <HostContainerActionsMenu
          compact={sidebar}
          container={container}
          onAction={onLifecycleAction}
          onInspectAction={onInspectAction}
          onOpenLogs={sidebar ? onOpenLogs : undefined}
          onPinContainer={sidebar ? onPinContainer : undefined}
          onSelectContainer={onSelectContainer}
          pinning={pinning}
          showInspectorItems={!sidebar}
        />
      </div>
    </div>
  );
}

function areSetsEqual(left: Set<string>, right: Set<string>) {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}
