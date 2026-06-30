#!/usr/bin/env node
// @author kongweiguang
/**
 * Codex PreToolUse Hook - 工具执行前安全拦截
 *
 * 设计原则：
 * 1. 通用高危命令直接阻止
 * 2. 敏感但合理的操作仅提醒，不误伤正常开发流
 * 3. 保持项目无关，不耦合其他仓库特定技术栈
 */

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function writeJson(payload) {
  process.stdout.write(JSON.stringify(payload));
}

function block(reason) {
  writeJson({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });
  process.exit(0);
}

function warn(message) {
  writeJson({ systemMessage: message });
  process.exit(0);
}

function compileRules(rules) {
  return rules.map(([pattern, flags, message]) => [new RegExp(pattern, flags), message]);
}

const DANGEROUS_RULES = compileRules([
  [String.raw`\bgit\s+add\s+(-A|--all|\.)\b`, 'i', '禁止宽泛 staging；请只 git add 本轮实际修改的具体文件，避免把密钥或无关改动塞进提交'],
  [String.raw`rm\s+-rf\s+/(?!\w)`, '', '删除根目录'],
  [String.raw`rm\s+-rf\s+\*`, '', '删除所有文件'],
  [String.raw`rm\s+-rf\s+["']?[A-Za-z]:[\\/][^"'\s]*["']?\s*\*?`, 'i', '删除 Windows 绝对路径下的文件'],
  [String.raw`rm\s+-rf\s+["']?/(home|usr|etc|var|opt|root|tmp|bin|sbin|lib)\b`, 'i', '删除系统关键目录'],
  [String.raw`drop\s+database`, 'i', '删除数据库'],
  [String.raw`truncate\s+table`, 'i', '清空表数据'],
  [String.raw`git\s+push\s+--force\s+(origin\s+)?(main|master)`, 'i', '强制推送到主分支'],
  [String.raw`git\s+reset\s+--hard\s+HEAD~\d+`, '', '硬重置多个提交'],
  [String.raw`>\s*/dev/sd[a-z]`, '', '直接写入磁盘设备'],
  [String.raw`mkfs\.`, '', '格式化文件系统'],
  [String.raw`:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:`, '', 'Fork 炸弹'],
  [String.raw`taskkill\s+(/F\s+)?/IM\s+node\.exe`, 'i', 'taskkill /IM node.exe 会终止当前 AI 工具自身进程，请用 npx kill-port 或精确 PID'],
  [String.raw`Stop-Process\b[^|;\n]*-Name\s+["']?node\*?["']?(\b|\s)`, 'i', 'Stop-Process -Name node 会终止当前 AI 工具自身进程，请用 npx kill-port 或精确 PID'],
  [String.raw`Get-Process\b[^|;\n]*\bnode\b[^|;\n]*\|\s*Stop-Process`, 'i', '管道杀 node 进程会终止当前 AI 工具自身，请用 npx kill-port 或精确 PID'],
  [String.raw`\b(powershell|pwsh)(\.exe)?\s+[-/]+(enc|encodedcommand|e\b)`, 'i', 'PowerShell -EncodedCommand 包装命令绕过审计，禁止使用（请用明文命令）'],
  [String.raw`\bFormat-Volume\b`, 'i', 'PowerShell 格式化磁盘卷（mkfs 等价）'],
  [String.raw`\bClear-Disk\b[^|;\n]*-RemoveData`, 'i', 'PowerShell 清空磁盘数据'],
  [String.raw`\b(Remove-Partition|Remove-Volume)\b[^|;\n]*-(Confirm|Force)`, 'i', 'PowerShell 删除磁盘分区/卷'],
  [String.raw`\b(Stop-Computer|Restart-Computer)\b[^|;\n]*-Force`, 'i', 'PowerShell 强制关机/重启'],
  [String.raw`\bshutdown\b[^|;\n]*/[rspf]\b`, 'i', 'shutdown 关机/重启命令'],
  [String.raw`\b(Invoke-RestMethod|Invoke-WebRequest|irm|iwr)\b[^|;\n]*\|\s*(iex|Invoke-Expression)\b`, 'i', '远程下载并执行（IRM | IEX），无法审计远端脚本内容'],
]);

