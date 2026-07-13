#!/usr/bin/env node
// @author kongweiguang

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRepoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = path.resolve(readOption("--repo-root") || defaultRepoRoot);
const externalBin = "binaries/kerminal-launch-shim-sidecar";
const hookPath = "../scripts/kerminal-launch-shim-nsis-hooks.nsh";
const packageManager = "pnpm@10.33.0";
const prepareCommand = "node scripts/prepare-launch-shim-sidecar.mjs";
const verifyCommand =
  "node scripts/verify-launch-shim-package-contract.mjs && node scripts/prepare-launch-shim-sidecar.mjs --verify --no-build";
const friendlyShim = "$INSTDIR\\kerminal-launch-shim.exe";
const sidecarShim = "$INSTDIR\\kerminal-launch-shim-sidecar.exe";
const deepLinkRegistryKey = "Software\\Classes\\kerminal";

main();

// 同时校验构建入口与安装生命周期，避免 sidecar 只存在于源码而未进入发布包。
function main() {
  const packageJson = readJson("package.json");
  const config = readJson("src-tauri/tauri.conf.json");
  const hook = readText("scripts/kerminal-launch-shim-nsis-hooks.nsh");
  const cargoToml = readText("src-tauri/Cargo.toml");
  const desktopPlugins = readText("src-tauri/src/desktop_plugins.rs");
  const libSource = readText("src-tauri/src/lib.rs");
  const commandRegistry = readText("src-tauri/src/commands/registry.rs");
  const releaseWorkflow = readText(".github/workflows/release.yml");
  const prepareScript = readText("scripts/prepare-launch-shim-sidecar.mjs");

  assertBuildContract(packageJson, config);
  assertInstallerContract(config, hook);
  assertDeepLinkContract(
    config,
    cargoToml,
    desktopPlugins,
    libSource,
    commandRegistry,
    hook,
  );
  assertAutomationContract(packageJson, releaseWorkflow);
  assertContains(
    prepareScript,
    "process.env.TAURI_ENV_TARGET_TRIPLE",
    "sidecar prepare script must honor the Tauri cross-build target",
  );
  console.log("Launch shim package contract verified.");
}

function assertAutomationContract(packageJson, releaseWorkflow) {
  assertEqual(
    packageJson.packageManager,
    packageManager,
    `package.json packageManager must be pinned to ${packageManager}`,
  );
  assertPathExists(
    "pnpm-lock.yaml",
    "repository must include pnpm-lock.yaml for reproducible installs",
  );
  assertPathMissing(
    "package-lock.json",
    "repository must not include package-lock.json after migrating to pnpm",
  );
  for (const script of [
    "verify:external-launch-security",
    "verify:external-launch-responsiveness",
    "verify:external-launch-windows-package",
  ]) {
    if (typeof packageJson.scripts?.[script] !== "string") {
      fail(`package.json must define ${script}`);
    }
  }
  for (const command of [
    "pnpm run verify:external-launch-security",
    "pnpm run verify:external-launch-responsiveness",
    "pnpm run verify:external-launch-windows-package",
  ]) {
    assertContains(
      releaseWorkflow,
      command,
      `release workflow must run ${command}`,
    );
  }
  for (const releaseContract of [
    "pnpm/action-setup@v4",
    "version: 10.33.0",
    "cache: pnpm",
    "cache-dependency-path: pnpm-lock.yaml",
    "pnpm install --frozen-lockfile",
  ]) {
    assertContains(
      releaseWorkflow,
      releaseContract,
      `release workflow must include ${releaseContract}`,
    );
  }
  assertContains(
    releaseWorkflow,
    "--require-updater-signature",
    "release workflow must require the NSIS updater signature",
  );
  assertContains(
    releaseWorkflow,
    "--require-archive-inspection",
    "release workflow must require inspection of the real NSIS archive",
  );
}

function assertDeepLinkContract(
  config,
  cargoToml,
  desktopPlugins,
  libSource,
  commandRegistry,
  hook,
) {
  const desktopSchemes = config.plugins?.["deep-link"]?.desktop;
  if (!Array.isArray(desktopSchemes) || desktopSchemes.length !== 0) {
    fail(
      "tauri.conf.json plugins.deep-link.desktop must stay empty so kerminal:// remains opt-in",
    );
  }
  assertContains(
    cargoToml,
    'tauri-plugin-deep-link = "2.4.9"',
    "Cargo.toml must pin the official deep-link plugin",
  );
  assertContains(
    desktopPlugins,
    ".plugin(tauri_plugin_deep_link::init())",
    "desktop plugin setup must initialize the official deep-link plugin",
  );
  assertContains(
    libSource,
    ".on_open_url(",
    "desktop setup must route on_open_url into the external intake",
  );
  for (const command of [
    "external_launch_deep_link_status",
    "external_launch_deep_link_register",
    "external_launch_deep_link_unregister",
  ]) {
    assertContains(
      commandRegistry,
      command,
      `command registry must expose ${command}`,
    );
  }

  for (const macroName of [
    "NSIS_HOOK_PREUNINSTALL",
    "NSIS_HOOK_POSTUNINSTALL",
  ]) {
    const body = macroBody(hook, macroName);
    assertContains(
      body,
      `ReadRegStr $0 HKCU "${deepLinkRegistryKey}\\shell\\open\\command" ""`,
      `${macroName} must inspect protocol ownership before cleanup`,
    );
    assertContains(
      body,
      `DeleteRegKey HKCU "${deepLinkRegistryKey}"`,
      `${macroName} must clean the Kerminal-owned protocol`,
    );
    const comparisonIndex = body.indexOf("StrCmp $0");
    const deletionIndex = body.indexOf(`DeleteRegKey HKCU "${deepLinkRegistryKey}"`);
    if (comparisonIndex === -1 || deletionIndex <= comparisonIndex) {
      fail(`${macroName} must ownership-gate protocol deletion`);
    }
  }
}

