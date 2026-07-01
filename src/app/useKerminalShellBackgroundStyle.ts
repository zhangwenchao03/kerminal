// @author kongweiguang

import { useMemo, type CSSProperties } from "react";
import type { AppSettings, ResolvedTheme } from "../features/settings/settingsModel";
import {
  workspaceBackgroundColor,
  workspaceBackgroundImage,
} from "./KerminalShell.helpers";

function formatCssAlpha(value: number) {
  return String(Number(value.toFixed(4)));
}

function clampCssAlpha(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function useKerminalShellBackgroundStyle({
  resolvedTheme,
  settings,
}: {
  resolvedTheme: ResolvedTheme;
  settings: AppSettings;
}) {
  return useMemo<CSSProperties>(() => {
    const windowOpacity =
      Math.min(Math.max(settings.appearance.windowOpacity, 35), 100) / 100;
    const backgroundImageVisible =
      settings.appearance.backgroundEnabled &&
      settings.appearance.backgroundImagePath.trim()
        ? Math.min(Math.max(settings.appearance.backgroundOpacity, 0), 100) /
          100
        : 0;
    const transparencyDepth = 1 - windowOpacity;
    const chromeSurfaceOpacity = clampCssAlpha(
      (resolvedTheme === "dark" ? 0.78 : 0.8) -
        transparencyDepth * 0.1 -
        backgroundImageVisible * 0.06,
      resolvedTheme === "dark" ? 0.62 : 0.66,
      0.82,
    );
    const terminalSurfaceOpacity = clampCssAlpha(
      (resolvedTheme === "dark" ? 0.76 : 0.78) -
        transparencyDepth * 0.12 -
        backgroundImageVisible * 0.08,
      resolvedTheme === "dark" ? 0.62 : 0.64,
      0.84,
    );
    const terminalHeaderOpacity = clampCssAlpha(
      terminalSurfaceOpacity + 0.05,
      resolvedTheme === "dark" ? 0.68 : 0.7,
      0.88,
    );
    const backgroundVeilOpacity =
      backgroundImageVisible > 0
        ? clampCssAlpha(
            (resolvedTheme === "dark" ? 0.32 : 0.46) +
              (1 - backgroundImageVisible) * 0.2,
            resolvedTheme === "dark" ? 0.3 : 0.44,
            resolvedTheme === "dark" ? 0.58 : 0.72,
          )
        : 0;
    return {
      "--app-background-veil-opacity": formatCssAlpha(backgroundVeilOpacity),
      "--app-window-opacity": formatCssAlpha(windowOpacity),
      "--app-nav-surface-opacity": formatCssAlpha(chromeSurfaceOpacity),
      "--app-workspace-surface-opacity": formatCssAlpha(chromeSurfaceOpacity),
      "--app-terminal-header-opacity": formatCssAlpha(terminalHeaderOpacity),
      "--app-terminal-surface-opacity": formatCssAlpha(terminalSurfaceOpacity),
      backgroundColor: workspaceBackgroundColor(
        settings.appearance.windowOpacity,
        resolvedTheme,
      ),
      backgroundImage: workspaceBackgroundImage(
        settings.appearance.backgroundEnabled,
        settings.appearance.backgroundImagePath,
        settings.appearance.backgroundOpacity,
        resolvedTheme,
      ),
      backgroundPosition: "center",
      backgroundRepeat:
        settings.appearance.backgroundFit === "tile" ? "repeat" : "no-repeat",
      backgroundSize:
        settings.appearance.backgroundFit === "tile"
          ? "auto"
          : settings.appearance.backgroundFit,
    } as CSSProperties;
  }, [
    resolvedTheme,
    settings.appearance.backgroundEnabled,
    settings.appearance.backgroundFit,
    settings.appearance.backgroundImagePath,
    settings.appearance.backgroundOpacity,
    settings.appearance.windowOpacity,
  ]);
}
