import { describe, expect, it } from "vitest";
import {
  buildTerminalArtifactActions,
  createTerminalArtifactViewModel,
  type TerminalArtifact,
} from "../../../../../../src/features/terminal/artifacts/public";

function artifact(overrides: Partial<TerminalArtifact> = {}): TerminalArtifact {
  return {
    actions: [
      { enabled: true, id: "copy", requiresConfirmation: false },
      { enabled: true, id: "open-terminal", requiresConfirmation: false },
      {
        disabledReason: "远端路径不能由本机文件管理器打开",
        enabled: false,
        id: "reveal",
        requiresConfirmation: false,
      },
    ],
    createdAt: 1,
    dedupeKey: "path",
    id: "artifact-1",
    kind: "path",
    label: "/var/log/app.log",
    paneId: "pane-1",
    pathStyle: "posix",
    revision: 2,
    sensitivity: "normal",
    source: "heuristic",
    target: { host: "prod.example", id: "ssh-1", kind: "ssh" },
    value: "/var/log/app.log",
    ...overrides,
  };
}

describe("terminal artifact action model", () => {
  it("reuses policy availability and exposes disabled reasons", () => {
    const actions = buildTerminalArtifactActions(artifact());

    expect(actions).toMatchObject([
      { enabled: true, id: "copy", route: "execute" },
      { enabled: true, id: "open", route: "execute" },
      {
        disabledReason: "远端路径不能由本机文件管理器打开",
        enabled: false,
        id: "reveal",
      },
      { enabled: true, id: "send-to-agent", route: "preview" },
    ]);
  });

  it("routes sensitive actions through confirmation or preview", () => {
    const actions = buildTerminalArtifactActions(
      artifact({ sensitivity: "sensitive" }),
    );

    expect(actions.filter((action) => action.id !== "send-to-agent")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "copy", route: "confirmation" }),
        expect.objectContaining({ id: "open", route: "confirmation" }),
      ]),
    );
    expect(actions[actions.length - 1]).toMatchObject({
      id: "send-to-agent",
      route: "preview",
    });
  });

  it("does not copy artifact value into the view model", () => {
    const model = createTerminalArtifactViewModel(artifact());

    expect(model).not.toHaveProperty("value");
    expect(model).toMatchObject({
      kindLabel: "路径",
      sourceLabel: "文本检测",
      targetLabel: "prod.example",
    });
  });
});
