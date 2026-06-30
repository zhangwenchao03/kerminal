#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_ENV = 'local';
const SENSITIVE_KEYS = new Set(['password', 'passphrase', 'secret', 'token', 'credential', 'api_key', 'apikey']);
const SENSITIVE_SUFFIXES = ['_password', '_secret', '_token', '_credential'];
const SAFE_SECRET_METADATA_KEYS = new Set(['password_env', 'secret_env', 'token_env', 'has_password_ref']);

export class ScriptError extends Error {
  constructor(message, code = 2) {
    super(message);
    this.name = 'ScriptError';
    this.code = code;
  }
}

export function fail(message, code = 2) {
  throw new ScriptError(message, code);
}

export function projectRoot() {
  return process.cwd();
}

export function projectSetting(name) {
  const agentsPath = path.join(projectRoot(), 'AGENTS.md');
  if (!fs.existsSync(agentsPath)) return null;
  const content = fs.readFileSync(agentsPath, 'utf8');
  const match = new RegExp(`PROJECT_${escapeRegExp(name)}\\s*:\\s*(.*?)\\s*(?:-->|$)`, 'im').exec(content);
  return match ? match[1].trim().replace(/^`|`$/g, '').replace(/^['"]|['"]$/g, '') : null;
}

export function resolveProjectPath(value) {
  return path.isAbsolute(value) ? value : path.join(projectRoot(), value);
}

export function deepMerge(base, override) {
  const result = { ...(base || {}) };
  for (const [key, value] of Object.entries(override || {})) {
    if (isPlainObject(value) && isPlainObject(result[key])) result[key] = deepMerge(result[key], value);
    else result[key] = value;
  }
  return result;
}

export function expandDottedKeys(data) {
  if (Array.isArray(data)) return data.map(expandDottedKeys);
  if (!isPlainObject(data)) return data;
  let result = {};
  for (const [key, value] of Object.entries(data)) {
    const expandedValue = expandDottedKeys(value);
    const parts = String(key).split('.');
    if (parts.length === 1) {
      if (isPlainObject(result[key]) && isPlainObject(expandedValue)) result[key] = deepMerge(result[key], expandedValue);
      else result[key] = expandedValue;
      continue;
    }
    let nested = expandedValue;
    for (const part of parts.reverse()) nested = { [part]: nested };
    result = deepMerge(result, nested);
  }
  return result;
}

export function loadYamlFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8')
    .replace(/(:\s*)(@[^@\s]+@)(\s*(?:#.*)?$)/gm, '$1"$2"$3');
  try {
    return content.split(/^---\s*$/m)
      .map((doc) => parseSimpleYaml(doc))
      .filter(isPlainObject)
      .map(expandDottedKeys)
      .reduce((merged, doc) => deepMerge(merged, doc), {});
  } catch (error) {
    fail(`Invalid YAML ${filePath}: ${error.message}`);
  }
}

function parseSimpleYaml(text) {
  const root = {};
  const stack = [{ indent: -1, value: root }];
  for (const rawLine of text.split(/\r?\n/)) {
    const withoutComment = stripYamlComment(rawLine);
    if (!withoutComment.trim() || withoutComment.trim() === '---') continue;
    const indent = withoutComment.match(/^\s*/)[0].length;
    const line = withoutComment.trimEnd();
    const trimmed = line.trim();
    while (stack.length > 1 && indent <= stack.at(-1).indent) stack.pop();
    const parent = stack.at(-1).value;
    if (trimmed.startsWith('- ')) {
      if (!Array.isArray(parent)) continue;
      parent.push(parseYamlScalar(trimmed.slice(2).trim()));
      continue;
    }
    const match = /^([^:]+):(.*)$/.exec(trimmed);
    if (!match) continue;
    const key = match[1].trim().replace(/^['"]|['"]$/g, '');
    const rawValue = match[2].trim();
    if (rawValue === '') {
      const child = {};
      parent[key] = child;
      stack.push({ indent, value: child });
    } else {
      parent[key] = parseYamlScalar(rawValue);
    }
  }
  return root;
}

function stripYamlComment(line) {
  let quote = '';
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if ((char === '"' || char === "'") && line[index - 1] !== '\\') {
      quote = quote === char ? '' : quote || char;
    }
    if (char === '#' && !quote && (index === 0 || /\s/.test(line[index - 1]))) {
      return line.slice(0, index);
    }
  }
  return line;
}

function parseYamlScalar(value) {
  const raw = value.trim();
  if (!raw) return '';
  if (raw === 'null' || raw === '~') return null;
  if (/^(true|false)$/i.test(raw)) return raw.toLowerCase() === 'true';
  if (/^-?\d+$/.test(raw)) return Number.parseInt(raw, 10);
  if (/^-?\d+\.\d+$/.test(raw)) return Number.parseFloat(raw);
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) return raw.slice(1, -1);
  return raw;
}

export function findResourcesDir(explicit) {
  if (explicit) {
    const resolved = path.resolve(explicit);
    if (!fs.existsSync(resolved)) fail(`Resources directory not found: ${resolved}`);
    return resolved;
  }
  const startModule = projectSetting('START_MODULE');
  if (startModule) {
    const candidate = path.join(resolveProjectPath(startModule), 'src', 'main', 'resources');
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
    fail(`PROJECT_START_MODULE does not contain src/main/resources: ${candidate}`);
  }
  const root = projectRoot();
  const candidates = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('-start'))
    .map((entry) => path.join(root, entry.name, 'src', 'main', 'resources'))
    .filter((item) => fs.existsSync(item) && fs.statSync(item).isDirectory())
    .sort();
  if (candidates.length === 0) {
    const fallback = path.join(root, 'src', 'main', 'resources');
    if (fs.existsSync(fallback) && fs.statSync(fallback).isDirectory()) return fallback;
    fail('Spring resources directory not found. Use --resources-dir to specify it.');
  }
  return candidates.find((item) => fs.existsSync(path.join(item, 'application.yml')) || fs.existsSync(path.join(item, 'application.yaml'))) || candidates[0];
}

export function getPath(data, keyPath) {
  let current = data;
  for (const part of keyPath.split('.')) {
    if (!isPlainObject(current) || !(part in current)) return null;
    current = current[part];
  }
  return current;
}

export function normalizeProfileValue(value) {
  if (value == null) return null;
  let raw = String(value).trim().replace(/^['"]|['"]$/g, '');
  if (!raw || raw.startsWith('@')) return null;
  const envReference = /^\$\{([^}:]+)(?::([^}]+))?\}$/.exec(raw);
  if (envReference) raw = process.env[envReference[1]] || envReference[2] || '';
  return raw ? raw.split(',')[0].trim() || null : null;
}

export function activeProfileFromApplicationYml(resourcesDir) {
  let base = loadYamlFile(path.join(resourcesDir, 'application.yml'));
  if (!Object.keys(base).length) base = loadYamlFile(path.join(resourcesDir, 'application.yaml'));
  return normalizeProfileValue(getPath(base, 'spring.profiles.active'));
}

export function detectEnv(explicitEnv, resourcesDir) {
  if (explicitEnv) return explicitEnv.trim();
  for (const key of ['SPRING_PROFILES_ACTIVE', 'APP_ENV', 'PROFILE']) {
    if (process.env[key]) return process.env[key].split(',')[0].trim();
  }
  return activeProfileFromApplicationYml(resourcesDir || findResourcesDir()) || DEFAULT_ENV;
}

export function configFiles(resourcesDir, env) {
  const files = [];
  for (const name of ['application.yml', 'application.yaml']) {
    const candidate = path.join(resourcesDir, name);
    if (fs.existsSync(candidate)) {
      files.push(candidate);
      break;
    }
  }
  for (const suffix of ['yml', 'yaml']) {
    const candidate = path.join(resourcesDir, `application-${env}.${suffix}`);
    if (fs.existsSync(candidate)) {
      files.push(candidate);
      break;
    }
  }
  return files;
}

export function loadConfig(resourcesDirArg, envArg) {
  const resourcesDir = findResourcesDir(resourcesDirArg);
  const resolvedEnv = detectEnv(envArg, resourcesDir);
  const files = configFiles(resourcesDir, resolvedEnv);
  if (files.length === 0) fail(`No application YAML files found under ${resourcesDir}`);
  const merged = files.map(loadYamlFile).reduce((acc, item) => deepMerge(acc, item), {});
  return [springConfigToTargets(merged, resourcesDir, files), resourcesDir, resolvedEnv];
}

export function envReference(value) {
  if (typeof value !== 'string') return null;
  const match = /^\$\{([^}:]+)(?::([^}]*))?\}$/.exec(value.trim());
  return match ? match[1] : null;
}

export function resolveEnvReference(value) {
  if (typeof value !== 'string') return value;
  const match = /^\$\{([^}:]+)(?::([^}]*))?\}$/.exec(value.trim());
  if (!match) return value;
  if (process.env[match[1]] != null) return process.env[match[1]];
  return match[2] != null ? match[2] : value;
}