const PS_DELETE_RULES = compileRules([
  [String.raw`Remove-Item\b`, 'i', 'PowerShell Remove-Item 删除 Windows 绝对路径'],
  [String.raw`\b(rm|ri|erase|del)\b\s+[^|;\n]*[A-Za-z]:[\\/]`, 'i', 'PowerShell 别名删除 Windows 绝对路径'],
  [String.raw`\b(rd|rmdir)\b[^|;\n]*/[sS]\b`, 'i', 'cmd 递归删除 Windows 绝对路径'],
  [String.raw`\bdel\b[^|;\n]*/[sSfF]\b`, 'i', 'cmd 强制/递归删除 Windows 绝对路径'],
  [String.raw`\[\s*(System\.)?IO\.File\s*\]\s*::\s*Delete`, 'i', '.NET File API 删除 Windows 绝对路径'],
  [String.raw`\[\s*(System\.)?IO\.Directory\s*\]\s*::\s*Delete`, 'i', '.NET Directory API 删除 Windows 绝对路径'],
  [String.raw`\bNew-Object\s+(System\.)?IO\.(FileInfo|DirectoryInfo)\b`, 'i', '.NET FileInfo/DirectoryInfo 删除 Windows 绝对路径'],
  [String.raw`Microsoft\.VisualBasic\.FileIO\.FileSystem.*Delete(File|Directory)`, 'i', 'VisualBasic FileSystem 删除 Windows 绝对路径'],
  [String.raw`\b(Invoke-Expression|iex)\b`, 'i', '间接执行（Invoke-Expression）+ Windows 绝对路径，无法静态审计'],
  [String.raw`\brobocopy\b[^|;\n]*/(mir|purge)\b`, 'i', 'robocopy MIR/PURGE 镜像删除 Windows 绝对路径'],
  [String.raw`\bClear-Content\b`, 'i', 'PowerShell Clear-Content 清空 Windows 绝对路径文件'],
]);

const WARNING_RULES = compileRules([
  [String.raw`git\s+push\s+--force`, '', 'Force push 可能覆盖他人代码'],
  [String.raw`docker\s+system\s+prune`, '', '将清理所有未使用的 Docker 资源'],
  [String.raw`pnpm\s+(remove|uninstall)`, '', '即将移除前端依赖，请确认不会影响现有构建流程'],
  [String.raw`\bmvn\b[^|;\n]*\bclean\b`, 'i', '即将执行 Maven clean，确认是否需要清理当前多模块构建产物'],
]);

const SENSITIVE_FILES = [
  '.env',
  '.env.production',
  '.env.local',
  'tauri.conf.json',
  'credentials.json',
  'secrets.json',
  '.gitee_token',
  'gitcode_token',
];

const CODE_WRITE_BLOCK_PHASES = new Set(['intake', 'explore', 'spec', 'design', 'plan', 'archive']);
const PHASE_WRITE_ALLOWED_PREFIXES = ['.codex/', '.updeng/', 'docs/'];
const PHASE_WRITE_ALLOWED_FILES = new Set(['AGENTS.md', 'README.md', '.gitignore']);
const AUTO_CLAIMS_START = '<!-- UPDENG_AUTO_CLAIMS_START -->';
const AUTO_CLAIMS_END = '<!-- UPDENG_AUTO_CLAIMS_END -->';
const AUTO_LANE_PREFIX = 'auto-session-';
const AUTO_LANE_MAX_PATHS = 80;
const AUTO_LANE_LOCK_TIMEOUT_MS = 1500;
const AUTO_LANE_LOCK_STALE_MS = 30_000;
const AUTO_LANE_CLEAN_GRACE_MS = 10 * 60 * 1000;
const AUTO_LANE_FALLBACK_TTL_MS = 6 * 60 * 60 * 1000;
const AUTO_CLAIM_IGNORED_FILES = new Set([
  '.updeng/docs/in-progress.md',
  '.updeng/docs/coordination/lanes.json',
  '.updeng/docs/coordination/status.json',
  '.updeng/docs/coordination/status.md',
]);
const AUTO_CLAIM_IGNORED_PREFIXES = [
  '.updeng/docs/coordination/checkpoints/',
  '.updeng/docs/metrics/',
  '.updeng/tmp/',
  '.codex/hooks/',
];

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function commandFromToolInput(toolInput) {
  if (toolInput.command) return String(toolInput.command);
  if (toolInput.cmd) return String(toolInput.cmd);
  if (Array.isArray(toolInput.argv)) return toolInput.argv.map(String).join(' ');
  return '';
}

