#!/usr/bin/env node
// @author kongweiguang

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  readOption("--repo-root") || fileURLToPath(new URL("..", import.meta.url)),
);
const bundleDir = readOption("--bundle-dir");
const requireUpdaterSignature = process.argv.includes("--require-updater-signature");
const requireArchiveInspection = process.argv.includes("--require-archive-inspection");

main();

// 无 bundle 参数时执行可跨平台的发布前检查；CI 产包后再验证真实 NSIS 内容。
function main() {
  runContractVerifier();
  const sidecarPath = configuredWindowsSidecar();
  assertPortableExecutable(sidecarPath, "launch shim sidecar");

  const report = {
    sidecar: relative(sidecarPath),
    sidecarSha256: sha256(sidecarPath),
  };
  if (bundleDir) {
    Object.assign(report, verifyNsisBundle(path.resolve(repoRoot, bundleDir)));
  }
  console.log(`External launch Windows package verified.\n${JSON.stringify(report, null, 2)}`);
}

function runContractVerifier() {
  const verifier = path.join(repoRoot, "scripts", "verify-launch-shim-package-contract.mjs");
  const result = spawnSync(process.execPath, [verifier, "--repo-root", repoRoot], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    fail(`${result.stdout ?? ""}${result.stderr ?? ""}`.trim());
  }
}

function configuredWindowsSidecar() {
  const binaries = path.join(repoRoot, "src-tauri", "binaries");
  const candidates = fs
    .readdirSync(binaries)
    .filter((name) => /^kerminal-launch-shim-sidecar-.*windows.*\.exe$/i.test(name));
  if (candidates.length !== 1) {
    fail(`expected exactly one tracked Windows launch shim sidecar, got ${candidates.length}`);
  }
  return path.join(binaries, candidates[0]);
}

function verifyNsisBundle(directory) {
  if (!fs.existsSync(directory)) {
    fail(`NSIS bundle directory does not exist: ${directory}`);
  }
  const installers = walkFiles(directory).filter(
    (file) => file.toLowerCase().endsWith("-setup.exe") || file.toLowerCase().endsWith("_setup.exe"),
  );
  if (installers.length !== 1) {
    fail(`expected exactly one NSIS installer, got ${installers.length}`);
  }
  const installer = installers[0];
  assertPortableExecutable(installer, "NSIS installer");
  if (fs.statSync(installer).size < 1024 * 1024) {
    fail("NSIS installer is unexpectedly small");
  }

  const listing = listArchive(installer);
  const inspectionMode = listing
    ? verifyArchiveListing(listing)
    : verifyGeneratedNsisScript(installer);
  const signature = `${installer}.sig`;
  if (requireUpdaterSignature && (!fs.existsSync(signature) || fs.statSync(signature).size === 0)) {
    fail("NSIS updater signature is missing or empty");
  }
  return {
    installer: relative(installer),
    installerSha256: sha256(installer),
    updaterSignature: fs.existsSync(signature) ? relative(signature) : null,
    inspectionMode,
  };
}

function listArchive(installer) {
  const executable = readOption("--seven-zip") || "7z";
  const result = spawnSync(executable, ["l", "-slt", installer], { encoding: "utf8" });
  if (result.error?.code === "ENOENT" && !requireArchiveInspection) {
    return null;
  }
  if (result.error || result.status !== 0) {
    fail(`7-Zip could not inspect the NSIS installer: ${result.error?.message ?? result.stderr}`);
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function verifyArchiveListing(listing) {
  for (const file of [
    "kerminal-launch-shim-sidecar.exe",
    "kerminal-launch-shim.exe",
  ]) {
    if (!listing.toLowerCase().includes(file.toLowerCase())) {
      fail(`NSIS installer does not contain ${file}`);
    }
  }
  return "archive";
}

// 本地环境没有 7-Zip 时只验证 Tauri 刚生成并用于该安装包的 NSIS 输入；发布 CI 禁止此降级。
function verifyGeneratedNsisScript(installer) {
  const configured = readOption("--generated-nsis-script");
  const script = path.resolve(
    repoRoot,
    configured || path.join("src-tauri", "target", "release", "nsis", "x64", "installer.nsi"),
  );
  if (!fs.existsSync(script)) {
    fail(`generated NSIS script does not exist: ${script}`);
  }
  if (fs.statSync(installer).mtimeMs < fs.statSync(script).mtimeMs) {
    fail("NSIS installer is older than the generated installer script");
  }
  const source = fs.readFileSync(script, "utf8");
  for (const file of [
    "kerminal-launch-shim-sidecar.exe",
    "kerminal-launch-shim.exe",
  ]) {
    const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`File\\s+/a\\s+[^\\r\\n]*${escaped}`, "i").test(source)) {
      fail(`generated NSIS script does not package ${file}`);
    }
  }
  return "generated-nsis-script";
}

function assertPortableExecutable(file, label) {
  if (!fs.existsSync(file)) {
    fail(`${label} does not exist: ${file}`);
  }
  const descriptor = fs.openSync(file, "r");
  try {
    const magic = Buffer.alloc(2);
    fs.readSync(descriptor, magic, 0, magic.length, 0);
    if (magic.toString("ascii") !== "MZ") {
      fail(`${label} is not a Windows PE executable`);
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

function walkFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(target) : entry.isFile() ? [target] : [];
  });
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function relative(file) {
  return path.relative(repoRoot, file).replaceAll("\\", "/");
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return "";
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) fail(`${name} requires a value`);
  return value;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
