import { disableNativeContextMenu } from "./lib/nativeContextMenu";
import { prepareXtermWebviewCompatibility } from "./lib/xtermWebviewCompatibility";

prepareXtermWebviewCompatibility();
disableNativeContextMenu();

const startupRetryKey = "kerminal:startup-import-retries";
const startupRetryLimit = 4;
const startupRetryDelayMs = 750;

void import("./bootstrap")
  .then(() => {
    clearStartupRetry();
  })
  .catch((error: unknown) => {
    console.error("Kerminal 启动失败", error);

    if (shouldRetryStartupImport(error)) {
      scheduleStartupRetry(error);
      return;
    }

    showStartupFailure(error);
  });

function shouldRetryStartupImport(error: unknown) {
  if (!import.meta.env.DEV || getStartupRetryCount() >= startupRetryLimit) {
    return false;
  }

  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Failed to fetch dynamically imported module") ||
    message.includes("Outdated Optimize Dep")
  );
}

function getStartupRetryCount() {
  try {
    const value = window.sessionStorage.getItem(startupRetryKey);
    const count = value ? Number.parseInt(value, 10) : 0;
    return Number.isFinite(count) ? count : 0;
  } catch {
    return startupRetryLimit;
  }
}

function scheduleStartupRetry(error: unknown) {
  const retryCount = getStartupRetryCount() + 1;

  try {
    window.sessionStorage.setItem(startupRetryKey, String(retryCount));
  } catch {
    // 无法持久化重试次数时不能继续静默等待，否则 bootstrap 失败后会留下空白根节点。
    showStartupFailure(error);
    return;
  }

  window.setTimeout(() => {
    window.location.reload();
  }, startupRetryDelayMs * retryCount);
}

function clearStartupRetry() {
  try {
    window.sessionStorage.removeItem(startupRetryKey);
  } catch {
    // Ignore storage failures.
  }
}

function showStartupFailure(error: unknown) {
  const root = document.getElementById("root");
  if (!root) {
    return;
  }

  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const colors = prefersDark
    ? {
        background: "#101012",
        border: "rgba(255, 255, 255, 0.12)",
        button: "#0a84ff",
        muted: "#a1a1aa",
        panel: "#1c1c1e",
        text: "#f5f5f7",
      }
    : {
        background: "#f5f5f7",
        border: "rgba(0, 0, 0, 0.1)",
        button: "#0071e3",
        muted: "#6e6e76",
        panel: "#ffffff",
        text: "#1d1d1f",
      };

  root.style.minHeight = "100vh";
  root.style.display = "flex";
  root.style.alignItems = "center";
  root.style.justifyContent = "center";
  root.style.padding = "24px";
  root.style.background = colors.background;
  root.style.color = colors.text;
  root.style.fontFamily =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif';

  const panel = document.createElement("main");
  panel.style.width = "min(100%, 480px)";
  panel.style.padding = "24px";
  panel.style.border = `1px solid ${colors.border}`;
  panel.style.borderRadius = "20px";
  panel.style.background = colors.panel;

  const title = document.createElement("h1");
  title.textContent = "应用启动失败";
  title.style.margin = "0";
  title.style.fontSize = "20px";
  title.style.lineHeight = "1.4";
  title.style.fontWeight = "650";

  const message = document.createElement("p");
  message.textContent = "请重新加载应用；如果持续失败，请通过应用日志反馈问题。";
  message.style.margin = "10px 0 0";
  message.style.color = colors.muted;
  message.style.fontSize = "14px";
  message.style.lineHeight = "1.6";

  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "重新加载";
  retry.style.marginTop = "18px";
  retry.style.minHeight = "36px";
  retry.style.padding = "0 14px";
  retry.style.border = "0";
  retry.style.borderRadius = "10px";
  retry.style.background = colors.button;
  retry.style.color = "#ffffff";
  retry.style.font = "inherit";
  retry.style.fontSize = "13px";
  retry.style.fontWeight = "600";
  retry.style.cursor = "pointer";
  retry.addEventListener("click", () => window.location.reload());

  const detail = error instanceof Error ? error.message.trim() : "";
  if (detail) {
    const diagnostics = document.createElement("details");
    diagnostics.style.marginTop = "16px";
    diagnostics.style.color = colors.muted;
    diagnostics.style.fontSize = "12px";
    const summary = document.createElement("summary");
    summary.textContent = "技术详情";
    summary.style.cursor = "pointer";
    const pre = document.createElement("pre");
    pre.textContent = detail;
    pre.style.margin = "8px 0 0";
    pre.style.whiteSpace = "pre-wrap";
    pre.style.overflowWrap = "anywhere";
    diagnostics.append(summary, pre);
    panel.append(title, message, retry, diagnostics);
  } else {
    panel.append(title, message, retry);
  }

  root.replaceChildren(panel);
}
