import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const isTauriMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}));

describe("aiConversationSnapshotApi", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    isTauriMock.mockReset();
  });

  it("calls Tauri snapshot commands with normalized JSON payloads", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock
      .mockResolvedValueOnce({
        id: "ctx-1",
        conversationId: "conv-1",
        generatedAt: 1,
        scopeKind: "lockedPane",
        scopeRefJson: "{}",
        attachmentRefsJson: "[]",
        policyJson: "{}",
        createdAt: 1,
      })
      .mockResolvedValueOnce({ id: "ctx-1" });
    const { createAiContextSnapshot, getAiContextSnapshot } = await import(
      "./aiConversationSnapshotApi"
    );

    await createAiContextSnapshot({
      applicationContextJson: ' { "focusedPane": { "id": "pane-1" } } ',
      attachmentRefsJson: ' [ { "id": "att-1" } ] ',
      conversationId: " conv-1 ",
      policyJson: ' { "providerId": "provider-main" } ',
      routeMode: "followWorkspaceTarget",
      scopeKind: "lockedPane",
      scopeRefJson: ' { "paneId": "pane-1" } ',
      targetRefJson: ' { "kind": "pane" } ',
      terminalContextJson: ' { "sessionId": "session-1" } ',
    });
    await getAiContextSnapshot(" ctx-1 ");

    expect(invokeMock).toHaveBeenNthCalledWith(1, "ai_context_snapshot_create", {
      request: {
        applicationContextJson: '{ "focusedPane": { "id": "pane-1" } }',
        attachmentRefsJson: '[ { "id": "att-1" } ]',
        conversationId: "conv-1",
        policyJson: '{ "providerId": "provider-main" }',
        routeMode: "followWorkspaceTarget",
        scopeKind: "lockedPane",
        scopeRefJson: '{ "paneId": "pane-1" }',
        targetRefJson: '{ "kind": "pane" }',
        terminalContextJson: '{ "sessionId": "session-1" }',
      },
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "ai_context_snapshot_get", {
      snapshotId: "ctx-1",
    });
  });

  it("rejects invalid snapshot payloads before invoking Tauri", async () => {
    isTauriMock.mockReturnValue(true);
    const { createAiContextSnapshot } = await import(
      "./aiConversationSnapshotApi"
    );

    await expect(
      createAiContextSnapshot({
        conversationId: "conv-1",
        scopeKind: "lockedPane",
        targetRefJson: "{not-json",
      }),
    ).rejects.toThrow();

    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("keeps browser preview snapshots readable by id", async () => {
    isTauriMock.mockReturnValue(false);
    const { createAiContextSnapshot, getAiContextSnapshot } = await import(
      "./aiConversationSnapshotApi"
    );

    const snapshot = await createAiContextSnapshot({
      conversationId: "conv-browser",
      policyJson: '{"source":"preview"}',
      scopeKind: "noContext",
    });
    await expect(getAiContextSnapshot(snapshot.id)).resolves.toMatchObject({
      conversationId: "conv-browser",
      id: snapshot.id,
      policyJson: '{"source":"preview"}',
      scopeKind: "noContext",
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
