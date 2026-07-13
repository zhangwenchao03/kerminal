#!/usr/bin/env node
/**
 * Windows WSL OpenSSH smoke runner for command suggestions.
 *
 * Starts a temporary sshd inside WSL, seeds a real Git repo and shell history,
 * then runs real SSH/SFTP smoke tests. With --posix-only, the temporary sshd
 * exposes only a minimal PATH containing sh so remoteCommand can prove POSIX
 * builtin fallback without fish/zsh plugins or PATH command discovery.
 *
 * @author kongweiguang
 */

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";

const distro = process.env.KERMINAL_WSL_SMOKE_DISTRO?.trim();
const posixOnly = process.argv.includes("--posix-only");
const terminalPasswordWrong = process.argv.includes("--terminal-password-wrong");
const terminalPassword =
  process.argv.includes("--terminal-password") || terminalPasswordWrong;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(scriptDir, "..");
const windowsTempDir = mkdtempSync(
  path.join(tmpdir(), "kerminal-wsl-ssh-smoke-"),
);
const keyPath = path.join(windowsTempDir, "client_key");
const knownHostsPath = path.join(windowsTempDir, "known_hosts");
let wslTempDir = "";
let wslTempUser = "";
let exitCode = 0;

try {
  if (posixOnly && terminalPassword) {
    throw new Error("--posix-only and --terminal-password cannot be combined.");
  }
  ensureWindows();
  ensureTool("wsl.exe", ["--status"], "wsl.exe");
  ensureTool("ssh-keygen.exe", ["-V"], "Windows OpenSSH ssh-keygen");
  ensureTool("ssh.exe", ["-V"], "Windows OpenSSH ssh");
  if (terminalPassword) {
    ensureWslPasswordTools();
  } else {
    ensureWslTools();
  }

  const port = await allocatePort();
  let result;
  if (terminalPassword) {
    const actualPassword = createSmokePassword();
    const savedPassword = terminalPasswordWrong
      ? `${actualPassword}-wrong`
      : actualPassword;
    const user = createSmokeUser();
    const tmp = `/tmp/kerminal-ssh-terminal-password-${user}`;
    wslTempDir = tmp;
    wslTempUser = user;
    const setup = setupWslPasswordSshd({
      password: actualPassword,
      port,
      tmp,
      user,
    });
    wslTempDir = setup.tmp;
    wslTempUser = setup.user;
    await waitForTcp({ port });

    console.log(
      `WSL OpenSSH smoke target ready: mode=${terminalPasswordWrong ? "terminal-password-wrong" : "terminal-password"} distro=${distro || "<default>"} user=${setup.user} port=${port}`,
    );

    result = spawnSync("pnpm", ["run", "smoke:ssh-terminal:password"], {
      cwd: workspace,
      env: {
        ...process.env,
        RUN_KERMINAL_SSH_TERMINAL_PASSWORD_SMOKE: "1",
        KERMINAL_SSH_TERMINAL_SMOKE_HOST: "127.0.0.1",
        KERMINAL_SSH_TERMINAL_SMOKE_PORT: String(port),
        KERMINAL_SSH_TERMINAL_SMOKE_USER: setup.user,
        KERMINAL_SSH_TERMINAL_SMOKE_PASSWORD: savedPassword,
        KERMINAL_SSH_TERMINAL_SMOKE_KNOWN_HOST_LINE: setup.knownHost,
        KERMINAL_SSH_TERMINAL_SMOKE_READY_MARKER:
          "kerminal-password-login-ready",
        ...(terminalPasswordWrong
          ? { KERMINAL_SSH_TERMINAL_SMOKE_EXPECT_AUTH_FAILURE: "1" }
          : {}),
      },
      shell: process.platform === "win32",
      stdio: "inherit",
    });
  } else {
    generateClientKey();
    const publicKey = readFileSync(`${keyPath}.pub`, "utf8").trim();
    const setup = setupWslSshd({ port, publicKey, posixOnly });
    wslTempDir = setup.tmp;
    waitForSsh({ port, user: setup.user });

    console.log(
      `WSL OpenSSH smoke target ready: mode=${posixOnly ? "posix-only" : "full"} distro=${distro || "<default>"} user=${setup.user} port=${port}`,
    );

    const smokeEnv = {
      ...process.env,
      RUN_KERMINAL_SSH_SMOKE: "1",
      KERMINAL_SSH_SMOKE_HOST: "127.0.0.1",
      KERMINAL_SSH_SMOKE_PORT: String(port),
      KERMINAL_SSH_SMOKE_USER: setup.user,
      KERMINAL_SSH_SMOKE_KEY_PATH: keyPath,
      KERMINAL_SSH_SMOKE_CWD: setup.cwd,
      KERMINAL_SSH_SMOKE_PATH: setup.path,
      KERMINAL_SSH_SMOKE_BUILTIN_COMMAND: "umask",
      KERMINAL_SSH_SMOKE_BUILTIN_PREFIX: "umas",
      KERMINAL_SSH_SMOKE_COMMAND_PREFIX: "kerminal-smoke",
      KERMINAL_SSH_SMOKE_PATH_PREFIX: "ls app",
      KERMINAL_SSH_SMOKE_GIT_PREFIX: "git checkout fe",
      KERMINAL_SSH_SMOKE_HISTORY_PREFIX: "echo kerminal-history",
    };
    result = posixOnly
      ? spawnSync(
          "cargo",
          [
            "test",
            "--test",
            "command_suggestion_ssh_smoke",
            "real_ssh_remote_command_posix_builtin_fallback_survives_minimal_path",
            "--",
            "--ignored",
            "--nocapture",
          ],
          {
            cwd: path.join(workspace, "src-tauri"),
            env: smokeEnv,
            shell: process.platform === "win32",
            stdio: "inherit",
          },
        )
      : spawnSync("pnpm", ["run", "smoke:ssh-suggestions"], {
        cwd: workspace,
        env: smokeEnv,
        shell: process.platform === "win32",
        stdio: "inherit",
      });
  }
  if (result.error) {
    throw result.error;
  }
  exitCode = result.status ?? 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exitCode = 2;
} finally {
  cleanupWsl();
  rmSync(windowsTempDir, { force: true, recursive: true });
}

