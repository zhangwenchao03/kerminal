/**
 * 本地传输面板的目标状态栏。
 *
 * @author kongweiguang
 */

import { cn } from "../../lib/cn";
import type { Machine } from "../workspace/types";

export function LocalTransferPaneTargetFooter({
  chromePaddingClass,
  targetMachine,
  targetPath,
}: {
  chromePaddingClass: string;
  targetMachine: Machine | undefined;
  targetPath: string | undefined;
}) {
  return (
    <div
      className={cn(
        "shrink-0 border-t border-[var(--border-subtle)]",
        chromePaddingClass,
      )}
    >
      <div className="truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">
        {targetMachine
          ? `目标：${targetMachine.name}:${targetPath ?? "/"}`
          : "右侧未选择服务器"}
      </div>
    </div>
  );
}
