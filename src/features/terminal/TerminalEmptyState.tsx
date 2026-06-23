import kerminalLogoUrl from "../../assets/kerminal-logo.svg";

export interface TerminalEmptyStateProps {
  onCreateTerminal?: () => void;
  onOpenAiTool?: () => void;
  onOpenConnection?: () => void;
}

export function TerminalEmptyState(_props: TerminalEmptyStateProps) {
  return (
    <div className="kerminal-solid-surface flex h-full items-center justify-center rounded-2xl border p-6 text-zinc-700 dark:text-zinc-200">
      <div className="mx-auto flex w-full max-w-sm flex-col items-center text-center">
        <div className="kerminal-muted-surface flex h-[72px] w-[72px] items-center justify-center rounded-2xl border p-3 shadow-sm shadow-black/5">
          <img
            alt="Kerminal"
            className="h-12 w-12"
            draggable={false}
            src={kerminalLogoUrl}
          />
        </div>
        <p className="mt-4 text-sm font-medium leading-6 text-zinc-500 dark:text-zinc-400">
          光标还没闪，AI 已经开始脑补命令了。
        </p>
      </div>
    </div>
  );
}