export function inferDbType(target) {
  const raw = String(target.type || target['driver-class-name'] || target.driverClassName || target.driver || target.url || '').toLowerCase();
  if (raw.includes('postgres') || raw.includes('pgsql')) return 'postgresql';
  if (raw.includes('mysql') || raw.includes('mariadb')) return 'mysql';
  return raw;
}

export function databaseTargetFromSpring(name, data) {
  const target = { ...data };
  if ('jdbc-url' in target && !('url' in target)) target.url = target['jdbc-url'];
  if (!('user' in target) && 'username' in target) target.user = target.username;
  const passwordReference = envReference(target.password);
  if (passwordReference) target.password_env = passwordReference;
  target.password = resolveEnvReference(target.password);
  target.type = inferDbType(target);
  target.read_only ??= true;
  target.description ??= `Spring datasource '${name}'`;
  return target;
}

export function redisTargetFromSpring(data) {
  if (!isPlainObject(data) || Object.keys(data).length === 0) return null;
  const target = { ...data };
  const passwordReference = envReference(target.password);
  if (passwordReference) target.password_env = passwordReference;
  target.password = resolveEnvReference(target.password);
  target.host ??= '127.0.0.1';
  target.port ??= 6379;
  target.database ??= target.db ?? 0;
  target.read_only ??= true;
  target.description ??= 'Spring Redis';
  return target;
}

