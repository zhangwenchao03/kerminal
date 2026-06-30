#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as common from '../../bwy-database-change-management/scripts/data_source_common.js';

const REDIS_PACKAGE = 'redis';

async function importRedis() {
  try {
    return await import(REDIS_PACKAGE);
  } catch {
    common.fail(`Missing npm package ${REDIS_PACKAGE}. Install it in the project before connecting: npm install redis`);
  }
}

export function loadRedis(args) {
  const [config, resourcesDir, env] = common.loadConfig(args.resourcesDir, args.env);
  const [targetName, rawTarget] = common.chooseTarget(config, 'redis', args.target);
  const target = common.normalizeRedisTarget(config, rawTarget);
  return [config, resourcesDir, env, targetName, target];
}

async function client(target) {
  const redis = await importRedis();
  const password = common.resolvePassword(target, Boolean(target.password_env || target.password));
  const url = `redis://${password ? `:${encodeURIComponent(password)}@` : ''}${target.host}:${common.asInt(target.port, 6379)}/${common.asInt(target.database, 0)}`;
  const instance = redis.createClient({
    url,
    socket: {
      connectTimeout: common.asInt(target.connect_timeout_sec, 5) * 1000,
      timeout: common.asInt(target.socket_timeout_sec, 8) * 1000,
    },
  });
  await instance.connect();
  return instance;
}

export function commandList(args) {
  const [config, resourcesDir, env] = common.loadConfig(args.resourcesDir, args.env);
  common.jsonPrint(common.configSummary(config, resourcesDir, env));
  return 0;
}

export function commandValidate(args) {
  const [config, resourcesDir, env] = common.loadConfig(args.resourcesDir, args.env);
  const result = {
    env,
    resources_dir: String(resourcesDir),
    source_yaml: config.source_yaml,
    redis: {},
    warnings: [],
  };
  for (const [name, rawTarget] of Object.entries(common.sectionTargets(config, 'redis'))) {
    if (!rawTarget || typeof rawTarget !== 'object' || Array.isArray(rawTarget)) {
      result.warnings.push(`${name}: target must be object`);
      continue;
    }
    const target = common.normalizeRedisTarget(config, rawTarget);
    result.redis[name] = {
      host: target.host,
      port: target.port,
      database: target.database,
      read_only: common.asBool(target.read_only, true),
      has_password_ref: Boolean(target.password_env || target.password),
      description: target.description,
    };
    if (target.password) result.warnings.push(`${name}: YAML contains inline password; prefer environment variable reference for new configs`);
  }
  common.jsonPrint(result);
  return 0;
}

export async function commandPing(args) {
  const [config, , env, targetName, target] = loadRedis(args);
  const r = await client(target);
  try {
    const pong = await r.ping();
    common.auditEvent(config, env, 'redis', targetName, { action: 'ping', allowed: true });
    common.jsonPrint({ target: targetName, database: target.database, ok: Boolean(pong) });
    return 0;
  } finally {
    await r.quit();
  }
}

export function decode(value) {
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [decode(key), decode(item)]));
  }
  return value;
}

export async function commandInfo(args) {
  const [config, , env, targetName, target] = loadRedis(args);
  const r = await client(target);
  try {
    const payload = await r.info(args.section === 'default' ? undefined : args.section);
    common.auditEvent(config, env, 'redis', targetName, { action: 'info', allowed: true, section: args.section });
    common.jsonPrint({ target: targetName, section: args.section, info: payload });
    return 0;
  } finally {
    await r.quit();
  }
}

export async function commandScan(args) {
  const [config, , env, targetName, target] = loadRedis(args);
  const r = await client(target);
  try {
    const keys = [];
    for await (const key of r.scanIterator({ MATCH: args.pattern, COUNT: args.count })) {
      keys.push(decode(key));
      if (keys.length >= args.limit) break;
    }
    common.auditEvent(config, env, 'redis', targetName, { action: 'scan', allowed: true, pattern: args.pattern, limit: args.limit });
    common.jsonPrint({ target: targetName, pattern: args.pattern, keys, count: keys.length, truncated: keys.length >= args.limit });
    return 0;
  } finally {
    await r.quit();
  }
}

export function bytesPreview(value, maxBytes, showValue) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  if (!showValue) return { length: buffer.length, value_redacted: true };
  const clipped = buffer.subarray(0, maxBytes);
  return {
    length: buffer.length,
    truncated: buffer.length > maxBytes,
    value: clipped.toString('utf8'),
  };
}

export async function inspectKey(r, key, limit, maxValueBytes, showValue) {
  const keyType = decode(await r.type(key));
  const ttl = await r.ttl(key);
  const result = { key, type: keyType, ttl };
  if (keyType === 'none') result.exists = false;
  else if (keyType === 'string') result.value = bytesPreview(await r.get(Buffer.from(key)) || Buffer.alloc(0), maxValueBytes, showValue);
  else if (keyType === 'hash') {
    result.length = await r.hLen(key);
    const sample = [];
    for await (const field of r.hScanIterator(key, { COUNT: limit })) {
      sample.push({ field: decode(field.field), ...bytesPreview(field.value, maxValueBytes, showValue) });
      if (sample.length >= limit) break;
    }
    result.sample = sample;
  } else {
    result.note = 'This Redis type is summarized by type and ttl only in the JS helper.';
  }
  return result;
}

export async function commandInspect(args) {
  const [config, , env, targetName, target] = loadRedis(args);
  const r = await client(target);
  try {
    const payload = await inspectKey(r, args.key, args.limit, args.maxValueBytes, Boolean(args.showValue));
    common.auditEvent(config, env, 'redis', targetName, { action: 'inspect', allowed: true, key: args.key, show_value: Boolean(args.showValue) });
    common.jsonPrint({ target: targetName, ...payload });
    return 0;
  } finally {
    await r.quit();
  }
}

function parseArgs(argv) {
  const args = { section: 'default', pattern: '*', count: 100, limit: 50, maxValueBytes: 512, showValue: false };
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const [rawName, inline] = arg.slice(2).split('=', 2);
    if (rawName === 'show-value') {
      args.showValue = true;
      continue;
    }
    const value = inline === undefined ? argv[index + 1] : inline;
    if (value === undefined) common.fail(`Missing value for --${rawName}`);
    index += inline === undefined ? 1 : 0;
    const key = rawName.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    args[key] = ['count', 'limit', 'maxValueBytes'].includes(key) ? Number.parseInt(value, 10) : value;
  }
  args.command = positionals[0];
  if (!args.command) common.fail('Usage: redis_ops.js list|validate|ping|info|scan|inspect ...');
  return args;
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.command === 'list') return commandList(args);
  if (args.command === 'validate') return commandValidate(args);
  if (args.command === 'ping') return commandPing(args);
  if (args.command === 'info') return commandInfo(args);
  if (args.command === 'scan') return commandScan(args);
  if (args.command === 'inspect') {
    if (!args.key) common.fail('inspect requires --key');
    return commandInspect(args);
  }
  common.fail(`Unknown command: ${args.command}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    if (error instanceof common.ScriptError) {
      console.error(`ERROR: ${error.message}`);
      process.exitCode = error.code;
    } else {
      console.error(`ERROR: ${error.message}`);
      process.exitCode = 1;
    }
  });
}
