import type {
  WorkspaceActionCatalog,
  WorkspaceActionContext,
  WorkspaceActionDescriptor,
  WorkspaceActionRegistry,
} from "../workspace-actions";
import type {
  CommandPaletteActionItem,
  CommandPaletteActionPresentation,
} from "./commandPaletteTypes";

const EFFECT_LABELS = {
  destructive: "危险",
  local: "本地",
  read: "只读",
  remote: "远程",
  write: "写入",
} as const;

/** 返回稳定的副作用等级文案。 */
export function formatCommandPaletteEffect(
  effect: WorkspaceActionDescriptor["effect"],
) {
  return EFFECT_LABELS[effect];
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase();
}

function scoreField(field: string | undefined, query: string, weight: number) {
  if (!field) {
    return 0;
  }
  const normalized = normalize(field);
  if (normalized === query) {
    return weight * 5;
  }
  if (normalized.startsWith(query)) {
    return weight * 3;
  }
  const index = normalized.indexOf(query);
  return index < 0 ? 0 : weight * 2 - Math.min(index, weight);
}

/**
 * 对动作标题、ID、分类、作用域和关键词评分。
 *
 * 标题权重最高；无查询时保留 registry 注册顺序，避免界面在输入清空后跳动。
 */
export function scoreCommandPaletteAction<TId extends string, TPayload>(
  descriptor: WorkspaceActionDescriptor<TId, TPayload>,
  presentation: CommandPaletteActionPresentation | undefined,
  query: string,
) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    return 1;
  }
  return (
    scoreField(descriptor.title, normalizedQuery, 40) +
    scoreField(descriptor.id, normalizedQuery, 24) +
    scoreField(presentation?.category, normalizedQuery, 16) +
    scoreField(presentation?.scope, normalizedQuery, 12) +
    (presentation?.keywords ?? []).reduce(
      (score, keyword) => score + scoreField(keyword, normalizedQuery, 10),
      0,
    )
  );
}

/** 从唯一 registry 派生 Palette 项，不保存第二份动作清单。 */
export function buildCommandPaletteItems<
  TCatalog extends WorkspaceActionCatalog,
>(
  registry: WorkspaceActionRegistry<TCatalog>,
  context: WorkspaceActionContext,
  query: string,
  getPayload: <TId extends keyof TCatalog & string>(
    descriptor: WorkspaceActionDescriptor<TId, TCatalog[TId]>,
  ) => TCatalog[TId],
  getPresentation?: <TId extends keyof TCatalog & string>(
    descriptor: WorkspaceActionDescriptor<TId, TCatalog[TId]>,
  ) => CommandPaletteActionPresentation | undefined,
): readonly CommandPaletteActionItem<keyof TCatalog & string>[] {
  return registry
    .list()
    .map((descriptor, index) => {
      const presentation = getPresentation?.(descriptor);
      const availability = descriptor.availability?.(
        context,
        getPayload(descriptor),
      ) ?? { available: true as const };
      return {
        category: presentation?.category,
        disabled: !availability.available,
        disabledReason: availability.available
          ? undefined
          : availability.reason,
        effect: descriptor.effect,
        id: descriptor.id,
        keybinding: presentation?.keybinding,
        leading: presentation?.leading,
        order: index,
        score: scoreCommandPaletteAction(descriptor, presentation, query),
        scope: presentation?.scope,
        title: descriptor.title,
      };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .map(({ order: _order, ...item }) => item);
}
