// @author kongweiguang
import type { TerminalPane } from "../workspace/types";

export type TerminalRuntimePaneMode = Extract<
  TerminalPane["mode"],
  "local" | "ssh" | "telnet" | "serial" | "container"
>;

const TERMINAL_RUNTIME_PANE_MODES = new Set<TerminalPane["mode"]>([
  "local",
  "ssh",
  "telnet",
  "serial",
  "container",
]);

export interface TerminalPaneCardModel {
  ariaLabel: string;
  closeAriaLabel: string;
  latencyLabel?: string;
  renderKind: "runtime" | "preview";
  title: string;
}

export function isTerminalRuntimePaneMode(
  mode: TerminalPane["mode"],
): mode is TerminalRuntimePaneMode {
  return TERMINAL_RUNTIME_PANE_MODES.has(mode);
}

export function buildTerminalPaneCardModel(
  pane: Pick<TerminalPane, "latencyMs" | "mode" | "title">,
): TerminalPaneCardModel {
  return {
    ariaLabel: `${pane.title} 终端分屏`,
    closeAriaLabel: `关闭 ${pane.title} 分屏`,
    latencyLabel: pane.latencyMs ? `${pane.latencyMs}ms` : undefined,
    renderKind: isTerminalRuntimePaneMode(pane.mode) ? "runtime" : "preview",
    title: pane.title,
  };
}
