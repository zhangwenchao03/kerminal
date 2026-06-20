import "./App.css";
import { lazy, Suspense } from "react";
import { KerminalShell } from "./app/KerminalShell";

const RemoteWorkspaceWindow = lazy(() =>
  import("./features/sftp/RemoteWorkspaceWindow").then((module) => ({
    default: module.RemoteWorkspaceWindow,
  })),
);

type DetachedWorkspaceTheme = "dark" | "light";

function App() {
  const remoteWorkspaceRoute = getRemoteWorkspaceRoute();
  if (remoteWorkspaceRoute) {
    return (
      <Suspense fallback={<RemoteWorkspaceFallback theme={remoteWorkspaceRoute.theme} />}>
        <RemoteWorkspaceWindow {...remoteWorkspaceRoute} />
      </Suspense>
    );
  }

  return <KerminalShell />;
}

function getRemoteWorkspaceRoute() {
  if (typeof window === "undefined") {
    return null;
  }

  const params = new URLSearchParams(window.location.search);
  if (params.get("view") !== "sftp-workspace") {
    return null;
  }

  const hostId = params.get("hostId");
  const rootPath = params.get("rootPath");
  if (!hostId || !rootPath) {
    return null;
  }

  return {
    hostId,
    openPath: params.get("filePath") ?? undefined,
    rootPath,
    theme: remoteWorkspaceThemeFromParam(params.get("theme")),
  };
}

export default App;

function remoteWorkspaceThemeFromParam(
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

function RemoteWorkspaceFallback({ theme }: { theme: DetachedWorkspaceTheme }) {
  return (
    <main
      className={
        theme === "dark"
          ? "flex h-screen items-center justify-center bg-[#101012] text-zinc-100"
          : "flex h-screen items-center justify-center bg-[#f5f5f7] text-zinc-950"
      }
      data-theme={theme}
    >
      <div
        className={
          theme === "dark"
            ? "rounded-2xl border border-white/10 bg-white/6 px-4 py-3 text-sm text-zinc-300"
            : "rounded-2xl border border-black/10 bg-white/80 px-4 py-3 text-sm text-zinc-600"
        }
        role="status"
      >
        正在加载远程工作区...
      </div>
    </main>
  );
}
