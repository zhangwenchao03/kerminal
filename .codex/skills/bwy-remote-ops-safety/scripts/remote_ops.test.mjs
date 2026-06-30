import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as remoteOps from './remote_ops.js';

test('default config paths use updeng project config directory', () => {
  const configPaths = remoteOps.defaultConfigPaths().map((item) => item.replaceAll('\\', '/'));
  assert.ok(configPaths.some((item) => item.endsWith('.updeng/docs/config/remote-servers.json')));
  assert.ok(configPaths.some((item) => item.endsWith('.updeng/docs/config/remote-servers.example.json')));
  assert.equal(configPaths.some((item) => item.includes(['.', 'kong'].join(''))), false);
});

test('safe mode allows reads and blocks destructive commands without approval', () => {
  const target = { host: 'example.com', security_mode: 'safe' };
  assert.equal(remoteOps.evaluateCommandPolicy('dev', target, 'df -h', false).allowed, true);
  assert.equal(remoteOps.evaluateCommandPolicy('dev', target, 'rm -rf /opt/app', false).allowed, false);
  assert.equal(remoteOps.evaluateCommandPolicy('dev', target, 'rm -rf /opt/app/cache', true).allowed, true);
});

test('restricted and readonly policies are enforced', () => {
  const readonly = { host: 'example.com', security_mode: 'readonly' };
  assert.equal(remoteOps.evaluateCommandPolicy('prod', readonly, 'rm -rf /opt/app/cache', true).allowed, false);
  const restricted = { host: 'example.com', security_mode: 'restricted', allow_patterns: ['^df -h$'] };
  assert.equal(remoteOps.evaluateCommandPolicy('prod', restricted, 'df -h', false).allowed, true);
  assert.equal(remoteOps.evaluateCommandPolicy('prod', restricted, 'free -h', false).allowed, false);
});

test('path allowlist and backend selection work', () => {
  const target = { host: 'example.com', security_mode: 'safe', path_allowlist: ['/var/log', '/opt/app/logs'] };
  remoteOps.enforcePathPolicy('prod', target, '/var/log/app.log');
  assert.throws(() => remoteOps.enforcePathPolicy('prod', target, '/etc/shadow'));
  assert.equal(remoteOps.chooseSshBackend('prod', { host: 'example.com', password: 'local-only' }), 'paramiko');
  assert.equal(remoteOps.chooseSshBackend('prod', { host: 'example.com', password: 'local-only', jump_host: 'jump.example.com' }), 'ssh');
  assert.throws(() => remoteOps.chooseSshBackend('prod', { host: 'example.com', ssh_backend: 'paramiko', jump_host: 'jump.example.com' }));
});
