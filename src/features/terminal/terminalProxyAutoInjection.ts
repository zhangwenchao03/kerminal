export interface RemoteSocksAutoInjection {
  command: string;
  hostId: string;
  protocol: "socks5";
  proxyUrl: string;
  sessionId: string;
}

const STORAGE_KEY = "kerminal.remoteSocksAutoInjection.v1";

const injectionsByHost = loadPersistedInjections();

export function setRemoteSocksAutoInjection(
  injection: RemoteSocksAutoInjection,
) {
  injectionsByHost.set(injection.hostId, injection);
  persistInjections();
}

export function getRemoteSocksAutoInjection(hostId: string) {
  return injectionsByHost.get(hostId);
}

export function isRemoteSocksAutoInjectionEnabled({
  hostId,
  sessionId,
}: {
  hostId: string;
  sessionId: string;
}) {
  return injectionsByHost.get(hostId)?.sessionId === sessionId;
}

export function clearRemoteSocksAutoInjection(
  hostId: string,
  sessionId?: string,
) {
  const current = injectionsByHost.get(hostId);
  if (!current || (sessionId && current.sessionId !== sessionId)) {
    return false;
  }
  injectionsByHost.delete(hostId);
  persistInjections();
  return true;
}

function loadPersistedInjections() {
  const map = new Map<string, RemoteSocksAutoInjection>();
  const storage = resolveStorage();
  if (!storage) {
    return map;
  }

  try {
    const rawValue = storage.getItem(STORAGE_KEY);
    if (!rawValue) {
      return map;
    }
    const parsed = JSON.parse(rawValue);
    const entries = Array.isArray(parsed?.injections) ? parsed.injections : [];
    for (const entry of entries) {
      const injection = normalizeInjection(entry);
      if (injection) {
        map.set(injection.hostId, injection);
      }
    }
  } catch {
    storage.removeItem(STORAGE_KEY);
  }
  return map;
}

function persistInjections() {
  const storage = resolveStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        injections: Array.from(injectionsByHost.values()),
        version: 1,
      }),
    );
  } catch {
    // Persistence is best-effort. The in-memory toggle still works for this run.
  }
}

function normalizeInjection(
  value: unknown,
): RemoteSocksAutoInjection | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const source = value as Partial<RemoteSocksAutoInjection>;
  if (
    typeof source.command !== "string" ||
    typeof source.hostId !== "string" ||
    typeof source.proxyUrl !== "string" ||
    typeof source.sessionId !== "string" ||
    !source.command.trim() ||
    !source.hostId.trim() ||
    !source.proxyUrl.trim() ||
    !source.sessionId.trim() ||
    source.protocol !== "socks5"
  ) {
    return undefined;
  }
  return {
    command: source.command,
    hostId: source.hostId,
    protocol: source.protocol,
    proxyUrl: source.proxyUrl,
    sessionId: source.sessionId,
  };
}

function resolveStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
