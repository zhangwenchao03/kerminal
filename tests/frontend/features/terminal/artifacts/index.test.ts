import { describe, expect, it, vi } from "vitest";
import {
  createTerminalArtifactEventAdapter,
  createTerminalArtifactIndex,
} from "../../../../../src/features/terminal/artifacts/public";

const target = { id: "local", kind: "local" as const };

describe("terminal artifact index", () => {
  it("deduplicates, limits, evicts, and keeps no terminal body", () => {
    const index = createTerminalArtifactIndex({
      maxArtifacts: 2,
      now: vi.fn().mockReturnValue(10),
      paneId: "pane-a",
      target,
    });
    index.accept([
      { kind: "path", source: "heuristic", value: "/a" },
      { kind: "path", source: "heuristic", value: "/a" },
      { kind: "log", source: "heuristic", value: "/b.log" },
      { kind: "url", source: "heuristic", value: "https://example.com" },
    ]);
    const snapshot = index.getSnapshot();
    expect(snapshot.artifacts.map((item) => item.value)).toEqual([
      "/b.log",
      "https://example.com",
    ]);
    expect(snapshot.evictions).toBe(1);
    expect(JSON.stringify(snapshot)).not.toContain("outputHistory");
  });

  it("invalidates on clear/restart, revision eviction, close, and dispose", () => {
    const index = createTerminalArtifactIndex({ paneId: "pane-a", target });
    const adapter = createTerminalArtifactEventAdapter(target, index);
    adapter.handle({ data: "/tmp/old.log", type: "output" });
    adapter.handle({ reason: "clear", revision: 4, type: "invalidate" });
    expect(index.getSnapshot()).toMatchObject({ artifacts: [], revision: 4 });

    adapter.handle({ data: "/tmp/new.log", type: "output" });
    adapter.handle({ minimumRevision: 5, type: "evict-before-revision" });
    expect(index.getSnapshot().artifacts).toEqual([]);

    adapter.handle({ command: "npm test", id: "block-1", type: "command-block" });
    adapter.handle({ type: "close" });
    expect(index.getSnapshot()).toMatchObject({
      artifacts: [],
      disposed: true,
      revision: 5,
    });
    adapter.handle({ data: "/ignored", type: "output" });
    expect(index.getSnapshot().artifacts).toEqual([]);
  });

  it("adapts link provider and command block events", () => {
    const index = createTerminalArtifactIndex({ paneId: "pane-a", target });
    const adapter = createTerminalArtifactEventAdapter(target, index);
    adapter.handle({
      label: "Docs",
      type: "link",
      uri: "https://example.com/docs",
    });
    adapter.handle({ command: "cargo test", id: "block-a", type: "command-block" });
    expect(index.getSnapshot().artifacts).toMatchObject([
      { kind: "link", label: "Docs", source: "link-provider" },
      { kind: "command", label: "cargo test", source: "command-block" },
    ]);
  });

  it("rejects secret bodies and degrades oversized batches predictably", () => {
    const index = createTerminalArtifactIndex({
      maxCandidatesPerBatch: 2,
      paneId: "pane-a",
      target,
    });
    index.accept([
      { kind: "path", source: "heuristic", value: "password=hunter2" },
      { kind: "path", source: "heuristic", value: "/safe/a" },
      { kind: "path", source: "heuristic", value: "/safe/b" },
      { kind: "path", source: "heuristic", value: "/safe/c" },
    ]);
    expect(index.getSnapshot()).toMatchObject({
      degraded: true,
      rejected: 3,
    });
    expect(index.getSnapshot().artifacts.map((item) => item.value)).toEqual([
      "/safe/a",
    ]);
  });

  it("rejects blocked link labels and replaces sensitive labels", () => {
    const index = createTerminalArtifactIndex({ paneId: "pane-a", target });
    index.accept([
      {
        kind: "link",
        label: "password=hunter2",
        source: "osc8",
        value: "https://example.com/rejected",
      },
      {
        kind: "link",
        label: "token",
        source: "link-provider",
        value: "https://example.com/safe",
      },
      {
        kind: "link",
        label: "普通文档",
        source: "osc8",
        value: "https://example.com/docs",
      },
      {
        kind: "link",
        label: `build output ${"x".repeat(200)}`,
        source: "osc8",
        value: "https://example.com/long-label",
      },
      {
        kind: "link",
        label: "\u001b[31m彩色文档\u001b[0m",
        source: "osc8",
        value: "https://example.com/colored",
      },
    ]);

    expect(index.getSnapshot()).toMatchObject({ rejected: 1 });
    expect(index.getSnapshot().artifacts).toMatchObject([
      {
        label: "安全链接",
        sensitivity: "sensitive",
        value: "https://example.com/safe",
      },
      {
        label: "普通文档",
        sensitivity: "normal",
        value: "https://example.com/docs",
      },
      {
        label: "安全链接",
        sensitivity: "sensitive",
        value: "https://example.com/long-label",
      },
      {
        label: "彩色文档",
        sensitivity: "normal",
        value: "https://example.com/colored",
      },
    ]);
    expect(JSON.stringify(index.getSnapshot())).not.toContain("hunter2");
    expect(JSON.stringify(index.getSnapshot())).not.toContain('"label":"token"');
    expect(JSON.stringify(index.getSnapshot())).not.toContain("build output");
  });

  it("rejects credential-bearing command blocks without harming normal commands", () => {
    const index = createTerminalArtifactIndex({ paneId: "pane-a", target });
    index.accept([
      {
        kind: "command",
        source: "command-block",
        value: 'curl -H "Authorization: Bearer secret-token" https://example.com',
      },
      {
        kind: "command",
        source: "command-block",
        value: "tool --secret hidden",
      },
      {
        kind: "command",
        source: "command-block",
        value: "cargo test --workspace",
      },
    ]);

    expect(index.getSnapshot()).toMatchObject({ rejected: 2 });
    expect(index.getSnapshot().artifacts).toMatchObject([
      {
        kind: "command",
        label: "cargo test --workspace",
        sensitivity: "normal",
        value: "cargo test --workspace",
      },
    ]);
  });
});
