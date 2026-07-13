#!/usr/bin/env node
/**
 * Managed SSH automated verification matrix.
 *
 * This runner groups the existing loopback, Rust, frontend, and build checks
 * that prove the non-HITL part of the managed SSH default path. It never
 * accepts or prints SSH secrets; real-target evidence remains covered by
 * verify-managed-ssh-hitl.mjs.
 *
 * @author kongweiguang
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDir, "..");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const cargoTargetDir = path.join(
  workspaceRoot,
  ".updeng",
  "tmp",
  "cargo-target-managed-ssh-auto-matrix",
);

const args = process.argv.slice(2);
const includeReadiness = args.includes("--include-readiness");
const includeFocused = args.includes("--include-focused");

const defaultMatrix = [
  {
    id: "loopback-password-terminal",
    command: "cargo",
    args: [
      "test",
      "--manifest-path",
      "Cargo.toml",
      "--test",
      "ssh_terminal_password_smoke",
      "local_russh_loopback",
      "--",
      "--nocapture",
    ],
    cwd: path.join(workspaceRoot, "src-tauri"),
    env: { CARGO_TARGET_DIR: cargoTargetDir },
    description: "Loopback SSH terminal password smoke.",
  },
  rustTest("ssh_terminal_service", "Managed SSH terminal service regressions."),
  rustTest("sftp_service", "Managed SFTP subsystem, transfer, and auth regressions."),
  rustTest("ssh_runtime", "Managed SSH session/channel runtime regressions."),
  rustTest("ssh_command_service", "Managed exec facade regressions."),
  rustTest("tmux_service", "tmux managed exec downstream smoke."),
  rustTest("port_forward_service", "Managed forwarding regressions."),
  rustTest("docker_host_service", "Container managed exec and transfer regressions."),
  rustTest("mcp_tool_executor_service", "MCP managed SSH/runtime tool regressions."),
  {
    id: "frontend-managed-ssh",
    command: pnpmCommand,
    args: [
      "run",
      "test",
      "--",
      "--run",
      "tests/frontend/lib/sshAuthApi.test.ts",
      "tests/frontend/features/ssh-auth",
      "tests/frontend/features/terminal/XtermPane.test.tsx",
      "tests/frontend/lib/diagnosticsApi.test.ts",
      "tests/frontend/features/terminal/terminalRuntimeDiagnostics.test.ts",
      "tests/frontend/features/tool-panel/managedSshToolAvailabilityModel.test.ts",
    ],
    cwd: workspaceRoot,
    description: "Frontend auth prompt, diagnostics, xterm prompt, and availability model.",
  },
  {
    id: "frontend-build",
    command: pnpmCommand,
    args: ["run", "build"],
    cwd: workspaceRoot,
    description: "Production frontend build.",
  },
];

const readinessMatrix = [
  {
    id: "readiness-hitl-preflight",
    command: pnpmCommand,
    args: ["run", "verify:managed-ssh-hitl", "--", "--preflight"],
    cwd: workspaceRoot,
    description:
      "HITL readiness preflight for local tools and verification templates.",
  },
  {
    id: "readiness-agent-cli-no-submit",
    command: "cargo",
    args: [
      "test",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--test",
      "terminal_agent_cli_hitl_matrix",
      "-j",
      "1",
      "--",
      "--nocapture",
    ],
    cwd: workspaceRoot,
    env: {
      CARGO_TARGET_DIR: cargoTargetDir,
      KERMINAL_AGENT_CLI_HITL: "1",
      KERMINAL_AGENT_CLI_HITL_ALLOW_SUBMIT: "",
    },
    description:
      "Real Codex/Claude CLI no-submit terminal preflight; does not submit a model prompt.",
  },
];

const focusedMatrix = [
  {
    id: "focused-bulk-transfer-isolation-runtime",
    command: "cargo",
    args: [
      "test",
      "--manifest-path",
      "Cargo.toml",
      "--test",
      "ssh_runtime",
      "bulk_transfer_lane_uses_separate_session_without_reprompt_contract",
      "-j",
      "1",
      "--",
      "--exact",
      "--nocapture",
    ],
    cwd: path.join(workspaceRoot, "src-tauri"),
    env: { CARGO_TARGET_DIR: cargoTargetDir },
    description:
      "Focused runtime contract: bulk SFTP transfer uses a latency-isolated managed SSH transport while sharing auth identity.",
    expectOutput: [
      {
        label: "cargo ran exactly one selected test",
        pattern: /running 1 test\b/,
      },
      {
        label: "target runtime bulk-transfer test passed",
        pattern:
          /test bulk_transfer_lane_uses_separate_session_without_reprompt_contract \.\.\. ok/,
      },
    ],
  },
  {
    id: "focused-bulk-transfer-isolation-sftp",
    command: "cargo",
    args: [
      "test",
      "--manifest-path",
      "Cargo.toml",
      "--test",
      "sftp_service",
      "managed_runtime::sftp_operations_use_real_managed_sftp_channel_without_second_ssh_connection",
      "-j",
      "1",
      "--",
      "--exact",
      "--nocapture",
    ],
    cwd: path.join(workspaceRoot, "src-tauri"),
    env: { CARGO_TARGET_DIR: cargoTargetDir },
    description:
      "Focused SFTP contract: interactive browse reuses the terminal-authenticated transport and file transfer uses the bulk-transfer lane.",
    expectOutput: [
      {
        label: "cargo ran exactly one selected test",
        pattern: /running 1 test\b/,
      },
      {
        label: "target SFTP bulk-transfer test passed",
        pattern:
          /test managed_runtime::sftp_operations_use_real_managed_sftp_channel_without_second_ssh_connection \.\.\. ok/,
      },
    ],
  },
  {
    id: "focused-bulk-transfer-shell-input-isolation",
    command: "cargo",
    args: [
      "test",
      "--manifest-path",
      "Cargo.toml",
      "--test",
      "ssh_runtime",
      "bulk_transfer_lane_does_not_block_interactive_shell_input_contract",
      "-j",
      "1",
      "--",
      "--exact",
      "--nocapture",
    ],
    cwd: path.join(workspaceRoot, "src-tauri"),
    env: { CARGO_TARGET_DIR: cargoTargetDir },
    description:
      "Focused runtime contract: terminal shell input remains writable while a bulk SFTP transfer lane is active.",
    expectOutput: [
      {
        label: "cargo ran exactly one selected test",
        pattern: /running 1 test\b/,
      },
      {
        label: "target shell-input isolation test passed",
        pattern:
          /test bulk_transfer_lane_does_not_block_interactive_shell_input_contract \.\.\. ok/,
      },
    ],
  },
];

const matrix = includeReadiness
  ? [...defaultMatrix, ...readinessMatrix, ...(includeFocused ? focusedMatrix : [])]
  : [...defaultMatrix, ...(includeFocused ? focusedMatrix : [])];

if (args.includes("--help")) {
  printUsage();
  process.exit(0);
}

if (args.includes("--self-test")) {
  runSelfTest();
  process.exit(0);
}

const selected = selectChecks();
if (args.includes("--list") || args.includes("--dry-run")) {
  printMatrix(selected);
  process.exit(0);
}

if (selected.length === 0) {
  console.error("No managed SSH automated checks selected.");
  process.exit(2);
}

const reportPath = valueAfter("--report");
const startedAt = new Date();
const results = [];
for (const check of selected) {
  const started = new Date();
  console.log(`\n[managed-ssh-auto] ${check.id}: ${check.description}`);
  console.log(`[managed-ssh-auto] cwd=${path.relative(workspaceRoot, check.cwd) || "."}`);
  console.log(`[managed-ssh-auto] command=${formatCommand(check)}`);
  const result = runCheck(check);
  const ended = new Date();
  const outputAssertions = inspectExpectedOutput(check, result.output);
  const missingOutput = outputAssertions
    .filter((assertion) => !assertion.matched)
    .map(
      (assertion) =>
        `missing output assertion: ${assertion.label} (${assertion.pattern})`,
    );
  const status = missingOutput.length > 0 ? 1 : result.status;
  results.push({
    id: check.id,
    command: formatCommand(check),
    durationMs: ended.getTime() - started.getTime(),
    outputAssertionDetails: outputAssertions,
    outputAssertions: outputAssertions.length,
    status,
  });
  if (missingOutput.length > 0) {
    writeReportIfRequested(reportPath, startedAt, new Date(), results, "failed");
    console.error(
      `[managed-ssh-auto] failed: ${check.id} did not produce required output:\n${missingOutput.join("\n")}`,
    );
    process.exit(1);
  }
  if (status !== 0) {
    writeReportIfRequested(reportPath, startedAt, new Date(), results, "failed");
    console.error(`[managed-ssh-auto] failed: ${check.id} exited with ${status}`);
    process.exit(status);
  }
}

writeReportIfRequested(reportPath, startedAt, new Date(), results, "passed");
console.log("\n[managed-ssh-auto] all selected checks passed.");

function rustTest(testName, description) {
  return {
    id: `rust-${testName}`,
    command: "cargo",
    args: ["test", "--manifest-path", "Cargo.toml", "--test", testName, "-j", "1"],
    cwd: path.join(workspaceRoot, "src-tauri"),
    env: { CARGO_TARGET_DIR: cargoTargetDir },
    description,
  };
}

function runCheck(check) {
  const options = {
    cwd: check.cwd,
    env: { ...process.env, ...check.env },
    shell: process.platform === "win32",
  };
  if (!check.expectOutput) {
    const result = spawnSync(check.command, check.args, {
      ...options,
      stdio: "inherit",
    });
    return {
      output: "",
      status: result.status ?? 1,
    };
  }
  const result = spawnSync(check.command, check.args, {
    ...options,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (stdout) {
    process.stdout.write(stdout);
  }
  if (stderr) {
    process.stderr.write(stderr);
  }
  return {
    output: `${stdout}${stderr}`,
    status: result.status ?? 1,
  };
}

function missingExpectedOutput(check, output) {
  return inspectExpectedOutput(check, output)
    .filter((assertion) => !assertion.matched)
    .map(
      (assertion) =>
        `missing output assertion: ${assertion.label} (${assertion.pattern})`,
    );
}

function inspectExpectedOutput(check, output) {
  return (check.expectOutput ?? []).map((assertion) => {
    const pattern = assertionPattern(assertion);
    const match = output.match(pattern);
    return {
      excerpt: match ? matchedLine(output, match[0]) : "",
      label: assertionLabel(assertion),
      matched: Boolean(match),
      pattern: pattern.toString(),
    };
  });
}

function assertionPattern(assertion) {
  return assertion instanceof RegExp ? assertion : assertion.pattern;
}

function assertionLabel(assertion) {
  return assertion instanceof RegExp ? assertion.toString() : assertion.label;
}

function matchedLine(output, matchedText) {
  const line =
    output
      .split(/\r?\n/)
      .find((candidate) => candidate.includes(matchedText))
      ?.trim() ?? matchedText;
  return line.length <= 180 ? line : `${line.slice(0, 177)}...`;
}

function runSelfTest() {
  const focusedChecks = focusedMatrix.filter((check) => check.expectOutput?.length);
  assertSelfTest(
    focusedChecks.length === 3,
    `expected 3 focused output assertion checks, got ${focusedChecks.length}`,
  );
  for (const check of focusedChecks) {
    const okOutput = selfTestOutputFor(check);
    assertSelfTest(
      missingExpectedOutput(check, okOutput).length === 0,
      `${check.id} should accept its passing cargo output`,
    );
    const zeroTestOutput = okOutput.replace("running 1 test", "running 0 tests");
    assertSelfTest(
      missingExpectedOutput(check, zeroTestOutput).some((message) =>
        message.includes("running 1 test"),
      ),
      `${check.id} should reject cargo output that ran zero tests`,
    );
    const wrongTestOutput = okOutput.replace("... ok", "... ignored");
    assertSelfTest(
      missingExpectedOutput(check, wrongTestOutput).some((message) =>
        message.includes("target"),
      ),
      `${check.id} should reject output without the target test success line`,
    );
  }
  console.log("[managed-ssh-auto] self-test passed.");
}

function selfTestOutputFor(check) {
  if (check.id === "focused-bulk-transfer-isolation-runtime") {
    return [
      "running 1 test",
      "test bulk_transfer_lane_uses_separate_session_without_reprompt_contract ... ok",
      "test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 15 filtered out; finished in 0.00s",
    ].join("\n");
  }
  if (check.id === "focused-bulk-transfer-isolation-sftp") {
    return [
      "running 1 test",
      "test managed_runtime::sftp_operations_use_real_managed_sftp_channel_without_second_ssh_connection ... ok",
      "test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 51 filtered out; finished in 0.25s",
    ].join("\n");
  }
  if (check.id === "focused-bulk-transfer-shell-input-isolation") {
    return [
      "running 1 test",
      "test bulk_transfer_lane_does_not_block_interactive_shell_input_contract ... ok",
      "test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 16 filtered out; finished in 0.00s",
    ].join("\n");
  }
  throw new Error(`No self-test fixture for ${check.id}`);
}

function assertSelfTest(condition, message) {
  if (!condition) {
    throw new Error(`[managed-ssh-auto] self-test failed: ${message}`);
  }
}

function selectChecks() {
  const only = valueAfter("--only");
  if (!only) {
    return matrix;
  }
  const selectors = only
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return matrix.filter((check) =>
    selectors.some((selector) => check.id.includes(selector)),
  );
}

function valueAfter(flag) {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    return undefined;
  }
  return value;
}

function printMatrix(checks) {
  for (const check of checks) {
    console.log(`${check.id}\n  ${check.description}\n  ${formatCommand(check)}\n`);
  }
}

function formatCommand(check) {
  return [check.command, ...check.args].join(" ");
}

function writeReportIfRequested(reportPath, startedAt, endedAt, results, status) {
  if (!reportPath) {
    return;
  }
  const resolved = path.resolve(workspaceRoot, reportPath);
  mkdirSync(path.dirname(resolved), { recursive: true });
  writeFileSync(
    resolved,
    [
      "# Managed SSH Automated Verification",
      "",
      `status: ${status}`,
      `started_at: ${startedAt.toISOString()}`,
      `ended_at: ${endedAt.toISOString()}`,
      "",
      "| Check | Exit | Duration ms | Output assertions | Command |",
      "| --- | ---: | ---: | ---: | --- |",
      ...results.map(
        (result) =>
          `| ${result.id} | ${result.status} | ${result.durationMs} | ${result.outputAssertions ?? 0} | \`${result.command}\` |`,
      ),
      ...outputAssertionReportLines(results),
      "",
      "This report contains command ids and exit codes only. Real-target secrets and HITL notes belong in a separate redacted HITL evidence file.",
      "",
    ].join("\n"),
    "utf8",
  );
  console.log(`[managed-ssh-auto] wrote report: ${resolved}`);
}

function outputAssertionReportLines(results) {
  const focusedResults = results.filter(
    (result) => result.outputAssertionDetails?.length > 0,
  );
  if (focusedResults.length === 0) {
    return [];
  }
  return [
    "",
    "## Output Assertions",
    "",
    "| Check | Assertion | Matched excerpt |",
    "| --- | --- | --- |",
    ...focusedResults.flatMap((result) =>
      result.outputAssertionDetails.map(
        (assertion) =>
          `| ${result.id} | ${assertion.label} | ${assertion.matched ? inlineCode(assertion.excerpt) : "missing"} |`,
      ),
    ),
  ];
}

function inlineCode(value) {
  return `\`${String(value).replaceAll("`", "'")}\``;
}

function printUsage() {
  console.error(
    [
      "Managed SSH automated verification matrix.",
      "",
      "Run all automated checks:",
      "  pnpm run verify:managed-ssh-auto",
      "",
      "List or dry-run checks:",
      "  pnpm run verify:managed-ssh-auto -- --list",
      "  pnpm run verify:managed-ssh-auto -- --dry-run",
      "",
      "Run verifier self-tests:",
      "  pnpm run verify:managed-ssh-auto -- --self-test",
      "",
      "Include readiness checks that may start real local CLIs without submitting prompts:",
      "  pnpm run verify:managed-ssh-auto -- --include-readiness --only readiness",
      "",
      "Include focused checks for specific production contracts already covered by broader suites:",
      "  pnpm run verify:managed-ssh-auto -- --include-focused --only bulk-transfer",
      "",
      "Run a subset by id substring:",
      "  pnpm run verify:managed-ssh-auto -- --only ssh_runtime,frontend-managed-ssh",
      "",
      "Write a redacted markdown report:",
      "  pnpm run verify:managed-ssh-auto -- --report .updeng/docs/verification/managed-ssh-auto-YYYYMMDD.md",
      "",
      "This does not replace real-host HITL evidence. Run verify:managed-ssh-hitl",
      "after completing the real SSH host, jump host, external launch, agent, and concurrency matrix.",
    ].join("\n"),
  );
}
