import { Monitor } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Select } from "../../../components/ui/select";
import { selectLocalDirectory, selectLocalFile } from "../../../lib/fileDialogApi";
import { formatLocalArgs } from "./local-form";
import {
  CUSTOM_LOCAL_SHELL_PRESET_ID,
  DEFAULT_LOCAL_SHELL_PRESET_ID,
  type LocalShellPreset,
} from "./model";
import { FieldRow, GroupSelectRow, inputClassName } from "./shared-ui";

export function LocalPropertiesPanel({
  editing,
  groupId,
  groupOptions,
  localArgs,
  localCwd,
  localShell,
  localShellPresetId,
  localShellPresets,
  localTitle,
  onCreateGroupClick,
  setError,
  setGroupId,
  setLocalArgs,
  setLocalCwd,
  setLocalShell,
  setLocalShellPresetId,
  setLocalTitle,
}: {
  editing: boolean;
  groupId: string;
  groupOptions: Array<{ label: string; value: string }>;
  localArgs: string;
  localCwd: string;
  localShell: string;
  localShellPresetId: string;
  localShellPresets: LocalShellPreset[];
  localTitle: string;
  onCreateGroupClick?: () => void;
  setError: (value: string | null) => void;
  setGroupId: (value: string) => void;
  setLocalArgs: (value: string) => void;
  setLocalCwd: (value: string) => void;
  setLocalShell: (value: string) => void;
  setLocalShellPresetId: (value: string) => void;
  setLocalTitle: (value: string) => void;
}) {
  const selectShellPreset = (presetId: string) => {
    setLocalShellPresetId(presetId);
    const preset = localShellPresets.find((item) => item.id === presetId);
    if (!preset) {
      return;
    }
    setError(null);
    if (preset.id === DEFAULT_LOCAL_SHELL_PRESET_ID) {
      setLocalShell("");
      setLocalArgs("");
      return;
    }
    if (preset.id === CUSTOM_LOCAL_SHELL_PRESET_ID) {
      setLocalShell("");
      setLocalArgs("");
      return;
    }
    setLocalShell(preset.shell);
    setLocalArgs(formatLocalArgs(preset.args));
  };

  const chooseShellFile = async () => {
    try {
      const selected = await selectLocalFile();
      if (!selected) {
        return;
      }
      setError(null);
      setLocalShellPresetId(CUSTOM_LOCAL_SHELL_PRESET_ID);
      setLocalShell(selected);
    } catch (caught) {
      console.warn("Failed to select a local shell file", caught);
      setError("无法选择启动文件，请重试。");
    }
  };

  const chooseWorkingDirectory = async () => {
    try {
      const selected = await selectLocalDirectory();
      if (!selected) {
        return;
      }
      setError(null);
      setLocalCwd(selected);
    } catch (caught) {
      console.warn("Failed to select a local working directory", caught);
      setError("无法选择工作目录，请重试。");
    }
  };

  return (
    <div className="grid gap-3">
      <FieldRow label="会话名称">
        <input
          aria-label="会话名称"
          autoFocus
          className={inputClassName}
          onChange={(event) => setLocalTitle(event.currentTarget.value)}
          placeholder="可选，例如：PowerShell 工作台"
          value={localTitle}
        />
      </FieldRow>
      <GroupSelectRow
        groupId={groupId}
        groupOptions={groupOptions}
        onCreateGroupClick={onCreateGroupClick}
        setGroupId={setGroupId}
      />
      <FieldRow label="Shell">
        <div className="grid gap-2">
          <Select
            aria-label="Shell"
            buttonClassName="h-9"
            onValueChange={selectShellPreset}
            options={localShellPresets.map((preset) => ({
              label: preset.label,
              value: preset.id,
            }))}
            value={localShellPresetId}
          />
          {localShellPresetId === CUSTOM_LOCAL_SHELL_PRESET_ID ? (
            <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_128px]">
              <input
                aria-label="自定义启动文件"
                className={inputClassName}
                onChange={(event) => setLocalShell(event.currentTarget.value)}
                placeholder="选择或输入 shell / 可执行文件路径"
                value={localShell}
              />
              <Button
                aria-label="选择启动文件"
                onClick={() => void chooseShellFile()}
                type="button"
                variant="secondary"
              >
                选择文件
              </Button>
            </div>
          ) : null}
        </div>
      </FieldRow>
      <FieldRow label="工作目录">
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_128px]">
          <input
            aria-label="工作目录"
            className={inputClassName}
            onChange={(event) => setLocalCwd(event.currentTarget.value)}
            placeholder="可选，例如 C:\\dev\\rust\\kerminal"
            value={localCwd}
          />
          <Button
            aria-label="选择工作目录"
            onClick={() => void chooseWorkingDirectory()}
            type="button"
            variant="secondary"
          >
            选择目录
          </Button>
        </div>
      </FieldRow>
      <FieldRow label="启动参数">
        <textarea
          aria-label="启动参数"
          className={`${inputClassName} min-h-[128px] resize-none py-2`}
          onChange={(event) => setLocalArgs(event.currentTarget.value)}
          placeholder={"每行一个参数，例如：\n-NoLogo\n-NoExit"}
          value={localArgs}
        />
      </FieldRow>
      <div className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--surface-content)] p-3">
        <div className="flex items-start gap-3">
          <Monitor className="mt-0.5 h-4 w-4 text-sky-500 dark:text-sky-300" />
          <p className="min-w-0 text-[13px] leading-6 text-[var(--text-secondary)]">
            {editing
              ? "保存到左侧本地终端；已打开会话不重启。"
              : "留空则使用默认终端 profile。"}
          </p>
        </div>
      </div>
    </div>
  );
}

export function LocalEnvironmentPanel({
  localEnv,
  setLocalEnv,
}: {
  localEnv: string;
  setLocalEnv: (value: string) => void;
}) {
  return (
    <FieldRow label="变量">
      <textarea
        aria-label="环境变量"
        className={`${inputClassName} min-h-[220px] resize-none py-2 font-mono`}
        onChange={(event) => setLocalEnv(event.currentTarget.value)}
        placeholder={"KEY=value\nNODE_ENV=development"}
        spellCheck={false}
        value={localEnv}
      />
    </FieldRow>
  );
}
