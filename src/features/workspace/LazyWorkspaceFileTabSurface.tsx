import { lazy, Suspense } from "react";
import type { WorkspaceFileTabSurfaceProps } from "./WorkspaceFileTabSurface";

const LazyWorkspaceFileTabSurfaceContent = lazy(() =>
  import("./WorkspaceFileTabSurface").then((module) => ({
    default: module.WorkspaceFileTabSurface,
  })),
);

export function LazyWorkspaceFileTabSurface(
  props: WorkspaceFileTabSurfaceProps,
) {
  return (
    <Suspense fallback={<WorkspaceFileTabSurfaceFallback />}>
      <LazyWorkspaceFileTabSurfaceContent {...props} />
    </Suspense>
  );
}

function WorkspaceFileTabSurfaceFallback() {
  return (
    <section
      aria-label="文件标签加载中"
      className="kerminal-solid-surface flex h-full min-h-0 items-center justify-center rounded-[var(--radius-card)] border px-4 text-sm text-zinc-500 dark:text-zinc-400"
    >
      正在加载文件视图...
    </section>
  );
}
