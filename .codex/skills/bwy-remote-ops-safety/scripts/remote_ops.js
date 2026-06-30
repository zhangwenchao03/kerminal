#!/usr/bin/env node
/**
 * 远程运维安全技能的复用脚本。
 *
 * The script reads server definitions from the current project's .updeng/docs/config
 * directory by default.
 */

import childProcess from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DELETE_CONFIRMATION_PATTERNS = [
  [/rm\s+-rf/i, 'recursive force delete'],
  [/\brm\s+/i, 'delete file'],
  [/\bunlink\s+/i, 'delete file'],
  [/\bshred\s+/i, 'destroy file contents'],
  [/\bdocker\s+(rm|rmi|system\s+prune)/i, 'docker delete or prune'],
  [/\bkubectl\s+delete\b/i, 'kubernetes delete'],
  [/\b(apt|apt-get|yum|dnf|apk)\s+(remove|purge|autoremove)\b/i, 'package removal'],
  [/\btruncate\s+/i, 'truncate file or table'],
  [/\bdd\s+/i, 'raw disk or file copy'],
  [/\b(redis-cli|valkey-cli)\s+.*\b(flushall|flushdb|del|unlink)\b/i, 'redis delete or flush'],
  [/\bdrop\s+database\b/i, 'drop database'],
  [/\bdrop\s+table\b/i, 'drop table'],
  [/\bdrop\s+schema\b/i, 'drop schema'],
  [/\bdelete\s+from\b/i, 'sql delete'],
];

export const PROBE_COMMANDS = {
  basic: 'hostname && whoami && pwd && uptime && df -h && free -h',
  network: 'hostname && ss -lntp && ip addr',
  java: 'hostname && ps -ef | grep java | grep -v grep && ss -lntp | grep java',
  docker: "hostname && docker ps --format 'table {{.Names}}\\t{{.Status}}\\t{{.Ports}}'",
  systemd: 'hostname && systemctl --failed --no-pager && systemctl list-units --type=service --state=running --no-pager | head -n 80',
};

const SECURITY_MODES = new Set(['safe', 'readonly', 'restricted', 'unrestricted']);
const MODE_ALIASES = { standard: 'safe', default: 'safe', 'read-only': 'readonly', read_only: 'readonly' };
const SENSITIVE_KEYS = ['password', 'passphrase', 'token', 'secret', 'apikey', 'api_key', 'sudo'];
const SSH_BACKENDS = new Set(['auto', 'paramiko', 'ssh']);

export class PolicyDecision {
  constructor(allowed, reason) {
    this.allowed = allowed;
    this.reason = reason;
  }
}

export function defaultConfigPaths() {
  const root = process.cwd();
  return [
    path.join(root, '.updeng', 'docs', 'config', 'remote-servers.json'),
    path.join(root, '.updeng', 'docs', 'config', 'remote-servers.example.json'),
  ];
}

export function loadConfig(configPath) {
  const candidates = configPath ? [path.resolve(configPath)] : defaultConfigPaths();
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return [JSON.parse(fs.readFileSync(candidate, 'utf8')), candidate];
    }
  }
  throw new Error(`Config file not found. Checked: ${candidates.join(', ')}`);
}

export function asBool(value, defaultValue = false) {
  if (value == null) return defaultValue;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  }
  return Boolean(value);
}

export function asStringList(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string') {
    const separator = value.includes(';') ? ';' : ',';
    return value.split(separator).map((item) => item.trim()).filter(Boolean);
  }
  throw new Error(`Expected string or list, got ${typeof value}: ${value}`);
}

export function sshBackend(target) {
  const rawBackend = String(target.ssh_backend || target.backend || 'auto').trim().toLowerCase();
  const aliases = { openssh: 'ssh', cli: 'ssh' };
  const backend = aliases[rawBackend] || rawBackend;
  if (!SSH_BACKENDS.has(backend)) throw new Error(`Invalid ssh_backend '${rawBackend}'. Allowed: ${[...SSH_BACKENDS].sort().join(', ')}`);
  return backend;
}

export function paramikoUnsupportedOptions(target) {
  const unsupported = [];
  if (target.jump_host) unsupported.push('jump_host');
  if (asBool(target.forward_agent, false)) unsupported.push('forward_agent');
  if (asStringList(target.ssh_options).length) unsupported.push('ssh_options');
  return unsupported;
}

