import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { RenderErrorBoundary } from "./components/RenderErrorBoundary";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RenderErrorBoundary fallback={() => <AppCrashFallback />}>
      <App />
    </RenderErrorBoundary>
  </React.StrictMode>,
);

function AppCrashFallback() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--surface-page)] p-6 text-[var(--text-primary)]">
      <section className="kerminal-solid-surface w-full max-w-lg rounded-[var(--radius-dialog)] border p-6">
        <p className="text-xs font-medium text-rose-600 dark:text-rose-300">
          Kerminal
        </p>
        <h1 className="mt-2 text-[20px] font-semibold">应用启动失败</h1>
        <p className="mt-3 text-[13px] leading-5 text-[var(--text-secondary)]">
          请重新打开应用；如果持续失败，请通过应用日志反馈问题。
        </p>
        <button
          className="kerminal-focus-ring kerminal-pressable mt-5 h-9 rounded-[var(--radius-control)] bg-[rgb(var(--app-accent))] px-3.5 text-[13px] font-medium text-white"
          onClick={() => window.location.reload()}
          type="button"
        >
          重新加载
        </button>
      </section>
    </main>
  );
}
