import { Button } from "../../../components/ui/button";
import { Select } from "../../../components/ui/select";
import { Switch } from "../../../components/ui/switch";
import { selectLocalDirectory } from "../../../lib/fileDialogApi";
import type { SshOptions } from "../../../lib/remoteHostApi";
import { terminalTypeOptions } from "./model";
import { optionalNumber } from "./request-builders";
import type { SshOptionsSetter } from "./ssh-network-panels";
import { FieldRow, inputClassName, ToggleRow } from "./shared-ui";

export function SshTerminalPanel({
  options,
  setOptions,
}: {
  options: SshOptions;
  setOptions: SshOptionsSetter;
}) {
  const terminal = options.terminal;
  const updateTerminal = (nextTerminal: Partial<SshOptions["terminal"]>) => {
    setOptions((current) => ({
      ...current,
      terminal: {
        ...current.terminal,
        ...nextTerminal,
      },
    }));
  };

  return (
    <div className="grid gap-3">
      <FieldRow label="TERM">
        <Select
          aria-label="SSH TERM"
          buttonClassName="h-9"
          onValueChange={(value) => updateTerminal({ terminalType: value })}
          options={terminalTypeOptions.map((value) => ({ label: value, value }))}
          value={terminal.terminalType}
        />
      </FieldRow>
      <FieldRow label="连接超时">
        <div className="grid gap-1.5">
          <input
            aria-label="连接超时时间"
            className={inputClassName}
            inputMode="numeric"
            onChange={(event) =>
              updateTerminal({
                connectTimeoutSeconds: optionalNumber(event.currentTarget.value) ?? 0,
              })
            }
            value={terminal.connectTimeoutSeconds}
          />
          <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
            建立 SSH 连接最多等待的秒数。
          </p>
        </div>
      </FieldRow>
      <FieldRow label="心跳间隔">
        <div className="grid gap-1.5">
          <input
            aria-label="心跳间隔"
            className={inputClassName}
            inputMode="numeric"
            onChange={(event) =>
              updateTerminal({
                keepaliveSeconds: optionalNumber(event.currentTarget.value) ?? 0,
              })
            }
            value={terminal.keepaliveSeconds}
          />
          <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
            空闲时发送 SSH keepalive 的间隔；0 表示关闭。
          </p>
        </div>
      </FieldRow>
      <FieldRow label="默认目录">
        <input
          aria-label="SSH 默认目录"
          className={inputClassName}
          onChange={(event) =>
            updateTerminal({ startupCommand: event.currentTarget.value })
          }
          placeholder="/srv/app"
          value={terminal.startupCommand}
        />
      </FieldRow>
    </div>
  );
}

export function SshTransferPanel({
  options,
  setOptions,
}: {
  options: SshOptions;
  setOptions: SshOptionsSetter;
}) {
  const transfer = options.transfer;
  const updateTransfer = (nextTransfer: Partial<SshOptions["transfer"]>) => {
    setOptions((current) => ({
      ...current,
      transfer: {
        ...current.transfer,
        ...nextTransfer,
      },
    }));
  };
  const chooseLocalDirectory = async () => {
    const selected = await selectLocalDirectory();
    if (selected) {
      updateTransfer({ localStartDirectory: selected });
    }
  };

  return (
    <div className="grid gap-3">
      <FieldRow label="SFTP">
        <div className="kerminal-field-surface flex min-h-9 items-center justify-between gap-3 rounded-[var(--radius-control)] border px-3 py-1.5 text-[13px] text-[var(--text-secondary)]">
          <span>启用文件传输</span>
          <Switch
            aria-label="启用 SFTP"
            checked={transfer.enabled}
            onCheckedChange={(enabled) => updateTransfer({ enabled })}
          />
        </div>
      </FieldRow>
      <FieldRow label="远端目录">
        <input
          aria-label="SFTP 远端默认目录"
          className={inputClassName}
          disabled={!transfer.enabled}
          onChange={(event) =>
            updateTransfer({ remoteStartDirectory: event.currentTarget.value })
          }
          placeholder="/srv/app"
          value={transfer.remoteStartDirectory}
        />
      </FieldRow>
      <FieldRow label="本地目录">
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_128px]">
          <input
            aria-label="SFTP 本地默认目录"
            className={inputClassName}
            disabled={!transfer.enabled}
            onChange={(event) =>
              updateTransfer({ localStartDirectory: event.currentTarget.value })
            }
            placeholder="可选"
            value={transfer.localStartDirectory}
          />
          <Button
            aria-label="选择 SFTP 本地默认目录"
            disabled={!transfer.enabled}
            onClick={() => void chooseLocalDirectory()}
            type="button"
            variant="secondary"
          >
            选择目录
          </Button>
        </div>
      </FieldRow>
      <FieldRow label="传输">
        <div className="grid gap-3 md:grid-cols-3">
          <ToggleRow
            checked={transfer.preserveTimestamps}
            disabled={!transfer.enabled}
            label="保留时间戳"
            onCheckedChange={(preserveTimestamps) =>
              updateTransfer({ preserveTimestamps })
            }
          />
          <ToggleRow
            checked={transfer.followSymlinks}
            disabled={!transfer.enabled}
            label="跟随符号链接"
            onCheckedChange={(followSymlinks) =>
              updateTransfer({ followSymlinks })
            }
          />
          <input
            aria-label="SFTP 同时传输数量"
            className={inputClassName}
            disabled={!transfer.enabled}
            inputMode="numeric"
            onChange={(event) =>
              updateTransfer({
                maxConcurrentTransfers:
                  optionalNumber(event.currentTarget.value) ?? 1,
              })
            }
            value={transfer.maxConcurrentTransfers}
          />
        </div>
      </FieldRow>
    </div>
  );
}
