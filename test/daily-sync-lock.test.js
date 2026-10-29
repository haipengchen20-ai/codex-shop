const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { acquireDailySyncLock } = require('../lib/daily-sync-lock');

test('rejects a second active daily sync without replacing its lock', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'daily-sync-lock-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const lockFile = path.join(root, 'daily-sync.lock');

  const first = await acquireDailySyncLock({ lockFile, pid: 101, isProcessRunning: () => true });

  await assert.rejects(
    acquireDailySyncLock({ lockFile, pid: 202, isProcessRunning: () => true }),
    /已有同步正在运行/
  );
  assert.deepEqual(JSON.parse(await fs.readFile(lockFile, 'utf8')), { pid: 101 });

  await first.release();
});

test('replaces a stale lock left by an ended process', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'daily-sync-lock-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const lockFile = path.join(root, 'daily-sync.lock');
  await fs.writeFile(lockFile, JSON.stringify({ pid: 101 }));

  const lock = await acquireDailySyncLock({ lockFile, pid: 202, isProcessRunning: () => false });

  assert.deepEqual(JSON.parse(await fs.readFile(lockFile, 'utf8')), { pid: 202 });
  await lock.release();
  await assert.rejects(fs.access(lockFile));
});
