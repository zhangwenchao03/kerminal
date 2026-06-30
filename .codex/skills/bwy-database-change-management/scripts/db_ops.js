#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as common from './data_source_common.js';

const POSTGRES_PACKAGE = 'pg';
const MYSQL_PACKAGE = 'mysql2/promise';

async function importOptional(packageName, installHint) {
  try {
    return await import(packageName);
  } catch (error) {
    common.fail(`Missing npm package ${packageName}. Install it in the project before connecting: ${installHint}`);
  }
}

export function loadDatabase(args) {
  const [config, resourcesDir, env] = common.loadConfig(args.resourcesDir, args.env);
  const [targetName, rawTarget] = common.chooseTarget(config, 'databases', args.target);
  const target = common.normalizeDatabaseTarget(config, rawTarget);
  return [config, resourcesDir, env, targetName, target];
}

async function connect(target) {
  const dbType = String(target.type);
  const password = common.resolvePassword(target, true);
  const connectTimeout = common.asInt(target.connect_timeout_sec, 8);
  if (dbType === 'postgresql') {
    const pg = await importOptional(POSTGRES_PACKAGE, 'npm install pg');
    const client = new pg.Client({
      host: target.host,
      port: common.asInt(target.port, 5432),
      database: target.database,
      user: target.username || target.user,
      password,
      connectionTimeoutMillis: connectTimeout * 1000,
      ssl: target.sslmode ? { rejectUnauthorized: target.sslmode !== 'disable' } : undefined,
    });
    await client.connect();
    return {
      type: 'postgresql',
      async query(sql, params = []) {
        return client.query(sql, params);
      },
      async commit() {},
      async close() {
        await client.end();
      },
    };
  }
  const mysqlModule = await importOptional(MYSQL_PACKAGE, 'npm install mysql2');
  const connection = await mysqlModule.createConnection({
    host: String(target.host),
    port: common.asInt(target.port, 3306),
    database: String(target.database),
    user: String(target.username || target.user),
    password,
    connectTimeout: connectTimeout * 1000,
    charset: String(target.charset || 'utf8mb4'),
  });
  return {
    type: 'mysql',
    async query(sql, params = []) {
      const [rows, fields] = await connection.execute(sql, params);
      return { rows: Array.isArray(rows) ? rows : [], fields: fields || [] };
    },
    async commit() {
      await connection.commit();
    },
    async close() {
      await connection.end();
    },
  };
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
    databases: {},
    warnings: [],
  };
  for (const [name, rawTarget] of Object.entries(common.sectionTargets(config, 'databases'))) {
    if (!rawTarget || typeof rawTarget !== 'object' || Array.isArray(rawTarget)) {
      result.warnings.push(`${name}: target must be object`);
      continue;
    }
    try {
      const target = common.normalizeDatabaseTarget(config, rawTarget);
      const hasSecretRef = Boolean(target.password_env || target.password);
      result.databases[name] = {
        type: target.type,
        host: target.host,
        port: target.port,
        database: target.database,
        username: target.username || target.user,
        read_only: common.asBool(target.read_only, true),
        has_password_ref: hasSecretRef,
        description: target.description,
      };
      if (target.password) result.warnings.push(`${name}: YAML contains inline password; prefer environment variable reference for new configs`);
      if (!hasSecretRef) result.warnings.push(`${name}: missing password_env/password`);
    } catch (error) {
      result.warnings.push(`${name}: ${error.message}`);
    }
  }
  common.jsonPrint(result);
  return 0;
}

export async function commandPing(args) {
  const [config, , env, targetName, target] = loadDatabase(args);
  const conn = await connect(target);
  try {
    const result = await conn.query('select version()');
    common.auditEvent(config, env, 'databases', targetName, { action: 'ping', allowed: true });
    const version = firstCell(result);
    common.jsonPrint({ target: targetName, type: target.type, ok: true, version });
    return 0;
  } finally {
    await conn.close();
  }
}

async function applySessionLimits(conn, target) {
  const timeoutMs = common.asInt(target.query_timeout_sec, 30) * 1000;
  try {
    if (target.type === 'postgresql') await conn.query('select set_config($1, $2, false)', ['statement_timeout', String(timeoutMs)]);
    else if (target.type === 'mysql') await conn.query(`set session max_execution_time=${timeoutMs}`);
  } catch {
    // Session limits are best-effort diagnostics safety.
  }
}

function fetchRows(result, rowLimit) {
  const rows = Array.isArray(result.rows) ? result.rows.slice(0, rowLimit + 1) : [];
  const truncated = rows.length > rowLimit;
  const clipped = rows.slice(0, rowLimit);
  const columns = Array.isArray(result.fields)
    ? result.fields.map((field) => field.name || field.columnID || field[0]).filter(Boolean)
    : (clipped[0] && typeof clipped[0] === 'object' ? Object.keys(clipped[0]) : []);
  return [columns, clipped, truncated];
}

