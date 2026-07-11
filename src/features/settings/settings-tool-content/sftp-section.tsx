import { Network } from "lucide-react";
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
import { NumberSetting, SettingsDisclosure } from "./shared-controls";

interface SftpSettingsSectionProps {
  normalizedSettings: AppSettings;
  updateSftp: (sftp: Partial<SftpPerformanceSettings>) => void;
}

export function SftpSettingsSection({
  normalizedSettings,
  updateSftp,
}: SftpSettingsSectionProps) {
  return (
    <div className="space-y-4" id="settings-sftp-panel">
      <section className="kerminal-solid-surface rounded-2xl border p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
          <Network className="h-4 w-4 text-sky-500 dark:text-sky-300" />
          SFTP 传输
        </div>
        <p className="mt-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
          参数仅影响新任务。
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
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

      <SettingsDisclosure
        summary={`${normalizedSettings.sftp.timeoutSeconds} 秒超时`}
        title="高级传输参数"
      >
        <div className="grid gap-3 md:grid-cols-3">
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
      </SettingsDisclosure>
    </div>
  );
}
