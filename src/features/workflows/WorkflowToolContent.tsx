import {
  CheckCircle2,
  ListChecks,
  Plus,
  Search,
  Send,
  Tag,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { cn } from "../../lib/cn";
import {
  createWorkflow,
  deleteWorkflow,
  listWorkflows,
  type CommandWorkflow,
  type WorkflowScope,
} from "../../lib/workflowApi";
import { writeWorkflowCommand } from "../terminal/terminalSessionRegistry";
import type { TerminalPane } from "../workspace/types";
import {
  buildWorkflowRunState,
  completeWorkflowStepExecution,
  failWorkflowStepExecution,
  getWorkflowRunPreview,
  prepareWorkflowStepExecution,
  startWorkflowStepExecution,
  updateWorkflowRunConfirmation,
  updateWorkflowRunVariable,
  type WorkflowRunState,
} from "./workflowRunModel";

interface WorkflowToolContentProps {
  activeTabId?: string;
  configRevision?: number;
  focusedPane?: TerminalPane;
}

interface DraftWorkflowStep {
  id: string;
  command: string;
  description: string;
  requiresConfirmation: boolean;
  scope: WorkflowScope | "";
  title: string;
}

const workflowScopeFilterOptions = [
  { label: "全部", value: "" },
  { label: "通用", value: "any" },
  { label: "本地", value: "local" },
  { label: "SSH", value: "ssh" },
];

const workflowScopeOptions = workflowScopeFilterOptions.slice(1);

const workflowStepScopeOptions = [
  { label: "继承", value: "" },
  ...workflowScopeOptions,
];

const workflowPanelClassName = "kerminal-solid-surface rounded-2xl border p-4";

const workflowMutedPanelClassName =
  "kerminal-muted-surface rounded-2xl border p-4 text-sm text-zinc-500 dark:text-zinc-400";

const workflowInputClassName =
  "kerminal-field-surface h-9 w-full rounded-xl border px-3 text-sm text-zinc-900 placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500";

const workflowSearchInputClassName =
  "kerminal-field-surface h-9 w-full rounded-xl border pl-9 pr-3 text-sm text-zinc-900 placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500";

const workflowMonoInputClassName =
  "kerminal-field-surface h-9 w-full rounded-xl border px-3 font-mono text-sm text-zinc-900 placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500";

const workflowTextareaClassName =
  "kerminal-field-surface min-h-20 w-full resize-y rounded-xl border px-3 py-2 font-mono text-xs leading-5 text-zinc-900 placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500";

function workflowNoticeClassName(
  kind: "error" | "success" | "warning",
  className?: string,
) {
  return cn(
    "rounded-xl border px-3 py-2 text-sm",
    kind === "error" &&
      "border-rose-300/25 bg-rose-500/10 text-rose-700 dark:text-rose-100",
    kind === "success" &&
      "border-emerald-300/20 bg-emerald-400/10 text-emerald-700 dark:text-emerald-100",
    kind === "warning" &&
      "border-amber-300/20 bg-amber-400/10 text-amber-700 dark:text-amber-100",
    className,
  );
}

export function WorkflowToolContent({
  activeTabId,
  configRevision,
  focusedPane,
}: WorkflowToolContentProps) {
  const [description, setDescription] = useState("本地项目常用检查链路");
  const [configDraftNotice, setConfigDraftNotice] = useState<string | null>(
    null,
  );
  const [draftTouched, setDraftTouched] = useState(false);
  const [draftSteps, setDraftSteps] = useState<DraftWorkflowStep[]>(
    initialDraftSteps,
  );
  const [error, setError] = useState<string | null>(null);
  const [filterScope, setFilterScope] = useState<WorkflowScope | "">("");
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [runState, setRunState] = useState<WorkflowRunState | null>(null);
  const [tags, setTags] = useState("daily, quality");
  const [title, setTitle] = useState("本地质量检查");
  const [workflowScope, setWorkflowScope] = useState<WorkflowScope>("local");
  const [workflows, setWorkflows] = useState<CommandWorkflow[]>([]);
  const lastConfigRevisionRef = useRef<number | undefined>(configRevision);
  const hasActiveWorkflowFilters = Boolean(query.trim() || filterScope);
  const workflowEmptyMessage = hasActiveWorkflowFilters
    ? "当前筛选下没有命令工作流。"
    : "暂无命令工作流。";

  const loadWorkflows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextWorkflows = await listWorkflows({
        query: query || undefined,
        scope: filterScope || undefined,
      });
      setWorkflows(nextWorkflows);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  }, [filterScope, query]);

  useEffect(() => {
    void loadWorkflows();
  }, [configRevision, loadWorkflows]);

  useEffect(() => {
    if (configRevision === undefined) {
      return;
    }
    if (lastConfigRevisionRef.current === undefined) {
      lastConfigRevisionRef.current = configRevision;
      return;
    }
    if (lastConfigRevisionRef.current === configRevision) {
      return;
    }
    lastConfigRevisionRef.current = configRevision;
    if (draftTouched || runState) {
      setConfigDraftNotice("cfg: workflows reloaded; draft kept");
    }
  }, [configRevision, draftTouched, runState]);

  useEffect(() => {
    if (!configDraftNotice) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setConfigDraftNotice(null);
    }, 3500);
    return () => window.clearTimeout(timer);
  }, [configDraftNotice]);

  const createCurrentWorkflow = async () => {
    const steps = draftSteps
      .map((step) => ({
        command: step.command,
        description: step.description || undefined,
        requiresConfirmation: step.requiresConfirmation,
        scope: step.scope || undefined,
        title: step.title,
      }))
      .filter((step) => step.title.trim() || step.command.trim());

    if (steps.length === 0) {
      setError("工作流至少需要一个命令步骤。");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await createWorkflow({
        description,
        scope: workflowScope,
        steps,
        tags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        title,
      });
      await loadWorkflows();
      setDraftTouched(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  };

  const deleteCurrentWorkflow = async (workflowId: string) => {
    setLoading(true);
    setError(null);
    try {
      await deleteWorkflow(workflowId);
      setRunState((current) =>
        current?.workflowId === workflowId ? null : current,
      );
      await loadWorkflows();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  };

  const updateDraftStep = (
    stepId: string,
    patch: Partial<Omit<DraftWorkflowStep, "id">>,
  ) => {
    setDraftTouched(true);
    setDraftSteps((current) =>
      current.map((step) => (step.id === stepId ? { ...step, ...patch } : step)),
    );
  };

  const addDraftStep = () => {
    setDraftTouched(true);
    setDraftSteps((current) => [
      ...current,
      {
        command: "",
        description: "",
        id: `draft-step-${Date.now().toString(36)}`,
        requiresConfirmation: false,
        scope: "",
        title: `步骤 ${current.length + 1}`,
      },
    ]);
  };

  const removeDraftStep = (stepId: string) => {
    setDraftTouched(true);
    setDraftSteps((current) =>
      current.length <= 1 ? current : current.filter((step) => step.id !== stepId),
    );
  };

  const openWorkflowRunPanel = (workflow: CommandWorkflow) => {
    setRunState((current) => {
      if (current?.workflowId === workflow.id) {
        return null;
      }
      return buildWorkflowRunState(workflow);
    });
  };

  const updateWorkflowVariable = (
    workflowId: string,
    name: string,
    value: string,
  ) => {
    setRunState((current) => {
      if (!current || current.workflowId !== workflowId) {
        return current;
      }
      return updateWorkflowRunVariable(current, name, value);
    });
  };

  const setConfirmedStep = (workflowId: string, stepId: string, checked: boolean) => {
    setRunState((current) => {
      if (!current || current.workflowId !== workflowId) {
        return current;
      }
      return updateWorkflowRunConfirmation(current, stepId, checked);
    });
  };

  const executeNextWorkflowStep = async (
    workflow: CommandWorkflow,
    state: WorkflowRunState,
  ) => {
    const plan = prepareWorkflowStepExecution(workflow, state, focusedPane);
    if (plan.kind !== "ready") {
      setRunState(plan.state);
      return;
    }

    setRunState(startWorkflowStepExecution(state, plan.values));
    try {
      const result = await writeWorkflowCommand({
        command: plan.command,
        paneId: focusedPane?.id ?? "",
        tabId: activeTabId,
      });
      if (!result.sent) {
        throw new Error(
          result.reason === "missing-session"
            ? "当前分屏尚未连接，无法发送工作流步骤。"
            : "步骤渲染后为空，无法发送。",
        );
      }

      setRunState(
        completeWorkflowStepExecution({
          focusedPaneTitle: focusedPane?.title,
          state,
          values: plan.values,
          workflow,
        }),
      );
    } catch (nextError) {
      setRunState(failWorkflowStepExecution(state, nextError, plan.values));
    }
  };

  return (
    <section className="space-y-3">
      <div className={workflowPanelClassName}>
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
          <ListChecks className="h-4 w-4 text-violet-500 dark:text-violet-300" />
          工作流
        </div>
        <p className="mt-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
          保存多步命令，按确认点发送到当前分屏。
        </p>

        <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
          <label className="relative min-w-0">
            <span className="sr-only">搜索工作流</span>
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
            <input
              className={workflowSearchInputClassName}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索工作流、步骤或标签"
              value={query}
            />
          </label>
          <Select
            aria-label="工作流作用域"
            onValueChange={(value) =>
              setFilterScope(value as WorkflowScope | "")
            }
            options={workflowScopeFilterOptions}
            value={filterScope}
          />
        </div>
      </div>

      <div className={workflowPanelClassName}>
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
          <Plus className="h-4 w-4 text-emerald-500 dark:text-emerald-300" />
          新建工作流
        </div>
        <div className="mt-3 space-y-2">
          <input
            aria-label="工作流标题"
            className={workflowInputClassName}
            onChange={(event) => {
              setDraftTouched(true);
              setTitle(event.target.value);
            }}
            placeholder="工作流标题"
            value={title}
          />
          <input
            aria-label="工作流说明"
            className={workflowInputClassName}
            onChange={(event) => {
              setDraftTouched(true);
              setDescription(event.target.value);
            }}
            placeholder="说明，可选"
            value={description}
          />
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <input
              aria-label="工作流标签"
              className={workflowInputClassName}
              onChange={(event) => {
                setDraftTouched(true);
                setTags(event.target.value);
              }}
              placeholder="标签，用英文逗号分隔"
              value={tags}
            />
            <Select
              aria-label="工作流默认作用域"
              onValueChange={(value) => {
                setDraftTouched(true);
                setWorkflowScope(value as WorkflowScope);
              }}
              options={workflowScopeOptions}
              value={workflowScope}
            />
          </div>

          <div className="space-y-2">
            {draftSteps.map((step, index) => (
              <DraftStepEditor
                index={index}
                key={step.id}
                onRemove={removeDraftStep}
                onUpdate={updateDraftStep}
                step={step}
                totalSteps={draftSteps.length}
              />
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button onClick={addDraftStep} size="sm" variant="secondary">
              <Plus className="h-4 w-4" />
              添加步骤
            </Button>
            <Button
              disabled={loading || !title.trim() || draftSteps.every((step) => !step.command.trim())}
              onClick={() => void createCurrentWorkflow()}
              size="sm"
            >
              <CheckCircle2 className="h-4 w-4" />
              保存工作流
            </Button>
          </div>
        </div>
      </div>

      {error ? (
        <div
          className={workflowNoticeClassName("error", "rounded-2xl p-4")}
          role="alert"
        >
          {error}
        </div>
      ) : null}
      {configDraftNotice ? (
        <div
          className={workflowNoticeClassName("warning", "rounded-2xl p-3 font-mono text-xs")}
          role="status"
        >
          {configDraftNotice}
        </div>
      ) : null}

      <div className="space-y-2">
        {loading && workflows.length === 0 ? (
          <div className={workflowMutedPanelClassName} role="status">
            正在加载工作流...
          </div>
        ) : null}
        {!loading && !error && workflows.length === 0 ? (
          <div className={workflowMutedPanelClassName}>{workflowEmptyMessage}</div>
        ) : null}
        {workflows.map((workflow) => (
          <WorkflowCard
            focusedPane={focusedPane}
            key={workflow.id}
            loading={loading}
            onConfirmStep={setConfirmedStep}
            onDelete={deleteCurrentWorkflow}
            onExecuteNext={executeNextWorkflowStep}
            onOpenRunPanel={openWorkflowRunPanel}
            onVariableChange={updateWorkflowVariable}
            runState={runState?.workflowId === workflow.id ? runState : null}
            workflow={workflow}
          />
        ))}
      </div>
    </section>
  );
}

function DraftStepEditor({
  index,
  onRemove,
  onUpdate,
  step,
  totalSteps,
}: {
  index: number;
  onRemove: (stepId: string) => void;
  onUpdate: (
    stepId: string,
    patch: Partial<Omit<DraftWorkflowStep, "id">>,
  ) => void;
  step: DraftWorkflowStep;
  totalSteps: number;
}) {
  const stepNumber = index + 1;

  return (
    <div className="kerminal-muted-surface rounded-2xl border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          步骤 {stepNumber}
        </div>
        <Button
          aria-label={`删除步骤 ${stepNumber}`}
          disabled={totalSteps <= 1}
          onClick={() => onRemove(step.id)}
          size="sm"
          variant="ghost"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <div className="mt-2 space-y-2">
        <input
          aria-label={`步骤 ${stepNumber} 标题`}
          className={workflowInputClassName}
          onChange={(event) => onUpdate(step.id, { title: event.target.value })}
          placeholder="步骤标题"
          value={step.title}
        />
        <textarea
          aria-label={`步骤 ${stepNumber} 命令`}
          className={workflowTextareaClassName}
          onChange={(event) => onUpdate(step.id, { command: event.target.value })}
          placeholder="命令，可使用 {{变量}}"
          value={step.command}
        />
        <input
          aria-label={`步骤 ${stepNumber} 说明`}
          className={workflowInputClassName}
          onChange={(event) =>
            onUpdate(step.id, { description: event.target.value })
          }
          placeholder="说明，可选"
          value={step.description}
        />
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Select
            aria-label={`步骤 ${stepNumber} 作用域`}
            onValueChange={(value) =>
              onUpdate(step.id, { scope: value as WorkflowScope | "" })
            }
            options={workflowStepScopeOptions}
            value={step.scope}
          />
          <div className="kerminal-muted-surface inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-xs text-zinc-600 dark:text-zinc-300">
            <Switch
              aria-label={`步骤 ${stepNumber} 执行前确认`}
              checked={step.requiresConfirmation}
              onCheckedChange={(requiresConfirmation) =>
                onUpdate(step.id, {
                  requiresConfirmation,
                })
              }
            />
            确认点
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkflowCard({
  focusedPane,
  loading,
  onConfirmStep,
  onDelete,
  onExecuteNext,
  onOpenRunPanel,
  onVariableChange,
  runState,
  workflow,
}: {
  focusedPane?: TerminalPane;
  loading: boolean;
  onConfirmStep: (
    workflowId: string,
    stepId: string,
    checked: boolean,
  ) => void;
  onDelete: (workflowId: string) => Promise<void>;
  onExecuteNext: (
    workflow: CommandWorkflow,
    state: WorkflowRunState,
  ) => Promise<void>;
  onOpenRunPanel: (workflow: CommandWorkflow) => void;
  onVariableChange: (
    workflowId: string,
    name: string,
    value: string,
  ) => void;
  runState: WorkflowRunState | null;
  workflow: CommandWorkflow;
}) {
  const runPreview = useMemo(
    () => getWorkflowRunPreview(workflow, runState, focusedPane),
    [focusedPane, runState, workflow],
  );
  const {
    blocker: nextStepBlocker,
    canExecute,
    nextRenderedCommand,
    nextStep,
    values,
    variables,
  } = runPreview;

  return (
    <article className={workflowPanelClassName}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50">
            {workflow.title}
          </h3>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {scopeLabel(workflow.scope)}
            {workflow.description ? ` · ${workflow.description}` : ""}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-violet-400/25 bg-violet-500/10 px-2 py-0.5 text-xs text-violet-700 dark:text-violet-100">
          {workflow.steps.length} 步
        </span>
      </div>

      <ol className="mt-3 space-y-2">
        {workflow.steps.map((step, index) => (
          <li
            className="kerminal-muted-surface rounded-xl border p-3"
            key={step.id}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-medium text-zinc-700 dark:text-zinc-200">
                  {index + 1}. {step.title}
                </div>
                <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {scopeLabel(step.scope ?? workflow.scope)}
                  {step.requiresConfirmation ? " · 需要确认" : ""}
                </div>
              </div>
            </div>
            <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-zinc-700 dark:text-zinc-300">
              {step.command}
            </pre>
          </li>
        ))}
      </ol>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {workflow.tags.map((tag) => (
          <span
            className="kerminal-muted-surface inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-zinc-500 dark:text-zinc-400"
            key={tag}
          >
            <Tag className="h-3 w-3" />
            {tag}
          </span>
        ))}
        <div className="ml-auto flex gap-2">
          <Button
            aria-label={`运行工作流 ${workflow.title}`}
            aria-pressed={Boolean(runState)}
            disabled={workflow.steps.length === 0}
            onClick={() => onOpenRunPanel(workflow)}
            size="sm"
            variant="primary"
          >
            <Send className="h-4 w-4" />
            {runState ? "收起" : "运行"}
          </Button>
          <Button
            aria-label={`删除工作流 ${workflow.title}`}
            disabled={loading}
            onClick={() => void onDelete(workflow.id)}
            size="sm"
            variant="danger"
          >
            <Trash2 className="h-4 w-4" />
            删除
          </Button>
        </div>
      </div>

      {runState ? (
        <div className="kerminal-muted-surface kerminal-floating-enter mt-3 rounded-2xl border p-3">
          {variables.length > 0 ? (
            <div className="space-y-2">
              {variables.map((name) => (
                <label className="block" key={name}>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    变量 {name}
                  </span>
                  <input
                    aria-label={`工作流变量 ${name}`}
                    className={cn(workflowMonoInputClassName, "mt-1")}
                    onChange={(event) =>
                      onVariableChange(
                        workflow.id,
                        name,
                        event.currentTarget.value,
                      )
                    }
                    value={values[name] ?? ""}
                  />
                </label>
              ))}
            </div>
          ) : null}

          <div className="mt-3">
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              下一步
            </div>
            {nextStep ? (
              <div className="kerminal-solid-surface mt-1 rounded-xl border p-3">
                <div className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
                  {runState.nextStepIndex + 1}. {nextStep.title}
                </div>
                <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-zinc-800 dark:text-zinc-200">
                  {nextRenderedCommand || "等待变量输入。"}
                </pre>
              </div>
            ) : (
              <div className="kerminal-solid-surface mt-1 rounded-xl border p-3 text-sm text-zinc-500 dark:text-zinc-400">
                工作流步骤已全部发送。
              </div>
            )}
          </div>

          {nextStep?.requiresConfirmation ? (
            <div className={workflowNoticeClassName("warning", "mt-3 flex items-center justify-between gap-3")}>
              <span>执行前确认：{nextStep.title}</span>
              <Switch
                aria-label={`确认执行步骤 ${nextStep.title}`}
                checked={runState.confirmedStepId === nextStep.id}
                onCheckedChange={(checked) =>
                  onConfirmStep(
                    workflow.id,
                    nextStep.id,
                    checked,
                  )
                }
              />
            </div>
          ) : null}

          {nextStepBlocker ? (
            <p className={workflowNoticeClassName("warning", "mt-3 text-xs")}>
              {nextStepBlocker}
            </p>
          ) : null}
          {runState.error ? (
            <div
              className={workflowNoticeClassName("error", "mt-3")}
              role="alert"
            >
              {runState.error}
            </div>
          ) : null}
          {runState.status ? (
            <div
              className={workflowNoticeClassName("success", "mt-3")}
              role="status"
            >
              {runState.status}
            </div>
          ) : null}

          <Button
            className="mt-3 w-full"
            disabled={!canExecute}
            onClick={() => void (runState && onExecuteNext(workflow, runState))}
            size="sm"
            variant="primary"
          >
            <Send className="h-4 w-4" />
            {runState.sending ? "发送中" : "执行下一步"}
          </Button>
        </div>
      ) : null}
    </article>
  );
}

function scopeLabel(scope: WorkflowScope) {
  const labels: Record<WorkflowScope, string> = {
    any: "通用",
    local: "本地终端",
    ssh: "SSH 远程",
  };
  return labels[scope];
}

function initialDraftSteps(): DraftWorkflowStep[] {
  return [
    {
      command: "git status --short",
      description: "确认仓库状态",
      id: "draft-step-1",
      requiresConfirmation: false,
      scope: "",
      title: "检查仓库状态",
    },
    {
      command: "npm run check",
      description: "运行完整质量门禁",
      id: "draft-step-2",
      requiresConfirmation: true,
      scope: "",
      title: "运行质量门禁",
    },
  ];
}
