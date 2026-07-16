/**
 * Compose project inspector for host-scoped containers.
 *
 * @author kongweiguang
 */

import { Copy, FileCode2, RefreshCw, ScrollText, Terminal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../../components/ui/button";
import { UserFacingNotice } from "../../../components/ui/user-facing-notice";
import { cn } from "../../../lib/cn";
import { writeDesktopClipboardText } from "../../../lib/desktopClipboardApi";
import { configureKerminalMonaco } from "../../../lib/monacoTheme";
import {
  buildUserFacingError,
  type UserFacingMessage,
} from "../../../lib/userFacingMessage";
import { MonacoTextEditor } from "../../sftp/editor/index";
import { languageForPath } from "../../sftp/editor/index";
import {
  readRemoteWorkspaceTextFile,
  type RemoteWorkspaceReadTextFileResponse,
} from "../../sftp/editor/index";
import type { OpenWorkspaceFileTabOptions } from "../../workspace/state/index";
import type { ComposeProjectView } from "./composeProjectModel";
import {
  canEnterHostContainer,
  hostContainerStatusLabel,
  hostContainerStatusTone,
  type HostContainerMetadata,
} from "./hostContainerDialogModel";
import {
  Field,
  Metric,
  PathList,
  StateMessage,
  YamlMetadata,
  buildYamlMetadataItems,
  composeYamlRootPath,
  useMonacoThemeName,
} from "./composeProjectInspectorPresenter";

export type ComposeProjectInspectorTab = "overview" | "containers" | "yaml";

const inspectorTabs: Array<{
  id: ComposeProjectInspectorTab;
  label: string;
}> = [
  { id: "overview", label: "概览" },
  { id: "containers", label: "容器" },
  { id: "yaml", label: "YAML" },
];

const statusToneClassNames = {
  attention: "bg-amber-400",
  danger: "bg-red-500",
  muted: "bg-zinc-400",
  running: "bg-emerald-400",
} as const;

const inspectorIconButtonClassName =
  "h-8 w-8 rounded-lg text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50";
const inspectorPanelClassName =
  "grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--surface-content)] p-3";
const inspectorHeaderClassName =
  "grid h-[5.75rem] grid-rows-[minmax(0,2.25rem)_2rem] gap-3 border-b border-[var(--border-subtle)] pb-3";
const inspectorTabsClassName =
  "grid h-8 w-full max-w-[22rem] justify-self-end rounded-xl bg-black/5 p-0.5 dark:bg-white/10";
const inspectorBodyClassName =
  "min-h-0 overflow-y-auto pt-3 [scrollbar-gutter:stable]";
const yamlPreviewFrameClassName =
  "h-full min-h-0 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-white shadow-inner dark:bg-black/60";

type YamlPreviewState = {
  binary?: boolean;
  bytesRead?: number;
  content: string;
  encoding?: string;
  error: UserFacingMessage | null;
  lineEnding?: string;
  loading: boolean;
  maxBytes?: number;
  path?: string;
  readonly?: boolean;
  revision?: RemoteWorkspaceReadTextFileResponse["revision"];
  truncated: boolean;
};

export function ComposeProjectInspector({
  hostId,
  onEnterContainer,
  onOpenContainerLogs,
  onOpenWorkspaceFileTab,
  onRefresh,
  onSelectContainer,
  onTabChange,
  project,
  tab,
}: {
  hostId: string;
  onEnterContainer: (container: HostContainerMetadata) => void;
  onOpenContainerLogs: (container: HostContainerMetadata) => void;
  onOpenWorkspaceFileTab?: (options: OpenWorkspaceFileTabOptions) => void;
  onRefresh: () => void;
  onSelectContainer: (container: HostContainerMetadata) => void;
  onTabChange: (tab: ComposeProjectInspectorTab) => void;
  project?: ComposeProjectView;
  tab: ComposeProjectInspectorTab;
}) {
  const configPathKey = project?.configPaths.join("\n") ?? "";
  const firstConfigPath = project?.configPaths[0];
  const [selectedPath, setSelectedPath] = useState<string | undefined>(
    firstConfigPath,
  );
  const [yamlState, setYamlState] = useState<YamlPreviewState>({
    content: "",
    error: null,
    loading: false,
    truncated: false,
  });
  const yamlRequestSequenceRef = useRef(0);

  useEffect(() => {
    yamlRequestSequenceRef.current += 1;
    setSelectedPath(firstConfigPath);
    setYamlState({
      content: "",
      error: null,
      loading: false,
      truncated: false,
    });
  }, [configPathKey, firstConfigPath, project?.id]);

  const loadYaml = useCallback(async () => {
    if (!project || !selectedPath) {
      return;
    }
    const requestId = yamlRequestSequenceRef.current + 1;
    yamlRequestSequenceRef.current = requestId;
    const requestedPath = selectedPath;
    setYamlState((current) => ({
      ...current,
      error: null,
      loading: true,
      path: requestedPath,
    }));
    try {
      const response = await readRemoteWorkspaceTextFile({
        maxBytes: 256 * 1024,
        path: requestedPath,
        target: { hostId, kind: "ssh" },
      });
      if (yamlRequestSequenceRef.current !== requestId) {
        return;
      }
      setYamlState({
        binary: response.binary,
        bytesRead: response.bytesRead,
        content: response.content,
        encoding: response.encoding,
        error: null,
        lineEnding: response.lineEnding,
        loading: false,
        maxBytes: response.maxBytes,
        path: requestedPath,
        readonly: response.readonly,
        revision: response.revision,
        truncated: response.truncated,
      });
    } catch (error: unknown) {
      if (yamlRequestSequenceRef.current !== requestId) {
        return;
      }
      setYamlState({
        content: "",
        error: buildUserFacingError(error, {
          detail: "当前 YAML 文件暂时无法预览。",
          recoveryAction: "请确认主机连接和文件路径有效，然后重试。",
          title: "无法读取 Compose YAML",
        }),
        loading: false,
        path: requestedPath,
        truncated: false,
      });
    }
  }, [hostId, project, selectedPath]);

  const openSelectedYamlInWorkspaceTab = useCallback(() => {
    if (!project || !selectedPath || !onOpenWorkspaceFileTab) {
      return;
    }
    onOpenWorkspaceFileTab({
      access: "readonly",
      path: selectedPath,
      rootPath: composeYamlRootPath(project, selectedPath),
      source: "composeYaml",
      target: { hostId, kind: "ssh" },
    });
  }, [hostId, onOpenWorkspaceFileTab, project, selectedPath]);

  useEffect(() => {
    if (tab !== "yaml" || !selectedPath) {
      return;
    }
    if (onOpenWorkspaceFileTab) {
      openSelectedYamlInWorkspaceTab();
      return;
    }
    void loadYaml();
  }, [
    loadYaml,
    onOpenWorkspaceFileTab,
    openSelectedYamlInWorkspaceTab,
    selectedPath,
    tab,
  ]);

  const primaryPath = project?.configPaths[0] ?? project?.configFiles[0] ?? "";
  const warningText = useMemo(
    () => project?.warnings.join(" / ") ?? "",
    [project?.warnings],
  );

  if (!project) {
    return (
      <aside className={inspectorPanelClassName}>
        <StateMessage>选择 Compose 项目后查看 YAML 和容器。</StateMessage>
      </aside>
    );
  }

  return (
    <aside className={inspectorPanelClassName}>
      <div className={inspectorHeaderClassName}>
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="grid min-w-0 gap-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                {project.project}
              </span>
              <span className="shrink-0 rounded-full bg-zinc-500/10 px-2 py-0.5 font-mono text-[11px] text-zinc-600 dark:text-zinc-300">
                {project.runningCount}/{project.totalCount}
              </span>
            </div>
            <div className="truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
              {primaryPath || project.workingDir || "未发现 Compose YAML 路径"}
            </div>
          </div>
          <Button
            aria-label="刷新 Compose 项目"
            className={inspectorIconButtonClassName}
            onClick={onRefresh}
            size="icon"
            title="刷新 Compose 项目"
            type="button"
            variant="ghost"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
        <div
          aria-label="Compose 项目信息视图"
          className={cn(inspectorTabsClassName, "grid-cols-3")}
          role="tablist"
        >
          {inspectorTabs.map((item) => (
            <button
              aria-selected={tab === item.id}
              className={cn(
                "kerminal-focus-ring h-7 rounded-lg text-xs font-medium transition",
                tab === item.id
                  ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-900 dark:text-zinc-50"
                  : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100",
              )}
              key={item.id}
              onClick={() => onTabChange(item.id)}
              role="tab"
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div
        className={inspectorBodyClassName}
        data-testid="compose-project-inspector-body"
      >
        {tab === "overview" ? (
          <ProjectOverview project={project} warningText={warningText} />
        ) : tab === "containers" ? (
          <ProjectContainers
            onEnterContainer={onEnterContainer}
            onOpenContainerLogs={onOpenContainerLogs}
            onSelectContainer={onSelectContainer}
            project={project}
          />
        ) : (
          <ProjectYaml
            loading={yamlState.loading}
            onCopyPath={(path) => void writeDesktopClipboardText(path)}
            onLoadYaml={() => void loadYaml()}
            onOpenWorkspaceFileTab={
              onOpenWorkspaceFileTab ? openSelectedYamlInWorkspaceTab : undefined
            }
            onSelectPath={setSelectedPath}
            project={project}
            selectedPath={selectedPath}
            yamlContent={yamlState.content}
            yamlError={yamlState.error}
            yamlMetadata={{
              bytesRead: yamlState.bytesRead,
              encoding: yamlState.encoding,
              lineEnding: yamlState.lineEnding,
              maxBytes: yamlState.maxBytes,
              readonly: yamlState.readonly,
              revision: yamlState.revision,
            }}
            yamlPath={yamlState.path}
            yamlTruncated={yamlState.truncated}
          />
        )}
      </div>
    </aside>
  );
}
function ProjectOverview({
  project,
  warningText,
}: {
  project: ComposeProjectView;
  warningText: string;
}) {
  return (
    <div className="grid gap-3 text-xs">
      <div className="grid grid-cols-3 gap-2">
        <Metric label="服务" value={project.services.length} />
        <Metric label="运行" value={`${project.runningCount}/${project.totalCount}`} />
        <Metric label="异常" value={project.errorCount} />
      </div>
      <Field label="运行时" value={`${project.runtime} / ${project.runtimeFamily}`} />
      <Field label="工作目录" mono value={project.workingDir ?? "-"} />
      <PathList label="Compose YAML" values={project.configPaths} />
      {warningText ? <StateMessage tone="danger">{warningText}</StateMessage> : null}
    </div>
  );
}
function ProjectContainers({
  onEnterContainer,
  onOpenContainerLogs,
  onSelectContainer,
  project,
}: {
  onEnterContainer: (container: HostContainerMetadata) => void;
  onOpenContainerLogs: (container: HostContainerMetadata) => void;
  onSelectContainer: (container: HostContainerMetadata) => void;
  project: ComposeProjectView;
}) {
  return (
    <div className="grid gap-1.5">
      {project.containers.map((item) => {
        const tone = hostContainerStatusTone(item.status);
        const canEnter = canEnterHostContainer(item.container);
        return (
          <div
            className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-xl border border-transparent bg-black/[0.035] px-2.5 py-2 transition hover:border-[var(--border-subtle)] hover:bg-[var(--surface-hover)] dark:bg-white/[0.055]"
            key={item.id}
          >
            <button
              className="kerminal-focus-ring grid min-w-0 gap-0.5 rounded-lg text-left outline-none"
              onClick={() => onSelectContainer(item.container)}
              type="button"
            >
              <span className="flex min-w-0 items-center gap-2 text-xs font-medium text-zinc-900 dark:text-zinc-100">
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-2 w-2 shrink-0 rounded-full",
                    statusToneClassNames[tone],
                  )}
                />
                <span className="truncate">{item.service}</span>
                <span className="shrink-0 text-[11px] text-zinc-400">
                  {hostContainerStatusLabel(item.status)}
                </span>
              </span>
              <span className="truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                {item.name} · {item.image}
              </span>
            </button>
            <div className="flex items-center gap-1">
              <Button
                aria-label={`查看容器 ${item.name} 日志`}
                className={inspectorIconButtonClassName}
                onClick={() => onOpenContainerLogs(item.container)}
                size="icon"
                title="打开实时日志终端"
                type="button"
                variant="ghost"
              >
                <ScrollText className="h-4 w-4" />
              </Button>
              <Button
                aria-label={`进入容器 ${item.name}`}
                className={inspectorIconButtonClassName}
                disabled={!canEnter}
                onClick={() => onEnterContainer(item.container)}
                size="icon"
                title={canEnter ? "进入容器终端" : "容器未运行"}
                type="button"
                variant="ghost"
              >
                <Terminal className="h-4 w-4" />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ProjectYaml({
  loading,
  onCopyPath,
  onLoadYaml,
  onOpenWorkspaceFileTab,
  onSelectPath,
  project,
  selectedPath,
  yamlContent,
  yamlError,
  yamlMetadata,
  yamlPath,
  yamlTruncated,
}: {
  loading: boolean;
  onCopyPath: (path: string) => void;
  onLoadYaml: () => void;
  onOpenWorkspaceFileTab?: () => void;
  onSelectPath: (path: string) => void;
  project: ComposeProjectView;
  selectedPath?: string;
  yamlContent: string;
  yamlError: UserFacingMessage | null;
  yamlMetadata: {
    bytesRead?: number;
    encoding?: string;
    lineEnding?: string;
    maxBytes?: number;
    readonly?: boolean;
    revision?: RemoteWorkspaceReadTextFileResponse["revision"];
  };
  yamlPath?: string;
  yamlTruncated: boolean;
}) {
  const editorTheme = useMonacoThemeName();
  const editorPath = selectedPath ?? "compose.yaml";
  const metadataItems = buildYamlMetadataItems(yamlMetadata, yamlTruncated);
  const editorValue = loading
    ? "正在读取 Compose YAML...\n"
    : yamlContent || `# 选择路径后预览宿主机文件\n# ${yamlPath ?? selectedPath ?? ""}\n`;

  if (project.configPaths.length === 0) {
    return <StateMessage>未发现 Compose YAML 路径。</StateMessage>;
  }

  return (
    <div className="grid h-full min-h-0 grid-rows-[2.25rem_1.75rem_minmax(0,1fr)_1.25rem] gap-2.5">
      <div className="flex h-9 min-w-0 items-center justify-between gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-solid)]/70 px-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <FileCode2
            className="h-4 w-4 shrink-0 text-zinc-400"
            strokeWidth={1.8}
          />
          <span className="truncate font-mono text-[11px] text-zinc-700 dark:text-zinc-200">
            {selectedPath ?? "未选择 Compose YAML"}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            aria-label="重新读取 Compose YAML"
            className={inspectorIconButtonClassName}
            disabled={loading || !selectedPath}
            onClick={onLoadYaml}
            size="icon"
            title="重新读取"
            type="button"
            variant="ghost"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </Button>
          {selectedPath ? (
            <Button
              aria-label="复制 Compose YAML 路径"
              className={inspectorIconButtonClassName}
              onClick={() => onCopyPath(selectedPath)}
              size="icon"
              title="复制路径"
              type="button"
              variant="ghost"
            >
              <Copy className="h-4 w-4" />
            </Button>
          ) : null}
          {onOpenWorkspaceFileTab ? (
            <Button
              aria-label="在中间工作区打开 Compose YAML"
              className={inspectorIconButtonClassName}
              disabled={!selectedPath}
              onClick={onOpenWorkspaceFileTab}
              size="icon"
              title="在中间工作区打开"
              type="button"
              variant="ghost"
            >
              <FileCode2 className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>
      {project.configPaths.length > 1 ? (
        <div className="scrollbar-none flex h-7 min-w-0 items-center gap-1 overflow-x-auto">
          {project.configPaths.map((path) => (
            <button
              aria-pressed={selectedPath === path}
              className={cn(
                "kerminal-focus-ring max-w-[18rem] shrink-0 truncate rounded-lg px-2 py-1 font-mono text-[11px] transition",
                selectedPath === path
                  ? "bg-sky-500/10 text-sky-700 dark:text-sky-200"
                  : "bg-black/5 text-zinc-500 hover:text-zinc-800 dark:bg-white/10 dark:text-zinc-400 dark:hover:text-zinc-100",
              )}
              key={path}
              onClick={() => onSelectPath(path)}
              title={path}
              type="button"
            >
              {path}
            </button>
          ))}
        </div>
      ) : (
        <div className="h-7 min-w-0" />
      )}
      {yamlError ? (
        <div
          aria-label="Compose YAML 预览"
          className={yamlPreviewFrameClassName}
          role="region"
        >
          <div className="flex h-full min-h-0 items-center justify-center overflow-y-auto p-4">
            <UserFacingNotice
              className="w-full max-w-lg text-left"
              compact
              message={yamlError}
            />
          </div>
        </div>
      ) : (
        <div
          aria-label="Compose YAML 预览"
          className={yamlPreviewFrameClassName}
          role="region"
        >
          <MonacoTextEditor
            beforeMount={configureKerminalMonaco}
            height="100%"
            language={languageForPath(editorPath)}
            options={{
              automaticLayout: true,
              domReadOnly: true,
              fontFamily: "JetBrains Mono, SFMono-Regular, Consolas, monospace",
              fontSize: 12,
              lineNumbers: "on",
              minimap: { enabled: false },
              padding: { bottom: 12, top: 12 },
              readOnly: true,
              renderLineHighlight: "none",
              scrollBeyondLastLine: false,
              tabSize: 2,
              wordWrap: "on",
            }}
            path={`compose-yaml:${editorPath}`}
            theme={editorTheme}
            value={editorValue}
          />
        </div>
      )}
      {yamlTruncated ? (
        <div className="flex h-5 min-w-0 items-center justify-between gap-3 text-[11px] text-amber-600 dark:text-amber-300">
          <span className="truncate">文件超过预览上限，内容已截断。</span>
          <YamlMetadata metadataItems={metadataItems} />
        </div>
      ) : (
        <div className="flex h-5 min-w-0 items-center justify-end">
          <YamlMetadata metadataItems={metadataItems} />
        </div>
      )}
    </div>
  );
}
