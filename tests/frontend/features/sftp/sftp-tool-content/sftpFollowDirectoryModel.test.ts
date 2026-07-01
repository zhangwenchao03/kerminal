/**
 * @author kongweiguang
 */

import { describe, expect, it } from "vitest";
import {
  normalizeFollowedRemotePath,
  resolveFollowedRemotePathChange,
  resolveFollowTerminalDirectoryToggle,
} from "../../../../../src/features/sftp/sftp-tool-content/sftpFollowDirectoryModel";

describe("sftpFollowDirectoryModel", () => {
  it("normalizes only absolute followed terminal paths", () => {
    expect(normalizeFollowedRemotePath("  /var//log/ ")).toBe("/var/log");
    expect(normalizeFollowedRemotePath("\\srv\\app\\")).toBeUndefined();
    expect(normalizeFollowedRemotePath("relative/path")).toBeUndefined();
    expect(normalizeFollowedRemotePath("   ")).toBeUndefined();
    expect(normalizeFollowedRemotePath(undefined)).toBeUndefined();
  });

  it("loads the current terminal path when enabling follow mode from off", () => {
    expect(
      resolveFollowTerminalDirectoryToggle({
        currentEnabled: false,
        hasFileTarget: true,
        lastAutoFollowedPath: undefined,
        nextEnabled: true,
        normalizedFollowedPath: "/var/log",
      }),
    ).toEqual({
      clearOperationStatus: true,
      enabled: true,
      loadPath: "/var/log",
      nextLastAutoFollowedPath: "/var/log",
    });
  });

  it("clears the tracked path without loading when disabling follow mode", () => {
    expect(
      resolveFollowTerminalDirectoryToggle({
        currentEnabled: true,
        hasFileTarget: true,
        lastAutoFollowedPath: "/var/log",
        nextEnabled: false,
        normalizedFollowedPath: "/srv/app",
      }),
    ).toEqual({
      clearOperationStatus: false,
      enabled: false,
      loadPath: null,
      nextLastAutoFollowedPath: undefined,
    });
  });

  it("does not reload when follow mode is already enabled", () => {
    expect(
      resolveFollowTerminalDirectoryToggle({
        currentEnabled: true,
        hasFileTarget: true,
        lastAutoFollowedPath: "/var/log",
        nextEnabled: true,
        normalizedFollowedPath: "/srv/app",
      }),
    ).toEqual({
      clearOperationStatus: false,
      enabled: true,
      loadPath: null,
      nextLastAutoFollowedPath: "/var/log",
    });
  });

  it("loads a new terminal path once and ignores duplicate path changes", () => {
    expect(
      resolveFollowedRemotePathChange({
        enabled: true,
        hasFileTarget: true,
        lastAutoFollowedPath: "/var/log",
        normalizedFollowedPath: "/srv/app",
      }),
    ).toEqual({
      clearOperationStatus: true,
      loadPath: "/srv/app",
      nextLastAutoFollowedPath: "/srv/app",
    });

    expect(
      resolveFollowedRemotePathChange({
        enabled: true,
        hasFileTarget: true,
        lastAutoFollowedPath: "/srv/app",
        normalizedFollowedPath: "/srv/app",
      }),
    ).toEqual({
      clearOperationStatus: false,
      loadPath: null,
      nextLastAutoFollowedPath: "/srv/app",
    });
  });

  it("clears the tracked path when follow mode is off or path is missing", () => {
    expect(
      resolveFollowedRemotePathChange({
        enabled: false,
        hasFileTarget: true,
        lastAutoFollowedPath: "/var/log",
        normalizedFollowedPath: "/srv/app",
      }).nextLastAutoFollowedPath,
    ).toBeUndefined();

    expect(
      resolveFollowedRemotePathChange({
        enabled: true,
        hasFileTarget: true,
        lastAutoFollowedPath: "/var/log",
        normalizedFollowedPath: undefined,
      }).nextLastAutoFollowedPath,
    ).toBeUndefined();
  });

  it("preserves the tracked path while waiting for a file target", () => {
    expect(
      resolveFollowedRemotePathChange({
        enabled: true,
        hasFileTarget: false,
        lastAutoFollowedPath: "/var/log",
        normalizedFollowedPath: "/srv/app",
      }),
    ).toEqual({
      clearOperationStatus: false,
      loadPath: null,
      nextLastAutoFollowedPath: "/var/log",
    });
  });
});
