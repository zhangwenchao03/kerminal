export type TerminalEmptyStateActionId =
  | "createTerminal"
  | "openConnection"
  | "openAiTool";

export type TerminalEmptyStateActionVariant = "primary" | "secondary" | "ghost";

export interface TerminalEmptyStateAction {
  id: TerminalEmptyStateActionId;
  label: string;
  onSelect: () => void;
  variant: TerminalEmptyStateActionVariant;
}

export interface TerminalEmptyStateActionInput {
  onCreateTerminal?: () => void;
  onOpenAiTool?: () => void;
  onOpenConnection?: () => void;
}

export function buildTerminalEmptyStateActions({
  onCreateTerminal: _onCreateTerminal,
  onOpenAiTool: _onOpenAiTool,
  onOpenConnection: _onOpenConnection,
}: TerminalEmptyStateActionInput): TerminalEmptyStateAction[] {
  return [];
}
