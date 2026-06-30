#!/usr/bin/env node
// @author kongweiguang
// Codex UserPromptSubmit Hook - 强制技能评估（极简版）
//
// 目标：
// 1. 强制模型先评估技能再动手
// 2. 避免跳过技能直接搜索/改代码
// 3. 仅从实际项目 .codex/skills 目录读取必载技能存在性
//
// stdin: { session_id, turn_id, prompt, cwd, hook_event_name, model }
// 输出: stdout 普通文本 -> 注入 context；空输出 -> 跳过

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const TOP_RULES = [
  '默认启用智能 Updeng 路由：用户可以直接描述需求，也可以用 `/skills <需求>` 显式触发；不要要求用户重复说明“按 Updeng”。',
  '每轮先使用 `bwy-updeng-workflow` 做任务分类、技能编排、流程深度和完成门禁判断。',
  '开发功能和修改功能使用 `bwy-development-governance` 约束交付；direct 简单任务可跳过正式计划和问答，直接实现并说明验证。',
];

const SKILL_TRIGGER_COMMANDS = new Set(['/skills', '/skill', '/updeng', '/updeng']);

const MANDATORY_SKILLS = ['bwy-updeng-workflow', 'bwy-development-governance'];

const ROUTE_RULES = [
  {
    pattern: /skill|技能|hook|hooks|workflow|updeng|updeng coding|自进化|初始化工具|能力管理|工作流/i,
    skills: ['bwy-project-skill-maintenance', 'bwy-skill-evolution'],
    reason: '涉及技能、hooks、工作流、初始化工具或能力自进化。',
    depth: 'evolution',
  },
  { pattern: /review|评审|审查|检查\s*diff|找问题|代码检查/i, skills: ['bwy-code-review'], reason: '涉及实现评审或交付前检查。', depth: 'planned' },
  { pattern: /\bjava\b|spring|controller|service|mapper|mybatis|maven|接口|后端/i, skills: ['bwy-java-backend-development'], reason: '涉及 Java 后端或接口调用链。', depth: 'planned' },
  { pattern: /crud|生成器|scaffold|脚手架/i, skills: ['bwy-java-scaffold-generator'], reason: '涉及 bwy-project 脚手架 CRUD 或生成器产物。', depth: 'planned' },
  { pattern: /\bcommon\b|公共组件|\bfoundation\b|\bdata\b|\bsecurity\b|\bio\b|\bevents\b/i, skills: ['bwy-java-scaffold-common'], reason: '涉及 bwy common 公共组件选择或边界。', depth: 'planned' },
  { pattern: /auth|登录|认证|验证码|sso|token|权限|放行/i, skills: ['bwy-java-scaffold-auth', 'bwy-java-scaffold-common-security'], reason: '涉及认证、权限或安全边界。', depth: 'high-risk' },
  { pattern: /system|用户|角色|菜单|部门|字典|参数|租户/i, skills: ['bwy-java-scaffold-system'], reason: '涉及 system 模块复用或后台系统能力。', depth: 'planned' },
  { pattern: /snailjob|job|定时任务|分布式任务|任务调度/i, skills: ['bwy-java-scaffold-job'], reason: '涉及分布式任务或调度能力。', depth: 'planned' },
  { pattern: /前端|react|vite|页面|组件|表单|表格|路由|浏览器|ui|tsx|typescript/i, skills: ['bwy-frontend-development', 'bwy-react-development-standards'], reason: '涉及前端页面、组件、类型或浏览器验证。', depth: 'planned' },
  { pattern: /数据库|sql|mysql|postgres|postgis|表|字段|索引|迁移|回填|mapper\s+sql/i, skills: ['bwy-database-change-management'], reason: '涉及数据库、SQL、结构或数据变更。', depth: 'high-risk' },
  { pattern: /redis|缓存|ttl|key|scan|队列/i, skills: ['bwy-redis-diagnostics'], reason: '涉及 Redis 或缓存诊断。', depth: 'planned' },
  { pattern: /服务器|远程|生产|部署|nginx|docker|端口|systemctl|日志|ssh/i, skills: ['bwy-remote-ops-safety'], reason: '涉及远程运维、生产诊断或服务器命令。', depth: 'high-risk' },
  { pattern: /gis|地理|空间|geoserver|wms|wfs|坐标|crs|地图/i, skills: ['bwy-gis-development'], reason: '涉及 GIS、空间数据或地图服务。', depth: 'planned' },
  { pattern: /\bdify\b|\bdataset\b|知识库|流式|\bchatflow\b/i, skills: ['bwy-dify-integration'], reason: '涉及 Dify 集成或联调。', depth: 'planned' },
  { pattern: /claude|cluade|多模型|外部模型|worker|codex\s*worker|派发/i, skills: ['bwy-collaborating-with-codex', 'bwy-collaborating-with-claude-code'], reason: '涉及 worker、多模型协作或第二意见。', depth: 'worker-assisted' },
];

