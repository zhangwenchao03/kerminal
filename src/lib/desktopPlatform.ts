import { isTauri } from "@tauri-apps/api/core";

/**
 * Kerminal 桌面外壳支持的平台；browser 专门表示不允许调用桌面 IPC 的预览环境。
 */
export type DesktopPlatform = "macos" | "windows" | "linux" | "browser";

/**
 * 平台识别只读取浏览器稳定暴露的少量字段，避免把完整 Navigator 绑定到纯模型。
 */
export interface DesktopNavigatorInfo {
  platform?: string;
  userAgent?: string;
  userAgentData?: {
    platform?: string;
  };
}

/**
 * 平台识别的运行时依赖，可在单元测试中替换 Tauri 检测和 Navigator 来源。
 */
export interface DesktopPlatformDependencies {
  getNavigator: () => DesktopNavigatorInfo | undefined;
  isTauri: () => boolean;
}

const defaultDependencies: DesktopPlatformDependencies = {
  getNavigator: () =>
    typeof navigator === "undefined" ? undefined : navigator,
  isTauri,
};

/**
 * 解析当前桌面平台。非 Tauri 环境必须返回 browser，确保预览模式不会误触发桌面能力。
 */
export function resolveDesktopPlatform(
  dependencies: DesktopPlatformDependencies = defaultDependencies,
): DesktopPlatform {
  if (!dependencies.isTauri()) {
    return "browser";
  }

  const navigatorInfo = dependencies.getNavigator();
  const platformDescription = [
    navigatorInfo?.userAgentData?.platform,
    navigatorInfo?.platform,
    navigatorInfo?.userAgent,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");

  if (/\b(macos|macintosh|mac|iphone|ipad|ipod)\b/i.test(platformDescription)) {
    return "macos";
  }
  if (/\b(win|windows|win32|win64|wow64)\b/i.test(platformDescription)) {
    return "windows";
  }
  if (/\b(linux|x11)\b/i.test(platformDescription)) {
    return "linux";
  }

  // Tauri 桌面运行态不应缺少平台信息；未知值保守落到自绘镶边路径，避免误用 macOS 原生策略。
  return "windows";
}
