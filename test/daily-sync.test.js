const test = require('node:test');
const assert = require('node:assert/strict');
const { syncGames } = require('../daily-sync');
const { createProxyAwareFetch } = require('../lib/steam-network');

test('syncGames continues after a failure and reports every game', async () => {
  const games = [
    { appId: '10', name: 'First game' },
    { appId: '20', name: 'Broken game' },
    { appId: '30', name: 'Last game' },
  ];
  const attempted = [];

  const results = await syncGames(games, async (game) => {
    attempted.push(game.appId);
    if (game.appId === '20') throw new Error('Steam is unavailable');
    return { count: 2 };
  });

  assert.deepEqual(attempted, ['10', '20', '30']);
  assert.deepEqual(results, [
    { appId: '10', name: 'First game', status: 'saved', count: 2 },
    { appId: '20', name: 'Broken game', status: 'failed', error: 'Steam is unavailable' },
    { appId: '30', name: 'Last game', status: 'saved', count: 2 },
  ]);
});

test('syncGames retries a transient fetch failure once before reporting success', async () => {
  let calls = 0;
  const waits = [];
  const results = await syncGames([{ name: 'PlayStation game', source: 'https://store.playstation.com/zh-hant-hk/product/EXAMPLE' }], async () => {
    calls += 1;
    if (calls === 1) throw new TypeError('fetch failed');
    return { platform: 'playstation', sourceKey: 'EXAMPLE', count: 1, missing: ['screenshots'] };
  }, { wait: async milliseconds => waits.push(milliseconds) });

  assert.equal(calls, 2);
  assert.deepEqual(waits, [1000]);
  assert.deepEqual(results, [{
    source: 'https://store.playstation.com/zh-hant-hk/product/EXAMPLE',
    name: 'PlayStation game',
    platform: 'playstation', sourceKey: 'EXAMPLE', count: 1, missing: ['screenshots'], retried: true, status: 'saved',
  }]);
});

test('createProxyAwareFetch sends Steam requests through the local proxy when it is available', async () => {
  const calls = [];
  const dispatcher = { proxy: true };
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: true };
  };

  const steamFetch = await createProxyAwareFetch({
    checkProxy: async () => true,
    ProxyAgent: class { constructor(url) { assert.equal(url, 'http://127.0.0.1:7897'); return dispatcher; } },
    fetchImpl,
  });

  await steamFetch('https://store.steampowered.com/api/appdetails', { headers: { a: 'b' } });
  assert.equal(calls[0].options.dispatcher, dispatcher);
});