const DEPTH_PRIORITY = { direct: 0, planned: 1, 'worker-assisted': 2, evolution: 3, 'high-risk': 4 };
const CODEX_ONLY_PATTERNS = [
  /只用\s*codex/i, /仅用\s*codex/i, /不用\s*claude/i, /不要用\s*claude/i, /不调用\s*claude/i,
  /codex\s*直接/i, /codex\s*自己/i, /codex\s*独立/i, /只让\s*codex/i, /直接让\s*codex/i,
  /不用\s*cluade/i, /不要用\s*cluade/i, /不调用\s*cluade/i,
];
const SKIP_PATTERNS = [
  'continued from a previous conversation',
  'ran out of context',
  'No code restore',
  'Conversation compacted',
  'commands restored',
  'context window',
  'session is being continued',
];

const EVOLUTION_SIGNAL_RULES = [
  {
    type: 'user-correction',
    pattern: /不是|并不是|不对|纠正|更正|应该是|我说的是|不是递归|而是|别.*递归|不要.*递归/i,
  },
  {
    type: 'repeated-feedback',
    pattern: /说了很多遍|反复|重复|多次|每次都|老是|又(?:出现|来了|是|没|没有)|还是(?:不|没|没有|跟之前)|之前说过|上次说过|一直/i,
  },
  {
    type: 'workflow-gap',
    pattern: /工作流|updeng|并行|多个任务|同时跑|同一个文件|看不到对方|自进化|进化|自动.*记|记到进化|没有体验|没体验|没有.*记住|没.*记住/i,
  },
];

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function projectPath(cwd) {
  return path.resolve(cwd || process.cwd());
}

function safeText(value) {
  return value == null ? '' : String(value);
}

function normalizePromptCommand(prompt) {
  const text = safeText(prompt).trim();
  if (!text) return { prompt: text, command: null, shouldSkip: false };
  const [firstToken] = text.split(/\s/, 1);
  const lowerToken = firstToken.toLowerCase();
  if (SKILL_TRIGGER_COMMANDS.has(lowerToken)) {
    return {
      prompt: text.slice(firstToken.length).trim(),
      command: lowerToken,
      shouldSkip: false,
    };
  }
  return {
    prompt: text,
    command: null,
    shouldSkip: /^\/[^/\s]+$/.test(firstToken),
  };
}

function sha256(value) {
  return crypto.createHash('sha256').update(safeText(value), 'utf8').digest('hex');
}

function skillRoot(cwd) {
  return path.join(projectPath(cwd), '.codex', 'skills');
}

function parseFrontmatter(content) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match) return {};
  const lines = match[1].split(/\r?\n/);
  const data = {};
  for (let i = 0; i < lines.length;) {
    const field = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]);
    if (!field) {
      i += 1;
      continue;
    }
    const key = field[1];
    const rawValue = field[2].trim();
    if (rawValue === '|') {
      const block = [];
      i += 1;
      while (i < lines.length && /^(?:\s+|$)/.test(lines[i])) {
        block.push(lines[i].replace(/^\s{2}/, ''));
        i += 1;
      }
      data[key] = block.join('\n').trim();
      continue;
    }
    data[key] = rawValue.replace(/^['"]|['"]$/g, '');
    i += 1;
  }
  return data;
}

function readSkill(cwd, dirName) {
  const skillPath = path.join(skillRoot(cwd), dirName, 'SKILL.md');
  let content = '';
  try {
    content = fs.readFileSync(skillPath, 'utf8');
  } catch {
    return { dirName, name: dirName, description: '', skillPath: `.codex/skills/${dirName}/SKILL.md` };
  }
  const frontmatter = parseFrontmatter(content);
  return {
    dirName,
    name: frontmatter.name || dirName,
    description: frontmatter.description || '',
    skillPath: `.codex/skills/${dirName}/SKILL.md`,
  };
}

