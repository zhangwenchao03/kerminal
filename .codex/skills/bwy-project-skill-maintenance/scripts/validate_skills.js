#!/usr/bin/env node
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_EXCLUDES = new Set();
const ALLOWED_SCRIPT_SUFFIXES = new Set(['.js', '.mjs', '.cjs', '.py']);
const REQUIRED_AGENT_KEYS = ['display_name', 'short_description', 'default_prompt'];

export class Finding {
  constructor(level, filePath, message) {
    this.level = level;
    this.path = filePath;
    this.message = message;
  }
}

export function skillsRoot() {
  const groupRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const maybeSkillsRoot = path.dirname(groupRoot);
  return path.basename(maybeSkillsRoot) === 'skills' ? maybeSkillsRoot : groupRoot;
}

export function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!match) return {};
  const data = {};
  for (const rawLine of match[1].split(/\r?\n/)) {
    if (!rawLine.trim() || /^[ \t]/.test(rawLine)) continue;
    const [key, ...rest] = rawLine.split(':');
    if (!rest.length) continue;
    data[key.trim()] = rest.join(':').trim().replace(/^['"]|['"]$/g, '');
  }
  return data;
}

export function agentMetadataKeys(text) {
  const keys = new Set();
  let inInterface = false;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === 'interface:') {
      inInterface = true;
      continue;
    }
    if (inInterface) {
      if (line && !/^[ \t]/.test(line)) break;
      const [key, ...rest] = line.trim().split(':');
      if (rest.length) keys.add(key);
    }
  }
  return keys;
}

export function iterSkillDirs(root, includeExcluded = false) {
  if (!fs.existsSync(root)) return [];
  const immediate = fs.existsSync(root)
    ? fs.readdirSync(root, { withFileTypes: true })
      .filter((item) => isDirectoryLikeSkillEntry(root, item))
      .map((item) => path.join(root, item.name))
    : [];
  const dirs = immediate.length > 0 ? immediate : fs.readdirSync(root, { withFileTypes: true })
    .filter((item) => item.isDirectory() || item.isSymbolicLink())
    .flatMap((group) => {
      const groupPath = path.join(root, group.name);
      return fs.readdirSync(groupPath, { withFileTypes: true })
        .filter((item) => isDirectoryLikeSkillEntry(groupPath, item))
        .map((item) => path.join(groupPath, item.name));
    });
  return dirs
    .filter((item) => includeExcluded || !DEFAULT_EXCLUDES.has(path.basename(item)))
    .sort();
}

function isDirectoryLikeSkillEntry(root, entry) {
  if (!entry.isDirectory() && !entry.isSymbolicLink()) return false;
  return fs.existsSync(path.join(root, entry.name, 'SKILL.md'));
}

export function validateSkillDir(skillDir) {
  const findings = [];
  const skillMd = path.join(skillDir, 'SKILL.md');
  const text = fs.readFileSync(skillMd, 'utf8');
  const frontmatter = parseFrontmatter(text);
  const name = frontmatter.name;
  const description = frontmatter.description;
  if (!name) findings.push(new Finding('error', skillMd, 'missing frontmatter name'));
  else if (name !== path.basename(skillDir)) findings.push(new Finding('error', skillMd, `name '${name}' does not match directory '${path.basename(skillDir)}'`));
  if (!description) findings.push(new Finding('error', skillMd, 'missing frontmatter description'));

  if (path.basename(skillDir).startsWith('bwy-')) {
    const agentFile = path.join(skillDir, 'agents', 'openai.yaml');
    if (!fs.existsSync(agentFile)) findings.push(new Finding('error', agentFile, 'missing agents/openai.yaml for bwy skill'));
    else {
      const keys = agentMetadataKeys(fs.readFileSync(agentFile, 'utf8'));
      for (const key of REQUIRED_AGENT_KEYS) {
        if (!keys.has(key)) findings.push(new Finding('error', agentFile, `missing interface.${key}`));
      }
    }
  }

  const scriptsDir = path.join(skillDir, 'scripts');
  if (fs.existsSync(scriptsDir)) {
    for (const script of fs.readdirSync(scriptsDir, { withFileTypes: true })) {
      const scriptPath = path.join(scriptsDir, script.name);
      if (script.isFile() && !ALLOWED_SCRIPT_SUFFIXES.has(path.extname(script.name).toLowerCase())) {
        findings.push(new Finding('error', scriptPath, `unsupported script suffix '${path.extname(script.name)}'`));
      }
    }
  }

  for (const jsonFile of walkFiles(path.join(skillDir, 'references')).filter((item) => item.endsWith('.json'))) {
    try {
      JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
    } catch (error) {
      findings.push(new Finding('error', jsonFile, `invalid JSON: ${error.message}`));
    }
  }

  if (/^\s*(?:[-*]\s*)?(?:TODO|TBD)\s*[:：]/im.test(text)) findings.push(new Finding('warning', skillMd, 'contains unresolved TODO/TBD marker'));
  return findings;
}