function projectPath(cwd) {
  return path.resolve(cwd || process.cwd());
}

function yamlScalar(text, key) {
  const match = new RegExp(`^${escapeRegExp(key)}:\\s*(.*)$`, 'm').exec(text);
  if (!match) return null;
  const value = match[1].trim();
  if (!value || value === 'null') return null;
  return value.replace(/^['"]|['"]$/g, '');
}

function readTextIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function activeWorkflow(cwd) {
  const root = projectPath(cwd);
  const rootStateText = readTextIfExists(path.join(root, '.updeng', 'state.yaml'));
  const activeChange = yamlScalar(rootStateText, 'active_change') || yamlScalar(rootStateText, 'activeChange');
  const rootPhase = yamlScalar(rootStateText, 'phase');
  if (activeChange) {
    const changeStateText = readTextIfExists(path.join(root, '.updeng', 'docs', 'changes', activeChange, 'state.yaml'));
    const changePhase = yamlScalar(changeStateText, 'phase');
    if (changePhase) return { active_change: activeChange, phase: changePhase };
  }
  return { active_change: activeChange, phase: rootPhase };
}

function normalizeProjectRelative(cwd, filePath) {
  if (!filePath) return null;
  const root = projectPath(cwd);
  const raw = String(filePath).replace(/\\/g, path.sep);
  const absolute = isAnyAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
  const relative = path.relative(root, absolute).replace(/\\/g, '/');
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative;
}

function isAnyAbsolute(value) {
  return path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value);
}

function patchPaths(patchText) {
  if (typeof patchText !== 'string') return [];
  const paths = [];
  for (const line of patchText.split(/\r?\n/)) {
    const match = /^\*\*\* (?:Add|Update|Delete) File:\s+(.+?)\s*$/.exec(line);
    if (match) paths.push(match[1].trim());
  }
  return paths;
}

function unquoteShellPath(value) {
  return String(value || '').trim().replace(/^['"]|['"]$/g, '');
}

function isNullRedirectionTarget(value) {
  const normalized = String(value || '').replace(/\\/g, '/').toLowerCase();
  return ['nul', '/dev/null', '2>&1', '&1'].includes(normalized);
}

function shellRedirectionTargets(command) {
  const text = String(command || '');
  const targets = [];
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote && text[index - 1] !== '\\') quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char !== '>') continue;
    if (text[index + 1] === '>') index += 1;
    index += 1;
    while (/\s/.test(text[index] || '')) index += 1;
    if (text[index] === '&') continue;
    let target = '';
    if (text[index] === '"' || text[index] === "'") {
      const targetQuote = text[index];
      index += 1;
      while (index < text.length && text[index] !== targetQuote) {
        target += text[index];
        index += 1;
      }
    } else {
      while (index < text.length && !/[\s|;&]/.test(text[index])) {
        target += text[index];
        index += 1;
      }
      index -= 1;
    }
    target = unquoteShellPath(target);
    if (target && !isNullRedirectionTarget(target)) targets.push(target);
  }
  return targets;
}

function shellWritePaths(command) {
  const text = String(command || '');
  const paths = shellRedirectionTargets(text);
  for (const match of text.matchAll(/\b(?:Set-Content|Add-Content|Out-File)\b[^|;\n]*?\s-(?:LiteralPath|Path|FilePath)\s+(?:"([^"]+)"|'([^']+)'|([^\s|;&]+))/gi)) {
    const target = unquoteShellPath(match[1] || match[2] || match[3] || '');
    if (target) paths.push(target);
  }
  for (const match of text.matchAll(/\b(?:Copy-Item|Move-Item)\b[^|;\n]*?\s-Destination\s+(?:"([^"]+)"|'([^']+)'|([^\s|;&]+))/gi)) {
    const target = unquoteShellPath(match[1] || match[2] || match[3] || '');
    if (target) paths.push(target);
  }
  return paths;
}

