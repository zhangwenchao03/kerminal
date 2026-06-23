/**
 * SFTP terminal cwd follow decision model.
 *
 * @author kongweiguang
 */

import { isFollowableRemotePath, normalizeRemotePath } from "./sftpPathModel";

export type FollowTerminalDirectoryToggleDecision = {
  clearOperationStatus: boolean;
  enabled: boolean;
  loadPath: string | null;
  nextLastAutoFollowedPath: string | undefined;
};

export type FollowedRemotePathChangeDecision = {
  clearOperationStatus: boolean;
  loadPath: string | null;
  nextLastAutoFollowedPath: string | undefined;
};

export function normalizeFollowedRemotePath(
  followedRemotePath: string | undefined,
) {
  const followedPath = followedRemotePath?.trim();
  return isFollowableRemotePath(followedPath)
    ? normalizeRemotePath(followedPath)
    : undefined;
}

export function resolveFollowTerminalDirectoryToggle({
  currentEnabled,
  hasFileTarget,
  lastAutoFollowedPath,
  nextEnabled,
  normalizedFollowedPath,
}: {
  currentEnabled: boolean;
  hasFileTarget: boolean;
  lastAutoFollowedPath: string | undefined;
  nextEnabled: boolean;
  normalizedFollowedPath: string | undefined;
}): FollowTerminalDirectoryToggleDecision {
  if (!nextEnabled) {
    return {
      clearOperationStatus: false,
      enabled: false,
      loadPath: null,
      nextLastAutoFollowedPath: undefined,
    };
  }

  if (currentEnabled || !normalizedFollowedPath || !hasFileTarget) {
    return {
      clearOperationStatus: false,
      enabled: true,
      loadPath: null,
      nextLastAutoFollowedPath: lastAutoFollowedPath,
    };
  }

  return {
    clearOperationStatus: true,
    enabled: true,
    loadPath: normalizedFollowedPath,
    nextLastAutoFollowedPath: normalizedFollowedPath,
  };
}

export function resolveFollowedRemotePathChange({
  enabled,
  hasFileTarget,
  lastAutoFollowedPath,
  normalizedFollowedPath,
}: {
  enabled: boolean;
  hasFileTarget: boolean;
  lastAutoFollowedPath: string | undefined;
  normalizedFollowedPath: string | undefined;
}): FollowedRemotePathChangeDecision {
  if (!enabled || !normalizedFollowedPath) {
    return {
      clearOperationStatus: false,
      loadPath: null,
      nextLastAutoFollowedPath: undefined,
    };
  }

  if (!hasFileTarget || normalizedFollowedPath === lastAutoFollowedPath) {
    return {
      clearOperationStatus: false,
      loadPath: null,
      nextLastAutoFollowedPath: lastAutoFollowedPath,
    };
  }

  return {
    clearOperationStatus: true,
    loadPath: normalizedFollowedPath,
    nextLastAutoFollowedPath: normalizedFollowedPath,
  };
}
