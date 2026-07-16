import type { Terminal as XtermTerminal } from "@xterm/xterm";
import {
  terminalChromeRuntimeStore,
  type TerminalPaneChromeSnapshot,
} from "./terminalChromeRuntimeStore";
import { acquireTerminalDocumentActivity } from "./terminalDocumentActivity";
import type { TerminalPaneBufferType } from "./terminalPaneActivityModel";
import type { ConnectionState } from "./XtermPane.helpers";

/** XtermPane 与低频 chrome store 之间的窄运行态接口。 */
export interface XtermPaneActivityRuntime {
  dispose(): void;
  jumpToBottom(): void;
  markBufferChanged(): TerminalPaneChromeSnapshot;
  markOutput(): TerminalPaneChromeSnapshot;
  markScrollPosition(): TerminalPaneChromeSnapshot;
  markUserInput(): TerminalPaneChromeSnapshot;
  setConnectionState(state: ConnectionState): TerminalPaneChromeSnapshot;
  setVisible(visible: boolean): TerminalPaneChromeSnapshot;
}

interface CreateXtermPaneActivityRuntimeOptions {
  connectionState: ConnectionState;
  container: HTMLElement;
  paneId: string;
  terminal: XtermTerminal;
  visible: boolean;
}

/**
 * 安装 xterm activity 事实源。
 *
 * 高频输出只调用纯 reducer；只有 unread/followPaused/Bell 等语义首次变化时，
 * external store 才通知 React。该运行态不保存 output 文本，也不使用 timer/rAF。
 */
export function createXtermPaneActivityRuntime({
  connectionState,
  container,
  paneId,
  terminal,
  visible,
}: CreateXtermPaneActivityRuntimeOptions): XtermPaneActivityRuntime {
  const documentActivityLease = acquireTerminalDocumentActivity();
  const documentActivity = documentActivityLease.activity;
  const unregisterPane = terminalChromeRuntimeStore.register(paneId, {
    applicationActive: documentActivity.getSnapshot(),
    atBottom: readTerminalAtBottom(terminal),
    bufferType: readTerminalBufferType(terminal),
    connectionState: mapConnectionState(connectionState),
    visible,
  });

  const bellDisposable =
    typeof terminal.onBell === "function"
      ? terminal.onBell(() => {
          terminalChromeRuntimeStore.update(paneId, { type: "bell" });
        })
      : undefined;
  const unsubscribeDocumentActivity = documentActivity.subscribe(() => {
    terminalChromeRuntimeStore.update(paneId, {
      applicationActive: documentActivity.getSnapshot(),
      type: "applicationActivityChanged",
    });
  });
  const handleUserWheel = () => {
    terminalChromeRuntimeStore.update(paneId, {
      atBottom: readTerminalAtBottom(terminal),
      type: "userScrolled",
    });
  };
  container.addEventListener("wheel", handleUserWheel, { passive: true });

  let disposed = false;
  return {
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      container.removeEventListener("wheel", handleUserWheel);
      bellDisposable?.dispose();
      unsubscribeDocumentActivity();
      documentActivityLease.release();
      unregisterPane();
    },
    jumpToBottom() {
      if (disposed) {
        return;
      }
      terminal.scrollToBottom();
      terminalChromeRuntimeStore.update(paneId, { type: "jumpToBottom" });
    },
    markBufferChanged() {
      if (disposed) {
        return terminalChromeRuntimeStore.getSnapshot(paneId);
      }
      terminalChromeRuntimeStore.update(paneId, {
        bufferType: readTerminalBufferType(terminal),
        type: "bufferChanged",
      });
      return terminalChromeRuntimeStore.update(paneId, {
        atBottom: readTerminalAtBottom(terminal),
        type: "bottomChanged",
      });
    },
    markOutput() {
      return disposed
        ? terminalChromeRuntimeStore.getSnapshot(paneId)
        : terminalChromeRuntimeStore.update(paneId, { type: "output" });
    },
    markScrollPosition() {
      return disposed
        ? terminalChromeRuntimeStore.getSnapshot(paneId)
        : terminalChromeRuntimeStore.update(paneId, {
            atBottom: readTerminalAtBottom(terminal),
            type: "bottomChanged",
          });
    },
    markUserInput() {
      return disposed
        ? terminalChromeRuntimeStore.getSnapshot(paneId)
        : terminalChromeRuntimeStore.update(paneId, { type: "userInput" });
    },
    setConnectionState(state) {
      return disposed
        ? terminalChromeRuntimeStore.getSnapshot(paneId)
        : terminalChromeRuntimeStore.update(paneId, {
            connectionState: mapConnectionState(state),
            type: "connectionChanged",
          });
    },
    setVisible(nextVisible) {
      return disposed
        ? terminalChromeRuntimeStore.getSnapshot(paneId)
        : terminalChromeRuntimeStore.update(paneId, {
            type: "visibilityChanged",
            visible: nextVisible,
          });
    },
  };
}

/** 使用 xterm buffer 事实判断 normal buffer 是否位于底部。 */
export function readTerminalAtBottom(terminal: XtermTerminal): boolean {
  const activeBuffer = terminal.buffer.active;
  return (
    activeBuffer.type === "normal" &&
    activeBuffer.viewportY >= activeBuffer.baseY
  );
}

function readTerminalBufferType(
  terminal: XtermTerminal,
): TerminalPaneBufferType {
  return terminal.buffer.active.type === "alternate" ? "alternate" : "normal";
}

function mapConnectionState(
  state: ConnectionState,
): TerminalPaneChromeSnapshot["connectionState"] {
  if (state === "connected") {
    return "connected";
  }
  if (state === "connecting") {
    return "connecting";
  }
  if (state === "reconnecting") {
    return "reconnecting";
  }
  if (state === "error") {
    return "error";
  }
  return "closed";
}
