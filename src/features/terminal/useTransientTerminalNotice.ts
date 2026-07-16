import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_TRANSIENT_NOTICE_DURATION_MS = 2_000;

/**
 * 管理终端内的瞬时操作提示；连续触发时重新计时，卸载时清理待执行任务。
 */
export function useTransientTerminalNotice(
  durationMs = DEFAULT_TRANSIENT_NOTICE_DURATION_MS,
) {
  const timeoutRef = useRef<number | null>(null);
  const [notice, setNoticeValue] = useState<string | null>(null);

  const clearNoticeTimeout = useCallback(() => {
    if (timeoutRef.current === null) {
      return;
    }
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }, []);

  const setNotice = useCallback(
    (nextNotice: string | null) => {
      clearNoticeTimeout();
      setNoticeValue(nextNotice);
      if (!nextNotice) {
        return;
      }
      timeoutRef.current = window.setTimeout(() => {
        timeoutRef.current = null;
        setNoticeValue(null);
      }, durationMs);
    },
    [clearNoticeTimeout, durationMs],
  );

  useEffect(() => clearNoticeTimeout, [clearNoticeTimeout]);

  return [notice, setNotice] as const;
}
