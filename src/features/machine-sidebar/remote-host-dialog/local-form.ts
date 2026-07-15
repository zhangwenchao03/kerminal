import type { ShellCandidate } from "../../../lib/profileApi";
import {
  CUSTOM_LOCAL_SHELL_PRESET_ID,
  DEFAULT_LOCAL_SHELL_PRESET_ID,
  localShellFallbackPresets,
  type LocalShellPreset,
  type LocalTerminalCreateOptions,
} from "./model";

export function buildLocalShellPresets(
  candidates: ShellCandidate[],
): LocalShellPreset[] {
  const presets: LocalShellPreset[] = [
    {
      args: [],
      id: DEFAULT_LOCAL_SHELL_PRESET_ID,
      label: "默认终端 Profile",
      shell: "",
    },
  ];

  for (const candidate of candidates) {
    if (candidate.id === "browser-preview") {
      continue;
    }
    addLocalShellPreset(presets, {
      args: candidate.args,
      id: candidate.id,
      label: candidate.name,
      shell: candidate.shell,
    });
  }

  for (const preset of localShellFallbackPresets) {
    addLocalShellPreset(presets, preset);
  }

  presets.push({
    args: [],
    id: CUSTOM_LOCAL_SHELL_PRESET_ID,
    label: "自定义启动文件",
    shell: "",
  });
  return presets;
}

function addLocalShellPreset(
  presets: LocalShellPreset[],
  preset: LocalShellPreset,
) {
  const exists = presets.some(
    (item) =>
      item.id === preset.id ||
      (normalizeShellPresetValue(item.shell) ===
        normalizeShellPresetValue(preset.shell) &&
        formatLocalArgs(item.args) === formatLocalArgs(preset.args)),
  );
  if (!exists) {
    presets.push(preset);
  }
}

function normalizeShellPresetValue(value: string) {
  return value.trim().toLowerCase();
}

export function formatLocalArgs(args: string[]) {
  return args.join("\n");
}

export function formatLocalEnv(env: Record<string, string> | undefined) {
  return Object.entries(env ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

export function buildLocalTerminalOptions({
  args,
  cwd,
  env,
  groupId,
  shell,
  title,
}: {
  args: string;
  cwd: string;
  env: string;
  groupId: string;
  shell: string;
  title: string;
},
includeEmptyValues = false,
): { error?: string; options?: LocalTerminalCreateOptions } {
  const envResult = parseLocalEnv(env);
  if (envResult.error) {
    return { error: envResult.error };
  }

  const parsedArgs = parseLocalArgs(args);
  if (includeEmptyValues) {
    return {
      options: {
        args: parsedArgs,
        cwd: cwd.trim() || undefined,
        env: envResult.env,
        groupId: groupId || undefined,
        shell: shell.trim() || undefined,
        title: title.trim() || undefined,
      },
    };
  }

  const options: LocalTerminalCreateOptions = {
    args: parsedArgs.length > 0 ? parsedArgs : undefined,
    cwd: cwd.trim() || undefined,
    env: Object.keys(envResult.env).length > 0 ? envResult.env : undefined,
    groupId: groupId || undefined,
    shell: shell.trim() || undefined,
    title: title.trim() || undefined,
  };
  const hasOverrides = Object.values(options).some(
    (value) => value !== undefined,
  );

  return { options: hasOverrides ? options : undefined };
}

function parseLocalArgs(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseLocalEnv(value: string): {
  env: Record<string, string>;
  error?: string;
} {
  const env: Record<string, string> = {};
  const lines = value.split(/\r?\n/);

  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      return {
        env: {},
        error: `环境变量第 ${index + 1} 行需要使用 KEY=value。`,
      };
    }

    const key = line.slice(0, separatorIndex).trim();
    if (!key || /\s/.test(key)) {
      return { env: {}, error: `环境变量第 ${index + 1} 行的变量名无效。` };
    }

    env[key] = line.slice(separatorIndex + 1);
  }

  return { env };
}