export function springConfigToTargets(data, resourcesDir, files) {
  const datasource = getPath(data, 'spring.datasource');
  const databases = {};
  if (isPlainObject(datasource)) {
    const dynamicSources = getPath(data, 'spring.datasource.dynamic.datasource');
    if (isPlainObject(dynamicSources)) {
      for (const [name, item] of Object.entries(dynamicSources)) {
        if (isPlainObject(item)) databases[String(name)] = databaseTargetFromSpring(String(name), item);
      }
    } else if (datasource.url || datasource['jdbc-url']) {
      databases.master = databaseTargetFromSpring('master', datasource);
    }
  }
  const redisData = getPath(data, 'spring.data.redis');
  const redisTarget = isPlainObject(redisData) ? redisTargetFromSpring(redisData) : null;
  return {
    environment: null,
    source: 'spring-application-yaml',
    resources_dir: String(resourcesDir),
    source_yaml: files.map(String),
    defaults: {
      audit_log_dir: 'tmp/data-source-audit',
      connect_timeout_sec: 8,
      query_timeout_sec: 30,
      row_limit: 100,
    },
    databases,
    redis: redisTarget ? { main: redisTarget } : {},
  };
}

export function sectionTargets(config, section) {
  const raw = config[section] || {};
  if (!isPlainObject(raw)) fail(`Config section '${section}' must be an object.`);
  return raw;
}

export function chooseTarget(config, section, target) {
  const targets = sectionTargets(config, section);
  if (Object.keys(targets).length === 0) fail(`Config section '${section}' has no targets.`);
  if (target) {
    if (!(target in targets)) fail(`Unknown ${section} target '${target}'. Available: ${Object.keys(targets).sort().join(', ')}`);
    if (!isPlainObject(targets[target])) fail(`Target '${target}' in section '${section}' must be an object.`);
    return [target, targets[target]];
  }
  const preferred = section === 'databases' && targets.master ? 'master' : 'main';
  const name = targets[preferred] ? preferred : Object.keys(targets).sort()[0];
  if (!isPlainObject(targets[name])) fail(`Target '${name}' in section '${section}' must be an object.`);
  return [name, targets[name]];
}