function assertBuildContract(packageJson, config) {
  assertEqual(
    packageJson.scripts?.["prepare:launch-shim-sidecar"],
    prepareCommand,
    "package.json prepare:launch-shim-sidecar must use the canonical prepare script",
  );
  assertEqual(
    packageJson.scripts?.["verify:launch-shim-sidecar"],
    verifyCommand,
    "package.json verify:launch-shim-sidecar must verify the package contract and sidecar artifact",
  );
  assertEqual(
    config.build?.beforeDevCommand,
    "pnpm run dev",
    "tauri.conf.json build.beforeDevCommand must use pnpm",
  );

  const beforeBuild = config.build?.beforeBuildCommand;
  if (typeof beforeBuild !== "string") {
    fail("tauri.conf.json build.beforeBuildCommand must be a command string");
  }
  const steps = beforeBuild.split("&&").map((step) => step.trim());
  const frontendBuildIndex = steps.indexOf("pnpm run build");
  const prepareIndex = steps.indexOf("pnpm run prepare:launch-shim-sidecar");
  if (frontendBuildIndex === -1 || prepareIndex <= frontendBuildIndex) {
    fail(
      "tauri.conf.json build.beforeBuildCommand must build the frontend, then prepare the launch shim sidecar",
    );
  }

  const externalBins = config.bundle?.externalBin;
  if (!Array.isArray(externalBins) || !externalBins.includes(externalBin)) {
    fail(`tauri.conf.json bundle.externalBin must include "${externalBin}"`);
  }
}

function assertInstallerContract(config, hook) {
  assertEqual(
    config.bundle?.windows?.nsis?.installerHooks,
    hookPath,
    `tauri.conf.json bundle.windows.nsis.installerHooks must be "${hookPath}"`,
  );

  const preinstall = macroBody(hook, "NSIS_HOOK_PREINSTALL");
  assertDeletes(preinstall, "NSIS_HOOK_PREINSTALL", friendlyShim, sidecarShim);

  const postinstall = macroBody(hook, "NSIS_HOOK_POSTINSTALL");
  assertContains(
    postinstall,
    `IfFileExists "${sidecarShim}"`,
    "NSIS_HOOK_POSTINSTALL must reject a missing bundled sidecar",
  );
  assertContains(
    postinstall,
    "ClearErrors",
    "NSIS_HOOK_POSTINSTALL must clear stale NSIS errors before copying",
  );
  assertContains(
    postinstall,
    `CopyFiles /SILENT "${sidecarShim}" "${friendlyShim}"`,
    "NSIS_HOOK_POSTINSTALL must install the stable launch shim name",
  );
  assertContains(
    postinstall,
    "IfErrors",
    "NSIS_HOOK_POSTINSTALL must check copy errors",
  );
  assertContains(
    postinstall,
    `IfFileExists "${friendlyShim}"`,
    "NSIS_HOOK_POSTINSTALL must verify the installed shim",
  );
  if (countCommands(postinstall, "Abort") < 3) {
    fail(
      "NSIS_HOOK_POSTINSTALL must Abort for missing source, copy failure, and missing destination",
    );
  }

  const preuninstall = macroBody(hook, "NSIS_HOOK_PREUNINSTALL");
  assertDeletes(preuninstall, "NSIS_HOOK_PREUNINSTALL", friendlyShim, sidecarShim);
  const postuninstall = macroBody(hook, "NSIS_HOOK_POSTUNINSTALL");
  assertDeletes(postuninstall, "NSIS_HOOK_POSTUNINSTALL", friendlyShim, sidecarShim);
}

function assertDeletes(body, macroName, ...files) {
  for (const file of files) {
    assertContains(
      body,
      `Delete /REBOOTOK "${file}"`,
      `${macroName} must clean ${file}`,
    );
  }
}

function macroBody(source, macroName) {
  const match = source.match(
    new RegExp(`!macro\\s+${macroName}\\s*([\\s\\S]*?)!macroend`),
  );
  if (!match) {
    fail(`NSIS hook must define ${macroName}`);
  }
  return match[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith(";"))
    .join("\n");
}

function countCommands(body, command) {
  return body
    .split("\n")
    .filter((line) => line === command || line.startsWith(`${command} `)).length;
}

function assertContains(actual, expected, message) {
  if (!actual.includes(expected)) {
    fail(message);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    fail(`${message}; got ${JSON.stringify(actual)}`);
  }
}

function assertPathExists(relativePath, message) {
  if (!fs.existsSync(path.join(repoRoot, relativePath))) {
    fail(message);
  }
}

function assertPathMissing(relativePath, message) {
  if (fs.existsSync(path.join(repoRoot, relativePath))) {
    fail(message);
  }
}

function readJson(relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`Failed to read ${relativePath}: ${error.message}`);
  }
}

function readText(relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    fail(`Failed to read ${relativePath}: ${error.message}`);
  }
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

function fail(message) {
  console.error(message);
  process.exit(1);
}
