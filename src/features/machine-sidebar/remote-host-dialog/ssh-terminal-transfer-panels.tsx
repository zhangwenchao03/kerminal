import { Folder } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Select } from "../../../components/ui/select";
import { Switch } from "../../../components/ui/switch";
import { selectLocalDirectory } from "../../../lib/fileDialogApi";
import type { SshOptions } from "../../../lib/remoteHostApi";
import { terminalEncodingOptions, terminalTypeOptions } from "./model";
import { optionalNumber } from "./request-builders";
import type { SshOptionsSetter } from "./ssh-network-panels";
import { FieldRow, HelpCard, inputClassName, ToggleRow } from "./shared-ui";

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
      <FieldRow label="编码">
        <Select
          aria-label="SSH 编码"
          buttonClassName="h-10"
          onValueChange={(value) => updateTerminal({ encoding: value })}
          options={terminalEncodingOptions.map((value) => ({ label: value, value }))}
          value={terminal.encoding}
        />
      </FieldRow>
      <FieldRow label="TERM">
        <Select
          aria-label="SSH TERM"
          buttonClassName="h-10"
          onValueChange={(value) => updateTerminal({ terminalType: value })}
          options={terminalTypeOptions.map((value) => ({ label: value, value }))}
          value={terminal.terminalType}
        />
      </FieldRow>
      <FieldRow label="键盘">
        <div className="grid gap-3 md:grid-cols-2">
          <Select
            aria-label="SSH 键盘方案"
            buttonClassName="h-10"
            onValueChange={(value) => updateTerminal({ keyboardProfile: value })}
            options={[
              { label: "默认集", value: "default" },
              { label: "Vim 优先", value: "vim" },
              { label: "Emacs 优先", value: "emacs" },
            ]}
            value={terminal.keyboardProfile}
          />
          <Select
            aria-label="Alt 键修饰"
            buttonClassName="h-10"
            onValueChange={(value) => updateTerminal({ altModifier: value })}
            options={[
              { label: "8 位字符", value: "8bit" },
              { label: "ESC 前缀", value: "escape" },
              { label: "不发送", value: "none" },
            ]}
            value={terminal.altModifier}
          />
        </div>
      </FieldRow>
      <FieldRow label="退格键">
        <div className="grid gap-3 md:grid-cols-2">
          <Select
            aria-label="SSH 退格键"
            buttonClassName="h-10"
            onValueChange={(value) => updateTerminal({ backspaceKey: value })}
            options={[
              { label: "ASCII Delete (0x7F)", value: "ascii-delete" },
              { label: "Control-H (0x08)", value: "control-h" },
            ]}
            value={terminal.backspaceKey}
          />
          <Select
            aria-label="SSH Delete 键"
            buttonClassName="h-10"
            onValueChange={(value) => updateTerminal({ deleteKey: value })}
            options={[
              { label: "Delete 序列", value: "delete-sequence" },
              { label: "ASCII Delete (0x7F)", value: "ascii-delete" },
            ]}
            value={terminal.deleteKey}
          />
        </div>
      </FieldRow>
      <FieldRow label="超时">
        <div className="grid gap-3 md:grid-cols-2">
          <input
            aria-label="连接超时时间"
            className={inputClassName}
            inputMode="numeric"
            onChange={(event) =>
              updateTerminal({
                connectTimeoutSeconds: optionalNumber(event.currentTarget.value) ?? 30,
              })
            }
            value={terminal.connectTimeoutSeconds}
          />
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
        </div>
      </FieldRow>
      <FieldRow label="启动命令">
        <input
          aria-label="SSH 启动命令"
          className={inputClassName}
          onChange={(event) =>
            updateTerminal({ startupCommand: event.currentTarget.value })
          }
          placeholder="可选，例如 cd /srv/app"
          value={terminal.startupCommand}
        />
      </FieldRow>
      <FieldRow label="环境">
        <textarea
          aria-label="SSH 环境变量"
          className={`${inputClassName} min-h-[112px] resize-none py-2 font-mono`}
          onChange={(event) => updateTerminal({ environment: event.currentTarget.value })}
          placeholder={"LANG=zh_CN.UTF-8\nAPP_ENV=staging"}
          spellCheck={false}
          value={terminal.environment}
        />
      </FieldRow>
      <FieldRow label="登录脚本">
        <textarea
          aria-label="SSH 登录脚本"
          className={`${inputClassName} min-h-[112px] resize-none py-2 font-mono`}
          onChange={(event) => updateTerminal({ loginScript: event.currentTarget.value })}
          placeholder={"可选；连接后按行执行\nsource ~/.profile"}
          spellCheck={false}
          value={terminal.loginScript}
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
        <div className="flex h-10 items-center justify-between gap-3 rounded-xl border border-black/10 bg-white/86 px-3 text-sm text-zinc-600 dark:border-white/10 dark:bg-black/20 dark:text-zinc-300">
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
      <HelpCard
        icon={<Folder className="mt-0.5 h-4 w-4 text-sky-500 dark:text-sky-300" />}
        text="这些选项会随主机保存，SFTP 面板打开该主机时可直接复用默认目录和传输策略。"
      />
    </div>
  );
}