export function chooseSshBackend(targetName, target) {
  const backend = sshBackend(target);
  const unsupported = paramikoUnsupportedOptions(target);
  if (backend === 'paramiko' && unsupported.length) {
    throw new Error(`Target '${targetName}' cannot use ssh_backend=paramiko with unsupported field(s): ${unsupported.join(', ')}`);
  }
  if (backend !== 'auto') return backend;
  if (target.password && unsupported.length === 0) return 'paramiko';
  return 'ssh';
}

export function securityMode(target) {
  const rawMode = String(target.security_mode || target.mode || 'safe').trim().toLowerCase();
  const mode = MODE_ALIASES[rawMode] || rawMode;
  if (!SECURITY_MODES.has(mode)) throw new Error(`Invalid security_mode '${rawMode}'. Allowed: ${[...SECURITY_MODES].sort().join(', ')}`);
  return mode;
}

export function compilePatterns(patterns, fieldName, targetName) {
  return patterns.map((pattern) => {
    try {
      return new RegExp(pattern);
    } catch (error) {
      throw new Error(`Invalid regex in ${targetName}.${fieldName}: ${JSON.stringify(pattern)}: ${error.message}`);
    }
  });
}

export function matchesAny(command, patterns) {
  return patterns.find((pattern) => pattern.test(command)) || null;
}

export function dangerousMatch(command) {
  for (const [pattern, reason] of DELETE_CONFIRMATION_PATTERNS) {
    if (pattern.test(command)) return [pattern.source, reason];
  }
  return null;
}

export function hostBlocked(config, host) {
  const blocked = asStringList(config.blocked_hosts || config.host_blocklist);
  return blocked.find((pattern) => wildcardMatch(host, pattern)) || null;
}

export function ensureTarget(config, targetName) {
  const targets = config.targets || {};
  if (!(targetName in targets)) throw new Error(`Unknown target '${targetName}'. Available targets: ${Object.keys(targets).sort().join(', ') || '<none>'}`);
  const target = targets[targetName];
  if (!target.host) throw new Error(`Target '${targetName}' is missing 'host'.`);
  const blockedBy = hostBlocked(config, String(target.host));
  if (blockedBy) throw new Error(`Target '${targetName}' host '${target.host}' is blocked by pattern '${blockedBy}'.`);
  return target;
}

export function evaluateCommandPolicy(targetName, target, command, allowWrite) {
  const mode = securityMode(target);
  if (mode === 'unrestricted') return new PolicyDecision(true, 'security_mode=unrestricted');

  const denyPatterns = compilePatterns(asStringList(target.deny_patterns), 'deny_patterns', targetName);
  const deniedBy = matchesAny(command, denyPatterns);
  if (deniedBy) return new PolicyDecision(false, `matches deny_patterns: ${deniedBy.source}`);

  const builtInDanger = dangerousMatch(command);
  if (mode === 'readonly' && builtInDanger) {
    const [pattern, reason] = builtInDanger;
    return new PolicyDecision(false, `readonly target blocks ${reason}: ${pattern}`);
  }

  if (mode === 'restricted') {
    const allowPatterns = compilePatterns(asStringList(target.allow_patterns), 'allow_patterns', targetName);
    if (allowPatterns.length === 0) return new PolicyDecision(false, 'restricted target has no allow_patterns');
    const allowedBy = matchesAny(command, allowPatterns);
    if (!allowedBy) return new PolicyDecision(false, 'restricted target command does not match allow_patterns');
  }

  if (builtInDanger && !allowWrite) {
    const [pattern, reason] = builtInDanger;
    return new PolicyDecision(
      false,
      'delete or destructive cleanup command blocked; confirm the delete action first, then rerun with --allow-write if approved. ' +
        `Reason: ${reason}; pattern: ${pattern}`,
    );
  }
  return new PolicyDecision(true, `security_mode=${mode}`);
}

export function normalizeRemotePath(remotePath) {
  if (remotePath.includes('\0')) throw new Error('Remote path contains a NUL byte.');
  let normalized = path.posix.normalize(remotePath.replace(/\\/g, '/'));
  if (!normalized.startsWith('/')) normalized = `/${normalized}`;
  return normalized;
}

export function pathUnder(candidate, base) {
  const normalizedPath = normalizeRemotePath(candidate);
  const normalizedBase = normalizeRemotePath(base);
  return normalizedPath === normalizedBase || normalizedPath.startsWith(`${normalizedBase.replace(/\/$/, '')}/`);
}