function writePathsFromToolInput(toolInput) {
  const paths = [];
  const direct = toolInput.file_path || toolInput.path;
  if (direct) paths.push(String(direct));
  paths.push(...patchPaths(toolInput.input || toolInput.patch || ''));
  return paths;
}

function writeIntentRelativePaths(cwd, toolName, toolInput) {
  const paths = [];
  if (isWriteTool(toolName)) paths.push(...writePathsFromToolInput(toolInput));
  if (isShellTool(toolName)) paths.push(...shellWritePaths(commandFromToolInput(toolInput)));
  return [...new Set(paths.map((item) => normalizeProjectRelative(cwd, item)).filter(Boolean))].sort();
}

function isPhaseWriteAllowed(relativePath) {
  if (!relativePath) return false;
  if (PHASE_WRITE_ALLOWED_FILES.has(relativePath)) return true;
  return PHASE_WRITE_ALLOWED_PREFIXES.some((prefix) => relativePath.startsWith(prefix));
}

function recordPretoolEvent(cwd, inputData, decision, reason, paths) {
  const root = projectPath(cwd);
  if (!fs.existsSync(path.join(root, '.updeng', 'config.yaml'))) return;
  const event = {
    schema_version: 1,
    event: 'PreToolUse',
    recorded_at: new Date().toISOString(),
    session_id: inputData.session_id,
    turn_id: inputData.turn_id,
    cwd: root,
    tool_name: inputData.tool_name,
    decision,
    reason,
    paths,
  };
  try {
    const eventsDir = path.join(root, '.updeng', 'docs', 'metrics');
    fs.mkdirSync(eventsDir, { recursive: true });
    fs.appendFileSync(path.join(eventsDir, 'hooks.jsonl'), `${JSON.stringify(event)}\n`, 'utf8');
  } catch {
    // Hook telemetry must never break the guarded operation.
  }
}

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function coordinationDir(root) {
  return path.join(root, '.updeng', 'docs', 'coordination');
}

function atomicWriteText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, text, 'utf8');
  fs.renameSync(tempPath, filePath);
}

function writeJsonAtomic(filePath, payload) {
  atomicWriteText(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withCoordinationLock(root, callback) {
  const dir = coordinationDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const lockPath = path.join(dir, '.auto-claims.lock');
  const startedAt = Date.now();
  while (Date.now() - startedAt < AUTO_LANE_LOCK_TIMEOUT_MS) {
    let fd = null;
    try {
      fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      return callback();
    } catch (error) {
      if (fd != null) {
        try {
          fs.closeSync(fd);
        } catch {
          // Best effort.
        }
      }
      if (error.code !== 'EEXIST') throw error;
      try {
        const stat = fs.statSync(lockPath);
        if (Date.now() - stat.mtimeMs > AUTO_LANE_LOCK_STALE_MS) fs.rmSync(lockPath, { force: true });
      } catch {
        // The competing writer may have released the lock.
      }
      sleep(25);
    } finally {
      if (fd != null) {
        try {
          fs.closeSync(fd);
        } catch {
          // Best effort.
        }
        try {
          fs.rmSync(lockPath, { force: true });
        } catch {
          // Best effort.
        }
      }
    }
  }
  throw new Error('Timed out waiting for coordination auto-claim lock');
}

function readCoordinationRegistry(root) {
  const registry = readJsonIfExists(path.join(coordinationDir(root), 'lanes.json'));
  if (!registry || !Array.isArray(registry.lanes)) return { schemaVersion: 1, lanes: [] };
  return registry;
}

function git(root, args) {
  const completed = childProcess.spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 16,
  });
  return {
    status: completed.status ?? 1,
    stdout: completed.stdout || '',
    stderr: completed.stderr || '',
  };
}

