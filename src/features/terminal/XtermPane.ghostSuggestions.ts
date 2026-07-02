// @author kongweiguang

import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { Terminal as XtermTerminal } from "@xterm/xterm";
import {
  listTerminalSuggestions,
  recordTerminalSuggestionFeedback,
} from "../../lib/terminalSuggestionApi";
import type { CommandHistoryTarget } from "../../lib/commandHistoryApi";
import { writeTerminal } from "../../lib/terminalApi";
import type { AppSettings } from "../settings/settingsModel";
import type { TerminalPane } from "../workspace/types";
import {
  applyTerminalInputData,
  terminalSuggestionEligibility,
  updateTerminalInputBufferKind,
  type TerminalInputModelState,
} from "./terminalInputModel";
import {
  resolveGhostSuggestionLayout,
  terminalGhostSuggestionEqual,
  terminalSuggestionProviders,
  type TerminalGhostSuggestion,
} from "./XtermPane.helpers";
import { resolveTerminalSuggestionProbePolicy } from "./terminalSuggestionProbePolicy";

function resolveSuggestionTarget({
  remoteHostId,
  target,
}: {
  remoteHostId?: string;
  target: TerminalPane["target"];
}) {
  const containerHostId =
    target?.kind === "dockerContainer" ? target.hostId : undefined;
  const telnetHostId = target?.kind === "telnet" ? target.hostId : undefined;
  const serialHostId = target?.kind === "serial" ? target.hostId : undefined;
  const sshHostId = telnetHostId || serialHostId ? undefined : remoteHostId;
  const remoteHostTargetId =
    containerHostId ?? telnetHostId ?? serialHostId ?? sshHostId;
  const suggestionTarget: CommandHistoryTarget = containerHostId
    ? "dockerContainer"
    : telnetHostId
      ? "telnet"
      : serialHostId
        ? "serial"
        : sshHostId
          ? "ssh"
          : "local";

  return {
    remoteHostId: remoteHostTargetId,
    target: suggestionTarget,
  };
}

