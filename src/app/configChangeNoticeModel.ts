export type ConfigChangeDomain =
  | "settings"
  | "profiles"
  | "hosts"
  | "snippets"
  | "workflows";

export type ConfigChangeNoticeLevel = "info" | "warning" | "error";

export type ConfigChangeStatus =
  | "ready"
  | "invalid"
  | "watcher-unavailable";

export type ConfigChangeSourceHint = "kerminal" | "external" | "unknown";

export interface ConfigChangePublicItem {
  id: string;
  label: string;
  revision?: string;
}

export interface ConfigChangeNoticeSnapshot {
  hosts?: ConfigChangePublicItem[];
  profiles?: ConfigChangePublicItem[];
  snippets?: ConfigChangePublicItem[];
  workflows?: ConfigChangePublicItem[];
  settingsRevision?: string;
}

export interface BuildConfigChangeNoticeInput {
  batchId: string;
  sequence: number;
  domains: ConfigChangeDomain[];
  status: ConfigChangeStatus;
  sourceHint: ConfigChangeSourceHint;
  before?: ConfigChangeNoticeSnapshot;
  after?: ConfigChangeNoticeSnapshot;
  redactedSecretDomains?: ConfigChangeDomain[];
  ttlMs?: number;
}

export interface ConfigChangeNotice {
  id: string;
  batchId: string;
  level: ConfigChangeNoticeLevel;
  text: string;
  ttlMs: number;
  domains: ConfigChangeDomain[];
}

interface DomainLabel {
  singular: string;
  plural: string;
}

interface DomainDiff {
  added: ConfigChangePublicItem[];
  removed: ConfigChangePublicItem[];
  updated: ConfigChangePublicItem[];
}

const DEFAULT_NOTICE_TTL_MS = 3000;
const MAX_LABEL_LENGTH = 48;

const domainLabels: Record<Exclude<ConfigChangeDomain, "settings">, DomainLabel> =
  {
    hosts: { plural: "hosts", singular: "host" },
    profiles: { plural: "profiles", singular: "profile" },
    snippets: { plural: "snippets", singular: "snippet" },
    workflows: { plural: "workflows", singular: "workflow" },
  };

export function buildConfigChangeNotice(
  input: BuildConfigChangeNoticeInput,
): ConfigChangeNotice | null {
  if (input.status === "invalid") {
    return notice(input, "error", "cfg: invalid TOML, kept last-known-good");
  }
  if (input.status === "watcher-unavailable") {
    return notice(input, "warning", "cfg: watcher offline, auto-refresh paused");
  }
  if (input.sourceHint === "kerminal") {
    return null;
  }

  const summaries = input.domains
    .map((domain) => domainSummary(domain, input))
    .filter((summary): summary is string => Boolean(summary));
  if (summaries.length === 0) {
    return null;
  }

  return notice(input, "info", `cfg: ${summaries.join(", ")}`);
}

export function configChangeNoticeSnapshot(input: {
  hosts?: ConfigChangePublicItem[];
  profiles?: ConfigChangePublicItem[];
  snippets?: ConfigChangePublicItem[];
  workflows?: ConfigChangePublicItem[];
  settingsRevision?: string;
}): ConfigChangeNoticeSnapshot {
  return {
    hosts: normalizeItems(input.hosts),
    profiles: normalizeItems(input.profiles),
    settingsRevision: input.settingsRevision,
    snippets: normalizeItems(input.snippets),
    workflows: normalizeItems(input.workflows),
  };
}

function notice(
  input: BuildConfigChangeNoticeInput,
  level: ConfigChangeNoticeLevel,
  text: string,
): ConfigChangeNotice {
  return {
    batchId: input.batchId,
    domains: uniqueDomains(input.domains),
    id: `${input.batchId}:${input.sequence}:${level}`,
    level,
    text,
    ttlMs: input.ttlMs ?? DEFAULT_NOTICE_TTL_MS,
  };
}

function domainSummary(
  domain: ConfigChangeDomain,
  input: BuildConfigChangeNoticeInput,
) {
  if (domain === "settings") {
    return input.before?.settingsRevision !== input.after?.settingsRevision
      ? "settings reloaded"
      : null;
  }
  if (input.redactedSecretDomains?.includes(domain)) {
    return domain === "hosts"
      ? "host credentials updated"
      : `${domainLabels[domain].plural} reloaded`;
  }

  const before = input.before?.[domain] ?? [];
  const after = input.after?.[domain] ?? [];
  const diff = diffItems(before, after);
  const label = domainLabels[domain];
  const parts = [
    countSummary("+", diff.added, label),
    countSummary("-", diff.removed, label),
    countSummary("~", diff.updated, label),
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(" ") : `${label.plural} reloaded`;
}

function diffItems(
  beforeItems: ConfigChangePublicItem[],
  afterItems: ConfigChangePublicItem[],
): DomainDiff {
  const beforeById = new Map(beforeItems.map((item) => [item.id, item]));
  const afterById = new Map(afterItems.map((item) => [item.id, item]));
  const added = afterItems.filter((item) => !beforeById.has(item.id));
  const removed = beforeItems.filter((item) => !afterById.has(item.id));
  const updated = afterItems.filter((item) => {
    const previous = beforeById.get(item.id);
    return Boolean(previous && itemFingerprint(previous) !== itemFingerprint(item));
  });

  return { added, removed, updated };
}

function countSummary(
  prefix: "+" | "-" | "~",
  items: ConfigChangePublicItem[],
  label: DomainLabel,
) {
  if (items.length === 0) {
    return null;
  }
  if (items.length === 1) {
    return `${prefix}1 ${label.singular} ${quoteLabel(items[0].label)}`;
  }
  return `${label.plural} ${prefix}${items.length}`;
}

function itemFingerprint(item: ConfigChangePublicItem) {
  return `${item.label}\n${item.revision ?? ""}`;
}

function normalizeItems(items: ConfigChangePublicItem[] | undefined) {
  if (!items) {
    return undefined;
  }
  return [...items]
    .map((item) => ({
      id: item.id,
      label: item.label.trim() || item.id,
      revision: item.revision,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function quoteLabel(label: string) {
  return `"${truncateMiddle(label.replace(/["\\\r\n\t]/g, " ").replace(/\s+/g, " ").trim(), MAX_LABEL_LENGTH)}"`;
}

function truncateMiddle(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }
  const sideLength = Math.max(1, Math.floor((maxLength - 3) / 2));
  return `${value.slice(0, sideLength)}...${value.slice(-sideLength)}`;
}

function uniqueDomains(domains: ConfigChangeDomain[]) {
  return Array.from(new Set(domains));
}
