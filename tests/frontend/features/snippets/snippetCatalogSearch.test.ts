import { describe, expect, it } from "vitest";
import type { SnippetCatalogItem } from "../../../../src/lib/snippetApi";
import {
  commonSnippetCatalog,
  searchSnippetCatalog,
} from "../../../../src/features/snippets/snippetCatalogSearch";

function item(index: number): SnippetCatalogItem {
  return {
    capabilities: index % 2 === 0 ? ["curl"] : ["systemctl"],
    contextBindings: [],
    category: index % 2 === 0 ? "network" : "service",
    defaultAction: "insert",
    deprecated: false,
    description: `命令说明 ${index}`,
    duration: "instant",
    favorite: false,
    id: `snippet-${index}`,
    origin: "user",
    pack: "mine",
    platforms: [],
    risk: "inspect",
    scope: "any",
    sensitive: false,
    shells: [],
    sortOrder: index,
    tags: [`tag-${index % 10}`],
    template: `echo command-${index}`,
    title: `片段 ${index}`,
    updatedAt: "2026-07-13",
    useCount: 0,
    variables: [],
  };
}

describe("snippetCatalogSearch", () => {
  it("searches 2000 projected items without mutating stable order", () => {
    const items = Array.from({ length: 2_000 }, (_, index) => item(index));
    const started = performance.now();
    const result = searchSnippetCatalog(items, "command-1999");
    const elapsed = performance.now() - started;

    expect(result.map((entry) => entry.id)).toEqual(["snippet-1999"]);
    expect(elapsed).toBeLessThan(25);
    expect(items[0]?.id).toBe("snippet-0");
  });

  it("matches user-visible title, description, category and tags", () => {
    const items = [item(1), item(2)];
    expect(searchSnippetCatalog(items, "SYSTEMCTL")).toEqual([]);
    expect(searchSnippetCatalog(items, "service").map((entry) => entry.id)).toEqual([
      "snippet-1",
    ]);
    expect(searchSnippetCatalog(items, "tag-2").map((entry) => entry.id)).toEqual([
      "snippet-2",
    ]);
  });

  it("orders favorites before recent and frequent items deterministically", () => {
    const favorite = { ...item(1), favorite: true, lastUsedAtUnixMs: 1, useCount: 1 };
    const recent = { ...item(2), lastUsedAtUnixMs: 50, useCount: 1 };
    const frequent = { ...item(3), lastUsedAtUnixMs: 10, useCount: 8 };

    expect(commonSnippetCatalog([frequent, recent, favorite]).map((entry) => entry.id)).toEqual([
      favorite.id,
      recent.id,
      frequent.id,
    ]);
  });
});
