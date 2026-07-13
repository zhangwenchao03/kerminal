import type { SnippetCatalogItem } from "../../lib/snippetApi";

/** 在已加载的有界目录投影中按用户可见片段内容执行大小写无关搜索。 */
export function catalogItemMatchesQuery(
  item: SnippetCatalogItem,
  normalizedQuery: string,
): boolean {
  return [
    item.title,
    item.description,
    item.template,
    item.category,
    ...item.tags,
  ].some((value) => value.toLowerCase().includes(normalizedQuery));
}

/** 搜索路径只接收最多 2000 项，避免外部调用绕过目录上限。 */
export function searchSnippetCatalog(
  items: readonly SnippetCatalogItem[],
  query: string,
): SnippetCatalogItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [...items];
  return items
    .slice(0, 2_000)
    .filter((item) => catalogItemMatchesQuery(item, normalizedQuery));
}

/** 常用区稳定地把收藏、最近使用和累计次数排在目录顺序之前。 */
export function commonSnippetCatalog(
  items: readonly SnippetCatalogItem[],
): SnippetCatalogItem[] {
  return items
    .filter((item) => item.favorite || item.useCount > 0)
    .sort(
      (left, right) =>
        Number(right.favorite) - Number(left.favorite) ||
        (right.lastUsedAtUnixMs ?? 0) - (left.lastUsedAtUnixMs ?? 0) ||
        right.useCount - left.useCount ||
        left.sortOrder - right.sortOrder ||
        left.id.localeCompare(right.id),
    );
}