function parsePorcelainZ(output) {
  const entries = output.split('\0').filter(Boolean);
  const paths = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const status = entry.slice(0, 2);
    const filePath = entry.slice(3).replace(/\\/g, '/');
    if (filePath) paths.push(filePath);
    if (status.includes('R') || status.includes('C')) index += 1;
  }
  return paths;
}

function changedGitPaths(root) {
  const result = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (result.status !== 0) return null;
  return new Set(parsePorcelainZ(result.stdout));
}

function autoLaneId(inputData) {
  const ids = [...currentSessionIds(inputData)].sort();
  const source = ids.length ? ids.join('|') : `${inputData.cwd || ''}|${inputData.turn_id || ''}|unknown`;
  return `${AUTO_LANE_PREFIX}${crypto.createHash('sha256').update(source).digest('hex').slice(0, 12)}`;
}

function mergeLimited(existing, additions, limit) {
  return [...new Set([...(Array.isArray(existing) ? existing : []), ...additions])].slice(-limit).sort();
}

function isAutoClaimIgnoredPath(relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  return AUTO_CLAIM_IGNORED_FILES.has(normalized)
    || AUTO_CLAIM_IGNORED_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function lanePatterns(lane) {
  return [
    ...(Array.isArray(lane.ownedPaths) ? lane.ownedPaths : []),
    ...(Array.isArray(lane.sharedPaths) ? lane.sharedPaths : []),
  ];
}

function autoLaneStillRelevant(lane, dirtyPaths, nowMs) {
  if (!lane.autoClaim) return true;
  const seen = Date.parse(lane.lastSeenAt || lane.updatedAt || lane.claimedAt || '');
  if (dirtyPaths) {
    const patterns = lanePatterns(lane);
    if ([...dirtyPaths].some((dirtyPath) => patterns.some((pattern) => pathMatchesPattern(dirtyPath, pattern)))) {
      return true;
    }
    return Number.isFinite(seen) && nowMs - seen <= AUTO_LANE_CLEAN_GRACE_MS;
  }
  return Number.isFinite(seen) && nowMs - seen <= AUTO_LANE_FALLBACK_TTL_MS;
}

function pruneAutoLanes(root, registry) {
  const dirtyPaths = changedGitPaths(root);
  const nowMs = Date.now();
  registry.lanes = registry.lanes.filter((lane) => autoLaneStillRelevant(lane, dirtyPaths, nowMs));
}

function shortId(value) {
  const text = String(value || '');
  return text.length <= 12 ? text : text.slice(0, 12);
}

function renderAutoClaimsBlock(registry) {
  const claims = registry.lanes
    .filter((lane) => lane.autoClaim && ['active', 'integrating'].includes(String(lane.status || '')))
    .sort((left, right) => String(right.lastSeenAt || '').localeCompare(String(left.lastSeenAt || '')));
  const lines = [
    AUTO_CLAIMS_START,
    '## 自动会话占用',
    '',
    '_此区块由 Codex hook 自动维护，用来让短会话的写入路径在并发开发中可见。_',
    '',
  ];
  if (!claims.length) {
    lines.push('当前没有自动登记的会话写入。', '');
  } else {
    for (const lane of claims) {
      const ids = [
        ...(Array.isArray(lane.sessionIds) ? lane.sessionIds : []),
        ...(Array.isArray(lane.threadIds) ? lane.threadIds : []),
        ...(Array.isArray(lane.turnIds) ? lane.turnIds : []),
      ].filter(Boolean);
      lines.push(`### ${lane.id}`);
      lines.push('');
      lines.push(`- 最后看到：${lane.lastSeenAt || lane.updatedAt || lane.claimedAt || '<unknown>'}`);
      lines.push(`- 会话：${ids.length ? ids.map(shortId).join(', ') : '<unknown>'}`);
      lines.push(`- 工作区：${lane.worktree || ''}`);
      lines.push('- 路径：');
      for (const item of (Array.isArray(lane.ownedPaths) ? lane.ownedPaths : []).slice(0, 20)) {
        lines.push(`  - ${item}`);
      }
      lines.push('');
    }
  }
  lines.push(AUTO_CLAIMS_END, '');
  return lines.join('\n');
}

function updateInProgressDocument(root, registry) {
  const filePath = path.join(root, '.updeng', 'docs', 'in-progress.md');
  const fallback = '# 进行中事项\n\n当前没有进行中的 updeng 事项。\n';
  const existing = readTextIfExists(filePath) || fallback;
  const block = renderAutoClaimsBlock(registry);
  const start = existing.indexOf(AUTO_CLAIMS_START);
  const end = existing.indexOf(AUTO_CLAIMS_END);
  if (start !== -1 && end !== -1 && end > start) {
    const next = `${existing.slice(0, start).trimEnd()}\n\n${block}${existing.slice(end + AUTO_CLAIMS_END.length).trimStart()}`;
    atomicWriteText(filePath, next.endsWith('\n') ? next : `${next}\n`);
    return;
  }
  atomicWriteText(filePath, `${existing.trimEnd()}\n\n${block}`);
}

function registerAutoSessionClaim(inputData, toolName, toolInput) {
  const cwd = inputData.cwd;
  const root = projectPath(cwd);
  if (!fs.existsSync(path.join(root, '.updeng', 'config.yaml'))) return;
  const paths = writeIntentRelativePaths(cwd, toolName, toolInput)
    .filter((item) => !isAutoClaimIgnoredPath(item));
  if (!paths.length) return;
  try {
    withCoordinationLock(root, () => {
      const registry = readCoordinationRegistry(root);
      pruneAutoLanes(root, registry);
      const now = new Date().toISOString();
      const laneId = autoLaneId(inputData);
      let lane = registry.lanes.find((item) => item.id === laneId);
      if (!lane) {
        lane = {
          id: laneId,
          autoClaim: true,
          status: 'active',
          title: `Auto session ${shortId(laneId.replace(AUTO_LANE_PREFIX, ''))}`,
          plan: '.updeng/docs/in-progress.md',
          branch: '',
          worktree: root,
          ownedPaths: [],
          sharedPaths: [],
          syncProtocol: 'Before writing a claimed path from another session, read .updeng/docs/in-progress.md, coordination/status.md, the latest file, current diff, and any checkpoint.',
          claimedAt: now,
        };
        registry.lanes.push(lane);
      }
      lane.autoClaim = true;
      lane.status = 'active';
      lane.worktree = root;
      lane.updatedAt = now;
      lane.lastSeenAt = now;
      lane.sessionIds = mergeLimited(lane.sessionIds, [inputData.session_id, inputData.sessionId].filter(Boolean).map(String), 12);
      lane.threadIds = mergeLimited(lane.threadIds, [inputData.thread_id, inputData.threadId].filter(Boolean).map(String), 12);
      lane.turnIds = mergeLimited(lane.turnIds, [inputData.turn_id, inputData.turnId].filter(Boolean).map(String), 12);
      lane.ownedPaths = mergeLimited(lane.ownedPaths, paths, AUTO_LANE_MAX_PATHS);
      registry.schemaVersion = registry.schemaVersion || 1;
      registry.updatedAt = now;
      writeJsonAtomic(path.join(coordinationDir(root), 'lanes.json'), registry);
      updateInProgressDocument(root, registry);
    });
    recordPretoolEvent(cwd, inputData, 'claim', 'auto-session-claim', paths);
  } catch (error) {
    recordPretoolEvent(cwd, inputData, 'warn', `auto-session-claim-failed: ${error.message}`, paths);
  }
}

function activeCoordinationLanes(cwd) {
  const root = projectPath(cwd);
  const registry = readJsonIfExists(path.join(coordinationDir(root), 'lanes.json'));
  if (!registry || !Array.isArray(registry.lanes)) return [];
  return registry.lanes.filter((lane) => ['active', 'integrating'].includes(String(lane.status || '')));
}

function currentSessionIds(inputData) {
  return new Set([
    inputData.session_id,
    inputData.sessionId,
    inputData.thread_id,
    inputData.threadId,
  ].filter(Boolean).map(String));
}

function currentTurnIds(inputData) {
  return new Set([
    inputData.turn_id,
    inputData.turnId,
  ].filter(Boolean).map(String));
}

function laneBelongsToCurrentSession(lane, inputData) {
  const currentIds = new Set([...currentSessionIds(inputData), ...currentTurnIds(inputData)]);
  const laneIds = [
    ...(Array.isArray(lane.sessionIds) ? lane.sessionIds : []),
    ...(Array.isArray(lane.threadIds) ? lane.threadIds : []),
    ...(Array.isArray(lane.turnIds) ? lane.turnIds : []),
  ].map(String);
  return laneIds.some((id) => currentIds.has(id));
}

function escapeGlob(value) {
  return String(value).replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

function globToRegExpSource(pattern) {
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*' && pattern[index + 1] === '*') {
      source += '.*';
      index += 1;
    } else if (char === '*') {
      source += '[^/]*';
    } else {
      source += escapeGlob(char);
    }
  }
  return source;
}

