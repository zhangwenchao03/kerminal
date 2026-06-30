#!/usr/bin/env node
// @author kongweiguang
/**
 * Updeng lane coordination helper.
 *
 * Commands:
 * - refresh [cwd]: write .updeng/docs/coordination/status.json and status.md
 * - checkpoint <lane-id> [cwd]: write checkpoints/<lane-id>.json and .patch
 * - summary [cwd]: print a compact markdown summary
 */

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const IGNORED_WORKFLOW_PREFIXES = ['.codex/', '.updeng/'];
const IGNORED_WORKFLOW_FILES = new Set(['AGENTS.md']);
const GENERATED_COORDINATION_PATHS = new Set([
  '.updeng/docs/coordination/status.json',
  '.updeng/docs/coordination/status.md',
]);
const GENERATED_COORDINATION_PREFIXES = [
  '.updeng/docs/coordination/checkpoints/',
];
const MAX_SNAPSHOT_BYTES = 1024 * 1024;

function projectPath(cwd) {
  return path.resolve(cwd || process.cwd());
}

function coordinationDir(root) {
  return path.join(root, '.updeng', 'docs', 'coordination');
}

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readRegistry(root) {
  const registry = readJsonIfExists(path.join(coordinationDir(root), 'lanes.json'));
  if (!registry || !Array.isArray(registry.lanes)) {
    return { schemaVersion: 1, lanes: [] };
  }
  return registry;
}

function activeLanes(registry) {
  return registry.lanes.filter((lane) => ['active', 'integrating'].includes(String(lane.status || '')));
}

function git(root, args, options = {}) {
  const completed = childProcess.spawnSync('git', args, {
    cwd: root,
    encoding: options.encoding || 'utf8',
    maxBuffer: options.maxBuffer || 1024 * 1024 * 64,
  });
  return {
    status: completed.status ?? 1,
    stdout: completed.stdout || '',
    stderr: completed.stderr || '',
  };
}

function parsePorcelainZ(output) {
  const entries = output.split('\0').filter(Boolean);
  const changes = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const status = entry.slice(0, 2);
    const filePath = entry.slice(3).replace(/\\/g, '/');
    if (!filePath) continue;
    changes.push({
      path: filePath,
      status,
      tracked: status !== '??',
    });
    if (status.includes('R') || status.includes('C')) index += 1;
  }
  return changes;
}

function gitChanges(root) {
  const result = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (result.status !== 0) {
    return { changes: [], error: result.stderr || result.stdout || `git status exited ${result.status}` };
  }
  return { changes: parsePorcelainZ(result.stdout), error: null };
}

