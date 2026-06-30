#!/usr/bin/env node
// @author kongweiguang
/**
 * Validate project Codex hook wiring.
 */

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'];
const REQUIRED_TOOL_ALIASES = [
  'Bash',
  'shell',
  'exec_command',
  'functions.exec_command',
  'apply_patch',
  'functions.apply_patch',
  'Edit',
  'Write',
];

function projectRoot() {
  return path.resolve(__dirname, '..', '..');
}

function readHooksConfig(root) {
  return JSON.parse(fs.readFileSync(path.join(root, '.codex', 'hooks.json'), 'utf8'));
}

function hookCommands(config) {
  const commands = [];
  for (const [eventName, groups] of Object.entries(config.hooks || {})) {
    for (const group of groups || []) {
      for (const hook of group.hooks || []) {
        if (hook.type === 'command' && hook.command) {
          commands.push({ eventName, matcher: group.matcher || '', command: hook.command });
        }
      }
    }
  }
  return commands;
}

function commandScriptPath(root, command) {
  const match = /^node\s+(.+?)(?:\s|$)/.exec(command.trim());
  if (!match) return null;
  return path.resolve(root, match[1].replace(/\//g, path.sep));
}

function matcherCovers(matcher, alias) {
  try {
    return new RegExp(matcher).test(alias);
  } catch {
    return false;
  }
}

function validate(root) {
  const findings = [];
  const config = readHooksConfig(root);
  const checkedScripts = new Set();
  for (const eventName of REQUIRED_EVENTS) {
    if (!Array.isArray(config.hooks?.[eventName]) || config.hooks[eventName].length === 0) {
      findings.push(`[error] missing hook event ${eventName}`);
    }
  }

  for (const item of hookCommands(config)) {
    const scriptPath = commandScriptPath(root, item.command);
    if (!scriptPath) {
      findings.push(`[error] ${item.eventName}: unsupported command '${item.command}'`);
      continue;
    }
    if (!fs.existsSync(scriptPath)) {
      findings.push(`[error] ${item.eventName}: missing script ${scriptPath}`);
      continue;
    }
    checkedScripts.add(scriptPath);
  }

  const hooksDir = path.join(root, '.codex', 'hooks');
  for (const entry of fs.readdirSync(hooksDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.cjs')) checkedScripts.add(path.join(hooksDir, entry.name));
  }

  for (const scriptPath of checkedScripts) {
    const completed = childProcess.spawnSync(process.execPath, ['--check', scriptPath], {
      cwd: root,
      encoding: 'utf8',
    });
    if (completed.status !== 0) {
      findings.push(`[error] node --check failed for ${scriptPath}: ${(completed.stderr || completed.stdout).trim()}`);
    }
  }

  const preToolMatchers = (config.hooks?.PreToolUse || []).map((group) => group.matcher || '');
  const postToolMatchers = (config.hooks?.PostToolUse || []).map((group) => group.matcher || '');
  for (const alias of REQUIRED_TOOL_ALIASES) {
    if (!preToolMatchers.some((matcher) => matcherCovers(matcher, alias))) {
      findings.push(`[error] PreToolUse matcher does not cover ${alias}`);
    }
    if (!postToolMatchers.some((matcher) => matcherCovers(matcher, alias))) {
      findings.push(`[error] PostToolUse matcher does not cover ${alias}`);
    }
  }

  return findings;
}

function main() {
  const root = projectRoot();
  const findings = validate(root);
  if (findings.length) {
    console.log(findings.join('\n'));
    return 1;
  }
  console.log('Hooks config OK.');
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { validate };
