import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { cn } from "../../lib/cn";
import type {
  UserFacingMessage,
  UserFacingMessageSeverity,
} from "../../lib/userFacingMessage";
import { DiagnosticDetails } from "./diagnostic-details";

interface UserFacingNoticeProps {
  children?: ReactNode;
  className?: string;
  compact?: boolean;
  message: UserFacingMessage;
}

const severityStyles: Record<UserFacingMessageSeverity, string> = {
  error:
    "border-rose-300/30 bg-rose-500/10 text-rose-800 dark:text-rose-100",
  info: "border-sky-300/25 bg-sky-500/10 text-sky-800 dark:text-sky-100",
  success:
    "border-emerald-300/25 bg-emerald-500/10 text-emerald-800 dark:text-emerald-100",
  warning:
    "border-amber-300/30 bg-amber-500/10 text-amber-800 dark:text-amber-100",
};

const severityIcons: Record<
  UserFacingMessageSeverity,
  ComponentType<{ className?: string }>
> = {
  error: AlertCircle,
  info: Info,
  success: CheckCircle2,
  warning: TriangleAlert,
};

/**
 * 展示用户摘要、恢复建议和默认隐藏的技术详情。
 */
export function UserFacingNotice({
  children,
  className,
  compact = false,
  message,
}: UserFacingNoticeProps) {
  const Icon = severityIcons[message.severity];
  return (
    <section
      className={cn(
        "rounded-[var(--radius-card)] border",
        compact ? "px-3 py-2.5" : "px-4 py-3",
        severityStyles[message.severity],
        className,
      )}
      role={message.severity === "error" ? "alert" : "status"}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{message.title}</p>
          {message.detail ? (
            <p className="mt-1 text-xs opacity-80">{message.detail}</p>
          ) : null}
          {message.recoveryAction ? (
            <p className="mt-1.5 text-xs font-medium">
              {message.recoveryAction}
            </p>
          ) : null}
          {message.technicalDetail ? (
            <DiagnosticDetails
              className="mt-2"
              detail={message.technicalDetail}
            />
          ) : null}
          {children ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">{children}</div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
