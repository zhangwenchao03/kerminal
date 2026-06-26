import { Hash, Network, RotateCcw, Terminal } from "lucide-react";
import {
  SFTP_GLOBAL_TRANSFERS_MAX,
  SFTP_GLOBAL_TRANSFERS_MIN,
  SFTP_HOST_TRANSFERS_MAX,
  SFTP_HOST_TRANSFERS_MIN,
  SFTP_PACKET_BYTES_MAX,
  SFTP_PACKET_BYTES_MIN,
  SFTP_PIPELINE_DEPTH_MAX,
  SFTP_PIPELINE_DEPTH_MIN,
  SFTP_TIMEOUT_SECONDS_MAX,
  SFTP_TIMEOUT_SECONDS_MIN,
  type AppSettings,
  type SftpPerformanceSettings,
} from "../settingsModel";
import { NumberSetting, SettingsMetricItem } from "./shared-controls";

interface SftpSettingsSectionProps {
  normalizedSettings: AppSettings;
  updateSftp: (sftp: Partial<SftpPerformanceSettings>) => void;
}

export function SftpSettingsSection({
  normalizedSettings,
  updateSftp,
}: SftpSettingsSectionProps) {
  return (
    <section
      className="kerminal-solid-surface rounded-2xl border p-5"
      id="settings-sftp-panel"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
            <Network className="h-4 w-4 text-sky-500 dark:text-sky-300" />
            SFTP 传输
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            新任务使用这里的参数，已排队任务不变。
          </p>
        </div>
        <span className="kerminal-muted-surface rounded-full border px-3 py-1 text-xs text-zinc-500 dark:text-zinc-400">
          性能参数
        </span>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <SettingsMetricItem
          description="所有主机的总并发。"
          icon={Network}
          label="全局并发"
          value={`${normalizedSettings.sftp.globalTransfers} 个`}
        />
        <SettingsMetricItem
          description="单服务器并发。"
          icon={Terminal}
          label="单主机"
          value={`${normalizedSettings.sftp.hostTransfers} 个`}
        />
        <SettingsMetricItem
          description="单请求最长等待。"
          icon={RotateCcw}
          label="超时"
          value={`${normalizedSettings.sftp.timeoutSeconds} 秒`}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className="kerminal-muted-surface rounded-xl border p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
            <Network className="h-4 w-4 text-zinc-400" />
            传输调度
          </div>
          <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
            控制排队和单主机压力。
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <NumberSetting
              help="所有任务共享。"
              label="全局传输并发"
              max={SFTP_GLOBAL_TRANSFERS_MAX}
              min={SFTP_GLOBAL_TRANSFERS_MIN}
              onChange={(globalTransfers) => updateSftp({ globalTransfers })}
              value={normalizedSettings.sftp.globalTransfers}
            />
            <NumberSetting
              help="限制单机压力。"
              label="单主机并发"
              max={SFTP_HOST_TRANSFERS_MAX}
              min={SFTP_HOST_TRANSFERS_MIN}
              onChange={(hostTransfers) => updateSftp({ hostTransfers })}
              value={normalizedSettings.sftp.hostTransfers}
            />
          </div>
        </section>

        <section className="kerminal-muted-surface rounded-xl border p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
            <Hash className="h-4 w-4 text-zinc-400" />
            通道参数
          </div>
          <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
            调整吞吐、包大小和超时。
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
            <NumberSetting
              help="提高吞吐，也增加压力。"
              label="流水线深度"
              max={SFTP_PIPELINE_DEPTH_MAX}
              min={SFTP_PIPELINE_DEPTH_MIN}
              onChange={(pipelineDepth) => updateSftp({ pipelineDepth })}
              value={normalizedSettings.sftp.pipelineDepth}
            />
            <NumberSetting
              displayScale={1024 * 1024}
              help="单位 M；0.25 = 256K。"
              label="最大包大小"
              max={SFTP_PACKET_BYTES_MAX}
              min={SFTP_PACKET_BYTES_MIN}
              onChange={(packetBytes) => updateSftp({ packetBytes })}
              step={SFTP_PACKET_BYTES_MIN}
              suffix="M"
              value={normalizedSettings.sftp.packetBytes}
            />
            <NumberSetting
              help="慢链路可调高。"
              label="请求超时"
              max={SFTP_TIMEOUT_SECONDS_MAX}
              min={SFTP_TIMEOUT_SECONDS_MIN}
              onChange={(timeoutSeconds) => updateSftp({ timeoutSeconds })}
              suffix="秒"
              value={normalizedSettings.sftp.timeoutSeconds}
            />
          </div>
        </section>
      </div>
    </section>
  );
}