export function mergedDefaults(config, target) {
  const defaults = isPlainObject(config.defaults) ? config.defaults : {};
  return { ...defaults, ...target };
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

export function asInt(value, defaultValue) {
  const resolved = resolveEnvReference(value);
  if (resolved == null || resolved === '') return defaultValue;
  const parsed = Number.parseInt(resolved, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

export function redact(value) {
  if (isPlainObject(value)) {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      const lowered = key.toLowerCase();
      if (SAFE_SECRET_METADATA_KEYS.has(lowered)) result[key] = redact(item);
      else if (SENSITIVE_KEYS.has(lowered) || SENSITIVE_SUFFIXES.some((suffix) => lowered.endsWith(suffix))) result[key] = '<redacted>';
      else result[key] = redact(item);
    }
    return result;
  }
  if (Array.isArray(value)) return value.map(redact);
  return value;
}

export function resolvePassword(target, required = false) {
  if (target.password_env && process.env[String(target.password_env)]) return process.env[String(target.password_env)];
  if (target.password != null) return String(target.password);
  if (required) fail('Target password is missing in Spring YAML.');
  return null;
}

export function parseJdbcUrl(url) {
  let raw = String(url || '').trim();
  if (raw.startsWith('jdbc:')) raw = raw.slice(5);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return {};
  }
  let dbType = parsed.protocol.replace(/:$/, '').toLowerCase();
  if (dbType === 'postgres') dbType = 'postgresql';
  const result = {
    type: dbType,
    host: parsed.hostname || null,
    port: parsed.port ? Number.parseInt(parsed.port, 10) : null,
    database: parsed.pathname ? parsed.pathname.replace(/^\//, '') : null,
  };
  if (parsed.searchParams.has('sslmode')) result.sslmode = parsed.searchParams.get('sslmode');
  return Object.fromEntries(Object.entries(result).filter(([, value]) => value != null && value !== ''));
}

export function normalizeDatabaseTarget(config, target) {
  const merged = mergedDefaults(config, target);
  const url = merged.jdbc_url || merged['jdbc-url'] || merged.url;
  const parsed = url ? parseJdbcUrl(String(url)) : {};
  const normalized = { ...parsed };
  for (const [key, value] of Object.entries(merged)) {
    if (value != null) normalized[key] = resolveEnvReference(value);
  }
  if (!('read_only' in normalized)) normalized.read_only = normalized['read-only'] ?? normalized.readOnly;
  if (!('allow_dangerous' in normalized)) normalized.allow_dangerous = normalized['allow-dangerous'] ?? normalized.allowDangerous;
  let dbType = inferDbType(normalized);
  if (dbType.startsWith('${') && parsed.type) dbType = parsed.type;
  const aliases = { postgres: 'postgresql', pgsql: 'postgresql', postgresql: 'postgresql', mysql: 'mysql', mariadb: 'mysql' };
  normalized.type = aliases[dbType] || dbType;
  if (!['postgresql', 'mysql'].includes(normalized.type)) fail("Database target type must be 'postgresql' or 'mysql'.");
  return normalized;
}

export function normalizeRedisTarget(config, target) {
  const merged = mergedDefaults(config, target);
  const normalized = Object.fromEntries(Object.entries(merged).map(([key, value]) => [key, resolveEnvReference(value)]));
  normalized.host ||= '127.0.0.1';
  normalized.port = asInt(normalized.port, 6379);
  normalized.database = asInt(normalized.database, asInt(normalized.db, 0));
  return normalized;
}

export function configSummary(config, resourcesDir, env) {
  return {
    env,
    resources_dir: String(resourcesDir),
    source_yaml: config.source_yaml,
    database_targets: Object.keys(sectionTargets(config, 'databases')).sort(),
    redis_targets: Object.keys(sectionTargets(config, 'redis')).sort(),
  };
}

export function auditEvent(config, env, section, targetName, event) {
  const defaults = isPlainObject(config.defaults) ? config.defaults : {};
  const logDir = path.resolve(String(defaults.audit_log_dir || 'tmp/data-source-audit'));
  fs.mkdirSync(logDir, { recursive: true });
  const payload = {
    time: new Date().toISOString(),
    env,
    section,
    target: targetName,
    ...event,
  };
  fs.appendFileSync(path.join(logDir, `${env}-${section}-${targetName}.jsonl`), `${JSON.stringify(payload)}\n`, 'utf8');
}

export function sqlFingerprint(sql) {
  return crypto.createHash('sha256').update(sql, 'utf8').digest('hex').slice(0, 16);
}

export function removeSqlComments(sql) {
  return String(sql).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--.*$/gm, ' ');
}

export function normalizedSql(sql) {
  return removeSqlComments(sql).replace(/\s+/g, ' ').trim();
}

export function sqlStatements(sql) {
  return normalizedSql(sql).split(';').map((item) => item.trim()).filter(Boolean);
}

export function sqlKeyword(sql) {
  const match = /^([A-Za-z]+)/.exec(normalizedSql(sql).replace(/^\(/, '').trim());
  return match ? match[1].toLowerCase() : '';
}

export function sqlPolicy(_target, sql, allowWrite = false, confirmDelete = false) {
  const text = normalizedSql(sql);
  if (!text) return [false, 'empty SQL'];
  const statements = sqlStatements(text);
  if (statements.length === 0) return [false, 'empty SQL'];
  if (statements.length > 1) return [false, 'multiple SQL statements are not allowed'];
  const keyword = sqlKeyword(statements[0]);
  const readKeywords = new Set(['select', 'show', 'explain', 'describe', 'desc']);
  const destructiveKeywords = new Set(['delete', 'drop', 'truncate']);
  if (readKeywords.has(keyword)) return [true, 'read-only SQL'];
  const displayKeyword = keyword ? keyword.toUpperCase() : '<UNKNOWN>';
  if (!allowWrite) return [false, `write SQL requires --allow-write: ${displayKeyword}`];
  if (destructiveKeywords.has(keyword) && !confirmDelete) {
    return [false, `${displayKeyword} requires --confirm-delete after explicit user confirmation`];
  }
  return [true, `write SQL allowed by --allow-write: ${displayKeyword}`];
}

export function jsonPrint(payload) {
  console.log(JSON.stringify(redact(payload), null, 2));
}

export function moduleDirectory(importMetaUrl) {
  return path.dirname(fileURLToPath(importMetaUrl));
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
