/** 浏览器 document/window 事实源的可测试适配器。 */
export interface TerminalDocumentActivityAdapter {
  addEventListener(
    type: TerminalDocumentActivityEventType,
    listener: () => void,
  ): void;
  hasFocus(): boolean;
  isVisible(): boolean;
  removeEventListener(
    type: TerminalDocumentActivityEventType,
    listener: () => void,
  ): void;
}

export type TerminalDocumentActivityEventType =
  | "focus"
  | "blur"
  | "visibilitychange";

/** 可供多个 pane 共享的 application activity lifecycle。 */
export interface TerminalDocumentActivityLifecycle {
  dispose(): void;
  getSnapshot(): boolean;
  subscribe(listener: () => void): () => void;
}

/** 多个 pane 共用同一组 document/window listener 的引用计数租约。 */
export interface TerminalDocumentActivityLease {
  activity: TerminalDocumentActivityLifecycle;
  release(): void;
}

let sharedActivity: TerminalDocumentActivityLifecycle | null = null;
let sharedActivityLeaseCount = 0;

/**
 * 获取进程内共享的 document activity。
 *
 * 第一个 pane 建立 listener，最后一个 pane 释放时统一清理，避免每个分屏重复监听。
 */
export function acquireTerminalDocumentActivity(): TerminalDocumentActivityLease {
  sharedActivity ??= createTerminalDocumentActivity();
  sharedActivityLeaseCount += 1;
  const activity = sharedActivity;
  let released = false;
  return {
    activity,
    release() {
      if (released) {
        return;
      }
      released = true;
      sharedActivityLeaseCount -= 1;
      if (sharedActivityLeaseCount > 0) {
        return;
      }
      activity.dispose();
      if (sharedActivity === activity) {
        sharedActivity = null;
      }
      sharedActivityLeaseCount = 0;
    },
  };
}

/**
 * 建立 document activity 事实源。
 * focus/blur 与 visibilitychange 都重新读取 adapter，且 dispose 会清理全部监听。
 */
export function createTerminalDocumentActivity(
  adapter: TerminalDocumentActivityAdapter = createBrowserDocumentActivityAdapter(),
): TerminalDocumentActivityLifecycle {
  const listeners = new Set<() => void>();
  let active = readApplicationActive(adapter);
  let disposed = false;

  const handleActivityChange = () => {
    if (disposed) {
      return;
    }
    const nextActive = readApplicationActive(adapter);
    if (nextActive === active) {
      return;
    }
    active = nextActive;
    for (const listener of listeners) {
      listener();
    }
  };

  const eventTypes: TerminalDocumentActivityEventType[] = [
    "focus",
    "blur",
    "visibilitychange",
  ];
  for (const eventType of eventTypes) {
    adapter.addEventListener(eventType, handleActivityChange);
  }

  return {
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const eventType of eventTypes) {
        adapter.removeEventListener(eventType, handleActivityChange);
      }
      listeners.clear();
    },
    getSnapshot: () => active,
    subscribe(listener) {
      if (disposed) {
        return EMPTY_UNSUBSCRIBE;
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function readApplicationActive(adapter: TerminalDocumentActivityAdapter) {
  return adapter.isVisible() && adapter.hasFocus();
}

function createBrowserDocumentActivityAdapter(): TerminalDocumentActivityAdapter {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return INERT_DOCUMENT_ACTIVITY_ADAPTER;
  }
  return {
    addEventListener(type, listener) {
      activityEventTarget(type).addEventListener(type, listener);
    },
    hasFocus: () => document.hasFocus(),
    isVisible: () => document.visibilityState === "visible",
    removeEventListener(type, listener) {
      activityEventTarget(type).removeEventListener(type, listener);
    },
  };
}

function activityEventTarget(type: TerminalDocumentActivityEventType) {
  return type === "visibilitychange" ? document : window;
}

const EMPTY_UNSUBSCRIBE = () => undefined;

const INERT_DOCUMENT_ACTIVITY_ADAPTER: TerminalDocumentActivityAdapter = {
  addEventListener: () => undefined,
  hasFocus: () => true,
  isVisible: () => true,
  removeEventListener: () => undefined,
};
