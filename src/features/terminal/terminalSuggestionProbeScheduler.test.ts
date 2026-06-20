import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CommandSuggestionGitRefreshRequest,
  CommandSuggestionGitRefreshResult,
  CommandSuggestionRemoteCommandRefreshRequest,
  CommandSuggestionRemoteCommandRefreshResult,
  CommandSuggestionRemoteHistoryRefreshRequest,
  CommandSuggestionRemoteHistoryRefreshResult,
  CommandSuggestionRemotePathRefreshRequest,
  CommandSuggestionRemotePathRefreshResult,
} from "../../lib/terminalSuggestionApi";
import { TerminalSuggestionProbeScheduler } from "./terminalSuggestionProbeScheduler";

type RefreshGit = (
  request: CommandSuggestionGitRefreshRequest,
) => Promise<CommandSuggestionGitRefreshResult>;
type RefreshRemoteCommand = (
  request: CommandSuggestionRemoteCommandRefreshRequest,
) => Promise<CommandSuggestionRemoteCommandRefreshResult>;
type RefreshRemoteHistory = (
  request: CommandSuggestionRemoteHistoryRefreshRequest,
) => Promise<CommandSuggestionRemoteHistoryRefreshResult>;
type RefreshRemotePath = (
  request: CommandSuggestionRemotePathRefreshRequest,
) => Promise<CommandSuggestionRemotePathRefreshResult>;

