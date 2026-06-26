import { Bell, BellRing, Clock, ShieldAlert } from "lucide-react";
import type {
  AppSettings,
  DesktopNotificationSettings,
} from "../settingsModel";
import {
  NumberSetting,
  PolicyToggle,
  SettingsMetricItem,
} from "./shared-controls";

interface DesktopSettingsSectionProps {
  normalizedSettings: AppSettings;
  updateDesktopNotifications: (
    settings: Partial<DesktopNotificationSettings>,
  ) => void;
}

export function DesktopSettingsSection({
  normalizedSettings,
  updateDesktopNotifications,
}: DesktopSettingsSectionProps) {
  const settings = normalizedSettings.desktopNotifications;

  return (
    <section
      className="kerminal-solid-surface rounded-2xl border p-5"
      id="settings-desktop-panel"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
            <Bell className="h-4 w-4 text-sky-500 dark:text-sky-300" />
            桌面通知
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            系统通知只用于后台任务、失败和更新等重要事件。
          </p>
        </div>
        <span className="kerminal-muted-surface rounded-full border px-3 py-1 text-xs text-zinc-500 dark:text-zinc-400">
          Windows / macOS
        </span>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <SettingsMetricItem
          description={settings.enabled ? "已允许触发通知。" : "不会请求系统权限。"}
          icon={BellRing}
          label="状态"
          value={settings.enabled ? "启用" : "关闭"}
        />
        <SettingsMetricItem
          description="前台短操作不打扰。"
          icon={Clock}
          label="耗时阈值"
          value={`${Math.round(settings.minDurationMs / 1000)} 秒`}
        />
        <SettingsMetricItem
          description="同类事件合并节流。"
          icon={ShieldAlert}
          label="节流"
          value={`${Math.round(settings.throttleMs / 1000)} 秒`}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <section className="kerminal-muted-surface rounded-xl border p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
            <BellRing className="h-4 w-4 text-zinc-400" />
            通知范围
          </div>
          <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
            失败类事件仍会保留更高优先级。
          </p>
          <div className="mt-4 grid gap-3">
            <PolicyToggle
              checked={settings.enabled}
              icon={Bell}
              label="启用桌面通知"
              onChange={(enabled) => updateDesktopNotifications({ enabled })}
            />
            <PolicyToggle
              checked={settings.backgroundOnly}
              icon={Clock}
              label="优先通知后台和耗时事件"
              onChange={(backgroundOnly) =>
                updateDesktopNotifications({ backgroundOnly })
              }
            />
            <PolicyToggle
              checked={settings.importantOnly}
              icon={ShieldAlert}
              label="只通知重要事件"
              onChange={(importantOnly) =>
                updateDesktopNotifications({ importantOnly })
              }
            />
          </div>
        </section>

        <section className="kerminal-muted-surface rounded-xl border p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
            <Clock className="h-4 w-4 text-zinc-400" />
            触发节奏
          </div>
          <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
            控制长任务和重复事件的通知频率。
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <NumberSetting
              displayScale={1000}
              help="前台任务低于该时长不发通知。"
              label="耗时阈值"
              max={120_000}
              min={1_000}
              onChange={(minDurationMs) =>
                updateDesktopNotifications({ minDurationMs })
              }
              step={1_000}
              suffix="秒"
              value={settings.minDurationMs}
            />
            <NumberSetting
              displayScale={1000}
              help="同类事件在该时间内只发一次。"
              label="同类事件节流"
              max={600_000}
              min={0}
              onChange={(throttleMs) =>
                updateDesktopNotifications({ throttleMs })
              }
              step={1_000}
              suffix="秒"
              value={settings.throttleMs}
            />
          </div>
        </section>
      </div>
    </section>
  );
}
