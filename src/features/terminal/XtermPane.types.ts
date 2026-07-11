import type { TerminalAgentSignal } from "../../lib/terminalApi";
import type { RemoteTargetRef } from "../../lib/targetModel";
import type {
  ResolvedTheme,
  TerminalAppearance,
  TerminalColorScheme,
} from "../settings/settingsModel";
import type { TerminalSplitDirection } from "../workspace/types";
import type { ConnectionState } from "./XtermPane.helpers";
import type { TerminalInputCompatibilityMode } from "./terminalKeyboardPolicy";

interface XtermPaneProps {
  args?: string[];
  currentCwd?: string;
  cwd?: string;
  env?: Record<string, string>;
  focusRequestToken?: number;
  focused: boolean;
  inputCompatibilityMode?: TerminalInputCompatibilityMode;
  inputRequest?: XtermPaneInputRequest | null;
  paneId: string;
  profileId?: string;
  remoteCommand?: string;
  remoteHostId?: string;
  remoteHostProduction?: boolean;
  resolvedTheme: ResolvedTheme;
  shell?: string;
  shellAssistEnabled?: boolean;
  startupMessage?: string;
  terminalAppearance: TerminalAppearance;
  terminalColorSchemeOverride?: TerminalColorScheme;
  target?: RemoteTargetRef;
  title: string;
  transientStartupMessage?: boolean;
  visible?: boolean;
  onAgentSignal?: (signal: TerminalAgentSignal) => void;
  onCurrentCwdChange?: (cwd: string) => void;
  onConnectionStateChange?: (state: ConnectionState) => void;
  onOpenLogs?: () => void;
  onOutputHistoryChange?: (outputHistory: string | undefined) => void;
  onSessionFinished?: (event: XtermPaneSessionFinishedEvent) => void;
  onSplitPane?: (direction: TerminalSplitDirection) => void;
  onTerminalDimensionsChange?: (dimensions: XtermPaneDimensions) => void;
  outputHistory?: string;
  resolveInitialOutputHistory?: () => string | undefined;
}

export interface XtermPaneDimensions {
  cols: number;
  rows: number;
}

export interface XtermPaneInputRequest {
  id: string;
  submit?: boolean;
  text: string;
}

export interface XtermPaneSessionFinishedEvent {
  durationMs: number;
  reason: "closed";
  sessionId: string;
}

export type { XtermPaneProps };
