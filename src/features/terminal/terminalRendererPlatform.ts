export type TerminalGpuPlatformClass =
  | "hardware-or-unknown"
  | "software"
  | "unavailable";

let cachedPlatformClass: TerminalGpuPlatformClass | undefined;

/**
 * 探测当前 WebView 的 WebGL 实现。
 *
 * 结果按进程缓存，避免每个 pane 创建额外探测 context。只有明确识别到
 * SwiftShader、WARP 或 llvmpipe 时才判定为软件 GPU；无法读取 renderer
 * 信息时保持兼容，继续交给 WebGL addon 自身决定是否可用。
 */
export function detectTerminalGpuPlatform(): TerminalGpuPlatformClass {
  if (cachedPlatformClass) {
    return cachedPlatformClass;
  }
  cachedPlatformClass = probeTerminalGpuPlatform();
  return cachedPlatformClass;
}

export function shouldUseAutoGpuRenderer(
  platformClass = detectTerminalGpuPlatform(),
): boolean {
  return platformClass !== "software";
}

export function classifyTerminalGpuRenderer(
  renderer: string,
): Exclude<TerminalGpuPlatformClass, "unavailable"> {
  const normalized = renderer.toLowerCase();
  const softwareRenderer =
    normalized.includes("swiftshader") ||
    normalized.includes("llvmpipe") ||
    normalized.includes("software rasterizer") ||
    normalized.includes("microsoft basic render") ||
    /\bwarp\b/.test(normalized);
  return softwareRenderer ? "software" : "hardware-or-unknown";
}

function probeTerminalGpuPlatform(): TerminalGpuPlatformClass {
  try {
    if (typeof document === "undefined") {
      return "hardware-or-unknown";
    }
    const canvas = document.createElement("canvas");
    const context =
      canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!context) {
      return "unavailable";
    }
    const debugInfo = context.getExtension("WEBGL_debug_renderer_info");
    return classifyTerminalGpuRenderer(
      String(
        debugInfo
          ? context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
          : context.getParameter(context.RENDERER),
      ),
    );
  } catch {
    return "hardware-or-unknown";
  }
}
