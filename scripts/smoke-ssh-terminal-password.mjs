#!/usr/bin/env node
/**
 * Real OpenSSH password terminal smoke runner.
 *
 * @author kongweiguang
 */

import { spawnSync } from "node:child_process";

const requiredEnv = [
  "RUN_KERMINAL_SSH_TERMINAL_PASSWORD_SMOKE",
  "KERMINAL_SSH_TERMINAL_SMOKE_HOST",
  "KERMINAL_SSH_TERMINAL_SMOKE_USER",
  "KERMINAL_SSH_TERMINAL_SMOKE_PASSWORD",
];

const missingRequired = requiredEnv.filter((name) => !process.env[name]?.trim());

if (
  process.env.RUN_KERMINAL_SSH_TERMINAL_PASSWORD_SMOKE !== "1" ||
  missingRequired.length > 0
) {
  console.error(
    [
      "SSH terminal password smoke was not run.",
      "",
      "Set a real, non-production OpenSSH target before running this command:",
      "  RUN_KERMINAL_SSH_TERMINAL_PASSWORD_SMOKE=1",
      "  KERMINAL_SSH_TERMINAL_SMOKE_HOST=<host>",
      "  KERMINAL_SSH_TERMINAL_SMOKE_USER=<user>",
      "  KERMINAL_SSH_TERMINAL_SMOKE_PASSWORD=<password>",
      "",
      "Optional:",
      "  KERMINAL_SSH_TERMINAL_SMOKE_PORT=22",
      "  KERMINAL_SSH_TERMINAL_SMOKE_KNOWN_HOST_LINE=<known_hosts-line>",
      "  KERMINAL_SSH_TERMINAL_SMOKE_READY_MARKER=<text printed after login>",
      "  KERMINAL_SSH_TERMINAL_SMOKE_EXPECT_AUTH_FAILURE=1",
      "",
      "The smoke creates a Kerminal SSH terminal session through OpenSSH, waits",
      "for password-prompt auto response, writes ASCII and UTF-8 Chinese commands",
      "through the PTY, and asserts that terminal output does not expose the saved password.",
      "When EXPECT_AUTH_FAILURE=1, the saved password is expected to be wrong and",
      "the smoke asserts that authentication fails without leaking that password.",
      "",
      "This gate intentionally exits non-zero when no real password host is configured.",
    ].join("\n"),
  );
  process.exit(2);
}

const result = spawnSync(
  "cargo",
  [
    "test",
    "--test",
    "ssh_terminal_password_smoke",
    "real_openssh_password_terminal_auto_login_smoke",
    "--",
    "--ignored",
    "--nocapture",
  ],
  {
    cwd: "src-tauri",
    env: process.env,
    shell: process.platform === "win32",
    stdio: "inherit",
  },
);

process.exit(result.status ?? 1);
