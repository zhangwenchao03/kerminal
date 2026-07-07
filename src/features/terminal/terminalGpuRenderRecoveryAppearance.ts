import type { TerminalAppearance } from "../settings/settingsModel";
import type { TerminalGpuRenderRecoveryTrigger } from "./terminalGpuRenderRecoveryPolicy";

export function resolveTerminalAppearanceRecoveryTrigger(
  previous: TerminalAppearance,
  next: TerminalAppearance,
): TerminalGpuRenderRecoveryTrigger | undefined {
  if (
    previous.fontFamily !== next.fontFamily ||
    previous.fontSize !== next.fontSize ||
    previous.fontWeight !== next.fontWeight ||
    previous.lineHeight !== next.lineHeight
  ) {
    return "font-changed";
  }
  if (previous.rendererType !== next.rendererType) {
    return next.rendererType === "cpu" ? "renderer-disposed" : "renderer-attached";
  }
  if (
    previous.darkColorScheme !== next.darkColorScheme ||
    previous.lightColorScheme !== next.lightColorScheme
  ) {
    return "theme-changed";
  }
  return undefined;
}