function pathMatchesPattern(relativePath, pattern) {
  const normalizedPath = String(relativePath || '').replace(/\\/g, '/');
  const normalizedPattern = String(pattern || '').replace(/\\/g, '/');
  if (!normalizedPath || !normalizedPattern) return false;
  if (normalizedPattern.endsWith('/**')) {
    const prefix = normalizedPattern.slice(0, -3);
    return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
  }
  if (!normalizedPattern.includes('*')) return normalizedPath === normalizedPattern;
  const regex = new RegExp(`^${globToRegExpSource(normalizedPattern)}$`);
  return regex.test(normalizedPath);
}

function lanePathHit(lane, relativePath) {
  const ownedPaths = Array.isArray(lane.ownedPaths) ? lane.ownedPaths : [];
  const sharedPaths = Array.isArray(lane.sharedPaths) ? lane.sharedPaths : [];
  const owned = ownedPaths.find((pattern) => pathMatchesPattern(relativePath, pattern));
  const shared = sharedPaths.find((pattern) => pathMatchesPattern(relativePath, pattern));
  if (!owned && !shared) return null;
  return {
    laneId: lane.id || '<unknown>',
    title: lane.title || lane.id || '<unknown>',
    plan: lane.plan,
    matched: shared || owned,
    kind: shared ? 'shared' : 'owned',
  };
}

