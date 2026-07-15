import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";

export interface DesktopRuntimePort {
  readonly mode: "desktop" | "preview";
  convertLocalFileSrc(path: string): string | undefined;
  listen<T>(eventName: string, handler: (payload: T) => void): Promise<() => void>;
  openPath(path: string): Promise<"opened" | "unsupported">;
  openUrl(url: string): Promise<void>;
}

const desktopRuntimePort: DesktopRuntimePort = {
  mode: "desktop",
  convertLocalFileSrc(path) {
    return convertFileSrc(path);
  },
  async listen<T>(eventName: string, handler: (payload: T) => void) {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<T>(eventName, (event) => handler(event.payload));
  },
  async openPath(path) {
    await openPath(path);
    return "opened";
  },
  async openUrl(url) {
    await openUrl(url);
  },
};

const previewRuntimePort: DesktopRuntimePort = {
  mode: "preview",
  convertLocalFileSrc() {
    return undefined;
  },
  async listen() {
    return () => undefined;
  },
  async openPath() {
    return "unsupported";
  },
  async openUrl(url) {
    window.open(url, "_blank", "noopener,noreferrer");
  },
};

/**
 * 桌面平台能力的唯一组合入口。
 *
 * preview 只提供明确的浏览器语义；文件路径等桌面专属能力返回 unsupported，
 * 避免 feature 通过散落的 `isTauri` 分支产生假成功。
 */
export function createDesktopRuntimePort(
  desktop = isTauri(),
): DesktopRuntimePort {
  return desktop ? desktopRuntimePort : previewRuntimePort;
}

export const desktopRuntime: DesktopRuntimePort = {
  get mode() {
    return createDesktopRuntimePort().mode;
  },
  convertLocalFileSrc(path) {
    return createDesktopRuntimePort().convertLocalFileSrc(path);
  },
  listen<T>(eventName: string, handler: (payload: T) => void) {
    return createDesktopRuntimePort().listen(eventName, handler);
  },
  openPath(path) {
    return createDesktopRuntimePort().openPath(path);
  },
  openUrl(url) {
    return createDesktopRuntimePort().openUrl(url);
  },
};
