import { ArrowDown } from "lucide-react";
import { Button } from "../../components/ui/button";

/** 用户查看历史输出时提供显式跳底，不主动改变当前滚动位置。 */
export function TerminalNewOutputButton({
  onClick,
}: {
  onClick: () => void;
}) {
  return (
    <Button
      aria-label="滚动到最新输出"
      className="absolute bottom-3 right-5 z-20 h-8 gap-1.5 rounded-lg border border-sky-500/30 bg-[var(--surface-overlay)] px-2.5 text-xs text-sky-700 shadow-lg shadow-black/10 backdrop-blur hover:bg-[var(--surface-hover)] dark:border-sky-300/25 dark:text-sky-100 dark:shadow-black/30"
      onClick={onClick}
      size="sm"
      title="滚动到最新输出"
      type="button"
      variant="ghost"
    >
      <ArrowDown className="h-3.5 w-3.5" />
      新输出
    </Button>
  );
}
