import { describe, expect, it } from "vitest";

import {
  buildConfigChangeNotice,
  configChangeNoticeSnapshot,
  type BuildConfigChangeNoticeInput,
} from "../../../src/app/configChangeNoticeModel";

describe("configChangeNoticeModel", () => {
  it("summarizes a single externally added host", () => {
    const notice = buildConfigChangeNotice(
      readyInput({
        after: configChangeNoticeSnapshot({
          hosts: [{ id: "host-staging", label: "staging-api" }],
        }),
        before: configChangeNoticeSnapshot({ hosts: [] }),
        domains: ["hosts"],
      }),
    );

    expect(notice?.text).toBe("已添加主机“staging-api”。");
    expect(notice?.level).toBe("info");
    expect(notice?.ttlMs).toBe(3000);
    expectUserFacingNotice(notice?.text);
  });

  it("folds multi-domain batches into one compact notice", () => {
    const notice = buildConfigChangeNotice(
      readyInput({
        after: configChangeNoticeSnapshot({
          hosts: [
            { id: "host-a", label: "host-a" },
            { id: "host-b", label: "host-b" },
          ],
          workflows: [{ id: "wf-deploy", label: "deploy" }],
        }),
        before: configChangeNoticeSnapshot({ hosts: [], workflows: [] }),
        domains: ["hosts", "workflows"],
      }),
    );

    expect(notice?.text).toBe(
      "已添加2个主机，已添加工作流“deploy”。",
    );
    expectUserFacingNotice(notice?.text);
  });

  it("summarizes settings without exposing raw values", () => {
    const notice = buildConfigChangeNotice(
      readyInput({
        after: configChangeNoticeSnapshot({ settingsRevision: "dark" }),
        before: configChangeNoticeSnapshot({ settingsRevision: "light" }),
        domains: ["settings"],
      }),
    );

    expect(notice?.text).toBe("设置已在外部更新。");
    expect(notice?.text).not.toContain("dark");
    expect(notice?.text).not.toContain("light");
  });

  it("does not report settings as reloaded when the revision did not change", () => {
    const notice = buildConfigChangeNotice(
      readyInput({
        after: configChangeNoticeSnapshot({ settingsRevision: "same" }),
        before: configChangeNoticeSnapshot({ settingsRevision: "same" }),
        domains: ["settings"],
      }),
    );

    expect(notice).toBeNull();
  });

  it("uses a credential-only summary for redacted host changes", () => {
    const notice = buildConfigChangeNotice(
      readyInput({
        domains: ["hosts"],
        redactedSecretDomains: ["hosts"],
      }),
    );

    expect(notice?.text).toBe("主机凭据已更新。");
    expect(notice?.text).not.toContain("secrets");
    expectUserFacingNotice(notice?.text);
  });

  it("keeps invalid config visible but concise", () => {
    const notice = buildConfigChangeNotice({
      ...readyInput({ domains: ["hosts"] }),
      status: "invalid",
    });

    expect(notice?.level).toBe("error");
    expect(notice?.text).toBe(
      "配置文件有误，Kerminal 已继续使用上次有效设置。",
    );
    expectUserFacingNotice(notice?.text);
  });

  it("uses a user-facing warning when automatic refresh is unavailable", () => {
    const notice = buildConfigChangeNotice({
      ...readyInput({ domains: ["settings"] }),
      status: "watcher-unavailable",
    });

    expect(notice?.level).toBe("warning");
    expect(notice?.text).toBe("暂时无法自动检查配置变化，请稍后重试。");
    expectUserFacingNotice(notice?.text);
  });

  it("does not show success notices for internal Kerminal saves", () => {
    const notice = buildConfigChangeNotice(
      readyInput({
        domains: ["hosts"],
        sourceHint: "kerminal",
      }),
    );

    expect(notice).toBeNull();
  });

  it("sanitizes and truncates labels", () => {
    const notice = buildConfigChangeNotice(
      readyInput({
        after: configChangeNoticeSnapshot({
          snippets: [
            {
              id: "snippet-long",
              label: 'deploy "token" with a very very very very long label',
            },
          ],
        }),
        before: configChangeNoticeSnapshot({ snippets: [] }),
        domains: ["snippets"],
      }),
    );

    expect(notice?.text).not.toContain('"token"');
    expect(notice?.text.length).toBeLessThan(90);
  });

  it("retains raw event identity without displaying it as notice text", () => {
    const notice = buildConfigChangeNotice(
      readyInput({
        after: configChangeNoticeSnapshot({
          hosts: [{ id: "host-a", label: "生产主机" }],
        }),
        batchId: "cfg: hosts changed externally; revision=raw-42",
        before: configChangeNoticeSnapshot({ hosts: [] }),
        domains: ["hosts"],
      }),
    );

    expect(notice?.batchId).toBe(
      "cfg: hosts changed externally; revision=raw-42",
    );
    expect(notice?.text).toBe("已添加主机“生产主机”。");
    expect(notice?.text).not.toContain("raw-42");
    expectUserFacingNotice(notice?.text);
  });
});

function expectUserFacingNotice(text: string | undefined) {
  expect(text).toBeDefined();
  for (const internalTerm of [
    /cfg:/i,
    /invalid TOML/i,
    /last-known-good/i,
    /watcher offline/i,
    /auto-refresh/i,
    /settings reloaded/i,
    /host credentials/i,
  ]) {
    expect(text).not.toMatch(internalTerm);
  }
}

function readyInput(
  overrides: Partial<BuildConfigChangeNoticeInput>,
): BuildConfigChangeNoticeInput {
  return {
    batchId: "batch-1",
    domains: [],
    sequence: 1,
    sourceHint: "external",
    status: "ready",
    ...overrides,
  };
}