export function createXtermPaneGhostSuggestions({
  assistEnabled,
  canScheduleSuggestion = () => true,
  container,
  currentCwdRef,
  cwd,
  ghostSuggestionRef,
  inputBufferRef,
  inputModelRef,
  isDisposed,
  paneId,
  profileId,
  remoteHostId,
  remoteHostProduction,
  scheduleCommandBlockViewSync,
  sessionIdRef,
  setGhostSuggestion,
  shell,
  target,
  terminal,
  terminalAppearanceRef,
}: {
  assistEnabled: boolean;
  canScheduleSuggestion?: () => boolean;
  container: HTMLDivElement;
  currentCwdRef: MutableRefObject<string | null>;
  cwd?: string;
  ghostSuggestionRef: MutableRefObject<TerminalGhostSuggestion | null>;
  inputBufferRef: MutableRefObject<string>;
  inputModelRef: MutableRefObject<TerminalInputModelState>;
  isDisposed: () => boolean;
  paneId: string;
  profileId?: string;
  remoteHostId?: string;
  remoteHostProduction?: boolean;
  scheduleCommandBlockViewSync: () => void;
  sessionIdRef: MutableRefObject<string | null>;
  setGhostSuggestion: Dispatch<SetStateAction<TerminalGhostSuggestion | null>>;
  shell?: string;
  target: TerminalPane["target"];
  terminal: XtermTerminal;
  terminalAppearanceRef: MutableRefObject<AppSettings["terminal"]>;
}) {
  let suggestionRequestRun = 0;
  let suggestionTimer: number | null = null;
  let consecutiveSuggestionFailures = 0;
  let inputBurstCount = 0;
  let lastInputAt: number | undefined;
  let lastSuggestionDurationMs: number | undefined;
  let lastSuggestionFailureAt: number | undefined;

  const clearSuggestionTimer = () => {
    if (suggestionTimer !== null) {
      window.clearTimeout(suggestionTimer);
      suggestionTimer = null;
    }
  };

  const updateGhostSuggestion = (suggestion: TerminalGhostSuggestion) => {
    ghostSuggestionRef.current = suggestion;
    setGhostSuggestion((current) =>
      terminalGhostSuggestionEqual(current, suggestion) ? current : suggestion,
    );
  };

  const hideGhostSuggestion = () => {
    ghostSuggestionRef.current = null;
    setGhostSuggestion((current) => (current === null ? current : null));
  };

  const clearGhostSuggestion = () => {
    clearSuggestionTimer();
    suggestionRequestRun += 1;
    hideGhostSuggestion();
  };

  const refreshGhostSuggestionLayout = () => {
    const suggestion = ghostSuggestionRef.current;
    if (!suggestion) {
      return;
    }
    const layout = resolveGhostSuggestionLayout(
      container,
      terminal,
      terminalAppearanceRef.current,
      inputModelRef.current,
    );
    if (!layout) {
      clearGhostSuggestion();
      return;
    }
    updateGhostSuggestion({ ...suggestion, ...layout });
  };

  const scheduleGhostSuggestion = () => {
    if (!assistEnabled) {
      clearGhostSuggestion();
      return;
    }
    const now = Date.now();
    inputBurstCount =
      typeof lastInputAt === "number" && now - lastInputAt <= 220
        ? inputBurstCount + 1
        : 1;
    lastInputAt = now;
    const policy = resolveTerminalSuggestionProbePolicy({
      consecutiveFailures: consecutiveSuggestionFailures,
      inputBurstCount,
      lastFailureAt: lastSuggestionFailureAt,
      lastInputAt,
      lastProbeDurationMs: lastSuggestionDurationMs,
      lifecycleEnabled: canScheduleSuggestion(),
      lifecycleReason: "lifecycle-gate",
      now,
    });
    if (!policy.shouldSchedule) {
      clearGhostSuggestion();
      return;
    }
    clearSuggestionTimer();
    const inlineSuggestion = terminalAppearanceRef.current.inlineSuggestion;
    if (!inlineSuggestion.enabled) {
      clearGhostSuggestion();
      return;
    }
    inputModelRef.current = updateTerminalInputBufferKind(
      inputModelRef.current,
      terminal.buffer.active.type,
    );
    const eligibility = terminalSuggestionEligibility(inputModelRef.current);
    if (!eligibility.eligible) {
      clearGhostSuggestion();
      return;
    }
    suggestionTimer = window.setTimeout(() => {
      suggestionTimer = null;
      if (!canScheduleSuggestion()) {
        clearGhostSuggestion();
        return;
      }
      const requestRun = ++suggestionRequestRun;
      const requestStartedAt = Date.now();
      const model = inputModelRef.current;
      const layout = resolveGhostSuggestionLayout(
        container,
        terminal,
        terminalAppearanceRef.current,
        model,
      );
      if (!layout) {
        clearGhostSuggestion();
        return;
      }
      const sessionId = sessionIdRef.current;
      const suggestionTarget = resolveSuggestionTarget({ remoteHostId, target });
      const suggestionProviders = terminalSuggestionProviders({
        hasSshRemote: Boolean(
          suggestionTarget.target === "ssh" && !target?.kind,
        ),
        inlineSuggestion: terminalAppearanceRef.current.inlineSuggestion,
        remoteHostProduction,
      });
      if (suggestionProviders.length === 0) {
        clearGhostSuggestion();
        return;
      }
      void listTerminalSuggestions({
        cursor: model.cursor,
        cwd: currentCwdRef.current ?? cwd,
        input: model.command,
        limit: 1,
        paneId,
        profileId,
        providers: suggestionProviders,
        remoteHostId: suggestionTarget.remoteHostId,
        sessionId: sessionId ?? undefined,
        shell,
        target: suggestionTarget.target,
      })
        .then((suggestions) => {
          lastSuggestionDurationMs = Date.now() - requestStartedAt;
          consecutiveSuggestionFailures = 0;
          if (isDisposed() || requestRun !== suggestionRequestRun) {
            return;
          }
          const candidate = suggestions.find((item) => item.suffix.length > 0);
          if (!candidate) {
            hideGhostSuggestion();
            return;
          }
          updateGhostSuggestion({
            ...layout,
            candidate,
            suffix: candidate.suffix,
          });
        })
        .catch(() => {
          lastSuggestionDurationMs = Date.now() - requestStartedAt;
          lastSuggestionFailureAt = Date.now();
          consecutiveSuggestionFailures += 1;
          if (!isDisposed() && requestRun === suggestionRequestRun) {
            hideGhostSuggestion();
          }
        });
    }, policy.delayMs);
  };

  const recordGhostSuggestionFeedback = (
    action: "accepted" | "dismissed",
    suggestion: TerminalGhostSuggestion,
    input: string,
  ) => {
    const sessionId = sessionIdRef.current;
    const suggestionTarget = resolveSuggestionTarget({ remoteHostId, target });
    const candidate = suggestion.candidate;
    void recordTerminalSuggestionFeedback({
      action,
      cwd: currentCwdRef.current ?? cwd,
      input,
      paneId,
      profileId,
      provider: candidate.provider,
      remoteHostId: suggestionTarget.remoteHostId,
      replacementText: candidate.replacementText,
      sessionId: sessionId ?? undefined,
      shell,
      sourceId: candidate.sourceId,
      target: suggestionTarget.target,
    }).catch(() => undefined);
  };

  const acceptGhostSuggestion = (sessionId: string) => {
    if (terminalAppearanceRef.current.inlineSuggestion.acceptKey !== "rightArrow") {
      return false;
    }
    const suggestion = ghostSuggestionRef.current;
    if (!suggestion?.suffix) {
      return false;
    }
    recordGhostSuggestionFeedback(
      "accepted",
      suggestion,
      inputModelRef.current.command,
    );
    void writeTerminal(sessionId, suggestion.suffix);
    const accepted = applyTerminalInputData(
      inputModelRef.current,
      suggestion.suffix,
    );
    inputModelRef.current = accepted.state;
    inputBufferRef.current = accepted.state.command;
    clearGhostSuggestion();
    scheduleCommandBlockViewSync();
    return true;
  };

  return {
    acceptGhostSuggestion,
    clearGhostSuggestion,
    dispose: clearSuggestionTimer,
    recordGhostSuggestionFeedback,
    refreshGhostSuggestionLayout,
    scheduleGhostSuggestion,
  };
}
