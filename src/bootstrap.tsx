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
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 p-6 text-zinc-100">
      <section className="w-full max-w-lg rounded-2xl border border-white/12 bg-zinc-900/80 p-6 shadow-2xl shadow-black/30 backdrop-blur-xl">
        <p className="text-xs font-medium uppercase tracking-normal text-rose-300">
          Kerminal
        </p>
        <h1 className="mt-2 text-xl font-semibold">应用启动失败</h1>
        <p className="mt-3 text-sm text-zinc-300">
          请重新打开应用；如果持续失败，请通过应用日志反馈问题。
        </p>
      </section>
    </main>
  );
}