process.exitCode = exitCode;

function ensureWindows() {
  if (process.platform !== "win32") {
    throw new Error("WSL smoke is only available on Windows.");
  }
}

function ensureTool(command, args, label) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.error && result.error.code === "ENOENT") {
    throw new Error(`${label} is required for WSL SSH smoke.`);
  }
}

function ensureWslTools() {
  const result = runWsl(
    [
      "set -eu",
      "command -v /usr/sbin/sshd >/dev/null",
      "command -v ssh-keygen >/dev/null",
      "command -v git >/dev/null",
      "command -v sh >/dev/null",
    ].join("\n"),
  );
  if (result.status !== 0) {
    throw new Error(
      [
        "WSL smoke prerequisites are missing.",
        "Install or choose a WSL distro that already has OpenSSH server, ssh-keygen, git, and sh.",
        "Use KERMINAL_WSL_SMOKE_DISTRO=<distro-name> to choose a distro.",
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
}

function ensureWslPasswordTools() {
  const result = runWsl(
    [
      "set -eu",
      "test \"$(id -u)\" = \"0\"",
      "command -v /usr/sbin/sshd >/dev/null",
      "command -v ssh-keygen >/dev/null",
      "command -v useradd >/dev/null",
      "command -v chpasswd >/dev/null",
      "command -v sh >/dev/null",
    ].join("\n"),
    undefined,
    { user: "root" },
  );
  if (result.status !== 0) {
    throw new Error(
      [
        "WSL terminal password smoke prerequisites are missing.",
        "The script needs WSL root, OpenSSH server, ssh-keygen, useradd, chpasswd, and sh.",
        "Use KERMINAL_WSL_SMOKE_DISTRO=<distro-name> to choose a distro.",
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
}

function generateClientKey() {
  const result = spawnSync(
    "ssh-keygen.exe",
    ["-t", "ed25519", "-N", "", "-q", "-f", keyPath],
    {
      encoding: "utf8",
      stdio: "pipe",
    },
  );
  if (result.status !== 0) {
    throw new Error(`failed to generate temporary SSH key:\n${result.stderr}`);
  }
  chmodSync(keyPath, 0o600);
  writeFileSync(knownHostsPath, "");
}

async function allocatePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function setupWslSshd({ port, publicKey, posixOnly }) {
  const script = String.raw`
set -eu
tmp=$(mktemp -d /tmp/kerminal-ssh-smoke-XXXXXX)
user=$(id -un)
read -r pubkey
mkdir -p "$tmp/home" "$tmp/srv/repo" "$tmp/bin" "$tmp/posix-bin"
chmod 700 "$tmp/home"
printf '%s\n' "$pubkey" > "$tmp/authorized_keys"
chmod 600 "$tmp/authorized_keys"
ssh-keygen -t ed25519 -N '' -q -f "$tmp/host_key"
sh_path=$(command -v sh)
ln -sf "$sh_path" "$tmp/posix-bin/sh" 2>/dev/null || cp "$sh_path" "$tmp/posix-bin/sh"
chmod 755 "$tmp/posix-bin/sh"
cat > "$tmp/bin/kerminal-smoke-tool" <<'EOS'
#!/bin/sh
printf 'kerminal smoke tool\n'
EOS
chmod 755 "$tmp/bin/kerminal-smoke-tool"
cat > "$tmp/home/.bash_history" <<'EOS'
echo kerminal-history smoke one
echo kerminal-history smoke two
deploy --dry-run --target staging
export API_TOKEN=secret-value
EOS
cd "$tmp/srv/repo"
git init -q -b main 2>/dev/null || git init -q
git config user.email kerminal-smoke@example.invalid
git config user.name 'Kerminal Smoke'
mkdir -p app
printf 'app log\n' > app.log
printf '#!/bin/sh\n' > deploy.sh
chmod 755 deploy.sh
git add .
git commit -qm init
git checkout -qb feature/wsl-smoke
git checkout -q main 2>/dev/null || git checkout -q master
mkdir -p /run/sshd 2>/dev/null || true
smoke_path="$tmp/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
if [ "${posixOnly ? "1" : "0"}" = "1" ]; then
  smoke_path="$tmp/posix-bin"
fi
cat > "$tmp/sshd_config" <<EOF
Port ${port}
ListenAddress 127.0.0.1
HostKey $tmp/host_key
PidFile $tmp/sshd.pid
AuthorizedKeysFile $tmp/authorized_keys
PasswordAuthentication no
PubkeyAuthentication yes
PermitRootLogin yes
StrictModes no
UsePAM no
SetEnv HOME=$tmp/home PATH=$smoke_path
Subsystem sftp internal-sftp
LogLevel ERROR
EOF
/usr/sbin/sshd -f "$tmp/sshd_config" -E "$tmp/sshd.log"
printf 'tmp=%s\n' "$tmp"
printf 'user=%s\n' "$user"
printf 'cwd=%s\n' "$tmp/srv/repo"
printf 'path=%s\n' "$tmp/srv/repo"
printf 'mode=%s\n' "${posixOnly ? "posix-only" : "full"}"
`;
  const result = runWsl(script, `${publicKey}\n`);
  if (result.status !== 0) {
    throw new Error(`failed to set up WSL sshd:\n${result.stderr}`);
  }
  const values = Object.fromEntries(
    result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
  if (!values.tmp || !values.user || !values.cwd || !values.path) {
    throw new Error(`unexpected WSL setup output:\n${result.stdout}`);
  }
  return values;
}

function setupWslPasswordSshd({ port, password, tmp, user }) {
  const script = String.raw`
set -eu
user=${shellQuote(user)}
tmp=${shellQuote(tmp)}
case "$tmp" in
  /tmp/kerminal-ssh-terminal-password-kerminalpw*) ;;
  *) echo "refusing unsafe temp dir: $tmp" >&2; exit 97 ;;
esac
IFS= read -r password
rm -rf "$tmp"
mkdir -p "$tmp/home"
sh_path=$(command -v sh)
useradd -M -d "$tmp/home" -s "$sh_path" "$user"
chown "$user" "$tmp/home"
chmod 700 "$tmp/home"
printf '%s:%s\n' "$user" "$password" | chpasswd
ssh-keygen -t ed25519 -N '' -q -f "$tmp/host_key"
known_host="[127.0.0.1]:${port} $(cat "$tmp/host_key.pub")"
mkdir -p /run/sshd 2>/dev/null || true
cat > "$tmp/sshd_config" <<EOF
Port ${port}
ListenAddress 127.0.0.1
HostKey $tmp/host_key
PidFile $tmp/sshd.pid
PasswordAuthentication yes
KbdInteractiveAuthentication yes
ChallengeResponseAuthentication yes
PubkeyAuthentication no
AuthenticationMethods password
MaxAuthTries 3
PermitEmptyPasswords no
PermitRootLogin no
StrictModes no
UsePAM no
SetEnv HOME=$tmp/home PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ForceCommand /bin/sh -lc 'printf "kerminal-password-login-ready\n"; exec /bin/sh -i'
Subsystem sftp internal-sftp
LogLevel ERROR
EOF
/usr/sbin/sshd -f "$tmp/sshd_config" -E "$tmp/sshd.log"
printf 'tmp=%s\n' "$tmp"
printf 'user=%s\n' "$user"
printf 'knownHost=%s\n' "$known_host"
`;
  const result = runWsl(script, `${password}\n`, { user: "root" });
  if (result.status !== 0) {
    throw new Error(`failed to set up WSL password sshd:\n${result.stderr}`);
  }
  const values = parseSetupOutput(result.stdout);
  if (!values.tmp || !values.user || !values.knownHost) {
    throw new Error(`unexpected WSL password setup output:\n${result.stdout}`);
  }
  return values;
}

function waitForSsh({ port, user }) {
  const args = [
    "-i",
    keyPath,
    "-p",
    String(port),
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=2",
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    `UserKnownHostsFile=${knownHostsPath}`,
    `${user}@127.0.0.1`,
    "printf ready",
  ];
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = spawnSync("ssh.exe", args, {
      encoding: "utf8",
      stdio: "pipe",
      timeout: 5000,
    });
    if (result.status === 0 && result.stdout.trim() === "ready") {
      return;
    }
  }
  throw new Error("temporary WSL sshd did not become reachable.");
}

async function waitForTcp({ port }) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await canConnect(port)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("temporary WSL password sshd did not become reachable.");
}

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1000);
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.once("timeout", () => done(false));
  });
}

function cleanupWsl() {
  if (!wslTempDir && !wslTempUser) {
    return;
  }
  const dir = wslTempDir ? shellQuote(wslTempDir) : "";
  const user = wslTempUser ? shellQuote(wslTempUser) : "";
  runWsl(
    [
      dir
        ? `[ -f ${dir}/sshd.pid ] && kill "$(cat ${dir}/sshd.pid)" 2>/dev/null || true`
        : "",
      user
        ? `command -v pkill >/dev/null 2>&1 && pkill -u ${user} 2>/dev/null || true`
        : "",
      user ? `userdel -r ${user} 2>/dev/null || true` : "",
      dir ? `rm -rf ${dir}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    undefined,
    wslTempUser ? { user: "root" } : undefined,
  );
}

function runWsl(script, input, options = {}) {
  return spawnSync("wsl.exe", [...wslPrefixArgs(options), "sh", "-lc", script], {
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function wslPrefixArgs(options = {}) {
  const args = [];
  if (distro) {
    args.push("-d", distro);
  }
  if (options.user) {
    args.push("-u", options.user);
  }
  args.push("--exec");
  return args;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

function createSmokePassword() {
  return `KerminalSmoke-${process.pid}-${Date.now()}`;
}

function createSmokeUser() {
  return `kerminalpw${process.pid}${Math.floor(Date.now() / 1000) % 100000}`;
}

function parseSetupOutput(output) {
  return Object.fromEntries(
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}