function listProjectSkills(cwd) {
  const root = skillRoot(cwd);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => isDirectoryLikeSkillEntry(root, entry))
    .map((entry) => readSkill(cwd, entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

function isDirectoryLikeSkillEntry(root, entry) {
  if (!entry.isDirectory() && !entry.isSymbolicLink()) return false;
  return fs.existsSync(path.join(root, entry.name, 'SKILL.md'));
}

function filterExisting(skills, cwd) {
  const existing = new Map();
  for (const skill of listProjectSkills(cwd)) {
    existing.set(skill.name, skill);
    existing.set(skill.dirName, skill);
  }
  return skills.map((skill) => existing.get(skill)).filter(Boolean);
}

function routeMatches(prompt, cwd) {
  const matches = [];
  const seen = new Set();
  let depth = 'direct';
  for (const rule of ROUTE_RULES) {
    if (!rule.pattern.test(prompt)) continue;
    if (DEPTH_PRIORITY[rule.depth] > DEPTH_PRIORITY[depth]) depth = rule.depth;
    for (const skill of filterExisting(rule.skills, cwd)) {
      if (seen.has(skill.name)) continue;
      seen.add(skill.name);
      matches.push({ name: skill.name, reason: rule.reason, depth: rule.depth, skillPath: skill.skillPath });
    }
  }
  return [matches, depth];
}

function capturePromptTextEnabled(cwd) {
  let text = '';
  try {
    text = fs.readFileSync(path.join(projectPath(cwd), '.updeng', 'config.yaml'), 'utf8');
  } catch {
    return [false, 160];
  }
  const enabled = /^\s*capture_prompt_text:\s*true\s*$/im.test(text);
  const charsMatch = /^\s*prompt_preview_chars:\s*(\d+)\s*$/im.exec(text);
  const previewChars = charsMatch ? Number(charsMatch[1]) : 160;
  return [enabled, Math.max(0, Math.min(previewChars, 1000))];
}

function configBoolean(cwd, key, defaultValue = false) {
  let text = '';
  try {
    text = fs.readFileSync(path.join(projectPath(cwd), '.updeng', 'config.yaml'), 'utf8');
  } catch {
    return defaultValue;
  }
  const match = new RegExp(`^\\s*${escapeRegExp(key)}:\\s*(true|false)\\s*$`, 'im').exec(text);
  return match ? match[1].toLowerCase() === 'true' : defaultValue;
}

function configInteger(cwd, key, defaultValue, minimum = 0, maximum = 1000) {
  let text = '';
  try {
    text = fs.readFileSync(path.join(projectPath(cwd), '.updeng', 'config.yaml'), 'utf8');
  } catch {
    return defaultValue;
  }
  const match = new RegExp(`^\\s*${escapeRegExp(key)}:\\s*(\\d+)\\s*$`, 'im').exec(text);
  if (!match) return defaultValue;
  return Math.max(minimum, Math.min(Number(match[1]), maximum));
}

function captureEvolutionSignalTextEnabled(cwd) {
  return [
    configBoolean(cwd, 'capture_evolution_signal_text', false),
    configInteger(cwd, 'evolution_signal_preview_chars', 240, 0, 1000),
  ];
}

function appendHookEvent(cwd, event) {
  const root = projectPath(cwd);
  if (!fs.existsSync(path.join(root, '.updeng', 'config.yaml'))) return;
  try {
    const eventsDir = path.join(root, '.updeng', 'docs', 'metrics');
    fs.mkdirSync(eventsDir, { recursive: true });
    fs.appendFileSync(path.join(eventsDir, 'hooks.jsonl'), `${JSON.stringify(event)}\n`, 'utf8');
  } catch {
    // Hook telemetry must never block prompt handling.
  }
}

function appendEvolutionCandidate(cwd, candidate) {
  const root = projectPath(cwd);
  if (!fs.existsSync(path.join(root, '.updeng', 'config.yaml'))) return;
  try {
    const eventsDir = path.join(root, '.updeng', 'docs', 'metrics');
    fs.mkdirSync(eventsDir, { recursive: true });
    fs.appendFileSync(
      path.join(eventsDir, 'evolution-candidates.jsonl'),
      `${JSON.stringify(candidate)}\n`,
      'utf8',
    );
  } catch {
    // Candidate telemetry must never block prompt handling.
  }
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
  const root = projectPath(cwd);
  const metricsDir = path.join(root, '.updeng', 'docs', 'metrics');
  const candidatesPath = path.join(metricsDir, 'evolution-candidates.jsonl');
  const candidates = readJsonl(candidatesPath);
  if (!candidates.length) return;
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
  fs.mkdirSync(metricsDir, { recursive: true });
  fs.writeFileSync(path.join(metricsDir, 'evolution-current.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(metricsDir, 'evolution-current.md'), renderEvolutionCandidateSummary(summary), 'utf8');
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

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function activeLaneSummary(cwd) {
  const coordinationDir = path.join(projectPath(cwd), '.updeng', 'docs', 'coordination');
  const status = readJsonIfExists(path.join(coordinationDir, 'status.json'));
  if (status && Array.isArray(status.lanes)) {
    const activeLines = status.lanes
      .slice(0, 6)
      .map((lane) => {
        return `- ${lane.id || '<unknown>'}: changed=${lane.totalCount || 0}, shared=${lane.sharedCount || 0}, plan=${lane.plan || '<none>'}`;
      });
    const conflictLines = Array.isArray(status.conflicts) && status.conflicts.length
      ? status.conflicts.slice(0, 5).map((conflict) => {
        const lanes = Array.isArray(conflict.lanes) ? conflict.lanes.map((lane) => `${lane.id}:${lane.kind}`).join(', ') : '';
        return `- shared ${conflict.path}: ${lanes}`;
      })
      : ['- 当前未发现 shared/conflict path'];
    return [
      `- 状态更新时间：${status.generatedAt || '<unknown>'}`,
      `- changed=${status.changedCount || 0}, shared/conflict=${status.conflictCount || 0}, unclaimed=${status.unclaimedCount || 0}`,
      ...activeLines,
      ...conflictLines,
    ].join('\n');
  }

  const registry = readJsonIfExists(path.join(coordinationDir, 'lanes.json'));
  if (!registry || !Array.isArray(registry.lanes)) return '- 未发现并行 lane 台账';
  const active = registry.lanes.filter((lane) => ['active', 'integrating'].includes(String(lane.status || '')));
  if (!active.length) return '- 当前没有 active lane';
  return active
    .slice(0, 6)
    .map((lane) => {
      const shared = Array.isArray(lane.sharedPaths) ? lane.sharedPaths.slice(0, 5).join(', ') : '';
      return `- ${lane.id || '<unknown>'}: ${lane.title || ''}; plan=${lane.plan || '<none>'}; shared=${shared || '<none>'}`;
    })
    .join('\n');
}

function recordRouteEvent(cwd, inputData, prompt, matches, depth) {
  const [capturePrompt, previewChars] = capturePromptTextEnabled(cwd);
  const event = {
    schema_version: 1,
    event: 'UserPromptSubmit',
    recorded_at: new Date().toISOString(),
    session_id: inputData.session_id,
    turn_id: inputData.turn_id,
    cwd: projectPath(cwd),
    model: inputData.model,
    prompt_sha256: sha256(prompt),
    prompt_length: safeText(prompt).length,
    workflow_depth: depth,
    matched_skills: matches.map((match) => match.name),
  };
  if (capturePrompt) event.prompt_preview = safeText(prompt).slice(0, previewChars);
  appendHookEvent(cwd, event);
}

function recordEvolutionSignals(cwd, inputData, prompt, matches, depth) {
  const signals = detectEvolutionSignals(prompt);
  if (!signals.length) return;
  const matchedSkillNames = new Set(matches.map((match) => match.name));
  const targetSkill = inferEvolutionTargetSkill(prompt, matches);
  const [captureExcerpt, excerptChars] = captureEvolutionSignalTextEnabled(cwd);
  const signalTypes = [...new Set(signals.map((signal) => signal.type))];
  const evidenceExcerpt = captureExcerpt ? redactedExcerpt(prompt, excerptChars) : undefined;
  const promptHash = sha256(prompt);
  const base = {
    schema_version: 1,
    recorded_at: new Date().toISOString(),
    session_id: inputData.session_id,
    turn_id: inputData.turn_id,
    cwd: projectPath(cwd),
    model: inputData.model,
    prompt_sha256: promptHash,
    prompt_length: safeText(prompt).length,
    workflow_depth: depth,
    matched_skills: [...matchedSkillNames],
    signal_types: signalTypes,
    target_type: 'skill-or-hook',
    target_id: targetSkill,
    target_skill: targetSkill,
    recommendation: recommendationForSignals(signalTypes, targetSkill),
  };
  if (evidenceExcerpt) base.evidence_excerpt = evidenceExcerpt;

  appendHookEvent(cwd, {
    ...base,
    event: 'SkillEvolutionSignal',
  });
  appendEvolutionCandidate(cwd, {
    schemaVersion: 1,
    id: `evo-${Date.now().toString(36)}-${promptHash.slice(0, 12)}`,
    source: 'UserPromptSubmit',
    signalType: signalTypes.join(','),
    target: targetSkill,
    status: 'candidate',
    summary: 'User feedback matched skill-evolution signal rules.',
    recommendation: base.recommendation,
    evidence: {
      promptSha256: promptHash,
      promptLength: safeText(prompt).length,
      excerpt: evidenceExcerpt,
      redacted: Boolean(evidenceExcerpt),
      sessionId: inputData.session_id,
      turnId: inputData.turn_id,
    },
    recordedAt: base.recorded_at,
  });
  try {
    refreshEvolutionCandidateSummary(cwd);
  } catch {
    // Candidate summary must never block prompt handling.
  }
}

function inferEvolutionTargetSkill(prompt, matches) {
  const matchedSkillNames = new Set(matches.map((match) => match.name));
  if (/自进化|进化|记到进化|没有体验|没体验|自动.*记|没有.*记住|没.*记住/i.test(prompt)) {
    return 'bwy-skill-evolution';
  }
  if (/skill|技能|递归|链接|映射|初始化工具|hook|hooks/i.test(prompt)) {
    return 'bwy-project-skill-maintenance';
  }
  if (/工作流|updeng|并行|多个任务|同时跑|同一个文件|看不到对方|worktree|lane/i.test(prompt)) {
    return 'bwy-updeng-workflow';
  }
  if (matchedSkillNames.has('bwy-project-skill-maintenance')) return 'bwy-project-skill-maintenance';
  return matches[0]?.name || 'bwy-updeng-workflow';
}

function recommendationForSignals(signalTypes, targetSkill) {
  if (signalTypes.includes('workflow-gap')) {
    return `Review ${targetSkill} and hooks for a durable workflow rule, not a one-off reply.`;
  }
  if (signalTypes.includes('repeated-feedback')) {
    return `Mine prior events and update ${targetSkill} if the repeated feedback is valid.`;
  }
  return `Review this correction as a candidate update to routing, skill instructions, or workflow examples.`;
}

function detectEvolutionSignals(prompt) {
  return EVOLUTION_SIGNAL_RULES.filter((rule) => rule.pattern.test(prompt));
}

function redactedExcerpt(prompt, limit) {
  const text = safeText(prompt)
    .replace(/(sk-[A-Za-z0-9_-]{10,})/g, '[REDACTED_TOKEN]')
    .replace(/([A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})/g, '[REDACTED_TOKEN]')
    .replace(/\b(password|passwd|pwd|token|secret|api[_-]?key)\s*[:=]\s*([^\s,;]+)/gi, '$1=[REDACTED]')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[REDACTED_EMAIL]');
  return text.slice(0, limit);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isClaudeWorkerEnabled(cwd) {
  const agentsPath = path.join(projectPath(cwd), 'AGENTS.md');
  if (!fs.existsSync(agentsPath)) return false;
  let content = '';
  try {
    content = fs.readFileSync(agentsPath, 'utf8');
  } catch {
    return false;
  }
  return /^[ \t]*(?:<!--\s*)?AI_COLLAB_CLAUDE_WORKER:\s*enabled(?:\s*-->)?[ \t]*$/im.test(content);
}

function hasExplicitClaudeRequest(prompt) {
  return /claude|cluade|多模型|外部模型|协作模式|worker/i.test(prompt);
}

function main() {
  let inputData;
  try {
    inputData = JSON.parse(readStdin());
  } catch {
    return;
  }
  const rawPrompt = safeText(inputData.prompt).trim();
  const commandRoute = normalizePromptCommand(rawPrompt);
  const prompt = commandRoute.prompt || rawPrompt;
  const lowerPrompt = prompt.toLowerCase();
  if (SKIP_PATTERNS.some((pattern) => lowerPrompt.includes(pattern.toLowerCase()))) return;
  if (commandRoute.shouldSkip) return;

  const cwd = inputData.cwd;
  const isCodexOnly = CODEX_ONLY_PATTERNS.some((pattern) => pattern.test(prompt));
  const claudeWorkerEnabled = isClaudeWorkerEnabled(cwd);
  const explicitClaudeRequest = hasExplicitClaudeRequest(prompt);
  let [matchedSkills, workflowDepth] = routeMatches(prompt, cwd);
  if (isCodexOnly) {
    matchedSkills = matchedSkills.filter((skill) => skill.name !== 'bwy-collaborating-with-claude-code');
    if (workflowDepth === 'worker-assisted') workflowDepth = 'planned';
  }
  recordRouteEvent(cwd, inputData, prompt, matchedSkills, workflowDepth);
  recordEvolutionSignals(cwd, inputData, prompt, matchedSkills, workflowDepth);

  const mandatory = filterExisting(MANDATORY_SKILLS, cwd);
  const mandatoryText = mandatory.length ? mandatory.map((skill) => `- \`${skill.name}\``).join('\n') : '- 无';
  const matchedText = matchedSkills.length
    ? matchedSkills.map((skill) => `- \`${skill.name}\`: ${skill.reason}`).join('\n')
    : '- 无额外命中技能';
  const topRuleText = TOP_RULES.map((rule) => `- ${rule}`).join('\n');
  const laneText = activeLaneSummary(cwd);

  let collaborationSwitchText = 'Claude worker 总开关未开启：默认由 Codex 直接开发；只有用户明确要求 Claude Code/多模型协作时才评估外部协作技能。';
  if (claudeWorkerEnabled) collaborationSwitchText = 'Claude worker 总开关已开启：开发/修改任务默认评估并优先采用 Codex leader + Claude Code worker。';
  if (explicitClaudeRequest && !isCodexOnly) collaborationSwitchText = '本轮检测到用户明确要求 Claude Code/多模型协作：评估外部协作技能。';
  if (isCodexOnly) collaborationSwitchText = '本轮检测到 Codex-only 开关：不要调用 Claude Code；仍需读取并遵守其他命中 skills。';

  process.stdout.write(`## 技能激活

规则：
${topRuleText}
- 只评估实际项目 \`.codex/skills\` 下存在的技能；本仓库内容是模板，映射到项目后以项目内 \`.codex/skills\` 为准。
- 先读完必载和命中技能的 \`SKILL.md\`，再执行 Bash、shell、apply_patch 或搜索命令。
- 不在上下文中展开全部 skill description；除必载技能外，只在用户明确点名或任务语义强命中时读取对应 \`SKILL.md\`。
- 智能执行：direct 深度表示简单回答、单文件小改、文案/配置微调或明确的小修复；无需创建 change、计划文档或反复问答，直接处理，完成时说明验证或跳过原因。
- planned/high-risk/evolution 深度才需要创建或维护 Updeng 证据链；需求明确且低风险时不要为了流程向用户索要确认。
- 并行 lane 可见性：planned/high-risk/evolution 任务开始实现前必须登记 \`.updeng/docs/coordination/lanes.json\`；写入 shared path 前先读 \`status.md\`、对方计划、最新文件、diff 和最近 checkpoint。
- ${collaborationSwitchText}
${commandRoute.command ? `- 本轮由 \`${commandRoute.command}\` 显式触发技能路由，按去掉命令前缀后的需求处理。` : '- 本轮按默认技能路由处理，用户无需显式提到 Updeng。'}

当前并行 lane：
${laneText}

必载技能：
${mandatoryText}

建议命中技能：
${matchedText}

建议流程深度：\`${workflowDepth}\`

输出要求：
1. 先列出必载技能，再列出命中技能，格式：\`技能名: 理由\`。
2. 没有额外命中时写“无额外命中技能”。
3. 说明本轮流程深度是 direct、planned、high-risk、worker-assisted 还是 evolution。
4. 禁止引用项目外技能，禁止边读边执行。`);
}

main();