export function enforcePathPolicy(targetName, target, remotePath) {
  const mode = securityMode(target);
  const allowlist = asStringList(target.path_allowlist || target.allowed_paths);
  const denylist = asStringList(target.path_denylist || target.blocked_paths);
  for (const blocked of denylist) {
    if (pathUnder(remotePath, blocked)) throw new Error(`Remote path '${remotePath}' is blocked by ${targetName}.path_denylist entry '${blocked}'.`);
  }
  if (mode === 'restricted' && allowlist.length === 0) throw new Error(`Target '${targetName}' is restricted and has no path_allowlist for file transfer.`);
  if (allowlist.length > 0 && !allowlist.some((allowed) => pathUnder(remotePath, allowed))) {
    throw new Error(`Remote path '${remotePath}' is outside allowed paths for target '${targetName}': ${allowlist.join(', ')}`);
  }
}

export function sshOptionArgs(target) {
  const opts = [];
  const addOption = (name, value) => {
    if (value != null && String(value) !== '') opts.push('-o', `${name}=${value}`);
  };
  if ('batch_mode' in target) addOption('BatchMode', asBool(target.batch_mode) ? 'yes' : 'no');
  const connectTimeout = target.connect_timeout ?? target.connect_timeout_sec ?? 10;
  if (connectTimeout) addOption('ConnectTimeout', Number.parseInt(connectTimeout, 10));
  if (target.strict_host_key_checking) {
    const allowed = new Set(['yes', 'no', 'off', 'ask', 'accept-new']);
    const value = String(target.strict_host_key_checking).toLowerCase();
    if (!allowed.has(value)) throw new Error(`Invalid strict_host_key_checking '${value}'. Allowed: ${[...allowed].sort().join(', ')}`);
    addOption('StrictHostKeyChecking', value);
  }
  addOption('UserKnownHostsFile', target.user_known_hosts_file);
  if ('identities_only' in target) addOption('IdentitiesOnly', asBool(target.identities_only) ? 'yes' : 'no');
  addOption('ServerAliveInterval', target.server_alive_interval);
  addOption('ServerAliveCountMax', target.server_alive_count_max);
  for (const option of asStringList(target.ssh_options)) opts.push('-o', option);
  return opts;
}

export function buildSshBase(targetName, target) {
  if (!target.host) throw new Error(`Target '${targetName}' is missing 'host'.`);
  const sshArgs = ['ssh', '-p', String(Number.parseInt(target.port ?? 22, 10)), ...sshOptionArgs(target)];
  if (target.identity_file) sshArgs.push('-i', String(target.identity_file));
  if (target.jump_host) sshArgs.push('-J', String(target.jump_host));
  if (asBool(target.forward_agent, false)) sshArgs.push('-A');
  sshArgs.push(target.user ? `${target.user}@${target.host}` : String(target.host));
  return sshArgs;
}

export function buildScpBase(target) {
  const scpArgs = ['scp', '-P', String(Number.parseInt(target.port ?? 22, 10)), ...sshOptionArgs(target)];
  if (target.identity_file) scpArgs.push('-i', String(target.identity_file));
  if (target.jump_host) scpArgs.push('-o', `ProxyJump=${target.jump_host}`);
  return scpArgs;
}

export function remoteRef(target, remotePath) {
  const prefix = target.user ? `${target.user}@${target.host}` : String(target.host);
  return `${prefix}:${remotePath}`;
}

export function applyCwd(command, cwd) {
  return cwd ? `cd ${shellQuote(cwd)} && ${command}` : command;
}

export function resolveExecCommand(args, target) {
  if (args.alias) {
    const aliases = target.command_aliases || target.aliases || {};
    if (!(args.alias in aliases)) throw new Error(`Unknown alias '${args.alias}'. Available aliases: ${Object.keys(aliases).sort().join(', ') || '<none>'}`);
    return [String(aliases[args.alias]), args.alias];
  }
  return [String(args.command), null];
}

export function timeoutFor(args, target, fieldName = 'command_timeout_sec') {
  const value = args.timeoutSec ?? target[fieldName];
  if (value == null || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  return parsed > 0 ? parsed : null;
}

export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      const keyLower = key.toLowerCase();
      return [key, SENSITIVE_KEYS.some((sensitive) => keyLower.includes(sensitive)) ? '***' : redact(item)];
    }));
  }
  return value;
}

export function auditEvent(target, record) {
  if (!target.audit_log) return;
  const auditPath = path.isAbsolute(String(target.audit_log)) ? String(target.audit_log) : path.join(process.cwd(), String(target.audit_log));
  fs.mkdirSync(path.dirname(auditPath), { recursive: true });
  fs.appendFileSync(auditPath, `${JSON.stringify({ ts: new Date().toISOString(), ...redact(record) })}\n`, 'utf8');
}

