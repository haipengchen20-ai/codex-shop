const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

test('settings endpoint reports the configured save folder', async (t) => {
  const port = 34017;
  const server = spawn(process.execPath, ['server.js'], { cwd: __dirname + '/..', env: { ...process.env, PORT: String(port) }, windowsHide: true });
  t.after(() => server.kill());

  let response;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { response = await fetch(`http://127.0.0.1:${port}/api/settings`); if (response) break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert.ok(response, 'the local server should start');
  assert.equal(response.status, 200);
  const settings = await response.json();
  assert.ok(Object.hasOwn(settings, 'folder'));
});
