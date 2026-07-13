#!/usr/bin/env node
// @author kongweiguang

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const tauriDir = path.join(repoRoot, "src-tauri");
const cargoToml = path.join(tauriDir, "Cargo.toml");
const tauriConfigPath = path.join(tauriDir, "tauri.conf.json");
const binName = "kerminal-launch-shim";
const sidecarName = "kerminal-launch-shim-sidecar";
const externalBinName = `binaries/${sidecarName}`;
const nsisHookPath = "../scripts/kerminal-launch-shim-nsis-hooks.nsh";
const args = new Set(process.argv.slice(2));
const noBuild = args.has("--no-build");
const verifyOnly = args.has("--verify");
// Tauri 在交叉构建 beforeBuildCommand 时通过该变量传递最终 bundle target。
const targetTriple =
  readOption("--target") ||
  process.env.KERMINAL_SHIM_TARGET_TRIPLE ||
  process.env.TAURI_ENV_TARGET_TRIPLE ||
  process.env.CARGO_BUILD_TARGET ||
  hostTriple();
const extension = targetTriple.includes("windows") ? ".exe" : "";
const sidecarDir = path.join(tauriDir, "binaries");
const sidecarPath = path.join(sidecarDir, `${sidecarName}-${targetTriple}${extension}`);
const cargoTargetDir = process.env.CARGO_TARGET_DIR
  ? path.resolve(process.env.CARGO_TARGET_DIR)
  : path.join(tauriDir, "target");
const cargoProfileDir = path.join(cargoTargetDir, targetTriple, "release");
const builtShimPath = path.join(cargoProfileDir, `${binName}${extension}`);
let createdBootstrapSidecar = false;

main();

function main() {
  assertTauriConfig();

  if (!noBuild) {
    const reusable = reusableShimArtifact();
    if (reusable.kind === "sidecar") {
      console.log(`Reusing fresh launch shim sidecar: ${relative(sidecarPath)}`);
    } else if (reusable.kind === "built") {
      installBuiltShim();
      console.log(`Reusing fresh launch shim build: ${relative(builtShimPath)}`);
    } else {
      console.log(`Building launch shim sidecar: ${reusable.reason}`);
      ensureBootstrapSidecarForCargoBuild();
      run("cargo", [
        "build",
        "--manifest-path",
        cargoToml,
        "--bin",
        binName,
        "--release",
        "--target",
        targetTriple,
      ]);
    }
  }

  if (!fs.existsSync(builtShimPath)) {
    if (!fs.existsSync(sidecarPath)) {
      fail(`Built shim not found: ${relative(builtShimPath)}`);
    }
  } else if (
    !verifyOnly &&
    artifactIsFresh(builtShimPath) &&
    !sameFileContent(builtShimPath, sidecarPath)
  ) {
    installBuiltShim();
  }

  assertSidecarReady();
  verifyInstalledDirIfRequested();

  console.log(
    [
      "Prepared Kerminal launch shim sidecar.",
      `target=${targetTriple}`,
      `source=${relative(builtShimPath)}`,
      `sidecar=${relative(sidecarPath)}`,
      `sha256=${sha256(sidecarPath)}`,
    ].join("\n"),
  );
}

function reusableShimArtifact() {
  if (artifactIsFresh(sidecarPath)) {
    return { kind: "sidecar" };
  }

  if (artifactIsFresh(builtShimPath)) {
    return { kind: "built" };
  }

  if (!fs.existsSync(sidecarPath) && !fs.existsSync(builtShimPath)) {
    return { kind: "missing", reason: "sidecar and release build are missing" };
  }

  return {
    kind: "stale",
    reason: `${relative(newestShimInput().path)} changed after the reusable artifact`,
  };
}

function artifactIsFresh(filePath) {
  if (!fs.existsSync(filePath) || isBootstrapSidecar(filePath)) {
    return false;
  }

  return fs.statSync(filePath).mtimeMs >= newestShimInput().mtimeMs;
}

function newestShimInput() {
  let newest = { path: cargoToml, mtimeMs: fs.statSync(cargoToml).mtimeMs };
  for (const input of shimInputs()) {
    const stat = fs.statSync(input);
    if (stat.mtimeMs > newest.mtimeMs) {
      newest = { path: input, mtimeMs: stat.mtimeMs };
    }
  }
  return newest;
}

function shimInputs() {
  return [
    cargoToml,
    path.join(tauriDir, "Cargo.lock"),
    path.join(tauriDir, "build.rs"),
    ...rustSources(path.join(tauriDir, "src")),
  ].filter((input) => fs.existsSync(input));
}

function rustSources(dir) {
  const entries = fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true })
    : [];
  return entries.flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return rustSources(entryPath);
    }
    return entry.isFile() && entry.name.endsWith(".rs") ? [entryPath] : [];
  });
}

