#!/usr/bin/env node
/**
 * Codex workflow event hook.
 *
 * Records low-leakage PostToolUse and Stop events for later offline ingestion by
 * `updeng metrics ingest-hooks`. It also turns repeated tool/verification
 * failures and closeout gaps into skill-evolution candidates.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const TEXT_LIMIT = 1000;

let laneCoordination = null;
let evolutionMetrics = null;

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function safeText(value) {
  return value == null ? '' : String(value);
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(safeText(value), 'utf8').digest('hex');
}

function projectPath(cwd) {
  return path.resolve(cwd || process.cwd());
}

function readTextIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function yamlScalar(text, key) {
  const match = new RegExp(`^${escapeRegExp(key)}:\\s*(.*)$`, 'm').exec(text);
  if (!match) return null;
  const value = match[1].trim();
  if (!value || value === 'null') return null;
  return value.replace(/^['"]|['"]$/g, '');
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

function configFlag(cwd, key, defaultValue = false) {
  const text = readTextIfExists(path.join(projectPath(cwd), '.updeng', 'config.yaml'));
  if (!text) return defaultValue;
  const match = new RegExp(`^\\s*${escapeRegExp(key)}:\\s*(true|false)\\s*$`, 'im').exec(text);
  return match ? match[1].toLowerCase() === 'true' : defaultValue;
}

function configInt(cwd, key, defaultValue, minimum = 0, maximum = 1000) {
  const text = readTextIfExists(path.join(projectPath(cwd), '.updeng', 'config.yaml'));
  if (!text) return defaultValue;
  const match = new RegExp(`^\\s*${escapeRegExp(key)}:\\s*(\\d+)\\s*$`, 'im').exec(text);
  if (!match) return defaultValue;
  return Math.max(minimum, Math.min(Number(match[1]), maximum));
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

function collectPaths(cwd, toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return [];
  const paths = [];
  const direct = toolInput.file_path || toolInput.path;
  if (direct) paths.push(String(direct));
  paths.push(...patchPaths(toolInput.input || toolInput.patch || ''));
  return [...new Set(paths.map((item) => normalizeProjectRelative(cwd, item)).filter(Boolean))].sort();
}

function commandFromToolInput(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return '';
  if (toolInput.command) return safeText(toolInput.command);
  if (toolInput.cmd) return safeText(toolInput.cmd);
  if (Array.isArray(toolInput.argv)) return toolInput.argv.map(safeText).join(' ');
  return '';
}

function textStat(value, name) {
  if (value == null) return {};
  const text = safeText(value);
  return {
    [`${name}_length`]: text.length,
    [`${name}_sha256`]: sha256Text(text.slice(0, TEXT_LIMIT)),
  };
}

function responseStats(response) {
  const stats = {};
  if (response && typeof response === 'object' && !Array.isArray(response)) {
    for (const key of ['exit_code', 'exitCode', 'code', 'status_code']) {
      if (Number.isInteger(response[key])) {
        stats.exit_code = response[key];
        break;
      }
    }
    for (const key of ['duration_ms', 'durationMs', 'elapsed_ms', 'elapsedMs']) {
      if (Number.isInteger(response[key]) && response[key] >= 0) {
        stats.duration_ms = response[key];
        break;
      }
    }
    for (const key of ['stdout', 'stderr', 'output', 'error']) {
      Object.assign(stats, textStat(response[key], key));
    }
    if (response.is_error === true || response.error != null || response.success === false) stats.is_error = true;
  } else if (response != null) {
    Object.assign(stats, textStat(response, 'output'));
  }
  return stats;
}

function inferToolStatus(stats) {
  if (stats.is_error) return 'error';
  if (Number.isInteger(stats.exit_code) && stats.exit_code !== 0) return 'error';
  return 'ok';
}

function summarizePostTool(inputData) {
  const cwd = inputData.cwd;
  const toolName = inputData.tool_name || inputData.toolName || 'unknown';
  const toolInput = inputData.tool_input || inputData.toolInput || {};
  const toolResponse = Object.hasOwn(inputData, 'tool_response')
    ? inputData.tool_response
    : (inputData.toolResponse ?? inputData.tool_output);
  const command = commandFromToolInput(toolInput);
  const stats = responseStats(toolResponse);
  const event = {
    tool_name: toolName,
    status: inferToolStatus(stats),
    paths: collectPaths(cwd, toolInput),
    response: stats,
  };
  if (command) {
    event.command_sha256 = sha256Text(command);
    event.command_length = command.length;
    if (configFlag(cwd, 'capture_command_text', false)) {
      event.command_preview = command.slice(0, configInt(cwd, 'command_preview_chars', 160));
    }
  }
  return event;
}

function failureKindForPostTool(event, command) {
  if (event.status !== 'error') return null;
  if (/\b(test|vitest|jest|cargo\s+test|npm\s+test|pnpm\s+test|yarn\s+test|typecheck|tsc|clippy|lint|validate|verify)\b/i.test(command)) {
    return 'verification-failure';
  }
  if (/\b(build|compile|cargo\s+check|cargo\s+build|npm\s+run\s+build|pnpm\s+build|yarn\s+build)\b/i.test(command)) {
    return 'build-failure';
  }
  return 'tool-error';
}

function closeoutSignals(cwd) {
  const root = projectPath(cwd);
  const workflow = activeWorkflow(cwd);
  const activeChange = workflow.active_change;
  const phase = workflow.phase;
  const signals = {
    active_change: activeChange,
    phase,
    has_verification: false,
    has_review: false,
    has_release: false,
    closeout_incomplete: false,
    missing: [],
  };
  if (!activeChange) return signals;
  const changeDir = path.join(root, '.updeng', 'docs', 'changes', activeChange);
  signals.has_verification = fs.existsSync(path.join(changeDir, 'verification.md')) || fs.existsSync(path.join(changeDir, 'verification.json'));
  signals.has_review = fs.existsSync(path.join(changeDir, 'review.md'));
  signals.has_release = fs.existsSync(path.join(changeDir, 'release.md'));
  if (['verify', 'archive', 'done'].includes(phase) && !signals.has_verification) signals.missing.push('verification');
  if (['archive', 'done'].includes(phase) && !signals.has_review) signals.missing.push('review');
  if (['archive', 'done'].includes(phase) && !signals.has_release) signals.missing.push('release');
  signals.closeout_incomplete = signals.missing.length > 0;
  return signals;
}

function baseEvent(inputData, eventName) {
  const cwd = inputData.cwd;
  const workflow = activeWorkflow(cwd);
  return {
    schema_version: 1,
    event: eventName,
    recorded_at: new Date().toISOString(),
    session_id: inputData.session_id,
    turn_id: inputData.turn_id,
    cwd: projectPath(cwd),
    model: inputData.model,
    active_change: workflow.active_change,
    phase: workflow.phase,
  };
}

function recordEvent(cwd, event) {
  const root = projectPath(cwd);
  if (!fs.existsSync(path.join(root, '.updeng', 'config.yaml'))) return;
  try {
    const eventsDir = path.join(root, '.updeng', 'docs', 'metrics');
    fs.mkdirSync(eventsDir, { recursive: true });
    fs.appendFileSync(path.join(eventsDir, 'hooks.jsonl'), `${JSON.stringify(event)}\n`, 'utf8');
  } catch {
    // Telemetry should never fail the hook.
  }
}

function refreshLaneStatus(cwd, eventName) {
  if (!['PostToolUse', 'Stop'].includes(eventName)) return;
  const root = projectPath(cwd);
  if (!fs.existsSync(path.join(root, '.updeng', 'docs', 'coordination', 'lanes.json'))) return;
  try {
    laneCoordination ??= require(path.join(__dirname, 'lane-coordination.cjs'));
    laneCoordination.refreshLaneStatus(root, { silent: true });
  } catch {
    // Coordination status is advisory and must never break Codex hook handling.
  }
}

function getEvolutionMetrics() {
  evolutionMetrics ??= require(path.join(__dirname, 'evolution-metrics.cjs'));
  return evolutionMetrics;
}

function recordEvolutionSignal(cwd, inputData, event) {
  try {
    getEvolutionMetrics().appendHookEvent(cwd, event);
  } catch {
    // Evolution telemetry should never fail the hook.
  }
}

function recordEvolutionCandidate(cwd, candidate) {
  try {
    getEvolutionMetrics().appendEvolutionCandidate(cwd, candidate);
  } catch {
    // Evolution telemetry should never fail the hook.
  }
}

function capturePostToolEvolution(cwd, inputData, event) {
  if (event.event !== 'PostToolUse' || event.status !== 'error') return;
  const toolInput = inputData.tool_input || inputData.toolInput || {};
  const command = commandFromToolInput(toolInput);
  const failureKind = failureKindForPostTool(event, command);
  const signalType = failureKind === 'verification-failure'
    ? 'ai-error,verification-failure'
    : `ai-error,${failureKind}`;
  const target = failureKind === 'verification-failure'
    ? 'bwy-development-governance,bwy-tdd-development,bwy-diagnose'
    : 'bwy-development-governance,bwy-diagnose';
  const evidence = {
    failureKind,
    toolName: event.tool_name,
    exitCode: event.response?.exit_code,
    commandSha256: event.command_sha256,
    commandLength: event.command_length,
    paths: event.paths,
    sessionId: inputData.session_id,
    turnId: inputData.turn_id,
  };
  if (event.command_preview) evidence.commandPreview = event.command_preview;
  const base = {
    schema_version: 1,
    event: 'SkillEvolutionSignal',
    recorded_at: new Date().toISOString(),
    session_id: inputData.session_id,
    turn_id: inputData.turn_id,
    cwd: projectPath(cwd),
    model: inputData.model,
    signal_types: signalType.split(','),
    target_type: 'skill-or-hook',
    target_id: target,
    target_skill: target,
    recommendation: failureKind === 'verification-failure'
      ? 'Review repeated verification failures; add a durable guard, narrower test-first loop, or skill rule if the pattern repeats.'
      : 'Review repeated tool failures; add diagnosis guidance, command preflight, or hook validation if the pattern repeats.',
    evidence,
  };
  recordEvolutionSignal(cwd, inputData, base);
  recordEvolutionCandidate(cwd, {
    source: 'PostToolUse',
    signalType,
    target,
    status: 'candidate',
    summary: failureKind === 'verification-failure'
      ? 'AI-triggered verification command failed.'
      : 'AI-triggered tool command failed.',
    recommendation: base.recommendation,
    evidence,
    recordedAt: base.recorded_at,
  });
}

function captureCloseoutEvolution(cwd, inputData, event) {
  if (event.event !== 'Stop' || !event.closeout_incomplete) return;
  const evidence = {
    failureKind: 'closeout-gap',
    activeChange: event.active_change,
    phase: event.phase,
    missing: event.missing,
    sessionId: inputData.session_id,
    turnId: inputData.turn_id,
  };
  const base = {
    schema_version: 1,
    event: 'SkillEvolutionSignal',
    recorded_at: new Date().toISOString(),
    session_id: inputData.session_id,
    turn_id: inputData.turn_id,
    cwd: projectPath(cwd),
    model: inputData.model,
    signal_types: ['ai-error', 'closeout-gap'],
    target_type: 'skill-or-hook',
    target_id: 'bwy-updeng-workflow,bwy-development-governance',
    target_skill: 'bwy-updeng-workflow,bwy-development-governance',
    recommendation: 'Review closeout gaps; tighten Stop/closeout checks or task ledger requirements if this repeats.',
    evidence,
  };
  recordEvolutionSignal(cwd, inputData, base);
  recordEvolutionCandidate(cwd, {
    source: 'Stop',
    signalType: 'ai-error,closeout-gap',
    target: 'bwy-updeng-workflow,bwy-development-governance',
    status: 'candidate',
    summary: 'Stop hook detected incomplete closeout evidence.',
    recommendation: base.recommendation,
    evidence,
    recordedAt: base.recorded_at,
  });
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
  const eventName = inputData.hook_event_name || inputData.hookEventName || 'WorkflowEvent';
  const cwd = inputData.cwd;
  const event = baseEvent(inputData, eventName);
  if (eventName === 'PostToolUse') {
    Object.assign(event, summarizePostTool(inputData));
  } else if (eventName === 'Stop') {
    Object.assign(event, closeoutSignals(cwd));
    event.status = event.closeout_incomplete ? 'warn' : 'ok';
  } else {
    event.status = 'ok';
  }
  recordEvent(cwd, event);
  capturePostToolEvolution(cwd, inputData, event);
  captureCloseoutEvolution(cwd, inputData, event);
  refreshLaneStatus(cwd, eventName);
  process.stdout.write('{}');
}

main();
