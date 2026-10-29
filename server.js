const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { URL } = require('node:url');
const { spawn } = require('node:child_process');
const { extractFolder, normalizeFolder } = require('./folder-output');
const { appId, lookupGame, fileBaseName, saveGame } = require('./lib/steam-saver');
const { identifyStore } = require('./lib/platform-registry');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const CONFIG = path.join(DATA, 'subscriptions.json');
const SETTINGS = path.join(DATA, 'settings.json');
const PORT = Number(process.env.PORT || 3210);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function json(res, code, value) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
async function settings() {
  try {
    const value = JSON.parse(await fsp.readFile(SETTINGS, 'utf8'));
    const folder = normalizeFolder(value.folder);
    if (folder && folder !== value.folder) await setSettings({ folder });
    return { folder };
  } catch { return { folder: null }; }
}
async function setSettings(value) { await fsp.mkdir(DATA, { recursive: true }); await fsp.writeFile(SETTINGS, JSON.stringify(value, null, 2)); }
async function chooseFolder(initial) {
  const script = "$WarningPreference='SilentlyContinue';$OutputEncoding=[Console]::OutputEncoding=[Text.Encoding]::UTF8;Add-Type -AssemblyName System.Windows.Forms;$d=New-Object System.Windows.Forms.FolderBrowserDialog;$d.Description='选择 Steam 图片保存文件夹';$d.ShowNewFolderButton=$true;if($env:STEAM_CURRENT_FOLDER -and (Test-Path -LiteralPath $env:STEAM_CURRENT_FOLDER)){$d.SelectedPath=$env:STEAM_CURRENT_FOLDER};if($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){Write-Output ('__STEAM_FOLDER__:' + $d.SelectedPath)}";
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { env: { ...process.env, STEAM_CURRENT_FOLDER: initial || '' }, windowsHide: true });
    let output = '', error = ''; child.stdout.on('data', data => output += data); child.stderr.on('data', data => error += data); child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(extractFolder(output)) : reject(new Error(error || '无法打开文件夹选择窗口。')));
  });
}
function subscriptionKey({ platform, sourceKey }) { return `${platform}:${sourceKey}`; }
function normalizeSubscription(record) {
  if (record.platform && record.sourceKey && record.source) return record;
  const store = identifyStore(String(record.id));
  const { id, ...rest } = record;
  return { ...rest, platform: store.platform, source: String(id), sourceKey: store.productId };
}
function normalizeSubscriptions(records) { return records.map(record => { try { return normalizeSubscription(record); } catch { return record; } }); }
function hasSubscriptionIdentity(record) { return record && record.platform && record.sourceKey && record.source; }
function upsertSubscription(list, record) { const key = subscriptionKey(record); return [...list.filter(x => !hasSubscriptionIdentity(x) || subscriptionKey(x) !== key), record]; }
function displaySubscription(record) { return hasSubscriptionIdentity(record) ? { ...record, id: record.platform === 'steam' ? record.sourceKey : subscriptionKey(record), key: subscriptionKey(record) } : record; }
async function subscriptions() { try { return normalizeSubscriptions(JSON.parse(await fsp.readFile(CONFIG, 'utf8'))); } catch (error) { if (error.code === 'ENOENT') return []; throw error; } }
async function setSubscriptions(value) { await fsp.mkdir(DATA, { recursive: true }); await fsp.writeFile(CONFIG, JSON.stringify(value, null, 2)); }
async function saveConfiguredGame({ source, name, selected }) {
  const configured = await settings();
  const result = await saveGame({ source, name, folder: configured.folder, selected });
  return { ...result, filename: fileBaseName(name, result.name) };
}
async function body(req) { let raw = ''; for await (const p of req) raw += p; try { return JSON.parse(raw || '{}'); } catch { throw new Error('请求格式错误。'); } }
async function api(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/subscriptions') return json(res, 200, (await subscriptions()).map(displaySubscription));
  if (req.method === 'GET' && pathname === '/api/settings') return json(res, 200, await settings());
  if (req.method === 'GET' && pathname === '/api/requirements') { const id = appId(new URL(req.url, 'http://x').searchParams.get('id')); const file = path.join(DATA, 'requirements', `${id}.png`); res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }); return fs.createReadStream(file).pipe(res); }
  if (req.method === 'GET' && pathname === '/api/game') { const query = new URL(req.url, 'http://x').searchParams; return json(res, 200, await lookupGame(query.get('source') || query.get('id'))); }
  const data = await body(req);
  if (req.method === 'POST' && pathname === '/api/settings/folder') {
    const current = await settings(); const folder = await chooseFolder(current.folder);
    if (!folder) return json(res, 200, { ...current, cancelled: true });
    await setSettings({ folder }); return json(res, 200, { folder, cancelled: false });
  }
  if (req.method === 'POST' && pathname === '/api/save') return json(res, 200, await saveConfiguredGame({ source: data.source || data.id, name: data.filename, selected: data.items || [] }));
  if (req.method === 'POST' && pathname === '/api/subscriptions') { const source = String(data.source || data.id || ''); const store = identifyStore(source); const list = await subscriptions(); const next = upsertSubscription(list, { platform: store.platform, source, sourceKey: store.productId, intervalHours: Math.max(1, Number(data.intervalHours) || 24), items: data.items || [], filename: data.filename || '', updatedAt: new Date().toISOString() }); await setSubscriptions(next); return json(res, 200, next.map(displaySubscription)); }
  if (req.method === 'DELETE' && pathname.startsWith('/api/subscriptions/')) { const key = decodeURIComponent(pathname.slice('/api/subscriptions/'.length)); const list = (await subscriptions()).filter(x => !hasSubscriptionIdentity(x) || (subscriptionKey(x) !== key && !(x.platform === 'steam' && x.sourceKey === key))); await setSubscriptions(list); return json(res, 200, list.map(displaySubscription)); }
  json(res, 404, { error: '未找到接口。' });
}
async function syncDue() { const list = await subscriptions(); const now = Date.now(); for (const x of list) { if (hasSubscriptionIdentity(x) && (!x.lastSavedAt || now - new Date(x.lastSavedAt).getTime() >= x.intervalHours * 3600000)) { try { await saveConfiguredGame({ source: x.source, name: x.filename, selected: x.items }); x.lastSavedAt = new Date().toISOString(); delete x.lastError; } catch (e) { x.lastError = e.message; } } } await setSubscriptions(list); }
if (require.main === module) {
http.createServer(async (req, res) => { try { const pathname = new URL(req.url, 'http://x').pathname; if (pathname.startsWith('/api/')) return await api(req, res, pathname); const file = pathname === '/' ? 'index.html' : pathname.slice(1); const full = path.resolve(PUBLIC, file); if (!full.startsWith(PUBLIC + path.sep)) throw new Error('非法路径'); const content = await fsp.readFile(full); res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' }); res.end(content); } catch (e) { if (!res.headersSent) json(res, 500, { error: e.message || '发生错误。' }); } }).listen(PORT, () => console.log(`Steam 图片自动保存工具已启动：http://localhost:${PORT}`));
syncDue(); setInterval(syncDue, 10 * 60 * 1000);
}
module.exports = { api, subscriptionKey, normalizeSubscription, normalizeSubscriptions, upsertSubscription };