function installBuiltShim() {
  fs.mkdirSync(sidecarDir, { recursive: true });
  fs.copyFileSync(builtShimPath, sidecarPath);
  createdBootstrapSidecar = false;
  if (process.platform !== "win32") {
    fs.chmodSync(sidecarPath, 0o755);
  }
}

function ensureBootstrapSidecarForCargoBuild() {
  if (fs.existsSync(sidecarPath)) {
    return;
  }

  fs.mkdirSync(sidecarDir, { recursive: true });
  fs.writeFileSync(
    sidecarPath,
    "bootstrap placeholder replaced by scripts/prepare-launch-shim-sidecar.mjs\n",
  );
  createdBootstrapSidecar = true;
}

function assertTauriConfig() {
  const config = JSON.parse(fs.readFileSync(tauriConfigPath, "utf8"));
  const externalBins = config.bundle?.externalBin ?? [];
  if (!externalBins.includes(externalBinName)) {
    fail(`tauri.conf.json bundle.externalBin must include "${externalBinName}"`);
  }

  const installerHooks = config.bundle?.windows?.nsis?.installerHooks;
  if (installerHooks !== nsisHookPath) {
    fail(`tauri.conf.json bundle.windows.nsis.installerHooks must be "${nsisHookPath}"`);
  }
}

function assertSidecarReady() {
  if (!fs.existsSync(sidecarPath)) {
    fail(`Tauri externalBin sidecar not found: ${relative(sidecarPath)}`);
  }

  if (isBootstrapSidecar(sidecarPath)) {
    fail(`Tauri externalBin sidecar is still a bootstrap placeholder: ${relative(sidecarPath)}`);
  }

  if (!artifactIsFresh(sidecarPath)) {
    fail(`Tauri externalBin sidecar is stale: ${relative(sidecarPath)}`);
  }

  if (!fs.existsSync(builtShimPath)) {
    return;
  }
  if (!artifactIsFresh(builtShimPath)) {
    return;
  }

  const builtStat = fs.statSync(builtShimPath);
  const sidecarStat = fs.statSync(sidecarPath);
  if (builtStat.size !== sidecarStat.size) {
    fail(
      `Sidecar size mismatch: built=${builtStat.size} sidecar=${sidecarStat.size}`,
    );
  }

  const builtHash = sha256(builtShimPath);
  const sidecarHash = sha256(sidecarPath);
  if (builtHash !== sidecarHash) {
    fail(`Sidecar hash mismatch: built=${builtHash} sidecar=${sidecarHash}`);
  }
}

function sameFileContent(left, right) {
  if (!fs.existsSync(left) || !fs.existsSync(right)) {
    return false;
  }
  const leftStat = fs.statSync(left);
  const rightStat = fs.statSync(right);
  return leftStat.size === rightStat.size && sha256(left) === sha256(right);
}

function isBootstrapSidecar(filePath) {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  const bootstrapText = "bootstrap placeholder replaced by scripts/prepare-launch-shim-sidecar.mjs";
  const stat = fs.statSync(filePath);
  if (stat.size > Buffer.byteLength(bootstrapText) + 2) {
    return false;
  }
  return fs.readFileSync(filePath, "utf8").includes(bootstrapText);
}

function verifyInstalledDirIfRequested() {
  const installedDir = readOption("--installed-dir");
  if (!installedDir) {
    return;
  }

  const installedMain = path.join(installedDir, `kerminal${extension}`);
  const installedShim = path.join(installedDir, `${binName}${extension}`);
  if (!fs.existsSync(installedMain)) {
    fail(`Installed Kerminal executable not found: ${installedMain}`);
  }
  if (!fs.existsSync(installedShim)) {
    fail(`Installed launch shim not found: ${installedShim}`);
  }

  const installedHash = sha256(installedShim);
  const sidecarHash = sha256(sidecarPath);
  if (installedHash !== sidecarHash) {
    fail(`Installed shim hash mismatch: installed=${installedHash} sidecar=${sidecarHash}`);
  }
}

function hostTriple() {
  const direct = spawnSync("rustc", ["--print", "host-tuple"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (direct.status === 0 && direct.stdout.trim()) {
    return direct.stdout.trim();
  }

  const verbose = spawnSync("rustc", ["-Vv"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (verbose.status === 0) {
    const hostLine = verbose.stdout
      .split(/\r?\n/)
      .find((line) => line.startsWith("host:"));
    if (hostLine) {
      return hostLine.replace("host:", "").trim();
    }
  }

  fail("Failed to determine Rust host target triple");
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    fail(`${command} ${commandArgs.join(" ")} failed`);
  }
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return "";
  }
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    fail(`${name} requires a value`);
  }
  return value;
}

function relative(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, "/");
}

function fail(message) {
  if (createdBootstrapSidecar) {
    fs.rmSync(sidecarPath, { force: true });
  }
  console.error(message);
  process.exit(1);
}