function isIgnoredWorkflowPath(relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  return IGNORED_WORKFLOW_FILES.has(normalized)
    || IGNORED_WORKFLOW_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function isGeneratedCoordinationPath(relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  return GENERATED_COORDINATION_PATHS.has(normalized)
    || GENERATED_COORDINATION_PREFIXES.some((prefix) => normalized.startsWith(prefix));
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
  return new RegExp(`^${globToRegExpSource(normalizedPattern)}$`).test(normalizedPath);
}

function laneHit(lane, relativePath) {
  const ownedPaths = Array.isArray(lane.ownedPaths) ? lane.ownedPaths : [];
  const sharedPaths = Array.isArray(lane.sharedPaths) ? lane.sharedPaths : [];
  const owned = ownedPaths.find((pattern) => pathMatchesPattern(relativePath, pattern));
  const shared = sharedPaths.find((pattern) => pathMatchesPattern(relativePath, pattern));
  if (!owned && !shared) return null;
  return {
    laneId: lane.id || '<unknown>',
    kind: shared ? 'shared' : 'owned',
    pattern: shared || owned,
  };
}

function patternBase(pattern) {
  const normalized = String(pattern || '').replace(/\\/g, '/');
  const wildcardIndex = normalized.search(/[*?[\]]/);
  if (wildcardIndex === -1) return normalized;
  const prefix = normalized.slice(0, wildcardIndex);
  const slashIndex = prefix.lastIndexOf('/');
  return slashIndex === -1 ? '' : prefix.slice(0, slashIndex);
}

function walkFiles(root, relativePath, output, seenRealPaths) {
  const absolute = path.join(root, relativePath);
  let stat;
  try {
    stat = fs.statSync(absolute);
  } catch {
    return;
  }
  if (stat.isDirectory()) {
    let realPath = absolute;
    try {
      realPath = fs.realpathSync(absolute);
    } catch {
      // Keep the unresolved path; the directory can still be walked.
    }
    if (seenRealPaths.has(realPath)) return;
    seenRealPaths.add(realPath);
    let entries = [];
    try {
      entries = fs.readdirSync(absolute, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      walkFiles(root, path.join(relativePath, entry.name).replace(/\\/g, '/'), output, seenRealPaths);
    }
    return;
  }
  if (stat.isFile()) output.push(relativePath.replace(/\\/g, '/'));
}

function expandIgnoredWorkflowPattern(root, pattern) {
  const normalized = String(pattern || '').replace(/\\/g, '/');
  if (!isIgnoredWorkflowPath(normalized)) return [];
  const base = patternBase(normalized);
  const files = [];
  walkFiles(root, base, files, new Set());
  return files
    .filter((relativePath) => pathMatchesPattern(relativePath, normalized))
    .filter((relativePath) => !isGeneratedCoordinationPath(relativePath));
}

function ignoredWorkflowChanges(root, registry, existingChanges) {
  const existingPaths = new Set(existingChanges.map((change) => change.path));
  const discovered = new Set();
  for (const lane of activeLanes(registry)) {
    const patterns = [
      ...(Array.isArray(lane.ownedPaths) ? lane.ownedPaths : []),
      ...(Array.isArray(lane.sharedPaths) ? lane.sharedPaths : []),
    ];
    for (const pattern of patterns) {
      for (const relativePath of expandIgnoredWorkflowPattern(root, pattern)) {
        if (existingPaths.has(relativePath)) continue;
        discovered.add(relativePath);
      }
    }
  }
  return [...discovered].sort().map((relativePath) => ({
    path: relativePath,
    status: '!!',
    tracked: false,
    source: 'ignored-workflow-asset',
  }));
}

function workspaceChanges(root, registry) {
  const result = gitChanges(root);
  return {
    changes: [
      ...result.changes,
      ...ignoredWorkflowChanges(root, registry, result.changes),
    ],
    error: result.error,
  };
}

function checkpointSummary(root, laneId) {
  const checkpointPath = path.join(coordinationDir(root), 'checkpoints', `${laneId}.json`);
  const checkpoint = readJsonIfExists(checkpointPath);
  if (!checkpoint) return null;
  return {
    generatedAt: checkpoint.generatedAt,
    checkpointPath: `.updeng/docs/coordination/checkpoints/${laneId}.json`,
    patchPath: `.updeng/docs/coordination/checkpoints/${laneId}.patch`,
    untrackedSnapshotPath: checkpoint.untrackedSnapshotPath || `.updeng/docs/coordination/checkpoints/${laneId}.untracked.json`,
    changedPathCount: Array.isArray(checkpoint.changedPaths) ? checkpoint.changedPaths.length : 0,
    trackedPatchPathCount: Array.isArray(checkpoint.trackedPatchPaths) ? checkpoint.trackedPatchPaths.length : 0,
    untrackedPathCount: Array.isArray(checkpoint.untrackedPaths) ? checkpoint.untrackedPaths.length : 0,
    omittedSnapshotPaths: Array.isArray(checkpoint.omittedSnapshotPaths) ? checkpoint.omittedSnapshotPaths : [],
  };
}

function classifyChanges(root, registry, changes) {
  const lanes = activeLanes(registry);
  const laneMap = new Map(lanes.map((lane) => [lane.id, {
    id: lane.id,
    title: lane.title,
    plan: lane.plan,
    branch: lane.branch,
    worktree: lane.worktree,
    checkpoint: checkpointSummary(root, lane.id),
    owned: [],
    shared: [],
    external: [],
  }]));
  const conflicts = [];
  const unclaimed = [];

  for (const change of changes) {
    const hits = lanes
      .map((lane) => ({ lane, hit: laneHit(lane, change.path) }))
      .filter((item) => item.hit);
    if (!hits.length) {
      unclaimed.push(change);
      continue;
    }
    for (const { hit } of hits) {
      const laneStatus = laneMap.get(hit.laneId);
      if (!laneStatus) continue;
      laneStatus[hit.kind === 'shared' ? 'shared' : 'owned'].push({
        path: change.path,
        status: change.status,
        tracked: change.tracked,
        pattern: hit.pattern,
      });
    }
    const uniqueLaneIds = [...new Set(hits.map((item) => item.hit.laneId))];
    const hasShared = hits.some((item) => item.hit.kind === 'shared');
    if (uniqueLaneIds.length > 1 || hasShared) {
      conflicts.push({
        path: change.path,
        status: change.status,
        lanes: hits.map((item) => ({
          id: item.hit.laneId,
          kind: item.hit.kind,
          pattern: item.hit.pattern,
        })),
      });
    }
  }

  return {
    lanes: [...laneMap.values()].map((lane) => ({
      ...lane,
      ownedCount: lane.owned.length,
      sharedCount: lane.shared.length,
      totalCount: lane.owned.length + lane.shared.length,
    })),
    conflicts,
    unclaimed,
  };
}

function statusPayload(root) {
  const registry = readRegistry(root);
  const { changes, error } = workspaceChanges(root, registry);
  const classified = classifyChanges(root, registry, changes);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    root,
    gitStatusError: error,
    policy: registry.policy || {},
    changedCount: changes.length,
    conflictCount: classified.conflicts.length,
    unclaimedCount: classified.unclaimed.length,
    lanes: classified.lanes,
    conflicts: classified.conflicts,
    unclaimed: classified.unclaimed.slice(0, 200),
  };
}

function renderStatusMarkdown(payload) {
  const lines = [
    '# Lane Status',
    '',
    `Generated: ${payload.generatedAt}`,
    `Changed paths: ${payload.changedCount}`,
    `Shared/conflict paths: ${payload.conflictCount}`,
    `Unclaimed paths: ${payload.unclaimedCount}`,
    '',
    '## Active Lanes',
    '',
  ];
  for (const lane of payload.lanes) {
    lines.push(`### ${lane.id}`);
    lines.push('');
    lines.push(`- Title: ${lane.title || ''}`);
    lines.push(`- Plan: ${lane.plan || ''}`);
    lines.push(`- Branch: ${lane.branch || ''}`);
    lines.push(`- Changed paths: ${lane.totalCount} (${lane.ownedCount} owned, ${lane.sharedCount} shared)`);
    if (lane.checkpoint) {
      lines.push(`- Last checkpoint: ${lane.checkpoint.generatedAt || '<unknown>'}`);
      lines.push(`  - ${lane.checkpoint.checkpointPath}`);
      lines.push(`  - tracked patch paths: ${lane.checkpoint.trackedPatchPathCount}; untracked snapshots: ${lane.checkpoint.untrackedPathCount}`);
      if (lane.checkpoint.omittedSnapshotPaths.length) {
        lines.push(`  - omitted snapshots: ${lane.checkpoint.omittedSnapshotPaths.join(', ')}`);
      }
    } else {
      lines.push('- Last checkpoint: <none>');
    }
    const sample = [...lane.shared, ...lane.owned].slice(0, 12);
    for (const change of sample) {
      lines.push(`  - ${change.status} ${change.path} (${change.pattern})`);
    }
    lines.push('');
  }
  if (payload.conflicts.length) {
    lines.push('## Shared Or Conflicting Paths');
    lines.push('');
    for (const conflict of payload.conflicts.slice(0, 30)) {
      const lanes = conflict.lanes.map((lane) => `${lane.id}:${lane.kind}`).join(', ');
      lines.push(`- ${conflict.status} ${conflict.path} -> ${lanes}`);
    }
    lines.push('');
  }
  if (payload.unclaimed.length) {
    lines.push('## Unclaimed Paths');
    lines.push('');
    for (const change of payload.unclaimed.slice(0, 30)) {
      lines.push(`- ${change.status} ${change.path}`);
    }
    lines.push('');
  }
  return `${lines.join('\n').trim()}\n`;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function refreshLaneStatus(cwd = process.cwd(), options = {}) {
  const root = projectPath(cwd);
  const dir = coordinationDir(root);
  ensureDir(dir);
  const payload = statusPayload(root);
  fs.writeFileSync(path.join(dir, 'status.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(dir, 'status.md'), renderStatusMarkdown(payload), 'utf8');
  if (!options.silent) process.stdout.write(renderSummary(payload));
  return payload;
}

function renderSummary(payload) {
  const lanes = payload.lanes
    .filter((lane) => lane.totalCount > 0)
    .slice(0, 6)
    .map((lane) => `- ${lane.id}: ${lane.totalCount} changed (${lane.sharedCount} shared)`)
    .join('\n') || '- No lane-owned changes detected';
  const conflicts = payload.conflicts
    .slice(0, 8)
    .map((conflict) => `- ${conflict.path}: ${conflict.lanes.map((lane) => lane.id).join(', ')}`)
    .join('\n') || '- No shared/conflict paths detected';
  return [
    '## Lane Coordination Summary',
    `Generated: ${payload.generatedAt}`,
    `Changed paths: ${payload.changedCount}`,
    '',
    'Active lane changes:',
    lanes,
    '',
    'Shared/conflict paths:',
    conflicts,
    '',
  ].join('\n');
}

function trackedPathsForDiff(root, paths) {
  if (!paths.length) return [];
  const result = git(root, ['ls-files', '--', ...paths]);
  if (result.status !== 0) return [];
  return [...new Set(result.stdout.split(/\r?\n/).filter(Boolean).map((item) => item.replace(/\\/g, '/')))];
}

function sha256File(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function textSnapshotForPath(root, relativePath) {
  const absolute = path.join(root, relativePath);
  let buffer;
  try {
    buffer = fs.readFileSync(absolute);
  } catch (error) {
    return {
      path: relativePath,
      readable: false,
      error: error.message,
    };
  }
  const entry = {
    path: relativePath,
    bytes: buffer.length,
    sha256: sha256File(buffer),
    readable: true,
  };
  if (buffer.length > MAX_SNAPSHOT_BYTES) {
    return {
      ...entry,
      omitted: true,
      reason: `file exceeds ${MAX_SNAPSHOT_BYTES} bytes`,
    };
  }
  const text = buffer.toString('utf8');
  if (text.includes('\uFFFD')) {
    return {
      ...entry,
      omitted: true,
      reason: 'file is not valid utf8 text',
    };
  }
  return {
    ...entry,
    text,
  };
}

function writeUntrackedSnapshots(root, checkpointDir, laneId, untrackedPaths) {
  const snapshot = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    laneId,
    maxSnapshotBytes: MAX_SNAPSHOT_BYTES,
    entries: untrackedPaths.map((relativePath) => textSnapshotForPath(root, relativePath)),
  };
  const snapshotPath = path.join(checkpointDir, `${laneId}.untracked.json`);
  fs.writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  return snapshot;
}

function checkpointLane(laneId, cwd = process.cwd()) {
  const root = projectPath(cwd);
  const payload = refreshLaneStatus(root, { silent: true });
  const lane = payload.lanes.find((item) => item.id === laneId);
  if (!lane) throw new Error(`Unknown active lane: ${laneId}`);
  const checkpointDir = path.join(coordinationDir(root), 'checkpoints');
  ensureDir(checkpointDir);
  const paths = [...new Set([...lane.owned, ...lane.shared].map((change) => change.path))].sort();
  const tracked = trackedPathsForDiff(root, paths);
  const untracked = paths.filter((item) => !tracked.includes(item));
  const untrackedSnapshot = writeUntrackedSnapshots(root, checkpointDir, laneId, untracked);
  const patch = tracked.length ? git(root, ['diff', '--binary', '--', ...tracked], { maxBuffer: 1024 * 1024 * 128 }).stdout : '';
  const checkpoint = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    laneId,
    title: lane.title,
    plan: lane.plan,
    branch: lane.branch,
    worktree: lane.worktree,
    changedPaths: paths,
    trackedPatchPaths: tracked,
    untrackedPaths: untracked,
    untrackedSnapshotPath: `.updeng/docs/coordination/checkpoints/${laneId}.untracked.json`,
    untrackedSnapshotCount: untrackedSnapshot.entries.length,
    omittedSnapshotPaths: untrackedSnapshot.entries.filter((entry) => entry.omitted || !entry.readable).map((entry) => entry.path),
    sharedPaths: lane.shared.map((change) => change.path),
    relatedConflicts: payload.conflicts.filter((conflict) => paths.includes(conflict.path)),
    note: 'Patch contains tracked file diffs. Untracked and ignored workflow assets are captured in the untracked snapshot JSON when they are readable UTF-8 text.',
  };
  fs.writeFileSync(path.join(checkpointDir, `${laneId}.json`), `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(checkpointDir, `${laneId}.patch`), patch, 'utf8');
  process.stdout.write(`Wrote checkpoint for ${laneId}: ${paths.length} paths, ${tracked.length} tracked patch paths\n`);
  return checkpoint;
}

function main(argv) {
  const [command = 'summary', arg1, arg2] = argv;
  if (command === 'refresh') {
    refreshLaneStatus(arg1 || process.cwd());
    return 0;
  }
  if (command === 'summary') {
    const root = projectPath(arg1 || process.cwd());
    const payload = readJsonIfExists(path.join(coordinationDir(root), 'status.json')) || refreshLaneStatus(root, { silent: true });
    process.stdout.write(renderSummary(payload));
    return 0;
  }
  if (command === 'checkpoint') {
    if (!arg1) throw new Error('checkpoint requires a lane id');
    checkpointLane(arg1, arg2 || process.cwd());
    return 0;
  }
  throw new Error(`Unknown command: ${command}`);
}

module.exports = {
  checkpointLane,
  refreshLaneStatus,
  renderSummary,
  statusPayload,
};

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}
