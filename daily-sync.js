const fs = require('node:fs/promises');
const path = require('node:path');
const readGameList = require('./lib/game-list');
const { saveGame } = require('./lib/steam-saver');
const { createProxyAwareFetch } = require('./lib/steam-network');
const { acquireDailySyncLock } = require('./lib/daily-sync-lock');
const { identifyStore } = require('./lib/platform-registry');

const DATA_DIRECTORY = path.join(__dirname, 'data');
const SETTINGS_FILE = path.join(DATA_DIRECTORY, 'settings.json');
const LOG_DIRECTORY = path.join(DATA_DIRECTORY, 'logs');
const LOCK_FILE = path.join(DATA_DIRECTORY, 'daily-sync.lock');
const GAME_LIST_FILE = 'C:\\Users\\33756\\Desktop\\自动化\\游戏图片.xls';

function isTransientNetworkError(error) {
  return /(?:fetch failed|network|socket|connect|timeout|econnreset|und_err)/i.test(String(error?.message || error?.cause?.message || ''));
}

async function syncGames(games, saver, dependencies = {}) {
  const results = [];
  const wait = dependencies.wait || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));

  for (const game of games) {
    try {
      let retried = false;
      let saved;
      try {
        saved = await saver(game);
      } catch (error) {
        if (!isTransientNetworkError(error)) throw error;
        await wait(1000);
        saved = await saver(game);
        retried = true;
      }
      results.push({ ...(game.source !== undefined ? { source: game.source } : { appId: game.appId }), name: game.name, ...saved, ...(retried ? { retried: true } : {}), ...(saved.count === 0 ? { status: 'failed', error: '没有可保存的图片，请检查商品页面后重试。' } : { status: 'saved' }) });
    } catch (error) {
      let identity = {};
      if (game.source !== undefined) {
        try { const store = identifyStore(String(game.source)); identity = { platform: store.platform, sourceKey: store.productId, count: 0, missing: [] }; } catch { /* Unknown sources have no identifiable platform or product. */ }
      }
      results.push({ ...(game.source !== undefined ? { source: game.source } : { appId: game.appId }), name: game.name, ...identity, status: 'failed', error: error.message });
    }
  }

  return results;
}

function timestampForFilename(value) {
  return value.toISOString().slice(0, 19).replace(/:/g, '-');
}

async function main() {
  const lock = await acquireDailySyncLock({ lockFile: LOCK_FILE });
  try {
    const settings = JSON.parse(await fs.readFile(SETTINGS_FILE, 'utf8'));
    if (!settings.folder) throw new Error('Missing configured image folder in data/settings.json.');

    const started = new Date();
    const games = readGameList(GAME_LIST_FILE);
    const steamFetch = await createProxyAwareFetch();
    const results = await syncGames(games, (game) => {
      const store = identifyStore(String(game.source ?? game.appId));
      const downloadFetch = store.platform === 'steam' ? steamFetch : fetch;
      return saveGame({ ...game, folder: settings.folder }, { fetch: steamFetch, downloadFetch });
    });
    const finished = new Date();
    const report = { startedAt: started.toISOString(), finishedAt: finished.toISOString(), results };

    await fs.mkdir(LOG_DIRECTORY, { recursive: true });
    const filename = `daily-sync-${timestampForFilename(started)}.json`;
    await fs.writeFile(path.join(LOG_DIRECTORY, filename), `${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await lock.release();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Daily sync failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { syncGames, isTransientNetworkError };