export async function commandQuery(args) {
  const [config, , env, targetName, target] = loadDatabase(args);
  const sql = args.sql != null ? args.sql : fs.readFileSync(path.resolve(args.file), 'utf8');
  const [allowed, reason] = common.sqlPolicy(target, sql, Boolean(args.allowWrite), Boolean(args.confirmDelete));
  common.auditEvent(config, env, 'databases', targetName, {
    action: 'query',
    allowed,
    reason,
    sql_hash: common.sqlFingerprint(sql),
    keyword: common.sqlKeyword(sql),
  });
  if (!allowed) common.fail(reason);
  const rowLimit = Math.min(args.limit, common.asInt(target.row_limit, 100));
  const conn = await connect(target);
  try {
    await applySessionLimits(conn, target);
    const result = await conn.query(sql);
    const [columns, rows, truncated] = fetchRows(result, rowLimit);
    if (!columns.length) await conn.commit();
    common.jsonPrint({
      target: targetName,
      type: target.type,
      columns,
      rows,
      row_count: rows.length,
      truncated,
      reason,
    });
    return 0;
  } finally {
    await conn.close();
  }
}

function splitTable(rawTable, defaultSchema) {
  if (rawTable.includes('.')) {
    const [schema, table] = rawTable.split('.', 2);
    return [schema.replace(/^["`]|["`]$/g, ''), table.replace(/^["`]|["`]$/g, '')];
  }
  return [defaultSchema, rawTable.replace(/^["`]|["`]$/g, '')];
}

export async function commandSchema(args) {
  const [config, , env, targetName, target] = loadDatabase(args);
  let [schema, table] = splitTable(args.table, args.schema);
  if (!table) common.fail('--table is required');
  const conn = await connect(target);
  try {
    let columns;
    let indexes;
    if (target.type === 'postgresql') {
      schema ||= 'public';
      columns = await conn.query(
        `select column_name, data_type, is_nullable, column_default
         from information_schema.columns
         where table_schema = $1 and table_name = $2
         order by ordinal_position`,
        [schema, table],
      );
      indexes = await conn.query(
        'select indexname, indexdef from pg_indexes where schemaname = $1 and tablename = $2 order by indexname',
        [schema, table],
      );
    } else {
      columns = await conn.query(
        `select column_name, column_type, is_nullable, column_default, column_key, extra
         from information_schema.columns
         where table_schema = database() and table_name = ?
         order by ordinal_position`,
        [table],
      );
      indexes = await conn.query(
        `select index_name, column_name, non_unique, seq_in_index
         from information_schema.statistics
         where table_schema = database() and table_name = ?
         order by index_name, seq_in_index`,
        [table],
      );
    }
    common.auditEvent(config, env, 'databases', targetName, { action: 'schema', allowed: true, table: args.table });
    common.jsonPrint({
      target: targetName,
      type: target.type,
      schema,
      table,
      columns: columns.rows || [],
      indexes: indexes.rows || [],
    });
    return 0;
  } finally {
    await conn.close();
  }
}

function firstCell(result) {
  const row = result.rows?.[0];
  if (Array.isArray(row)) return row[0];
  if (row && typeof row === 'object') return Object.values(row)[0];
  return null;
}

function parseArgs(argv) {
  const args = { env: undefined, resourcesDir: undefined, target: undefined, limit: 100, allowWrite: false, confirmDelete: false };
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const [rawName, inline] = arg.slice(2).split('=', 2);
    const value = inline === undefined ? argv[index + 1] : inline;
    if (['allow-write', 'confirm-delete'].includes(rawName)) {
      args[rawName.replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = true;
      continue;
    }
    if (value === undefined) common.fail(`Missing value for --${rawName}`);
    index += inline === undefined ? 1 : 0;
    const key = rawName.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    args[key] = rawName === 'limit' ? Number.parseInt(value, 10) : value;
  }
  args.command = positionals[0];
  if (!args.command) common.fail('Usage: db_ops.js list|validate|ping|query|schema ...');
  return args;
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.command === 'list') return commandList(args);
  if (args.command === 'validate') return commandValidate(args);
  if (args.command === 'ping') return commandPing(args);
  if (args.command === 'query') {
    if (!args.sql && !args.file) common.fail('query requires --sql or --file');
    return commandQuery(args);
  }
  if (args.command === 'schema') {
    if (!args.table) common.fail('schema requires --table');
    return commandSchema(args);
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
