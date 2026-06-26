export type TerminalEmptyStateActionId =
  | "createTerminal"
  | "openConnection"
  | "openAgentTool";

export type TerminalEmptyStateActionVariant = "primary" | "secondary" | "ghost";

export interface TerminalEmptyStateAction {
  id: TerminalEmptyStateActionId;
  label: string;
  onSelect: () => void;
  variant: TerminalEmptyStateActionVariant;
}

export interface TerminalEmptyStateActionInput {
  onCreateTerminal?: () => void;
  onOpenAgentTool?: () => void;
  onOpenConnection?: () => void;
}

export function buildTerminalEmptyStateActions({
  onCreateTerminal: _onCreateTerminal,
  onOpenAgentTool: _onOpenAgentTool,
  onOpenConnection: _onOpenConnection,
}: TerminalEmptyStateActionInput): TerminalEmptyStateAction[] {
  return [];
}