export function printTargets(config, configFile) {
  const targets = config.targets || {};
  console.log(`Config: ${configFile}`);
  if (Object.keys(targets).length === 0) {
    console.log('No targets configured.');
    return 0;
  }
  for (const name of Object.keys(targets).sort()) {
    const item = targets[name];
    console.log(`- ${name}: env=${item.env || ''} mode=${securityMode(item)} backend=${chooseSshBackend(name, item)} host=${item.host || ''} user=${item.user || ''} desc=${item.description || ''}`);
  }
  return 0;
}

export function runCommand(cmd, dryRun, timeoutSec = null) {
  console.log(`$ ${cmd.map(shellQuote).join(' ')}`);
  if (dryRun) return 0;
  const result = childProcess.spawnSync(cmd[0], cmd.slice(1), {
    stdio: 'inherit',
    timeout: timeoutSec ? timeoutSec * 1000 : undefined,
    windowsHide: true,
  });
  if (result.error?.code === 'ETIMEDOUT') {
    console.error(`Command timed out after ${timeoutSec} seconds.`);
    return 124;
  }
  if (result.error) {
    console.error(result.error.message);
    return 1;
  }
  return result.status ?? 0;
}

function runParamikoUnavailable(targetName) {
  throw new Error(
    `Target '${targetName}' selects ssh_backend=paramiko/password mode, but the JS helper does not bundle a password SSH backend. ` +
    'Use OpenSSH key auth, set ssh_backend=ssh, or add a JS SSH implementation before executing this target.',
  );
}

export function runRemoteCommand(targetName, target, command, dryRun, timeoutSec) {
  const backend = chooseSshBackend(targetName, target);
  if (backend === 'paramiko') {
    if (dryRun) {
      console.log(`$ paramiko ssh -p ${Number.parseInt(target.port ?? 22, 10)} ${shellQuote(target.user ? `${target.user}@${target.host}` : String(target.host))} -- ${shellQuote(command)}`);
      return 0;
    }
    runParamikoUnavailable(targetName);
  }
  const sshCmd = buildSshBase(targetName, target);
  sshCmd.push(command);
  return runCommand(sshCmd, dryRun, timeoutSec);
}

export function commandExec(args, config) {
  const target = ensureTarget(config, args.target);
  const [command, alias] = resolveExecCommand(args, target);
  const policy = evaluateCommandPolicy(args.target, target, command, Boolean(args.allowWrite));
  if (!policy.allowed) {
    auditEvent(target, { target: args.target, action: 'exec', command, alias, allowed: false, reason: policy.reason });
    throw new Error(`Blocked remote command for target '${args.target}': ${policy.reason}`);
  }
  const cwd = args.cwd || target.default_dir;
  const exitCode = runRemoteCommand(args.target, target, applyCwd(command, cwd), Boolean(args.dryRun), timeoutFor(args, target));
  auditEvent(target, {
    target: args.target,
    action: 'exec',
    command,
    alias,
    cwd,
    allowed: true,
    reason: policy.reason,
    dry_run: Boolean(args.dryRun),
    exit_code: exitCode,
    success: exitCode === 0,
  });
  return exitCode;
}

export function commandProbe(args, config) {
  const target = ensureTarget(config, args.target);
  if (!(args.probe in PROBE_COMMANDS)) throw new Error(`Unknown probe '${args.probe}'. Available probes: ${Object.keys(PROBE_COMMANDS).sort().join(', ')}`);
  const command = PROBE_COMMANDS[args.probe];
  const policy = evaluateCommandPolicy(args.target, target, command, false);
  if (!policy.allowed) {
    auditEvent(target, { target: args.target, action: 'probe', probe: args.probe, command, allowed: false, reason: policy.reason });
    throw new Error(`Blocked probe for target '${args.target}': ${policy.reason}`);
  }
  const cwd = target.default_dir;
  const exitCode = runRemoteCommand(args.target, target, applyCwd(command, cwd), Boolean(args.dryRun), timeoutFor(args, target));
  auditEvent(target, {
    target: args.target,
    action: 'probe',
    probe: args.probe,
    command,
    cwd,
    allowed: true,
    reason: policy.reason,
    dry_run: Boolean(args.dryRun),
    exit_code: exitCode,
    success: exitCode === 0,
  });
  return exitCode;
}

