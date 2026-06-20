#!/usr/bin/env node
/**
 * Local loopback SSH/SFTP smoke runner for command suggestions.
 *
 * This proves the native russh + SFTP provider chain, bounded slow/large probe
 * handling, and cache-only query path without requiring an external SSH host.
 * It is not a replacement for the real host smoke in
 * smoke-ssh-command-suggestions.mjs.
 *
 * @author kongweiguang
 */

import { spawnSync } from "node:child_process";

const result = spawnSync(
    "cargo",
    [
      "test",
      "--test",
      "command_suggestion_ssh_smoke",
      "loopback_",
      "--",
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
