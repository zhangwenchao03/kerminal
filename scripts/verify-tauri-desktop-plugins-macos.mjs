#!/usr/bin/env node
/**
 * macOS validation helper for the Tauri desktop plugin hardening lane.
 *
 * @author kongweiguang
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { platform } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutputDir = path.join(repoRoot, ".updeng", "docs", "verification");
const args = parseArgs(process.argv.slice(2));
const outputDir = path.resolve(repoRoot, args.outputDir ?? defaultOutputDir);
const outputJson = path.join(
  outputDir,
  "tauri-desktop-plugin-macos-validation-automated.json",
);
const outputMarkdown = path.join(
  outputDir,
  "tauri-desktop-plugin-macos-validation-round-log.md",
);
const configRoot =
  args.configRoot ??
  process.env.KERMINAL_CONFIG_ROOT ??
  path.join(repoRoot, ".updeng", "tmp", "tauri-plugin-macos-root");
const cargoTargetDir =
  args.cargoTargetDir ??
  process.env.CARGO_TARGET_DIR ??
  path.join(repoRoot, "src-tauri", "target-codex-tauri-plugin-macos");
const currentPlatform = platform();
const dryRun = args.dryRun;

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  goal:
    "Validate Tauri window-state, single-instance, notification, log, and clipboard behavior on macOS.",
  platform: currentPlatform,
  dryRun,
  paths: {
    cargoTargetDir: sanitizePath(cargoTargetDir),
    configRoot: sanitizePath(configRoot),
    outputJson: sanitizePath(outputJson),
    outputMarkdown: sanitizePath(outputMarkdown),
  },
  commands: [],
  manualChecklist: buildManualChecklist(),
};

if (args.help) {
  printUsage();
  process.exit(0);
}

if (currentPlatform !== "darwin" && !dryRun && !args.allowNonMacos) {
  console.error(
    "This helper is intended for macOS validation. Re-run with --dry-run to inspect commands on this platform.",
  );
  process.exit(2);
}

await main();

async function main() {
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(configRoot, { recursive: true });

  const commandPlan = buildCommandPlan();
  if (dryRun) {
    report.commands = commandPlan.map((command) => ({
      ...commandForReport(command),
      skipped: true,
      status: "dry-run",
    }));
    report.summary = {
      automatedPass: true,
      manualRequired: true,
      status: "dry-run",
    };
  } else {
    report.commands = [];
    for (const command of commandPlan) {
      const result = await runCommand(command);
      report.commands.push(result);
      if (result.exitCode !== 0 && !command.optional) {
        report.summary = {
          automatedPass: false,
          failedCommand: command.name,
          manualRequired: true,
          status: "failed",
        };
        writeReports();
        process.exitCode = 1;
        return;
      }
    }
    report.summary = {
      automatedPass: report.commands.every(
        (command) => command.optional || command.exitCode === 0,
      ),
      manualRequired: true,
      status: "automated-complete",
    };
  }

  writeReports();
  printSummary();
}

function buildCommandPlan() {
  const env = {
    ...process.env,
    CARGO_TARGET_DIR: cargoTargetDir,
    KERMINAL_CONFIG_ROOT: configRoot,
  };
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  return [
    shellCommand("macOS version", "sw_vers", [], { env, optional: currentPlatform !== "darwin" }),
    shellCommand("kernel version", "uname", ["-a"], { env }),
    shellCommand("node version", process.execPath, ["--version"], { env }),
    shellCommand("npm version", npmCommand, ["--version"], { env }),
    shellCommand("rustc version", "rustc", ["--version"], { env }),
    shellCommand("cargo version", "cargo", ["--version"], { env }),
    shellCommand("xcode-select path", "xcode-select", ["-p"], {
      env,
      optional: currentPlatform !== "darwin",
    }),
    shellCommand(
      "frontend desktop plugin tests",
      npmCommand,
      [
        "run",
        "test:frontend",
        "--",
        "src/lib/desktopClipboardApi.test.ts",
        "src/lib/desktopNotificationPolicy.test.ts",
        "src/lib/desktopNotificationApi.test.ts",
        "src/lib/appLog.test.ts",
      ],
      { env },
    ),
    shellCommand(
      "tauri security config tests",
      "cargo",
      [
        "test",
        "--manifest-path",
        "src-tauri/Cargo.toml",
        "--target-dir",
        cargoTargetDir,
        "--test",
        "tauri_security_config",
      ],
      { env },
    ),
    shellCommand(
      "sftp system file clipboard platform tests",
      "cargo",
      [
        "test",
        "--manifest-path",
        "src-tauri/Cargo.toml",
        "--target-dir",
        cargoTargetDir,
        "--test",
        "sftp_service",
        "system_file_clipboard",
        "--",
        "--nocapture",
      ],
      { env },
    ),
    shellCommand("frontend production build", npmCommand, ["run", "build"], { env }),
    ...(args.tauriBuild
      ? [
          shellCommand("tauri build", npmCommand, ["run", "tauri:build"], {
            env,
            optional: true,
          }),
        ]
      : []),
  ];
}

function shellCommand(name, command, commandArgs, options = {}) {
  return {
    args: commandArgs,
    command,
    env: options.env ?? process.env,
    name,
    optional: Boolean(options.optional),
  };
}

function runCommand(command) {
  const startedAt = new Date();
  console.log(`\n> ${command.name}`);
  console.log(formatCommand(command));
  return new Promise((resolve) => {
    const child = spawn(command.command, command.args, {
      cwd: repoRoot,
      env: command.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      process.stderr.write(text);
    });
    child.on("error", (error) => {
      resolve({
        ...commandForReport(command),
        durationMs: Date.now() - startedAt.getTime(),
        error: sanitizeText(error.message),
        exitCode: 127,
        startedAt: startedAt.toISOString(),
        status: command.optional ? "optional-error" : "error",
      });
    });
    child.on("exit", (exitCode, signal) => {
      resolve({
        ...commandForReport(command),
        durationMs: Date.now() - startedAt.getTime(),
        exitCode,
        signal,
        startedAt: startedAt.toISOString(),
        status: exitCode === 0 ? "passed" : command.optional ? "optional-failed" : "failed",
        stderrTail: tailForReport(stderr),
        stdoutTail: tailForReport(stdout),
      });
    });
  });
}

function commandForReport(command) {
  return {
    args: command.args.map((arg) => sanitizePath(String(arg))),
    command: sanitizePath(command.command),
    name: command.name,
    optional: command.optional,
  };
}

function writeReports() {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(outputJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(outputMarkdown, buildRoundLogTemplate(report), "utf8");
}

function printSummary() {
  console.log("\nmacOS desktop plugin validation helper complete.");
  console.log(`JSON report: ${sanitizePath(outputJson)}`);
  console.log(`Round Log template: ${sanitizePath(outputMarkdown)}`);
  if (report.summary?.manualRequired) {
    console.log("Manual tauri:dev checks are still required; see the markdown template.");
  }
}

function buildRoundLogTemplate(result) {
  const isDryRun = result.dryRun || result.summary?.status === "dry-run";
  const heading = isDryRun
    ? `- ${new Date().toISOString()}：macOS Tauri desktop plugin validation dry-run only; macOS acceptance not executed.\n`
    : `- ${new Date().toISOString()}：macOS Tauri desktop plugin validation <passed|blocked|failed>。\n`;
  const scopeLine = isDryRun
    ? "  - 范围：本地 dry-run 只验证命令计划与报告生成，所有命令均未执行。\n"
    : "";
  const conclusionLine = isDryRun
    ? "  - 结论：dry-run 不证明 macOS 真实运行验收；按当前目标口径，它只作为 CI/runbook 证据，不阻塞计划 done。\n"
    : "  - 结论：<macOS 自动化与人工验收是否通过；是否存在发布前残余风险>。\n";
  const commandSummary = result.commands
    .map(
      (command) =>
        `    - ${command.name}: ${command.status}${
          typeof command.exitCode === "number" ? ` (exit ${command.exitCode})` : ""
        }`,
    )
    .join("\n");
  return heading +
    `  - 环境：platform=${result.platform}；详见 \`${relativePath(outputJson)}\`。\n` +
    scopeLine +
    `  - 自动化：\n${commandSummary}\n` +
    "  - 启动：<运行 `KERMINAL_CONFIG_ROOT=... CARGO_TARGET_DIR=... npm run tauri:dev`，记录窗口截图/日志路径>。\n" +
    "  - single-instance：<主窗口打开/最小化/关闭到 Dock 或 tray 后二次启动结果>。\n" +
    "  - window-state：<size/position/maximized/显示器变化恢复结果>。\n" +
    "  - notification：<granted/denied/真实事件结果>。\n" +
    "  - log：<日志目录、脱敏 grep 结果、诊断包是否只含元数据>。\n" +
    "  - clipboard：<official clipboard-manager token 写读结果、终端/tmux/SFTP UI 复制结果>。\n" +
    "  - SFTP：<内部 clipboard、Finder 拖放、Finder 文件列表系统剪贴板降级结果>。\n" +
    "  - tauri:build：<通过或阻塞原因>。\n" +
    conclusionLine;
}

function buildManualChecklist() {
  return [
    "Run real `npm run tauri:dev` with the reported KERMINAL_CONFIG_ROOT and CARGO_TARGET_DIR.",
    "Verify single-instance focus for open, minimized, and closed-window-but-running states.",
    "Verify window-state restores size, position, and maximized state.",
    "Verify notification granted and denied behavior without startup permission spam.",
    "Verify Kerminal-managed logs are generated and secret grep does not expose credentials.",
    "Verify official clipboard-manager text write/read and UI copy paths.",
    "Verify SFTP internal clipboard, Finder drag/drop, and Finder file-list pasteboard degradation.",
    "Optionally run `npm run tauri:build` or record signing/notarization blockers.",
  ];
}

function parseArgs(rawArgs) {
  const parsed = {
    allowNonMacos: false,
    cargoTargetDir: null,
    configRoot: null,
    dryRun: false,
    help: false,
    outputDir: null,
    tauriBuild: false,
  };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    switch (arg) {
      case "--allow-non-macos":
        parsed.allowNonMacos = true;
        break;
      case "--cargo-target-dir":
        parsed.cargoTargetDir = requireValue(rawArgs, ++index, arg);
        break;
      case "--config-root":
        parsed.configRoot = requireValue(rawArgs, ++index, arg);
        break;
      case "--dry-run":
        parsed.dryRun = true;
        break;
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      case "--output-dir":
        parsed.outputDir = requireValue(rawArgs, ++index, arg);
        break;
      case "--tauri-build":
        parsed.tauriBuild = true;
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        printUsage();
        process.exit(1);
    }
  }
  return parsed;
}

function requireValue(rawArgs, index, flag) {
  const value = rawArgs[index];
  if (!value) {
    console.error(`Missing value for ${flag}`);
    process.exit(1);
  }
  return value;
}

function printUsage() {
  console.log(`Usage: node scripts/verify-tauri-desktop-plugins-macos.mjs [options]\n\n` +
    "Options:\n" +
    "  --dry-run                 Print/write the command plan without executing it.\n" +
    "  --output-dir <path>        Directory for JSON and Round Log template outputs.\n" +
    "  --config-root <path>       Isolated Kerminal config root for validation.\n" +
    "  --cargo-target-dir <path>  Isolated Cargo target directory for validation.\n" +
    "  --tauri-build             Also run npm run tauri:build as an optional command.\n" +
    "  --allow-non-macos         Execute automated checks even when not on macOS.\n" +
    "  --help                    Show this help.\n");
}

function tailForReport(text) {
  return sanitizeText(text).split(/\r?\n/).slice(-80).join("\n").trim();
}

function sanitizeText(text) {
  return [
    [repoRoot, "<repo>"],
    [repoRoot.replaceAll("\\", "/"), "<repo>"],
    [process.env.HOME, "~"],
    [process.env.USERPROFILE, "~"],
  ].reduce((current, [from, to]) => {
    if (!from) {
      return current;
    }
    return current.replaceAll(from, to);
  }, text);
}

function sanitizePath(value) {
  return sanitizeText(value).replaceAll("\\", "/");
}

function relativePath(value) {
  return path.relative(repoRoot, value).replaceAll("\\", "/");
}

function formatCommand(command) {
  return [command.command, ...command.args].map(quoteArg).join(" ");
}

function quoteArg(value) {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}
