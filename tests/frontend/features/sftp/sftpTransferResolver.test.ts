import { describe, expect, it } from "vitest";
import {
  TRANSFER_RESOLVER_ERRORS,
  type FileTransferEndpoint,
  type FileTransferEntry,
  type TransferConflictPolicy,
  type TransferRequestedBy,
  resolveTransferIntent,
} from "../../../../src/features/sftp/sftpTransferResolver";

function entry(
  path: string,
  kind: FileTransferEntry["kind"] = "file",
  name = path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? path,
): FileTransferEntry {
  return { name, path, kind };
}

function intent({
  source,
  target,
  entries,
  requestedBy = "drag",
  conflictPolicy = "ask",
}: {
  source: FileTransferEndpoint;
  target: FileTransferEndpoint;
  entries: FileTransferEntry[];
  requestedBy?: TransferRequestedBy;
  conflictPolicy?: TransferConflictPolicy;
}) {
  return {
    source,
    target,
    entries,
    requestedBy,
    conflictPolicy,
  };
}

describe("resolveTransferIntent", () => {
  it("resolves local to remote uploads", () => {
    const plan = resolveTransferIntent(
      intent({
        source: { kind: "local", path: "/Users/me/dist" },
        target: { kind: "remote", hostId: "prod-api", path: "/opt/releases/" },
        entries: [entry("/Users/me/dist/release.tgz")],
        requestedBy: "toolbar",
        conflictPolicy: "overwrite",
      }),
    );

    expect(plan.operation).toBe("upload");
    expect(plan.requestedBy).toBe("toolbar");
    expect(plan.conflictPolicy).toBe("overwrite");
    expect(plan.tasks).toEqual([
      {
        sourceEntryPath: "/Users/me/dist/release.tgz",
        targetEntryPath: "/opt/releases/release.tgz",
        targetPath: "/opt/releases",
        entryKind: "file",
        entryName: "release.tgz",
      },
    ]);
  });

  it("resolves remote to local downloads with multiple entries", () => {
    const plan = resolveTransferIntent(
      intent({
        source: { kind: "remote", hostId: "prod-api", path: "/var/log" },
        target: { kind: "local", path: "/Users/me/Downloads/" },
        entries: [
          entry("/var/log/app.log"),
          entry("/var/log/archive", "directory"),
        ],
        requestedBy: "contextMenu",
        conflictPolicy: "rename",
      }),
    );

    expect(plan.operation).toBe("download");
    expect(plan.tasks).toEqual([
      {
        sourceEntryPath: "/var/log/app.log",
        targetEntryPath: "/Users/me/Downloads/app.log",
        targetPath: "/Users/me/Downloads",
        entryKind: "file",
        entryName: "app.log",
      },
      {
        sourceEntryPath: "/var/log/archive",
        targetEntryPath: "/Users/me/Downloads/archive",
        targetPath: "/Users/me/Downloads",
        entryKind: "directory",
        entryName: "archive",
      },
    ]);
  });

  it("resolves remote to remote copies at the remote root", () => {
    const plan = resolveTransferIntent(
      intent({
        source: { kind: "remote", hostId: "prod-a", path: "/tmp" },
        target: { kind: "remote", hostId: "prod-b", hostLabel: "Prod B", path: "/" },
        entries: [entry("/tmp/release.tgz")],
        requestedBy: "paste",
        conflictPolicy: "skip",
      }),
    );

    expect(plan.operation).toBe("remoteCopy");
    expect(plan.target).toEqual({
      kind: "remote",
      hostId: "prod-b",
      hostLabel: "Prod B",
      path: "/",
    });
    expect(plan.tasks[0]).toEqual({
      sourceEntryPath: "/tmp/release.tgz",
      targetEntryPath: "/release.tgz",
      targetPath: "/",
      entryKind: "file",
      entryName: "release.tgz",
    });
  });

  it("resolves local to local copies with Windows paths", () => {
    const plan = resolveTransferIntent(
      intent({
        source: { kind: "local", path: "C:\\work\\build" },
        target: { kind: "local", path: "D:\\Transfer\\incoming\\" },
        entries: [
          entry("C:\\work\\build\\release.tgz"),
          entry("C:\\work\\build\\latest", "symlink"),
        ],
      }),
    );

    expect(plan.operation).toBe("localCopy");
    expect(plan.tasks).toEqual([
      {
        sourceEntryPath: "C:\\work\\build\\release.tgz",
        targetEntryPath: "D:\\Transfer\\incoming\\release.tgz",
        targetPath: "D:\\Transfer\\incoming",
        entryKind: "file",
        entryName: "release.tgz",
      },
      {
        sourceEntryPath: "C:\\work\\build\\latest",
        targetEntryPath: "D:\\Transfer\\incoming\\latest",
        targetPath: "D:\\Transfer\\incoming",
        entryKind: "symlink",
        entryName: "latest",
      },
    ]);
  });

  it("rejects empty entry selections", () => {
    expect(() =>
      resolveTransferIntent(
        intent({
          source: { kind: "local", path: "/Users/me" },
          target: { kind: "remote", hostId: "prod-api", path: "/tmp" },
          entries: [],
        }),
      ),
    ).toThrow(TRANSFER_RESOLVER_ERRORS.emptyEntries);
  });

  it("rejects copying an entry onto the same path in the same endpoint", () => {
    expect(() =>
      resolveTransferIntent(
        intent({
          source: { kind: "remote", hostId: "prod-api", path: "/var/log" },
          target: { kind: "remote", hostId: "prod-api", path: "/var/log/" },
          entries: [entry("/var/log/app.log")],
        }),
      ),
    ).toThrow(TRANSFER_RESOLVER_ERRORS.sameEntry);
  });

  it("rejects remote directory copies into their own subtree", () => {
    expect(() =>
      resolveTransferIntent(
        intent({
          source: { kind: "remote", hostId: "prod-api", path: "/srv" },
          target: { kind: "remote", hostId: "prod-api", path: "/srv/app/backup" },
          entries: [entry("/srv/app", "directory")],
        }),
      ),
    ).toThrow(TRANSFER_RESOLVER_ERRORS.directoryIntoDescendant);
  });

  it("rejects local directory copies into their own subtree", () => {
    expect(() =>
      resolveTransferIntent(
        intent({
          source: { kind: "local", path: "C:\\work" },
          target: { kind: "local", path: "C:\\work\\dist\\backup" },
          entries: [entry("C:\\work\\dist", "directory")],
        }),
      ),
    ).toThrow(TRANSFER_RESOLVER_ERRORS.directoryIntoDescendant);
  });
});
