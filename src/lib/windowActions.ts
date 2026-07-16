import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** 自绘窗口控件允许触发的原生窗口动作。 */
export type WindowAction = "close" | "minimize" | "toggleMaximize";

/**
 * 窗口动作只依赖实际使用的 Tauri 方法，避免组件和测试依赖完整 Window API。
 */
export interface WindowActionTarget {
  close: () => Promise<void>;
  minimize: () => Promise<void>;
  startDragging: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
}

/** 窗口动作的窄运行时依赖，可注入 fake 验证 browser no-op 和调用次数。 */
export interface WindowActionDependencies {
  getCurrentWindow: () => WindowActionTarget;
  isTauri: () => boolean;
}

const defaultDependencies: WindowActionDependencies = {
  getCurrentWindow,
  isTauri,
};

/**
 * 执行窗口控制动作。browser preview 直接返回，且不会获取当前 Tauri 窗口。
 */
export async function runWindowAction(
  action: WindowAction,
  dependencies: WindowActionDependencies = defaultDependencies,
): Promise<void> {
  if (!dependencies.isTauri()) {
    return;
  }

  const appWindow = dependencies.getCurrentWindow();
  await appWindow[action]();
}

/**
 * 开始原生窗口拖拽。browser preview 保持 no-op，供标题栏和 overlay 安全复用。
 */
export async function startWindowDragging(
  dependencies: WindowActionDependencies = defaultDependencies,
): Promise<void> {
  if (!dependencies.isTauri()) {
    return;
  }

  await dependencies.getCurrentWindow().startDragging();
}
