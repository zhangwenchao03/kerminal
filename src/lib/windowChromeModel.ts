import type { DesktopPlatform } from "./desktopPlatform";
import type { WindowFrameState } from "./useTauriWindowFrameState";

/** 窗口控制按钮由系统、应用或预览环境中的哪一层负责。 */
export type WindowControlMode = "native" | "custom" | "none";

/** 应用内容外框圆角由原生窗口负责，或使用正常态圆角/无圆角裁切。 */
export type WindowFrameRadiusMode = "native" | "rounded" | "square";

/**
 * 窗口镶边纯模型，供标题栏、根布局和 overlay 共享同一套平台与窗口状态决策。
 */
export interface WindowChromeModel {
  controlMode: WindowControlMode;
  frameRadiusMode: WindowFrameRadiusMode;
  reserveTrafficLightInset: boolean;
  showMaximizeControl: boolean;
  showRestoreIcon: boolean;
}

/** 窗口镶边模型的最小输入，frameState 由现有窗口状态 Hook 提供。 */
export interface ResolveWindowChromeModelInput {
  frameState: WindowFrameState;
  platform: DesktopPlatform;
}

/**
 * 根据桌面平台和窗口状态派生窗口镶边行为，不读取浏览器或 Tauri 运行时。
 */
export function resolveWindowChromeModel({
  frameState,
  platform,
}: ResolveWindowChromeModelInput): WindowChromeModel {
  const squareFrame = frameState !== "normal";

  if (platform === "browser") {
    return {
      controlMode: "none",
      frameRadiusMode: squareFrame ? "square" : "rounded",
      reserveTrafficLightInset: false,
      showMaximizeControl: false,
      showRestoreIcon: false,
    };
  }

  if (platform === "macos") {
    return {
      controlMode: "native",
      frameRadiusMode: "native",
      reserveTrafficLightInset: frameState !== "fullscreen",
      showMaximizeControl: false,
      showRestoreIcon: false,
    };
  }

  return {
    controlMode: "custom",
    frameRadiusMode: squareFrame ? "square" : "rounded",
    reserveTrafficLightInset: false,
    showMaximizeControl: frameState !== "fullscreen",
    showRestoreIcon: frameState === "maximized",
  };
}
