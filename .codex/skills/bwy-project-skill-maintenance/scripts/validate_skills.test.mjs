import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import * as validateSkills from './validate_skills.js';

test('parseFrontmatter extracts name and description', () => {
  const parsed = validateSkills.parseFrontmatter('---\nname: bwy-demo\ndescription: |\n  demo skill\n---\n# Body\n');
  assert.equal(parsed.name, 'bwy-demo');
  assert.equal(parsed.description, '|');
});

test('bwy skill requires agents metadata', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-validate-'));
  try {
    const skillDir = path.join(root, 'bwy-demo');
    fs.mkdirSync(skillDir);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: bwy-demo\ndescription: demo\n---\n', 'utf8');
    const findings = validateSkills.validateSkillDir(skillDir);
    assert.ok(findings.some((finding) => finding.message.includes('missing agents/openai.yaml')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('valid JSON reference passes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-validate-'));
  try {
    const skillDir = path.join(root, 'bwy-demo');
    fs.mkdirSync(path.join(skillDir, 'references'), { recursive: true });
    fs.mkdirSync(path.join(skillDir, 'agents'));
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: bwy-demo\ndescription: demo\n---\n', 'utf8');
    fs.writeFileSync(path.join(skillDir, 'agents', 'openai.yaml'), 'interface:\n  display_name: Demo\n  short_description: Demo skill\n  default_prompt: Use demo.\n', 'utf8');
    fs.writeFileSync(path.join(skillDir, 'references', 'sample.json'), JSON.stringify({ ok: true }), 'utf8');
    const findings = validateSkills.validateSkillDir(skillDir);
    assert.deepEqual(findings.filter((finding) => finding.level === 'error'), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('missing skill reference is reported', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-validate-'));
  try {
    const skillDir = path.join(root, 'bwy-demo');
    fs.mkdirSync(path.join(skillDir, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: bwy-demo\ndescription: demo\n---\nUse `bwy-missing-skill`.\n', 'utf8');
    const findings = validateSkills.validateSkillReferences(root, [skillDir]);
    assert.ok(findings.some((finding) => finding.message.includes('bwy-missing-skill')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
