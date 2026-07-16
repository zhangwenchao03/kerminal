import { describe, expect, it, vi } from "vitest";
import { createXtermPaneArtifactRuntime } from "../../../../src/features/terminal/XtermPane.artifacts";
import {
  getXtermPaneArtifactSnapshot,
  subscribeXtermPaneArtifactSnapshot,
} from "../../../../src/features/terminal/XtermPane.artifactsRegistry";

describe("XtermPane artifact runtime", () => {
  it("批次处理增量 output，不读取 output history", () => {
    const pending: Array<() => void> = [];
    const runtime = createXtermPaneArtifactRuntime({
      paneId: "pane-1",
      schedule: (work) => pending.push(work),
      target: { kind: "local" },
    });

    runtime.queueOutput("open https://example.com/a");
    runtime.queueOutput(" and /var/log/app.log");

    expect(runtime.getSnapshot().artifacts).toEqual([]);
    expect(pending).toHaveLength(1);
    pending[0]?.();
    expect(
      runtime.getSnapshot().artifacts.map((artifact) => artifact.value),
    ).toEqual(
      expect.arrayContaining(["https://example.com/a", "/var/log/app.log"]),
    );
  });

  it("接入 OSC、link、command block 并在 clear/restart 时失效", () => {
    const runtime = createXtermPaneArtifactRuntime({
      paneId: "pane-2",
      schedule: (work) => work(),
      target: { hostId: "host-1", kind: "ssh" },
    });

    runtime.queueOutput("\u001b]7;file:///srv/app\u0007");
    runtime.queueOutput(
      "\u001b]8;;https://example.com\u0007docs\u001b]8;;\u0007",
    );
    runtime.queueLink("https://openai.com", "OpenAI");
    runtime.queueCommandBlock("block-1", "tail -f /var/log/app.log");
    expect(
      runtime.getSnapshot().artifacts.map((artifact) => artifact.source),
    ).toEqual(
      expect.arrayContaining([
        "osc7",
        "osc8",
        "link-provider",
        "command-block",
      ]),
    );

    runtime.invalidate("clear");
    expect(runtime.getSnapshot().artifacts).toEqual([]);
    expect(runtime.getSnapshot().revision).toBe(1);
    runtime.invalidate("restart");
    expect(runtime.getSnapshot().revision).toBe(2);
  });

  it("dispose 取消迟到批次并完整移除 registry", () => {
    const pending: Array<() => void> = [];
    const listener = vi.fn();
    const unsubscribe = subscribeXtermPaneArtifactSnapshot("pane-3", listener);
    const runtime = createXtermPaneArtifactRuntime({
      paneId: "pane-3",
      schedule: (work) => pending.push(work),
    });

    runtime.queueOutput("https://example.com/late");
    runtime.close();
    pending[0]?.();

    expect(getXtermPaneArtifactSnapshot("pane-3")).toBeUndefined();
    expect(listener).toHaveBeenLastCalledWith(undefined);
    expect(runtime.getSnapshot().disposed).toBe(true);
    unsubscribe();
  });
});
