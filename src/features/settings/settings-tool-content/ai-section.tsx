import { Bot, Check, Clipboard, Hash, Terminal } from "lucide-react";
import { cn } from "../../../lib/cn";
import { LlmProviderSettingsSection } from "../LlmProviderSettingsSection";
import {
  AI_CONTEXT_OUTPUT_BYTES_MAX,
  AI_CONTEXT_OUTPUT_BYTES_MIN,
  type AiCommandApprovalPolicy,
  type AiSecuritySettings,
  type AppSettings,
} from "../settingsModel";
import { commandApprovalOptions } from "./options";
import { NumberSetting, PolicyToggle } from "./shared-controls";

interface AiSettingsSectionProps {
  normalizedSettings: AppSettings;
  updateAi: (ai: Partial<AiSecuritySettings>) => void;
  updateAiCommandApprovalPolicy: (
    commandApprovalPolicy: AiCommandApprovalPolicy,
  ) => void;
}

export function AiSettingsSection({
  normalizedSettings,
  updateAi,
  updateAiCommandApprovalPolicy,
}: AiSettingsSectionProps) {
  return (
    <div className="space-y-4" id="settings-ai-panel">
      <LlmProviderSettingsSection />
      <section className="kerminal-solid-surface rounded-2xl border p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
              <Bot className="h-4 w-4 text-emerald-500 dark:text-emerald-300" />
              AI 安全策略
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
              控制 AI
              可读取的终端上下文、命令执行确认和高风险工具边界，基础密钥脱敏始终开启。
            </p>
          </div>
          <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-700 dark:text-emerald-100">
            本机策略
          </span>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <div className="space-y-4">
            <section className="kerminal-muted-surface rounded-xl border p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                <Check className="h-4 w-4 text-zinc-400" />
                命令确认策略
              </div>
              <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                先决定 AI 调用工具时的确认强度，再用下方开关限定可执行范围。
              </p>
              <div className="mt-3 grid gap-2 md:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
                {commandApprovalOptions.map((option) => {
                  const selected =
                    normalizedSettings.ai.commandApprovalPolicy ===
                    option.value;
                  return (
                    <button
                      aria-pressed={selected}
                      className={cn(
                        "kerminal-focus-ring kerminal-pressable min-h-28 rounded-xl border px-3 py-2.5 text-left",
                        selected
                          ? "border-sky-500/45 bg-[var(--surface-selected)] text-sky-700 shadow-sm shadow-sky-950/5 dark:border-sky-300/35 dark:text-sky-100"
                          : "border-[var(--border-subtle)] bg-[var(--surface-field)] text-zinc-600 hover:bg-[var(--surface-hover)] dark:text-zinc-300",
                      )}
                      key={option.value}
                      onClick={() =>
                        updateAiCommandApprovalPolicy(option.value)
                      }
                      type="button"
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium">
                          {option.label}
                        </span>
                        {selected ? (
                          <Check className="h-4 w-4 shrink-0 text-sky-500 dark:text-sky-200" />
                        ) : null}
                      </span>
                      <span className="mt-1.5 block text-xs leading-5 opacity-80">
                        {option.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="kerminal-muted-surface rounded-xl border p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                <Terminal className="h-4 w-4 text-zinc-400" />
                权限开关
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                <PolicyToggle
                  checked={normalizedSettings.ai.includeCommandHistory}
                  icon={Clipboard}
                  label="纳入命令历史"
                  onChange={(includeCommandHistory) =>
                    updateAi({ includeCommandHistory })
                  }
                />
                <PolicyToggle
                  checked={normalizedSettings.ai.allowDestructiveTools}
                  icon={Terminal}
                  label="允许破坏性工具（总开关）"
                  onChange={(allowDestructiveTools) =>
                    updateAi({ allowDestructiveTools })
                  }
                />
              </div>
            </section>
          </div>

          <div className="space-y-4">
            <section className="kerminal-muted-surface rounded-xl border p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                <Hash className="h-4 w-4 text-zinc-400" />
                上下文预算
              </div>
              <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                限制单次输出、终端尾部和命令等待时间，避免一次请求带入过多噪音。
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
                <NumberSetting
                  displayScale={1024}
                  help="显示单位为 K，内部会自动换算保存。"
                  label="上下文输出上限"
                  max={AI_CONTEXT_OUTPUT_BYTES_MAX}
                  min={AI_CONTEXT_OUTPUT_BYTES_MIN}
                  onChange={(contextMaxOutputBytes) =>
                    updateAi({ contextMaxOutputBytes })
                  }
                  step={512}
                  suffix="K"
                  value={normalizedSettings.ai.contextMaxOutputBytes}
                />
                <NumberSetting
                  label="命令超时"
                  max={600}
                  min={5}
                  onChange={(commandTimeoutSeconds) =>
                    updateAi({ commandTimeoutSeconds })
                  }
                  suffix="秒"
                  value={normalizedSettings.ai.commandTimeoutSeconds}
                />
                <NumberSetting
                  label="附带终端尾部"
                  max={500}
                  min={10}
                  onChange={(terminalTailLines) =>
                    updateAi({ terminalTailLines })
                  }
                  suffix="行"
                  value={normalizedSettings.ai.terminalTailLines}
                />
              </div>
            </section>

            <section className="kerminal-muted-surface rounded-xl border p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  <Bot className="h-4 w-4 text-zinc-400" />
                  自定义提示词
                </div>
                <span className="shrink-0 text-xs text-zinc-500">
                  {normalizedSettings.ai.customInstructions.length} / 8000
                </span>
              </div>
              <textarea
                aria-label="AI 自定义提示词"
                className="kerminal-field-surface mt-3 min-h-32 w-full resize-y rounded-xl border px-3 py-2 text-sm leading-6 text-zinc-950 placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                maxLength={8000}
                onChange={(event) =>
                  updateAi({
                    customInstructions: event.currentTarget.value,
                  })
                }
                placeholder="例如：当前主机为 Debian 12；优先使用 fish；安装包请先解释影响。"
                value={normalizedSettings.ai.customInstructions}
              />
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}