function isShellTool(toolName) {
  return /^(Bash|shell|exec_command|functions\.exec_command)$/i.test(toolName);
}

function isWriteTool(toolName) {
  return /^(apply_patch|functions\.apply_patch|Edit|Write)$/i.test(toolName);
}

function checkParallelLaneWriteGuard(inputData, toolName, toolInput) {
  const cwd = inputData.cwd;
  const relativePaths = writeIntentRelativePaths(cwd, toolName, toolInput);
  if (!relativePaths.length) return;

  const hits = [];
  for (const lane of activeCoordinationLanes(cwd)) {
    if (laneBelongsToCurrentSession(lane, inputData)) continue;
    for (const relativePath of relativePaths) {
      const hit = lanePathHit(lane, relativePath);
      if (hit) hits.push({ path: relativePath, ...hit });
    }
  }
  if (!hits.length) return;

  const uniqueHits = [...new Map(hits.map((hit) => [`${hit.path}:${hit.laneId}:${hit.matched}`, hit])).values()];
  const hitText = uniqueHits
    .slice(0, 8)
    .map((hit) => `- ${hit.path} -> ${hit.laneId} (${hit.kind}: ${hit.matched})${hit.plan ? ` plan=${hit.plan}` : ''}`)
    .join('\n');
  const reason = [
    '并行 lane 写入提醒：目标路径属于其他 active lane 或共享热点文件。本提醒不阻止执行，但继续前必须同步上下文。',
    hitText,
    '执行要求：读取 .updeng/docs/coordination/status.md、对应计划、最新文件、当前 diff 和最近 checkpoint；只做最小兼容修改；在本轮 Round Log 或 coordination ledger 记录同步结果。',
  ].join('\n');
  recordPretoolEvent(cwd, inputData, 'warn', 'parallel-lane-write', uniqueHits.map((hit) => hit.path));
  warn(reason);
}

