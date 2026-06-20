import { lazy } from "react";
import type { SettingsSectionId } from "../features/settings/SettingsToolContent";

export const DEFAULT_SETTINGS_SECTION_ID: SettingsSectionId =
  "settings-appearance";
export const DEFAULT_REMOTE_GROUP_NAME = "默认分组";
export const LEFT_RAIL_WIDTH = 64;
export const TOOL_RAIL_WIDTH = 64;
export const WORKSPACE_SESSION_SAVE_DELAY_MS = 1_000;

export const LazySettingsDialog = lazy(() =>
  import("../features/settings/SettingsDialog").then((module) => ({
    default: module.SettingsDialog,
  })),
);

export const LazyRemoteHostCreateDialog = lazy(() =>
  import("../features/machine-sidebar/RemoteHostCreateDialog").then((module) => ({
    default: module.RemoteHostCreateDialog,
  })),
);

export const LazyRemoteHostGroupCreateDialog = lazy(() =>
  import("../features/machine-sidebar/RemoteHostGroupCreateDialog").then(
    (module) => ({
      default: module.RemoteHostGroupCreateDialog,
    }),
  ),
);
