// @author kongweiguang

// 项目测试 tsconfig 不加载 Node 类型；Vitest 运行时仍提供该内置模块。
// @ts-expect-error Node 内置模块由 Vitest 的 Node 运行时提供。
import fs from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

interface ContractInventory {
  tauri: {
    commandCount: number;
    frontendInvokeCount: number;
    frontendInvokeFingerprint: string;
  };
  workspaceSession: { frontendVersion: number };
}

describe("公共契约 inventory", () => {
  it("前端 literal invoke 与后端注册命令保持双向可审计", () => {
    const root = process.cwd().replace(/\\/g, "/");
    const inventory = JSON.parse(
      fs.readFileSync(
        `${root}/tests/fixtures/contracts/public-contract-inventory.json`,
        "utf8",
      ),
    ) as ContractInventory;
    const registry = fs.readFileSync(
      `${root}/src-tauri/src/commands/registry.rs`,
      "utf8",
    );
    const backendCommands = new Set(
      [...registry.matchAll(/crate::commands::[\w:]+::(\w+),/g)].map(
        (match) => match[1]!,
      ),
    );
    expect(backendCommands.size).toBe(inventory.tauri.commandCount);

    const invokes = new Set<string>();
    for (const file of sourceFiles(`${root}/src`)) {
      const source = ts.createSourceFile(
        file,
        fs.readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      const visit = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === "invoke" &&
          node.arguments.length > 0 &&
          ts.isStringLiteral(node.arguments[0]!)
        ) {
          invokes.add(node.arguments[0]!.text);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }

    const sortedInvokes = [...invokes].sort();
    expect(sortedInvokes).toHaveLength(inventory.tauri.frontendInvokeCount);
    expect(fingerprint(sortedInvokes.join("\n"))).toBe(
      inventory.tauri.frontendInvokeFingerprint,
    );
    expect(sortedInvokes.filter((command) => !backendCommands.has(command))).toEqual([]);
  });

  it("workspace snapshot 由前端规范化为 v2", () => {
    const root = process.cwd().replace(/\\/g, "/");
    const inventory = JSON.parse(
      fs.readFileSync(
        `${root}/tests/fixtures/contracts/public-contract-inventory.json`,
        "utf8",
      ),
    ) as ContractInventory;
    const source = fs.readFileSync(
      `${root}/src/features/workspace/workspaceSession.ts`,
      "utf8",
    );

    expect(source).toContain(
      `WORKSPACE_SESSION_VERSION = ${inventory.workspaceSession.frontendVersion}`,
    );
  });
});

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry: {
    isDirectory(): boolean;
    name: string;
  }) => {
    const target = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.tsx?$/.test(entry.name) ? [target] : [];
  });
}

function fingerprint(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}
