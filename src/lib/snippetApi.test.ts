import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const isTauriMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}));

describe("snippetApi", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    isTauriMock.mockReset();
  });

  it("lists snippets through Tauri with filters", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue([
      {
        command: "git status --short",
        createdAt: "now",
        description: "日常开发检查",
        id: "snippet-1",
        scope: "local",
        sortOrder: 10,
        tags: ["git"],
        title: "检查 Git 状态",
        updatedAt: "now",
      },
    ]);
    const { listSnippets } = await import("./snippetApi");

    const snippets = await listSnippets({ query: "git", scope: "local" });

    expect(snippets[0].title).toBe("检查 Git 状态");
    expect(invokeMock).toHaveBeenCalledWith("snippet_list", {
      request: { query: "git", scope: "local" },
    });
  });

  it("normalizes create snippet requests", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      command: "npm run check",
      createdAt: "now",
      description: null,
      id: "snippet-1",
      scope: "any",
      sortOrder: 10,
      tags: ["quality"],
      title: "一键检查",
      updatedAt: "now",
    });
    const { createSnippet } = await import("./snippetApi");

    await createSnippet({
      command: "npm run check",
      tags: [" quality ", "QUALITY"],
      title: "一键检查",
    });

    expect(invokeMock).toHaveBeenCalledWith("snippet_create", {
      request: {
        command: "npm run check",
        description: undefined,
        scope: "any",
        tags: ["quality"],
        title: "一键检查",
      },
    });
  });

  it("uses searchable browser preview snippets outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const { listSnippets } = await import("./snippetApi");

    const snippets = await listSnippets({ query: "journalctl", scope: "ssh" });

    expect(snippets).toEqual([
      expect.objectContaining({
        scope: "ssh",
        title: "查看服务日志",
      }),
    ]);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
