import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { RenderErrorBoundary } from "./components/RenderErrorBoundary";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RenderErrorBoundary fallback={(error) => <AppCrashFallback error={error} />}>
      <App />
    </RenderErrorBoundary>
  </React.StrictMode>,
);

function AppCrashFallback({ error }: { error: Error | null }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 p-6 text-zinc-100">
      <section className="w-full max-w-lg rounded-2xl border border-white/12 bg-zinc-900/80 p-6 shadow-2xl shadow-black/30 backdrop-blur-xl">
        <p className="text-xs font-medium uppercase tracking-normal text-rose-300">
          Kerminal
        </p>
        <h1 className="mt-2 text-xl font-semibold">应用启动失败</h1>
        <p className="mt-3 text-sm text-zinc-300">
          应用启动失败，请打开开发者工具查看错误。
        </p>
        {error?.message ? (
          <pre className="mt-4 max-h-40 overflow-auto rounded-xl bg-black/30 p-3 text-xs text-zinc-300">
            {error.message}
          </pre>
        ) : null}
      </section>
    </main>
  );
}