export function commandFetch(args, config) {
  const target = ensureTarget(config, args.target);
  enforcePathPolicy(args.target, target, args.remotePath);
  const localPath = path.resolve(args.localPath);
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  if (chooseSshBackend(args.target, target) === 'paramiko') {
    if (args.dryRun) {
      console.log(`$ paramiko sftp -P ${Number.parseInt(target.port ?? 22, 10)} ${shellQuote(`${target.user ? `${target.user}@` : ''}${target.host}:${args.remotePath}`)} ${shellQuote(localPath)}`);
      return 0;
    }
    runParamikoUnavailable(args.target);
  }
  const scpCmd = buildScpBase(target);
  scpCmd.push(remoteRef(target, args.remotePath), localPath);
  const exitCode = runCommand(scpCmd, Boolean(args.dryRun), timeoutFor(args, target, 'transfer_timeout_sec'));
  auditEvent(target, {
    target: args.target,
    action: 'fetch',
    remote_path: args.remotePath,
    local_path: localPath,
    allowed: true,
    dry_run: Boolean(args.dryRun),
    exit_code: exitCode,
    success: exitCode === 0,
  });
  return exitCode;
}

export function commandValidate(config, configFile) {
  const targets = config.targets || {};
  if (!targets || typeof targets !== 'object' || Array.isArray(targets)) throw new Error("Config field 'targets' must be an object.");
  for (const [name, target] of Object.entries(targets)) {
    ensureTarget(config, name);
    securityMode(target);
    compilePatterns(asStringList(target.allow_patterns), 'allow_patterns', name);
    compilePatterns(asStringList(target.deny_patterns), 'deny_patterns', name);
    Number.parseInt(target.port ?? 22, 10);
    for (const field of ['path_allowlist', 'path_denylist', 'allowed_paths', 'blocked_paths']) asStringList(target[field]);
    sshOptionArgs(target);
    sshBackend(target);
    chooseSshBackend(name, target);
    hostKeyFingerprints(target);
  }
  console.log(`Config OK: ${configFile} (${Object.keys(targets).length} target(s))`);
  return 0;
}

export function hostKeyFingerprints(target) {
  const values = [];
  for (const field of ['host_key', 'host_key_fingerprint', 'host_key_fingerprints', 'host_key_sha256']) {
    values.push(...asStringList(target[field]));
  }
  return values.map(normalizeFingerprint);
}

export function normalizeFingerprint(value) {
  const raw = value.trim();
  const sha256Match = /SHA256:[A-Za-z0-9+/=]+/.exec(raw);
  if (sha256Match) return sha256Match[0].replace(/=+$/, '');
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(raw) && raw.length >= 32) return `SHA256:${raw.replace(/=+$/, '')}`;
  const md5Match = /([0-9a-fA-F]{2}:){15}[0-9a-fA-F]{2}/.exec(raw);
  return md5Match ? md5Match[0].toLowerCase() : raw;
}

function wildcardMatch(value, pattern) {
  const regex = new RegExp(`^${String(pattern).split('*').map(escapeRegExp).join('.*')}$`);
  return regex.test(value);
}

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, "'\\''")}'`;
}

function parseArgs(argv) {
  const args = { config: '', dryRun: false, allowWrite: false, probe: 'basic' };
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const [rawName, inline] = arg.slice(2).split('=', 2);
    if (['dry-run', 'allow-write'].includes(rawName)) {
      args[rawName.replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = true;
      continue;
    }
    const value = inline === undefined ? argv[index + 1] : inline;
    if (value === undefined) throw new Error(`Missing value for --${rawName}`);
    index += inline === undefined ? 1 : 0;
    const key = rawName.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    args[key] = rawName === 'timeout-sec' ? Number.parseInt(value, 10) : value;
  }
  args.action = positionals[0];
  if (!args.action) throw new Error('Usage: remote_ops.js [--config path] list|validate|exec|probe|fetch ...');
  return args;
}

function main(argv) {
  const args = parseArgs(argv);
  const [config, configFile] = loadConfig(args.config);
  if (args.action === 'list') return printTargets(config, configFile);
  if (args.action === 'validate') return commandValidate(config, configFile);
  if (args.action === 'exec') {
    if (!args.target) throw new Error('exec requires --target');
    if (!args.command && !args.alias) throw new Error('exec requires --command or --alias');
    return commandExec(args, config);
  }
  if (args.action === 'probe') {
    if (!args.target) throw new Error('probe requires --target');
    return commandProbe(args, config);
  }
  if (args.action === 'fetch') {
    if (!args.target || !args.remotePath || !args.localPath) throw new Error('fetch requires --target, --remote-path and --local-path');
    return commandFetch(args, config);
  }
  throw new Error(`Unknown action: ${args.action}`);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function fingerprintText(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(String(error.message || error));
    process.exitCode = 1;
  }
}
