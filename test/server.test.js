const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const saver = require('../lib/steam-saver');

test('game endpoint accepts a PlayStation source and legacy Steam id', async (t) => {
  const realLookup = saver.lookupGame;
  saver.lookupGame = input => realLookup(input, {
    fetch: async url => url.includes('steampowered.com/api/')
      ? { ok: true, json: async () => ({ 730: { success: true, data: { name: 'Steam fixture', header_image: 'https://cdn.steamstatic.com/cover.jpg', screenshots: [], pc_requirements: {} } } }) }
      : { ok: true, status: 200, text: async () => '<meta property="og:title" content="PlayStation fixture"><meta property="og:image" content="https://image.api.playstation.com/cover.jpg">' },
    requirementsPng: async () => 'fixture.png',
  });
  delete require.cache[require.resolve('../server')];
  const { api } = require('../server');
  saver.lookupGame = realLookup;
  const server = http.createServer(async (req, res) => { try { await api(req, res, new URL(req.url, 'http://localhost').pathname); } catch (error) { res.writeHead(500); res.end(JSON.stringify({ error: error.message })); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const source = 'https://store.playstation.com/en-us/product/UP9000-CUSA00001_00-EXAMPLE000000001';
  const ps = await (await fetch(`${origin}/api/game?source=${encodeURIComponent(source)}`)).json();
  assert.equal(ps.platform, 'playstation');
  assert.ok(ps.items.some(item => item.kind === 'capsule'));
  const steam = await (await fetch(`${origin}/api/game?id=730`)).json();
  assert.equal(steam.platform, 'steam');
  assert.equal(steam.id, '730');
});
