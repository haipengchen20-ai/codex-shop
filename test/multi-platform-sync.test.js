const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const readGameList = require('../lib/game-list');
const { syncGames } = require('../daily-sync');
const { saveGame } = require('../lib/steam-saver');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { normalizeSubscription, upsertSubscription, subscriptionKey } = require('../server');

test('invalid legacy subscriptions do not erase valid records during normalization', () => {
  const { normalizeSubscriptions } = require('../server');
  const records = [{ id: '730', filename: 'Valid', items: [] }, { id: 'invalid', filename: 'Broken', items: [] }];
  const normalized = normalizeSubscriptions(records);
  assert.equal(normalized.length, 2);
  assert.equal(normalized[0].sourceKey, '730');
  assert.deepEqual(normalized[1], records[1]);
});

test('retains unsupported sources so batch synchronization can report failure', () => {
  assert.deepEqual(readGameList.fromRows([['Name', 'Source'], ['Bad game', 'https://evil.test/123']]), [{ name: 'Bad game', source: 'https://evil.test/123' }]);
});

test('failed batch entries retain identified platform and product metadata', async () => {
  const [result] = await syncGames([{ name: 'Xbox', source: 'https://www.xbox.com/en-us/games/store/example/730' }], async () => { throw new Error('offline'); });
  assert.equal(result.status, 'failed');
  assert.equal(result.platform, 'xbox');
  assert.equal(result.sourceKey, '730');
  assert.equal(result.count, 0);
  assert.deepEqual(result.missing, []);
});

test('same-name console products have distinct output folders', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'identity-save-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dependencies = {
    fetch: async () => ({ ok: true, status: 200, text: async () => '<meta property="og:title" content="Same"><meta property="og:image" content="https://assets.nintendo.com/cover.jpg">' }),
    coverStateFile: path.join(root, 'counter.json'),
    download: async (_url, target) => { await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, 'cover'); },
  };
  const one = await saveGame({ source: 'https://www.nintendo.com/us/store/products/first/', name: 'Same', folder: root }, dependencies);
  const two = await saveGame({ source: 'https://www.nintendo.com/us/store/products/second/', name: 'Same', folder: root }, dependencies);
  assert.notEqual(one.folder, two.folder);
  assert.equal((await fs.readdir(one.folder)).length, 1);
  assert.equal((await fs.readdir(two.folder)).length, 1);
});

test('spreadsheet rows preserve a Nintendo store source', () => {
  const url = 'https://www.nintendo.com/us/store/products/example-switch/';
  assert.deepEqual(readGameList.fromRows([['Name', 'Source'], ['Switch game', url]]), [{ name: 'Switch game', source: url }]);
});

test('mixed batch saves a Steam game even when a console source is invalid', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mixed-sync-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const requirement = path.join(root, 'requirements.png');
  await fs.writeFile(requirement, 'requirements');
  const dependencies = {
    fetch: async () => ({ ok: true, json: async () => ({ 730: { success: true, data: { name: 'Steam game', screenshots: [], pc_requirements: {} } } }) }),
    requirementsPng: async () => requirement,
  };
  const results = await syncGames([{ name: 'Steam game', source: '730' }, { name: 'Invalid', source: 'https://evil.test/store/730' }], game => saveGame({ ...game, folder: root }, dependencies));
  assert.deepEqual(results.map(result => result.status), ['saved', 'failed']);
  assert.equal(results[0].platform, 'steam');
  assert.equal(results[0].sourceKey, '730');
  assert.equal(results[0].count, 1);
  assert.deepEqual(results[0].missing, ['cover', 'screenshots']);
});

test('console cover-only save succeeds and reports missing screenshots', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'console-save-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const result = await saveGame({ source: 'https://www.nintendo.com/us/store/products/example-switch/', folder: root }, {
    fetch: async () => ({ ok: true, status: 200, text: async () => '<html><head><meta property="og:title" content="Example"><meta property="og:image" content="https://assets.nintendo.com/cover.jpg"></head></html>' }),
    coverStateFile: path.join(root, 'counter.json'),
    download: async (_url, target) => { await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, 'cover'); },
  });
  assert.equal(result.platform, 'switch');
  assert.equal(result.count, 1);
  assert.deepEqual(result.missing, ['screenshots']);
  assert.equal((await fs.readdir(result.folder)).length, 1);
});

test('saving a page with no public images reports failure', async () => {
  await assert.rejects(saveGame({ source: 'https://www.xbox.com/en-us/games/store/example/730', folder: 'unused' }, {
    fetch: async () => ({ ok: true, status: 200, text: async () => '<meta property="og:title" content="Example">' }),
  }), /没有可保存的公开图片/);
});

test('saving with no selected images reports failure even when a cover exists', async () => {
  await assert.rejects(saveGame({ source: 'https://www.nintendo.com/us/store/products/example-switch/', folder: 'unused', selected: [] }, {
    fetch: async () => ({ ok: true, status: 200, text: async () => '<meta property="og:title" content="Example"><meta property="og:image" content="https://assets.nintendo.com/cover.jpg">' }),
  }), /请选择至少一张图片/);
});

test('batch reports a zero-image saver result as failed and continues', async () => {
  const results = await syncGames([{ name: 'Empty', source: 'https://www.xbox.com/en-us/games/store/example/730' }, { name: 'Cover', source: 'https://www.nintendo.com/us/store/products/example-switch/' }], async game => game.name === 'Empty' ? { platform: 'xbox', sourceKey: '730', count: 0, missing: ['cover', 'screenshots'] } : { count: 1 });
  assert.equal(results[0].status, 'failed');
  assert.match(results[0].error, /没有.*图片/);
  assert.equal(results[1].status, 'saved');
});

test('subscription keys distinguish platforms with the same product id', () => {
  const result = spawnSync(process.execPath, ['-e', "const { subscriptionKey } = require('./server'); console.log(JSON.stringify([subscriptionKey({platform:'steam',sourceKey:'730'}),subscriptionKey({platform:'xbox',sourceKey:'730'})])); process.exit(0)"], { cwd: require('node:path').join(__dirname, '..'), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const [steam, xbox] = JSON.parse(result.stdout);
  assert.notEqual(steam, xbox);
});

test('upserting a console subscription preserves a legacy Steam subscription with the same id', () => {
  const legacy = normalizeSubscription({ id: '730', filename: 'Steam', items: ['capsule-0'] });
  const xbox = { platform: 'xbox', source: 'https://www.xbox.com/en-us/games/store/example/730', sourceKey: '730', filename: 'Xbox', items: [] };
  const list = upsertSubscription([legacy], xbox);
  assert.equal(list.length, 2);
  assert.deepEqual(list.map(subscriptionKey), ['steam:730', 'xbox:730']);
  assert.equal(list[0].source, '730');
  assert.equal(upsertSubscription(list, { ...xbox, filename: 'Updated' }).length, 2);
});
