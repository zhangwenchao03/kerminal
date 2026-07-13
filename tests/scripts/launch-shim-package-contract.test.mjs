// @author kongweiguang

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const verifierPath = path.join(
  repoRoot,
  "scripts",
  "verify-launch-shim-package-contract.mjs",
);

test("当前仓库满足 launch shim 安装包合同", () => {
  const result = runVerifier(repoRoot);

  assert.equal(result.ok, true, result.output);
});

test("缺少 externalBin 时拒绝发布", (context) => {
  const fixture = createFixture(context, ({ config }) => {
    delete config.bundle.externalBin;
  });

  const result = runVerifier(fixture);

  assert.equal(result.ok, false);
  assert.match(result.output, /bundle\.externalBin/);
});

test("构建流程没有准备 sidecar 时拒绝发布", (context) => {
  const fixture = createFixture(context, ({ config }) => {
    config.build.beforeBuildCommand = "npm run build";
  });

  const result = runVerifier(fixture);

  assert.equal(result.ok, false);
  assert.match(result.output, /beforeBuildCommand/);
});

test("安装复制失败没有 fail closed 时拒绝发布", (context) => {
  const fixture = createFixture(context, ({ hook }) => ({
    hook: hook.replaceAll(
      'Abort "Kerminal launch shim',
      '; Abort removed: "Kerminal launch shim',
    ),
  }));

  const result = runVerifier(fixture);

  assert.equal(result.ok, false);
  assert.match(result.output, /NSIS_HOOK_POSTINSTALL.*Abort/s);
});

test("卸载后置清理缺失时拒绝发布", (context) => {
  const fixture = createFixture(context, ({ hook }) => ({
    hook: hook.replace(
      /!macro NSIS_HOOK_POSTUNINSTALL[\s\S]*?!macroend\s*/,
      "",
    ),
  }));

  const result = runVerifier(fixture);

  assert.equal(result.ok, false);
  assert.match(result.output, /NSIS_HOOK_POSTUNINSTALL/);
});

test("配置静态 kerminal scheme 时拒绝发布以保持 opt-in", (context) => {
  const fixture = createFixture(context, ({ config }) => {
    config.plugins["deep-link"].desktop = { schemes: ["kerminal"] };
  });

  const result = runVerifier(fixture);

  assert.equal(result.ok, false);
  assert.match(result.output, /must stay empty.*opt-in/);
});

test("卸载协议清理缺少 ownership gate 时拒绝发布", (context) => {
  const fixture = createFixture(context, ({ hook }) => ({
    hook: hook.replaceAll(/\s*StrCmp \$0[^\r\n]+/g, ""),
  }));

  const result = runVerifier(fixture);

  assert.equal(result.ok, false);
  assert.match(result.output, /ownership-gate/);
});

test("sidecar prepare 使用 Tauri 交叉构建 target", () => {
  const target = "aarch64-kerminal-contract-test";
  const prepare = path.join(repoRoot, "scripts", "prepare-launch-shim-sidecar.mjs");
  const result = spawnSync(
    process.execPath,
    [prepare, "--verify", "--no-build"],
    {
      encoding: "utf8",
      env: { ...process.env, TAURI_ENV_TARGET_TRIPLE: target },
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout ?? ""}${result.stderr ?? ""}`, new RegExp(target));
});

function createFixture(context, mutate) {
  const fixture = fs.mkdtempSync(
    path.join(os.tmpdir(), "kerminal-launch-shim-contract-"),
  );
  context.after(() => fs.rmSync(fixture, { force: true, recursive: true }));

  const config = readJson("src-tauri/tauri.conf.json");
  const packageJson = readJson("package.json");
  const currentHook = fs.readFileSync(
    path.join(repoRoot, "scripts", "kerminal-launch-shim-nsis-hooks.nsh"),
    "utf8",
  );
  const mutation = mutate({ config, hook: currentHook, packageJson }) ?? {};

  fs.mkdirSync(path.join(fixture, "src-tauri"), { recursive: true });
  fs.mkdirSync(path.join(fixture, "src-tauri", "src", "commands"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(fixture, ".github", "workflows"), { recursive: true });
  fs.mkdirSync(path.join(fixture, "scripts"), { recursive: true });
  fs.writeFileSync(
    path.join(fixture, "package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(fixture, "src-tauri", "tauri.conf.json"),
    `${JSON.stringify(config, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(fixture, "scripts", "kerminal-launch-shim-nsis-hooks.nsh"),
    mutation.hook ?? currentHook,
  );
  for (const relativePath of [
    "src-tauri/Cargo.toml",
    "src-tauri/src/desktop_plugins.rs",
    "src-tauri/src/lib.rs",
    "src-tauri/src/commands/registry.rs",
    ".github/workflows/release.yml",
    "scripts/prepare-launch-shim-sidecar.mjs",
  ]) {
    fs.copyFileSync(
      path.join(repoRoot, relativePath),
      path.join(fixture, relativePath),
    );
  }
  return fixture;
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), "utf8"));
}

function runVerifier(root) {
  const result = spawnSync(
    process.execPath,
    [verifierPath, "--repo-root", root],
    { encoding: "utf8" },
  );
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}
