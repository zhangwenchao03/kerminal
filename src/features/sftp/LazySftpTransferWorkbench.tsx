import { lazy, Suspense } from "react";
import type { SftpTransferWorkbenchProps } from "./SftpTransferWorkbench";

// @author kongweiguang

const LazySftpTransferWorkbenchContent = lazy(() =>
  import("./SftpTransferWorkbench").then((module) => ({
    default: module.SftpTransferWorkbench,
  })),
);

export function LazySftpTransferWorkbench(
  props: SftpTransferWorkbenchProps,
) {
  return (
    <Suspense fallback={<SftpTransferWorkbenchFallback />}>
      <LazySftpTransferWorkbenchContent {...props} />
    </Suspense>
  );
}

function SftpTransferWorkbenchFallback() {
  return (
    <section
      aria-label="SFTP 传输工作台加载中"
      className="kerminal-solid-surface flex h-full min-h-0 items-center justify-center rounded-2xl border px-4 text-sm text-zinc-500 dark:text-zinc-400"
    >
      正在加载 SFTP 传输工作台...
    </section>
  );
}
