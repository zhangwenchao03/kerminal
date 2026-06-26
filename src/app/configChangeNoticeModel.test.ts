import { describe, expect, it } from "vitest";

import {
  buildConfigChangeNotice,
  configChangeNoticeSnapshot,
  type BuildConfigChangeNoticeInput,
} from "./configChangeNoticeModel";

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

    expect(notice?.text).toBe('cfg: +1 host "staging-api"');
    expect(notice?.level).toBe("info");
    expect(notice?.ttlMs).toBe(3000);
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

    expect(notice?.text).toBe('cfg: hosts +2, +1 workflow "deploy"');
  });

  it("summarizes settings without exposing raw values", () => {
    const notice = buildConfigChangeNotice(
      readyInput({
        after: configChangeNoticeSnapshot({ settingsRevision: "dark" }),
        before: configChangeNoticeSnapshot({ settingsRevision: "light" }),
        domains: ["settings"],
      }),
    );

    expect(notice?.text).toBe("cfg: settings reloaded");
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

    expect(notice?.text).toBe("cfg: host credentials updated");
    expect(notice?.text).not.toContain("secrets");
  });

  it("keeps invalid config visible but concise", () => {
    const notice = buildConfigChangeNotice({
      ...readyInput({ domains: ["hosts"] }),
      status: "invalid",
    });

    expect(notice?.level).toBe("error");
    expect(notice?.text).toBe("cfg: invalid TOML, kept last-known-good");
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
});

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
