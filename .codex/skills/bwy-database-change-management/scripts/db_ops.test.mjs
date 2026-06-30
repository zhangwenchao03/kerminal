import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import * as common from './data_source_common.js';

test('SQL policy allows reads and gates writes', () => {
  assert.deepEqual(common.sqlPolicy({ read_only: true }, 'select * from sys_user'), [true, 'read-only SQL']);
  const [writeAllowed, writeReason] = common.sqlPolicy({ read_only: true }, "update sys_user set nick_name='x'");
  assert.equal(writeAllowed, false);
  assert.match(writeReason, /--allow-write/);
  const [deleteAllowed, deleteReason] = common.sqlPolicy({ read_only: false }, 'delete from sys_user where id = 1', true);
  assert.equal(deleteAllowed, false);
  assert.match(deleteReason, /--confirm-delete/);
});

test('JDBC parser and Spring target extraction support dynamic datasource', () => {
  const parsed = common.parseJdbcUrl('jdbc:postgresql://127.0.0.1:5432/demo?sslmode=prefer');
  assert.equal(parsed.type, 'postgresql');
  assert.equal(parsed.host, '127.0.0.1');
  assert.equal(parsed.port, 5432);
  assert.equal(parsed.database, 'demo');

  const config = common.springConfigToTargets({
    spring: {
      datasource: {
        dynamic: {
          datasource: {
            master: {
              url: 'jdbc:mysql://127.0.0.1:3306/demo',
              username: 'root',
              password: '${DB_PASSWORD:secret}',
            },
          },
        },
      },
      data: { redis: { host: '127.0.0.1', port: 6379, database: 1 } },
    },
  }, path.join('app', 'src', 'main', 'resources'), [path.join('app', 'src', 'main', 'resources', 'application.yml')]);
  const db = common.normalizeDatabaseTarget(config, config.databases.master);
  const redis = common.normalizeRedisTarget(config, config.redis.main);
  assert.equal(db.type, 'mysql');
  assert.equal(db.database, 'demo');
  assert.equal(db.password_env, 'DB_PASSWORD');
  assert.equal(redis.database, 1);
});
