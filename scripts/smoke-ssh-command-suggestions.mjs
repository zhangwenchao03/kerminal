#!/usr/bin/env node
/**
 * Real SSH/SFTP smoke runner for command suggestions.
 *
 * @author kongweiguang
 */

import { spawnSync } from "node:child_process";

const requiredEnv = ["RUN_KERMINAL_SSH_SMOKE", "KERMINAL_SSH_SMOKE_HOST", "KERMINAL_SSH_SMOKE_USER"];
const authEnv = [
  "KERMINAL_SSH_SMOKE_PASSWORD",
  "KERMINAL_SSH_SMOKE_PRIVATE_KEY",
  "KERMINAL_SSH_SMOKE_KEY_PATH",
  "KERMINAL_SSH_SMOKE_AUTH",
];

const missingRequired = requiredEnv.filter((name) => !process.env[name]?.trim());
const hasAuth = authEnv.some((name) => process.env[name]?.trim());

if (process.env.RUN_KERMINAL_SSH_SMOKE !== "1" || missingRequired.length > 0 || !hasAuth) {
  console.error(
    [
      "SSH command suggestion smoke was not run.",
      "",
      "Set a real, non-production SSH target before running this command:",
      "  RUN_KERMINAL_SSH_SMOKE=1",
      "  KERMINAL_SSH_SMOKE_HOST=<host>",
      "  KERMINAL_SSH_SMOKE_USER=<user>",
      "  one of:",
      "    KERMINAL_SSH_SMOKE_PASSWORD=<password>",
      "    KERMINAL_SSH_SMOKE_PRIVATE_KEY=<private-key-pem>",
      "    KERMINAL_SSH_SMOKE_KEY_PATH=<private-key-path>",
      "    KERMINAL_SSH_SMOKE_AUTH=agent",
      "",
      "Optional for encrypted inline private keys:",
      "  KERMINAL_SSH_SMOKE_PRIVATE_KEY_PASSPHRASE=<passphrase>",
      "",
      "remoteCommand/Git probes run through Kerminal's native russh path in this smoke,",
      "so password and inline private-key credentials are valid full-chain auth inputs.",
      "",
      "Optional:",
      "  KERMINAL_SSH_SMOKE_PORT=22",
      "  KERMINAL_SSH_SMOKE_CWD=~",
      "  KERMINAL_SSH_SMOKE_PATH=~",
      "  KERMINAL_SSH_SMOKE_COMMAND_PREFIX=ec",
      "  KERMINAL_SSH_SMOKE_BUILTIN_COMMAND=umask",
      "  KERMINAL_SSH_SMOKE_BUILTIN_PREFIX=umas",
      "  KERMINAL_SSH_SMOKE_PATH_PREFIX='ls '",
      "  KERMINAL_SSH_SMOKE_GIT_PREFIX='git checkout '",
      "  KERMINAL_SSH_SMOKE_HISTORY_PREFIX=<history-prefix-to-require>",
      "",
      "This gate intentionally exits non-zero when no real SSH host is configured.",
    ].join("\n"),
  );
  process.exit(2);
}

const result = spawnSync(
  "cargo",
  [
    "test",
    "--test",
    "command_suggestion_ssh_smoke",
    "real_ssh_sftp_provider_chain_produces_command_path_and_git_suggestions",
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