function checkPhaseWriteGuard(inputData, toolName, toolInput) {
  const cwd = inputData.cwd;
  const workflow = activeWorkflow(cwd);
  const phase = workflow.phase;
  if (!CODE_WRITE_BLOCK_PHASES.has(phase)) return;
  const relativePaths = writeIntentRelativePaths(cwd, toolName, toolInput);
  const blockedPaths = relativePaths.filter((item) => !isPhaseWriteAllowed(item));
  if (blockedPaths.length === 0) return;

  const activeChange = workflow.active_change || 'none';
  const reason = [
    `Updeng 阶段写入门禁：当前 active change \`${activeChange}\` 处于 \`${phase}\` 阶段，只允许修改流程资产 \`.updeng/\`、\`.codex/\` 或文档入口。`,
    `被拦截路径：${blockedPaths.join(', ')}`,
    '请先完成计划/规格/设计门禁，进入 build 阶段后再修改代码。',
  ].join('\n');
  recordPretoolEvent(cwd, inputData, 'deny', 'phase-write-guard', blockedPaths);
  block(reason);
}

function checkShellCommand(command) {
  if (/[12]?\s*>\s*nul\b/i.test(command)) {
    block(
      '🚫 命令被阻止：检测到 `> nul`\n\n' +
      '问题：Windows 的 bash 不识别 nul 设备，会创建名为 nul 的实体文件\n\n' +
      '解决方案：移除重定向，或改用 `> /dev/null 2>&1`（跨平台）\n\n' +
      `原命令: \`${command}\``,
    );
  }

  for (const [pattern, reason] of DANGEROUS_RULES) {
    if (pattern.test(command)) {
      block(`⚠️ 危险操作被阻止\n\n命令: \`${command}\`\n原因: ${reason}\n\n如确需执行，请手动在终端运行`);
    }
  }

  if (/[A-Za-z]:[\\/][^"'\s|;<>]+/.test(command)) {
    for (const [pattern, reason] of PS_DELETE_RULES) {
      if (pattern.test(command)) {
        block(`⚠️ 危险操作被阻止\n\n命令: \`${command}\`\n原因: ${reason}\n\n如确需执行，请手动在终端运行`);
      }
    }
  }

  for (const [pattern, message] of WARNING_RULES) {
    if (pattern.test(command)) warn(`⚠️ 注意：${message}`);
  }
}

function checkFileWrite(toolInput) {
  const filePath = String(toolInput.file_path || '');
  const patchText = toolInput.input || toolInput.patch || '';
  const hits = SENSITIVE_FILES.filter((filename) => {
    return filePath.endsWith(filename) || (typeof patchText === 'string' && patchText.includes(filename));
  });
  if (hits.length === 0) return;
  if (hits.includes('tauri.conf.json')) {
    warn('⚠️ 即将修改 tauri.conf.json\n请确认这是当前仓库真正需要维护的配置文件，而不是从其他项目迁移来的规则残留');
  }
  warn(`⚠️ 敏感文件写入：${hits.join(', ')}\n请确保不要把密钥/Token 提交到 Git`);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function main() {
  let inputData;
  try {
    inputData = JSON.parse(readStdin());
  } catch {
    return;
  }
  const toolName = inputData.tool_name || '';
  const toolInput = inputData.tool_input && typeof inputData.tool_input === 'object' ? inputData.tool_input : {};

  if (isShellTool(toolName)) {
    checkShellCommand(commandFromToolInput(toolInput));
  }
  const writeIntentPaths = writeIntentRelativePaths(inputData.cwd, toolName, toolInput);
  if (writeIntentPaths.length) {
    checkPhaseWriteGuard(inputData, toolName, toolInput);
    registerAutoSessionClaim(inputData, toolName, toolInput);
    checkParallelLaneWriteGuard(inputData, toolName, toolInput);
  }
  if (isWriteTool(toolName)) {
    checkFileWrite(toolInput);
  }
  process.stdout.write('{}');
}

main();