describe("TerminalSuggestionProbeScheduler", () => {
  let refreshGit: ReturnType<typeof vi.fn<RefreshGit>>;
  let refreshRemoteCommand: ReturnType<typeof vi.fn<RefreshRemoteCommand>>;
  let refreshRemoteHistory: ReturnType<typeof vi.fn<RefreshRemoteHistory>>;
  let refreshRemotePath: ReturnType<typeof vi.fn<RefreshRemotePath>>;
  let scheduler: TerminalSuggestionProbeScheduler;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-19T00:00:00.000Z"));
    refreshGit = vi.fn<RefreshGit>().mockResolvedValue({
      cachedAtUnixMs: 0,
      cwd: "/srv/app",
      entryCount: 0,
      hostId: "prod",
      ttlSeconds: 60,
    });
    refreshRemoteCommand = vi.fn<RefreshRemoteCommand>().mockResolvedValue({
      cachedAtUnixMs: 0,
      commandCount: 0,
      hostId: "prod",
      ttlSeconds: 300,
    });
    refreshRemoteHistory = vi.fn<RefreshRemoteHistory>().mockResolvedValue({
      cachedAtUnixMs: 0,
      commandCount: 0,
      hostId: "prod",
      ttlSeconds: 900,
    });
    refreshRemotePath = vi.fn<RefreshRemotePath>().mockResolvedValue({
      cachedAtUnixMs: 0,
      entryCount: 0,
      hostId: "prod",
      path: "/srv/app",
      ttlSeconds: 30,
    });
    scheduler = new TerminalSuggestionProbeScheduler({
      api: {
        refreshGit,
        refreshRemoteCommand,
        refreshRemoteHistory,
        refreshRemotePath,
      },
    });
  });

  afterEach(() => {
    scheduler.reset();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("deduplicates one remote command probe across owners", async () => {
    expect(
      scheduler.scheduleRemoteCommand({
        delayMs: 100,
        hostId: "prod",
        maxEntries: 1500,
        ownerId: "pane-a",
        ttlSeconds: 300,
      }),
    ).toBe(true);
    expect(
      scheduler.scheduleRemoteCommand({
        delayMs: 100,
        hostId: "prod",
        maxEntries: 1500,
        ownerId: "pane-b",
        ttlSeconds: 300,
      }),
    ).toBe(false);

    await vi.advanceTimersByTimeAsync(100);

    expect(refreshRemoteCommand).toHaveBeenCalledTimes(1);
    expect(refreshRemoteCommand).toHaveBeenCalledWith({
      hostId: "prod",
      maxEntries: 1500,
      ttlSeconds: 300,
    });
    expect(scheduler.snapshot()).toMatchObject([
      {
        failureCount: 0,
        key: "remoteCommand:prod",
        kind: "remoteCommand",
        ownerCount: 2,
        timerPending: false,
      },
    ]);
  });

  it("cancels an owner's stale remote path probe when the cwd changes", async () => {
    expect(
      scheduler.scheduleRemotePath({
        delayMs: 100,
        hostId: "prod",
        maxEntries: 250,
        ownerId: "pane-a",
        path: "/srv/app",
        ttlSeconds: 30,
      }),
    ).toBe(true);
    expect(
      scheduler.scheduleRemotePath({
        delayMs: 100,
        hostId: "prod",
        maxEntries: 250,
        ownerId: "pane-a",
        path: "/opt/app",
        ttlSeconds: 30,
      }),
    ).toBe(true);

    await vi.advanceTimersByTimeAsync(100);

    expect(refreshRemotePath).toHaveBeenCalledTimes(1);
    expect(refreshRemotePath).toHaveBeenCalledWith({
      hostId: "prod",
      maxEntries: 250,
      path: "/opt/app",
      ttlSeconds: 30,
    });
  });

  it("deduplicates one remote history probe across owners", async () => {
    expect(
      scheduler.scheduleRemoteHistory({
        delayMs: 100,
        hostId: "prod",
        maxEntries: 1000,
        ownerId: "pane-a",
        ttlSeconds: 900,
      }),
    ).toBe(true);
    expect(
      scheduler.scheduleRemoteHistory({
        delayMs: 100,
        hostId: "prod",
        maxEntries: 1000,
        ownerId: "pane-b",
        ttlSeconds: 900,
      }),
    ).toBe(false);

    await vi.advanceTimersByTimeAsync(100);

    expect(refreshRemoteHistory).toHaveBeenCalledTimes(1);
    expect(refreshRemoteHistory).toHaveBeenCalledWith({
      hostId: "prod",
      maxEntries: 1000,
      ttlSeconds: 900,
    });
    expect(scheduler.snapshot()).toMatchObject([
      {
        failureCount: 0,
        key: "remoteHistory:prod",
        kind: "remoteHistory",
        ownerCount: 2,
        timerPending: false,
      },
    ]);
  });

  it("cancels pending probes when the owner is removed", async () => {
    scheduler.scheduleRemotePath({
      delayMs: 100,
      hostId: "prod",
      maxEntries: 250,
      ownerId: "pane-a",
      path: "/srv/app",
      ttlSeconds: 30,
    });

    scheduler.cancelOwner("pane-a");
    await vi.advanceTimersByTimeAsync(100);

    expect(refreshRemotePath).not.toHaveBeenCalled();
    expect(scheduler.snapshot()).toEqual([]);
  });

  it("backs off failed probes before allowing the same key to run again", async () => {
    refreshRemoteCommand
      .mockRejectedValueOnce(new Error("ssh offline"))
      .mockResolvedValueOnce({
        cachedAtUnixMs: 0,
        commandCount: 0,
        hostId: "prod",
        ttlSeconds: 300,
      });

    expect(
      scheduler.scheduleRemoteCommand({
        delayMs: 0,
        hostId: "prod",
        maxEntries: 1500,
        ownerId: "pane-a",
        ttlSeconds: 300,
      }),
    ).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(refreshRemoteCommand).toHaveBeenCalledTimes(1);

    expect(
      scheduler.scheduleRemoteCommand({
        delayMs: 0,
        hostId: "prod",
        maxEntries: 1500,
        ownerId: "pane-a",
        ttlSeconds: 300,
      }),
    ).toBe(false);

    await vi.advanceTimersByTimeAsync(999);
    expect(
      scheduler.scheduleRemoteCommand({
        delayMs: 0,
        hostId: "prod",
        maxEntries: 1500,
        ownerId: "pane-a",
        ttlSeconds: 300,
      }),
    ).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(
      scheduler.scheduleRemoteCommand({
        delayMs: 0,
        hostId: "prod",
        maxEntries: 1500,
        ownerId: "pane-a",
        ttlSeconds: 300,
      }),
    ).toBe(true);
    await vi.advanceTimersByTimeAsync(0);

    expect(refreshRemoteCommand).toHaveBeenCalledTimes(2);
  });

  it("limits concurrent probe refreshes", async () => {
    let finishFirstProbe: (() => void) | undefined;
    refreshRemoteCommand.mockImplementation(({ hostId }) => {
      if (hostId === "prod-a") {
        return new Promise((resolve) => {
          finishFirstProbe = () =>
            resolve({
              cachedAtUnixMs: 0,
              commandCount: 0,
              hostId,
              ttlSeconds: 300,
            });
        });
      }
      return Promise.resolve({
        cachedAtUnixMs: 0,
        commandCount: 0,
        hostId,
        ttlSeconds: 300,
      });
    });
    scheduler = new TerminalSuggestionProbeScheduler({
      api: {
        refreshGit,
        refreshRemoteCommand,
        refreshRemoteHistory,
        refreshRemotePath,
      },
      maxConcurrent: 1,
    });

    scheduler.scheduleRemoteCommand({
      delayMs: 0,
      hostId: "prod-a",
      maxEntries: 1500,
      ownerId: "pane-a",
      ttlSeconds: 300,
    });
    scheduler.scheduleRemoteCommand({
      delayMs: 0,
      hostId: "prod-b",
      maxEntries: 1500,
      ownerId: "pane-b",
      ttlSeconds: 300,
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(refreshRemoteCommand).toHaveBeenCalledTimes(1);
    expect(refreshRemoteCommand).toHaveBeenCalledWith({
      hostId: "prod-a",
      maxEntries: 1500,
      ttlSeconds: 300,
    });

    finishFirstProbe?.();
    await vi.advanceTimersByTimeAsync(250);

    expect(refreshRemoteCommand).toHaveBeenCalledTimes(2);
    expect(refreshRemoteCommand).toHaveBeenLastCalledWith({
      hostId: "prod-b",
      maxEntries: 1500,
      ttlSeconds: 300,
    });
  });
});
