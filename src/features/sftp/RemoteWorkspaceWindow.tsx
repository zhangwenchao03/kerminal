import { useEffect, useMemo, useState } from "react";
import { FolderOpen, Save } from "lucide-react";
import { cn } from "../../lib/cn";
import { useDocumentTheme } from "../../lib/useDocumentTheme";
import {
  RemoteWorkspaceEditor,
  type RemoteWorkspaceOpenCommand,
  type RemoteWorkspaceStatus,
} from "./RemoteWorkspaceEditor";

type DetachedWorkspaceTheme = "dark" | "light";

export function RemoteWorkspaceWindow({
  hostId,
  openPath,
  rootPath,
  theme,
}: {
  hostId: string;
  openPath?: string;
  rootPath: string;
  theme: DetachedWorkspaceTheme;
}) {
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<RemoteWorkspaceStatus | null>(null);
  useDocumentTheme({ theme });
  const openCommand = useMemo<RemoteWorkspaceOpenCommand | null>(
    () => (openPath ? { nonce: 1, path: openPath } : null),
    [openPath],
  );

  useEffect(() => {
    if (!dirty) {
      return undefined;
    }

    const confirmClose = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", confirmClose);
    return () => window.removeEventListener("beforeunload", confirmClose);
  }, [dirty]);

  return (
    <main
      className={cn(
        "flex h-screen min-h-0 flex-col overflow-hidden",
        theme === "dark"
          ? "dark bg-[#101012] text-zinc-100"
          : "bg-[#f5f5f7] text-zinc-950",
      )}
      data-theme={theme}
    >
      <header
        className="flex h-12 shrink-0 items-center gap-3 border-b border-black/8 bg-white/72 px-4 backdrop-blur-xl dark:border-white/8 dark:bg-[#111113]/92"
        data-tauri-drag-region
      >
        <FolderOpen className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-300" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">远程工作区</div>
          <div className="truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">
            {rootPath}
          </div>
        </div>
        {dirty ? (
          <div className="flex items-center gap-1.5 rounded-md border border-amber-300/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-200">
            <Save className="h-3.5 w-3.5" />
            有未保存修改
          </div>
        ) : null}
        {status ? (
          <div
            className={cn(
              "max-w-[36vw] truncate rounded-md border px-2 py-1 text-xs",
              status.kind === "success" &&
                "border-emerald-300/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200",
              status.kind === "error" &&
                "border-rose-300/30 bg-rose-500/10 text-rose-700 dark:text-rose-200",
              status.kind === "info" &&
                "border-black/8 bg-black/[0.03] text-zinc-600 dark:border-white/8 dark:bg-white/6 dark:text-zinc-300",
            )}
            role={status.kind === "error" ? "alert" : "status"}
            title={status.message}
          >
            {status.message}
          </div>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 p-3">
        <RemoteWorkspaceEditor
          hostId={hostId}
          onDirtyStateChange={setDirty}
          onStatus={setStatus}
          openCommand={openCommand}
          rootPath={rootPath}
          variant="workspace"
        />
      </div>
    </main>
  );
}

export function remoteWorkspaceThemeFromParam(
  value: string | null,
): DetachedWorkspaceTheme {
  if (value === "dark" || value === "light") {
    return value;
  }
  if (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }
  return "light";
}
