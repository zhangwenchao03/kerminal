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
      scheduleStartupRetry();
      return;
    }

    showStartupFailure();
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

function scheduleStartupRetry() {
  const retryCount = getStartupRetryCount() + 1;

  try {
    window.sessionStorage.setItem(startupRetryKey, String(retryCount));
  } catch {
    // 无法持久化重试次数时不能继续静默等待，否则 bootstrap 失败后会留下空白根节点。
    showStartupFailure();
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

function showStartupFailure() {
  const root = document.getElementById("root");
  if (!root) {
    return;
  }

  root.style.minHeight = "100vh";
  root.style.display = "flex";
  root.style.alignItems = "center";
  root.style.justifyContent = "center";
  root.style.padding = "24px";
  root.style.background = "#09090b";
  root.style.color = "#f4f4f5";
  root.style.fontFamily =
    'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  root.textContent = "应用启动失败，请重新打开应用；如果持续失败，请通过应用日志反馈问题。";
}
