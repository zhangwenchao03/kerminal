#!/usr/bin/env node
// @author kongweiguang
/**
 * Shared low-leakage helpers for Updeng skill-evolution metrics.
 */

const fs = require('node:fs');
const path = require('node:path');

function projectPath(cwd) {
  return path.resolve(cwd || process.cwd());
}

function metricsDir(cwd) {
  return path.join(projectPath(cwd), '.updeng', 'docs', 'metrics');
}

function hasUpdengConfig(cwd) {
  return fs.existsSync(path.join(projectPath(cwd), '.updeng', 'config.yaml'));
}

function safeText(value) {
  return value == null ? '' : String(value);
}

function appendJsonl(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
}

function appendHookEvent(cwd, event) {
  if (!hasUpdengConfig(cwd)) return;
  appendJsonl(path.join(metricsDir(cwd), 'hooks.jsonl'), event);
}

function candidateId(prefix, hashOrSeed) {
  const seed = safeText(hashOrSeed).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12) || Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${seed}`;
}

function appendEvolutionCandidate(cwd, candidate) {
  if (!hasUpdengConfig(cwd)) return null;
  const normalized = {
    schemaVersion: 1,
    id: candidate.id || candidateId('evo', candidate.evidence?.promptSha256 || candidate.evidence?.commandSha256 || candidate.signalType),
    source: candidate.source || 'hook',
    signalType: candidate.signalType || 'unknown',
    target: candidate.target || 'bwy-skill-evolution',
    status: candidate.status || 'candidate',
    summary: candidate.summary || 'Hook detected a skill-evolution candidate.',
    recommendation: candidate.recommendation || 'Review this signal and decide whether a durable workflow, skill, hook, or eval update is needed.',
    evidence: candidate.evidence || {},
    recordedAt: candidate.recordedAt || new Date().toISOString(),
  };
  appendJsonl(path.join(metricsDir(cwd), 'evolution-candidates.jsonl'), normalized);
  refreshEvolutionCandidateSummary(cwd);
  return normalized;
}

function readJsonl(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function refreshEvolutionCandidateSummary(cwd) {
  if (!hasUpdengConfig(cwd)) return null;
  const dir = metricsDir(cwd);
  const candidates = readJsonl(path.join(dir, 'evolution-candidates.jsonl'));
  if (!candidates.length) return null;
  const groups = new Map();
  for (const candidate of candidates) {
    const key = [
      candidate.target || candidate.target_id || candidate.target_skill || '<unknown>',
      candidate.signalType || candidate.signal_type || '<unknown>',
      candidate.status || 'candidate',
    ].join('|');
    const group = groups.get(key) || {
      target: candidate.target || candidate.target_id || candidate.target_skill || '<unknown>',
      signalType: candidate.signalType || candidate.signal_type || '<unknown>',
      status: candidate.status || 'candidate',
      count: 0,
      firstRecordedAt: candidate.recordedAt || candidate.recorded_at || '',
      lastRecordedAt: candidate.recordedAt || candidate.recorded_at || '',
      ids: [],
      recommendations: new Set(),
      excerpts: [],
      failureKinds: new Set(),
    };
    group.count += 1;
    if (candidate.id) group.ids.push(candidate.id);
    const recordedAt = candidate.recordedAt || candidate.recorded_at || '';
    if (recordedAt && (!group.firstRecordedAt || recordedAt < group.firstRecordedAt)) group.firstRecordedAt = recordedAt;
    if (recordedAt && (!group.lastRecordedAt || recordedAt > group.lastRecordedAt)) group.lastRecordedAt = recordedAt;
    if (candidate.recommendation) group.recommendations.add(candidate.recommendation);
    if (candidate.evidence?.failureKind) group.failureKinds.add(candidate.evidence.failureKind);
    const excerpt = candidate.evidence?.excerpt || candidate.evidence?.promptExcerpt || candidate.evidence?.promptRedacted;
    if (typeof excerpt === 'string' && excerpt && group.excerpts.length < 3) group.excerpts.push(excerpt);
    groups.set(key, group);
  }
  const summary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    candidateCount: candidates.length,
    groupCount: groups.size,
    groups: [...groups.values()]
      .map((group) => ({
        ...group,
        recommendations: [...group.recommendations],
        failureKinds: [...group.failureKinds],
        ids: group.ids.slice(-10),
      }))
      .sort((left, right) => right.count - left.count || String(right.lastRecordedAt).localeCompare(String(left.lastRecordedAt))),
  };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'evolution-current.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(dir, 'evolution-current.md'), renderEvolutionCandidateSummary(summary), 'utf8');
  return summary;
}

function renderEvolutionCandidateSummary(summary) {
  const lines = [
    '# Skill Evolution Candidates',
    '',
    `Generated: ${summary.generatedAt}`,
    `Candidates: ${summary.candidateCount}`,
    `Groups: ${summary.groupCount}`,
    '',
  ];
  for (const group of summary.groups.slice(0, 20)) {
    lines.push(`## ${group.target}`);
    lines.push('');
    lines.push(`- Signal: ${group.signalType}`);
    lines.push(`- Status: ${group.status}`);
    lines.push(`- Count: ${group.count}`);
    lines.push(`- First recorded: ${group.firstRecordedAt || '<unknown>'}`);
    lines.push(`- Last recorded: ${group.lastRecordedAt || '<unknown>'}`);
    if (group.failureKinds.length) lines.push(`- Failure kinds: ${group.failureKinds.join(', ')}`);
    if (group.recommendations.length) {
      lines.push('- Recommendations:');
      for (const recommendation of group.recommendations.slice(0, 3)) lines.push(`  - ${recommendation}`);
    }
    if (group.excerpts.length) {
      lines.push('- Evidence excerpts:');
      for (const excerpt of group.excerpts) lines.push(`  - ${excerpt}`);
    }
    if (group.ids.length) lines.push(`- Recent ids: ${group.ids.slice(-5).join(', ')}`);
    lines.push('');
  }
  return `${lines.join('\n').trim()}\n`;
}

module.exports = {
  appendEvolutionCandidate,
  appendHookEvent,
  refreshEvolutionCandidateSummary,
};
