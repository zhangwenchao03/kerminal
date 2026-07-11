import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { writeDesktopClipboardText } from "../../lib/desktopClipboardApi";
import { cn } from "../../lib/cn";
import { IconAction } from "./icon-action";

interface DiagnosticDetailsProps {
  className?: string;
  detail: string;
  summary?: string;
}

/**
 * 默认收起技术信息，并提供可访问的复制入口。
 */
export function DiagnosticDetails({
  className,
  detail,
  summary = "技术详情",
}: DiagnosticDetailsProps) {
  const [copied, setCopied] = useState(false);

  const copyDetail = async () => {
    const result = await writeDesktopClipboardText(detail);
    setCopied(result.ok);
  };

  return (
    <details className={cn("group text-xs", className)}>
      <summary className="kerminal-focus-ring w-fit cursor-pointer list-none rounded-md text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100">
        {summary}
      </summary>
      <div className="kerminal-muted-surface relative mt-2 rounded-xl border p-3 pr-12">
        <pre className="scrollbar-none max-h-52 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-zinc-600 dark:text-zinc-300">
          {detail}
        </pre>
        <IconAction
          className="absolute right-2 top-2 h-7 w-7 rounded-lg"
          icon={copied ? Check : Copy}
          label={copied ? "已复制技术详情" : "复制技术详情"}
          onClick={() => void copyDetail()}
          tooltip={copied ? "已复制" : "复制"}
          variant="ghost"
        />
      </div>
    </details>
  );
}
