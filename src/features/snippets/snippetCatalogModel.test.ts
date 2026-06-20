import { describe, expect, it } from "vitest";
import type { CommandSnippet } from "../../lib/snippetApi";
import type { TerminalPane } from "../workspace/types";
import {
  PRESET_SNIPPET_ID_PREFIX,
  PRESET_TAG,
  buildSnippetVariableValues,
  collectTagGroups,
  filterPresetSnippets,
  getPaneCommandTarget,
  getSnippetSendBlocker,
  groupSnippets,
  isPresetSnippetId,
  parseTags,
  presetSnippets,
  scopeBadgeClassName,
  scopeLabel,
  scopeShortLabel,
  snippetHasTag,
} from "./snippetCatalogModel";

const localPane: TerminalPane = {
  id: "pane-local",
  lines: [],
  machineId: "local-powershell",
  mode: "local",
  prompt: "PS>",
  status: "online",
  title: "PowerShell",
};

const sshPane: TerminalPane = {
  id: "pane-ssh",
  lines: [],
  machineId: "prod-api",
  mode: "ssh",
  prompt: "root@prod:~$",
  remoteHostId: "prod-api",
  status: "online",
  title: "prod-api",
};

const sampleSnippets: CommandSnippet[] = [
  {
    command: "git status",
    createdAt: "now",
    id: "git-status",
    scope: "local",
    sortOrder: 1,
    tags: ["git", "daily", "git"],
    title: "Git 状态",
    updatedAt: "now",
  },
  {
    command: "df -h",
    createdAt: "now",
    id: "ssh-disk",
    scope: "ssh",
    sortOrder: 2,
    tags: ["ssh", "system"],
    title: "磁盘空间",
    updatedAt: "now",
  },
];

describe("snippetCatalogModel", () => {
  it("defines stable preset snippets", () => {
    expect(presetSnippets).toHaveLength(14);
    expect(presetSnippets.every((snippet) => isPresetSnippetId(snippet.id))).toBe(
      true,
    );
    expect(presetSnippets[0]).toMatchObject({
      id: `${PRESET_SNIPPET_ID_PREFIX}git-status`,
      sortOrder: 10,
      tags: [PRESET_TAG, "git", "daily"],
      title: "Git 状态",
    });
  });

  it("filters presets by scope, query and tag", () => {
    expect(filterPresetSnippets({ query: "docker", scope: "" }).map((item) => item.title)).toEqual([
      "Docker 容器",
      "Docker Compose 状态",
    ]);
    expect(filterPresetSnippets({ query: "磁盘", scope: "ssh" })).toHaveLength(1);
    expect(filterPresetSnippets({ query: "git", scope: "ssh" })).toEqual([]);
  });

  it("builds variable values and send blockers from pane target", () => {
    const sshSnippet = sampleSnippets[1];
    const localSnippet = sampleSnippets[0];

    expect(buildSnippetVariableValues(["service", "path"], { service: "nginx" })).toEqual({
      path: "",
      service: "nginx",
    });
    expect(getPaneCommandTarget(localPane)).toBe("local");
    expect(getPaneCommandTarget(sshPane)).toBe("ssh");
    expect(getSnippetSendBlocker(sshSnippet, localPane)).toBe(
      "该片段仅适用于 SSH 终端，请先聚焦 SSH 分屏。",
    );
    expect(getSnippetSendBlocker(localSnippet, undefined)).toBe(
      "当前没有可发送的终端分屏。",
    );
    expect(getSnippetSendBlocker(localSnippet, localPane)).toBeNull();
  });

  it("groups tags and snippets deterministically", () => {
    expect(parseTags("git, daily，ssh\nprod")).toEqual([
      "git",
      "daily",
      "ssh",
      "prod",
    ]);
    expect(snippetHasTag(sampleSnippets[0], "GIT")).toBe(true);
    expect(collectTagGroups(sampleSnippets)).toEqual([
      { count: 1, tag: "daily" },
      { count: 1, tag: "git" },
      { count: 1, tag: "ssh" },
      { count: 1, tag: "system" },
    ]);
    const presetTagGroups = collectTagGroups(presetSnippets, [PRESET_TAG]);
    expect(presetTagGroups.some((group) => group.tag === PRESET_TAG)).toBe(false);
    expect(presetTagGroups.slice(0, 2).map((group) => group.tag)).toEqual([
      "daily",
      "git",
    ]);
    expect(groupSnippets(sampleSnippets, "").map((group) => group.label)).toEqual([
      "#git",
      "#ssh",
    ]);
    expect(groupSnippets(sampleSnippets, "daily")).toMatchObject([
      { id: "tag:daily", label: "#daily", snippets: sampleSnippets },
    ]);
  });

  it("labels and styles scopes", () => {
    expect(scopeLabel("any")).toBe("通用片段");
    expect(scopeShortLabel("ssh")).toBe("ssh");
    expect(scopeBadgeClassName("local")).toContain("emerald");
  });
});
