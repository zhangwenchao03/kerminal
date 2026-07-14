import type {
  TerminalAgentSignal,
  TerminalOutputEvent,
} from "../../lib/terminalApi";
import {
  runTerminalOutputInstrumentationStep,
  type TerminalOutputInstrumentation,
} from "./terminalOutputInstrumentation";
import type { TerminalOutputHistoryBuffer } from "./terminalOutputHistoryBuffer";
import type { TerminalOutputWriter } from "./terminalOutputWriter";
import type { InitialRemoteOutputGate } from "./terminalInitialRemoteOutputGate";
import { collectCurrentDirOscSequences } from "./XtermPane.helpers";

interface RefBox<T> {
  current: T;
}

interface CreateTerminalSessionOutputControllerOptions {
  activityRuntime: { markOutput(): void };
  artifactRuntime: { queueOutput(data: string): void };
  assistEnabled: boolean;
  commandBlockRuntime: {
    appendShellIntegrationCommandOutput(data: string): void;
  };
  cwdTrackingBufferRef: RefBox<string>;
  focusedRef: RefBox<boolean>;
  hasRemoteTerminalTarget: boolean;
  initialRemoteOutputGate: InitialRemoteOutputGate;
  instrumentation: TerminalOutputInstrumentation | null;
  isCurrent(): boolean;
  isSshTerminalTarget: boolean;
  onAgentSignal(signal: TerminalAgentSignal): void;
  onCurrentCwd(cwd: string): void;
  onReadError(event: TerminalOutputEvent): void;
  onSessionClosed(sessionId: string): void;
  outputHistoryBuffer: TerminalOutputHistoryBuffer;
  outputWriter: TerminalOutputWriter;
  remoteCwdTracking: boolean;
  sshFailureTracker: { append(data: string): void };
  transientStartupNoticeVisible: boolean;
  visibleRef: RefBox<boolean>;
}

/**
 * 固化单次会话的输出处理顺序。
 *
 * generation 的事实源仍由调用方持有；旧会话事件在进入任何写入副作用前被拒绝。
 */
export function createTerminalSessionOutputController({
  activityRuntime,
  artifactRuntime,
  assistEnabled,
  commandBlockRuntime,
  cwdTrackingBufferRef,
  focusedRef,
  hasRemoteTerminalTarget,
  initialRemoteOutputGate,
  instrumentation,
  isCurrent,
  isSshTerminalTarget,
  onAgentSignal,
  onCurrentCwd,
  onReadError,
  onSessionClosed,
  outputHistoryBuffer,
  outputWriter,
  remoteCwdTracking,
  sshFailureTracker,
  transientStartupNoticeVisible: initialStartupNoticeVisible,
  visibleRef,
}: CreateTerminalSessionOutputControllerOptions) {
  let transientStartupNoticeVisible = initialStartupNoticeVisible;

  return (event: TerminalOutputEvent) => {
    if (!isCurrent()) {
      return;
    }
    if (event.kind === "agentSignal") {
      if (event.agentSignal) {
        onAgentSignal(event.agentSignal);
      }
      return;
    }
    if (event.kind === "data") {
      artifactRuntime.queueOutput(event.data);
      activityRuntime.markOutput();
      if (isSshTerminalTarget) {
        sshFailureTracker.append(event.data);
      }
      if (transientStartupNoticeVisible) {
        outputWriter.writeNow("\x1b[1A\x1b[2K\r");
        transientStartupNoticeVisible = false;
      }
      if (remoteCwdTracking) {
        const tracked = runTerminalOutputInstrumentationStep(
          instrumentation,
          "cwdOsc",
          event.data.length,
          () =>
            collectCurrentDirOscSequences(
              cwdTrackingBufferRef.current,
              event.data,
            ),
        );
        cwdTrackingBufferRef.current = tracked.buffer;
        for (const nextCwd of tracked.paths) {
          onCurrentCwd(nextCwd);
        }
      }
      if (assistEnabled) {
        runTerminalOutputInstrumentationStep(
          instrumentation,
          "commandBlock",
          event.data.length,
          () =>
            commandBlockRuntime.appendShellIntegrationCommandOutput(event.data),
        );
      }
      runTerminalOutputInstrumentationStep(
        instrumentation,
        "writer",
        event.data.length,
        () => {
          if (
            hasRemoteTerminalTarget &&
            initialRemoteOutputGate.shouldWriteNow(event.data)
          ) {
            outputWriter.writeNow(event.data);
            return;
          }
          outputWriter.setCadence(
            visibleRef.current === false
              ? "hidden"
              : focusedRef.current
                ? "focused"
                : "visible",
          );
          outputWriter.write(event.data);
        },
      );
      runTerminalOutputInstrumentationStep(
        instrumentation,
        "history",
        event.data.length,
        () => outputHistoryBuffer.append(event.data),
      );
      return;
    }
    if (event.kind === "closed") {
      onSessionClosed(event.sessionId);
      return;
    }
    onReadError(event);
  };
}
