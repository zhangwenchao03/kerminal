import {
  buildConfigChangeNotice,
  type ConfigChangeDomain,
  type ConfigChangeNotice,
  type ConfigChangeNoticeSnapshot,
  type ConfigChangeSourceHint,
  type ConfigChangeStatus,
} from "./configChangeNoticeModel";

export type { ConfigChangeDomain, ConfigChangeNotice };

interface ConfigChangeEventDiagnostic {
  domain?: ConfigChangeDomain;
  message: string;
  path?: string;
}

export interface ConfigChangeEvent {
  version: 1;
  sequence: number;
  batchId: string;
  observedAt: string;
  domains: ConfigChangeDomain[];
  status: ConfigChangeStatus;
  diagnostics: ConfigChangeEventDiagnostic[];
  sourceHint: ConfigChangeSourceHint;
}

type ConfigDomainRefreshers = Partial<
  Record<ConfigChangeDomain, () => Promise<void>>
>;

export interface ConfigRefreshCoordinatorOptions {
  getSnapshot: () => ConfigChangeNoticeSnapshot;
  onNotice: (notice: ConfigChangeNotice) => void;
  refreshers: ConfigDomainRefreshers;
}

export interface ConfigRefreshCoordinator {
  handleEvent: (event: ConfigChangeEvent) => Promise<void>;
  lastSequence: () => number;
  revision: (domain: ConfigChangeDomain) => number;
}

type DomainRevisions = Record<ConfigChangeDomain, number>;

const domains: ConfigChangeDomain[] = [
  "settings",
  "profiles",
  "hosts",
  "snippets",
  "workflows",
];

export function createConfigRefreshCoordinator({
  getSnapshot,
  onNotice,
  refreshers,
}: ConfigRefreshCoordinatorOptions): ConfigRefreshCoordinator {
  let lastSequence = 0;
  const revisions = Object.fromEntries(domains.map((domain) => [domain, 0])) as DomainRevisions;

  const handleEvent = async (event: ConfigChangeEvent) => {
    if (event.sequence <= lastSequence) {
      return;
    }
    lastSequence = event.sequence;

    if (event.status !== "ready") {
      emitNotice(event, getSnapshot(), getSnapshot());
      return;
    }

    const before = getSnapshot();
    const domainsToRefresh = uniqueDomains(event.domains);
    const results = await Promise.allSettled(
      domainsToRefresh.map(async (domain) => {
        await refreshers[domain]?.();
        revisions[domain] += 1;
      }),
    );
    if (event.sequence !== lastSequence) {
      return;
    }

    const failed = results.find((result) => result.status === "rejected");
    if (failed) {
      onNotice({
        batchId: event.batchId,
        domains: domainsToRefresh,
        id: `${event.batchId}:${event.sequence}:refresh-failed`,
        level: "warning",
        text: "配置更新失败，Kerminal 已继续使用上次有效数据。",
        ttlMs: 3000,
      });
      return;
    }

    emitNotice(event, before, getSnapshot());
  };

  const emitNotice = (
    event: ConfigChangeEvent,
    before: ConfigChangeNoticeSnapshot,
    after: ConfigChangeNoticeSnapshot,
  ) => {
    const notice = buildConfigChangeNotice({
      after,
      batchId: event.batchId,
      before,
      domains: event.domains,
      sequence: event.sequence,
      sourceHint: event.sourceHint,
      status: event.status,
    });
    if (notice) {
      onNotice(notice);
    }
  };

  return {
    handleEvent,
    lastSequence: () => lastSequence,
    revision: (domain) => revisions[domain],
  };
}

function uniqueDomains(nextDomains: ConfigChangeDomain[]) {
  return nextDomains.filter(
    (domain, index) => nextDomains.indexOf(domain) === index && domains.includes(domain),
  );
}
