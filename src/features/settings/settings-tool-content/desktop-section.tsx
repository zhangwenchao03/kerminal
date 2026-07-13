import { Bell, BellRing, Clock, ShieldAlert } from "lucide-react";
import type {
  AppSettings,
  DesktopNotificationSettings,
} from "../settingsModel";
import {
  NumberSetting,
  PolicyToggle,
  SettingsDisclosure,
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
    <div className="space-y-4" id="settings-desktop-panel">
      <section className="kerminal-solid-surface rounded-[var(--radius-panel)] border p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
          <BellRing className="h-4 w-4 text-sky-500 dark:text-sky-300" />
          桌面通知
        </div>
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

      <SettingsDisclosure
        summary={`${Math.round(settings.minDurationMs / 1000)} 秒`}
        title="高级通知设置"
      >
        <div className="grid gap-3 md:grid-cols-2">
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
      </SettingsDisclosure>
    </div>
  );
}