export function validateSkillReferences(root, skillDirs) {
  const findings = [];
  const known = new Set(skillDirs.map((item) => path.basename(item)));
  for (const item of DEFAULT_EXCLUDES) known.add(item);
  for (const skillDir of skillDirs) {
    const skillMd = path.join(skillDir, 'SKILL.md');
    const text = fs.readFileSync(skillMd, 'utf8');
    for (const [, name] of text.matchAll(/`(bwy-[a-z0-9-]+)`/g)) {
      if (!known.has(name)) findings.push(new Finding('error', skillMd, `references missing skill '${name}'`));
    }
  }
  return findings;
}

export function testFiles(root, includeExcluded = false) {
  return iterSkillDirs(root, includeExcluded)
    .flatMap((skillDir) => {
      const scriptsDir = path.join(skillDir, 'scripts');
      if (!fs.existsSync(scriptsDir)) return [];
      return fs.readdirSync(scriptsDir)
        .filter((name) => /^test_.*\.mjs$/.test(name) || /^.*\.test\.mjs$/.test(name))
        .map((name) => path.join(scriptsDir, name));
    })
    .sort();
}

export function runNodeTests(files) {
  const findings = [];
  for (const testFile of files) {
    const completed = childProcess.spawnSync(process.execPath, ['--test', path.basename(testFile)], {
      cwd: path.dirname(testFile),
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    });
    if (completed.status !== 0) {
      const summary = `${completed.stdout || ''}${completed.stderr || ''}`.trim().split(/\r?\n/);
      const tail = summary.length ? summary.slice(-6).join(' | ') : `exit ${completed.status}`;
      findings.push(new Finding('error', testFile, `unit test failed: ${tail}`));
    }
  }
  return findings;
}

export function validate(root, options = {}) {
  const findings = [];
  const skillDirs = iterSkillDirs(root, Boolean(options.includeExcluded));
  for (const skillDir of skillDirs) findings.push(...validateSkillDir(skillDir));
  findings.push(...validateSkillReferences(root, skillDirs));
  if (options.runTests) findings.push(...runNodeTests(testFiles(root, Boolean(options.includeExcluded))));
  return {
    root,
    excluded: options.includeExcluded ? [] : [...DEFAULT_EXCLUDES].sort(),
    checked_skills: skillDirs.map((item) => path.basename(item)),
    findings,
  };
}

function walkFiles(root) {
  if (!fs.existsSync(root)) return [];
  const result = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...walkFiles(entryPath));
    else if (entry.isFile()) result.push(entryPath);
  }
  return result;
}

function parseArgs(argv) {
  const args = { root: skillsRoot(), includeExcluded: false, runTests: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--include-excluded') args.includeExcluded = true;
    else if (arg === '--run-tests') args.runTests = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--root') args.root = path.resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function main(argv) {
  const args = parseArgs(argv);
  const payload = validate(path.resolve(args.root), args);
  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`Checked ${payload.checked_skills.length} skill(s). Excluded: ${payload.excluded.join(', ') || '<none>'}`);
    if (payload.findings.length) {
      for (const finding of payload.findings) console.log(`[${finding.level}] ${finding.path}: ${finding.message}`);
    } else {
      console.log('No findings.');
    }
  }
  return payload.findings.some((finding) => finding.level === 'error') ? 1 : 0;
}

function sameEntrypoint(left, right) {
  try {
    return fs.realpathSync(left) === fs.realpathSync(right);
  } catch {
    return path.resolve(left) === path.resolve(right);
  }
}

if (process.argv[1] && sameEntrypoint(fileURLToPath(import.meta.url), process.argv[1])) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}
