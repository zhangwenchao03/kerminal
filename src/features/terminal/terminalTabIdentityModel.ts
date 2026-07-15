import {
  terminalTabGroupColorIds,
  type TerminalTabGroupColor,
  type TerminalTabGroupPreference,
} from "../workspace/contracts/index";

/**
 * 身份 accent 的来源。已保存颜色属于显式选择，缺少颜色时始终按 groupId 自动派生。
 */
type TerminalTabIdentityAccentSource = "automatic" | "explicit";

/**
 * 单个身份色 token。该模型只提供静态 accent，不承担选中态、容器、标题或阴影样式。
 */
export interface TerminalTabIdentityPaletteToken {
  accentClassName: string;
  color: TerminalTabGroupColor;
  label: string;
  swatchClassName: string;
}

/**
 * 身份 accent 的解析输入。collapsed 仅用于明确稳定性边界，不参与颜色或显示决策。
 */
export interface TerminalTabIdentityAccentOptions {
  collapsed?: boolean;
  groupId: string;
  preference?: TerminalTabGroupPreference | null;
  tabCount: number;
}

/**
 * 供 Tab、分组标题和 Overview 复用的身份 accent 结果。
 */
export interface TerminalTabIdentityAccent {
  accentClassName: string;
  color: TerminalTabGroupColor;
  source: TerminalTabIdentityAccentSource;
  visible: boolean;
}

/**
 * 编辑器可提交的 preference 草稿。null 颜色表示恢复自动，空标题表示移除自定义标题。
 */
export interface TerminalTabGroupPreferenceDraft {
  color?: TerminalTabGroupColor | null;
  title?: string | null;
}

/**
 * 身份 accent 的唯一 palette token 源。
 *
 * 顺序属于自动颜色稳定性契约；已有 groupId 的映射不得因 Tab 排序、插入或删除而变化。
 */
export const terminalTabIdentityPalette = [
  {
    accentClassName: "bg-sky-500 dark:bg-sky-300",
    color: "blue",
    label: "蓝色",
    swatchClassName: "bg-sky-500 dark:bg-sky-300",
  },
  {
    accentClassName: "bg-pink-500 dark:bg-pink-300",
    color: "pink",
    label: "粉色",
    swatchClassName: "bg-pink-500 dark:bg-pink-300",
  },
  {
    accentClassName: "bg-violet-500 dark:bg-violet-300",
    color: "purple",
    label: "紫色",
    swatchClassName: "bg-violet-500 dark:bg-violet-300",
  },
  {
    accentClassName: "bg-emerald-500 dark:bg-emerald-300",
    color: "mint",
    label: "薄荷",
    swatchClassName: "bg-emerald-500 dark:bg-emerald-300",
  },
  {
    accentClassName: "bg-amber-500 dark:bg-amber-300",
    color: "amber",
    label: "琥珀",
    swatchClassName: "bg-amber-500 dark:bg-amber-300",
  },
  {
    accentClassName: "bg-cyan-500 dark:bg-cyan-300",
    color: "teal",
    label: "青色",
    swatchClassName: "bg-cyan-500 dark:bg-cyan-300",
  },
  {
    accentClassName: "bg-orange-500 dark:bg-orange-300",
    color: "orange",
    label: "橙色",
    swatchClassName: "bg-orange-500 dark:bg-orange-300",
  },
  {
    accentClassName: "bg-zinc-500 dark:bg-zinc-300",
    color: "gray",
    label: "灰色",
    swatchClassName: "bg-zinc-500 dark:bg-zinc-300",
  },
] as const satisfies readonly TerminalTabIdentityPaletteToken[];

const identityPaletteByColor = new Map<TerminalTabGroupColor, TerminalTabIdentityPaletteToken>(
  terminalTabIdentityPalette.map((token) => [token.color, token]),
);

/**
 * 解析稳定身份 accent。
 *
 * 自动颜色只依赖 groupId 的 UTF-16 字符序列和固定 palette 顺序；显式颜色始终优先。
 * 折叠状态、Tab 顺序、活动状态和运行态输出均不会改变结果。
 */
export function resolveTerminalTabIdentityAccent({
  groupId,
  preference,
  tabCount,
}: TerminalTabIdentityAccentOptions): TerminalTabIdentityAccent {
  const source: TerminalTabIdentityAccentSource = preference?.color
    ? "explicit"
    : "automatic";
  const color =
    preference?.color ?? resolveAutomaticTerminalTabGroupColor(groupId);
  const token =
    identityPaletteByColor.get(color) ?? terminalTabIdentityPalette[0];

  return {
    accentClassName: token.accentClassName,
    color: token.color,
    source,
    visible: tabCount > 1 || (tabCount === 1 && source === "explicit"),
  };
}

/**
 * 规范化分组 preference。返回 undefined 表示调用方应删除该 groupId 的保存项。
 *
 * 标题和颜色分别处理，编辑标题不会隐式写入自动颜色。
 */
export function normalizeTerminalTabGroupPreference(
  draft: TerminalTabGroupPreferenceDraft | null | undefined,
): TerminalTabGroupPreference | undefined {
  const color = draft?.color ?? undefined;
  const title = draft?.title?.trim() || undefined;

  if (!color && !title) {
    return undefined;
  }

  return {
    ...(color ? { color } : {}),
    ...(title ? { title } : {}),
  };
}

/**
 * 将 groupId 稳定映射到现有八色 palette。
 */
export function resolveAutomaticTerminalTabGroupColor(
  groupId: string,
): TerminalTabGroupColor {
  const paletteIndex =
    stableStringHash(groupId) % terminalTabGroupColorIds.length;
  return terminalTabIdentityPalette[paletteIndex]?.color ?? "blue";
}

/** 返回编辑器和展示层共享的受控 palette token。 */
export function resolveTerminalTabIdentityPaletteToken(
  color: TerminalTabGroupColor,
): TerminalTabIdentityPaletteToken {
  return identityPaletteByColor.get(color) ?? terminalTabIdentityPalette[0];
}

/**
 * 使用固定 FNV-1a 32 位算法生成无符号 hash，避免随机数或渲染顺序参与身份分配。
 */
function stableStringHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
