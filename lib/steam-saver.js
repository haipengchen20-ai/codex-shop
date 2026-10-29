const https = require('node:https');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { URL } = require('node:url');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { createCoverSequence } = require('./cover-sequence');
const { identifyStore, isAllowedImageUrl } = require('./platform-registry');
const { parseStorePage } = require('./store-page-parser');
const { createProxyAwareFetch } = require('./steam-network');

const DATA = path.join(__dirname, '..', 'data');

function appId(value) {
  const match = String(value || '').match(/(?:app\/)?(\d{1,12})(?:[/?#]|$)/);
  return match ? match[1] : null;
}

function plainText(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h\d)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function requirementsPng(id, name, requirements) {
  const output = path.join(DATA, 'requirements', `${id}.png`);
  const payload = Buffer.from(JSON.stringify({ output, name: '系统需求', minimum: plainText(requirements?.minimum || 'Steam 未提供最低配置。').replace(/^最低配置[：:]\s*/, '') })).toString('base64');
  const script = `$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:STEAM_REQUIREMENTS_PAYLOAD))|ConvertFrom-Json;Add-Type -AssemblyName System.Drawing;$w=1400;$bodyW=1240;$titleFont=New-Object System.Drawing.Font 'Microsoft YaHei',32,[System.Drawing.FontStyle]::Bold;$bodyFont=New-Object System.Drawing.Font 'Microsoft YaHei',22;$smallFont=New-Object System.Drawing.Font 'Microsoft YaHei',20;$measureBmp=New-Object System.Drawing.Bitmap 1,1;$measure=[System.Drawing.Graphics]::FromImage($measureBmp);$minH=[Math]::Max(260,[int][Math]::Ceiling($measure.MeasureString($p.minimum,$bodyFont,$bodyW).Height)+150);$measure.Dispose();$measureBmp.Dispose();$h=275+$minH;$bmp=New-Object System.Drawing.Bitmap $w,$h;$g=[System.Drawing.Graphics]::FromImage($bmp);$g.SmoothingMode='HighQuality';$g.TextRenderingHint='ClearTypeGridFit';$g.Clear([System.Drawing.Color]::FromArgb(10,24,37));$headerBrush=New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(24,66,89));$g.FillRectangle($headerBrush,0,0,$w,170);$white=[System.Drawing.Brushes]::White;$muted=New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(167,202,221));$g.DrawString('系统需求',$titleFont,$white,[System.Drawing.RectangleF]::new(70,34,1100,60));$g.DrawString($p.name,$smallFont,$muted,[System.Drawing.RectangleF]::new(72,102,1180,38));$card=New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(18,48,66));$cyan=New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(92,204,233));$y=205;$g.FillRectangle($card,70,$y,$bodyW,$minH);$g.DrawString('最低配置',$smallFont,$cyan,[System.Drawing.RectangleF]::new(100,$y+22,400,34));$g.DrawString($p.minimum,$bodyFont,$white,[System.Drawing.RectangleF]::new(100,$y+72,1160,$minH-100));[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($p.output))|Out-Null;$bmp.Save($p.output,[System.Drawing.Imaging.ImageFormat]::Png);$g.Dispose();$bmp.Dispose()`;
  await new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { env: { ...process.env, STEAM_REQUIREMENTS_PAYLOAD: payload }, windowsHide: true });
    let error = '';
    child.stderr.on('data', data => error += data);
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(error || '无法生成系统需求 PNG。')));
  });
  return output;
}

function safeImage(url) {
  return isAllowedImageUrl('steam', url);
}

function download(url, target, redirects = 0) {
  if (!safeImage(url)) return Promise.reject(new Error('只允许下载 Steam 官方图片资源。'));
  return new Promise((resolve, reject) => https.get(url, { headers: { 'User-Agent': 'Steam Image Keeper/1.0' } }, async response => {
    if ([301, 302, 307, 308].includes(response.statusCode) && response.headers.location && redirects < 4) {
      response.resume();
      return resolve(download(new URL(response.headers.location, url).href, target, redirects + 1));
    }
    if (response.statusCode !== 200) {
      response.resume();
      return reject(new Error(`下载失败（HTTP ${response.statusCode}）`));
    }
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const output = fs.createWriteStream(target);
    response.pipe(output);
    output.on('finish', () => output.close(resolve));
    output.on('error', reject);
  }).on('error', reject));
}

async function download(url, target, steamFetch = fetch, redirects = 0, platform = 'steam') {
  if (!isAllowedImageUrl(platform, url)) throw new Error(platform === 'steam' ? 'Only official Steam CDN image URLs are allowed.' : 'Only official store image URLs are allowed.');

  const response = await steamFetch(url, {
    headers: { 'User-Agent': 'Steam Image Keeper/1.0' },
    redirect: 'manual',
  });
  const location = response.headers.get('location');
  if ([301, 302, 307, 308].includes(response.status) && location && redirects < 4) {
    return download(new URL(location, url).href, target, steamFetch, redirects + 1, platform);
  }
  if (!response.ok || !response.body) throw new Error(`Download failed (HTTP ${response.status}).`);

  const { Readable } = require('node:stream');
  const { pipeline } = require('node:stream/promises');
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(target));
}

function fileBaseName(value, fallback) {
  const name = String(value || fallback).trim().replace(/[<>:"/\\|?*]/g, '_').replace(/[. ]+$/g, '').slice(0, 100);
  return name || fallback;
}

async function existingCoverFilename(folder) {
  try {
    const files = await fsp.readdir(folder);
    return files.find(file => /^\d+封面图\.(?:jpe?g|png|webp)$/i.test(file));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function game(value, dependencies = {}) {
  const id = appId(value);
  if (!id) throw new Error('AppID 无效。');
  const steamFetch = dependencies.fetch || fetch;
  const makeRequirementsPng = dependencies.requirementsPng || requirementsPng;
  let response;
  try {
    response = await steamFetch(`https://store.steampowered.com/api/appdetails?appids=${id}&l=schinese`, {
      headers: { 'User-Agent': 'Steam Image Keeper/1.0' }, signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    const detail = error.name === 'TimeoutError' || error.cause?.code === 'UND_ERR_CONNECT_TIMEOUT' ? '连接超时' : '连接失败';
    throw new Error(`无法连接 Steam 商店接口（${detail}）。请确认浏览器能打开 store.steampowered.com；若网络需要代理，请先让本机/Node.js 可通过该代理访问 Steam 后重试。`);
  }
  if (!response.ok) throw new Error('Steam 服务暂时不可用。');
  const entry = (await response.json())[id];
  if (!entry?.success) throw new Error('找不到该 AppID，或该游戏尚未公开。');
  const data = entry.data;
  const items = [['capsule', '封面图', data.header_image]];
  for (const [index, screenshot] of (data.screenshots || []).slice(0, 4).entries()) {
    items.push(['screenshot', `游戏截图 ${index + 1}`, screenshot.path_full]);
  }
  const requirementFile = await makeRequirementsPng(id, data.name, data.pc_requirements);
  items.push(['requirements', '系统需求', `/api/requirements?id=${id}&v=${Date.now()}`, requirementFile]);
  return {
    id,
    name: data.name,
    items: items.filter(([, , url]) => url).map(([kind, label, url, localPath], index) => ({ id: `${kind}-${index}`, kind, label, url, localPath })),
  };
}

async function lookupGame(input, dependencies = {}) {
  const store = identifyStore(input);
  if (store.platform === 'steam') {
    const result = await game(store.productId, dependencies);
    const missing = [];
    if (!result.items.some(item => item.kind === 'capsule')) missing.push('cover');
    if (!result.items.some(item => item.kind === 'screenshot')) missing.push('screenshots');
    return { platform: 'steam', ...result, missing };
  }
  const pageFetch = dependencies.fetch || await createProxyAwareFetch();
  let url = store.canonicalUrl;
  for (let redirects = 0; redirects <= 4; redirects++) {
    const response = await pageFetch(url, { headers: { 'User-Agent': 'Steam Image Keeper/1.0' }, signal: AbortSignal.timeout(15000), redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers?.get('location');
      if (!location || redirects === 4) throw new Error('Store page redirect failed.');
      const target = new URL(location, url);
      if (store.platform === 'playstation' && target.protocol === 'https:' && target.hostname === 'store.playstation.com' && !target.port && !target.username && !target.password && /^\/[a-z]{2}(?:-[a-z]{2,4}){1,2}\/error\/?$/i.test(target.pathname)) {
        throw new Error('PlayStation 商店暂时不可用或该商品在此地区无法访问。请在浏览器打开商品链接，检查地区和网络后重试。');
      }
      const next = identifyStore(target.href);
      if (next.platform !== store.platform) throw new Error('Store page redirected to an unsupported platform.');
      if (next.productId.toLowerCase() !== store.productId.toLowerCase()) throw new Error('Store page redirected to a different product.');
      url = next.canonicalUrl;
      continue;
    }
    if (!response.ok) throw new Error(`Store page unavailable (HTTP ${response.status}).`);
    return { platform: store.platform, id: store.productId, ...parseStorePage({ platform: store.platform, canonicalUrl: store.canonicalUrl, html: await response.text() }) };
  }
}

async function saveGame({ source, appId: legacyId, name, folder, selected }, dependencies = {}) {
  const store = identifyStore(String(source ?? legacyId ?? ''));
  if (!folder) throw new Error('请先选择保存文件夹。');
  const result = await lookupGame(source ?? legacyId, dependencies);
  if (!result.items.length) throw new Error('官方商店没有可保存的公开图片，请检查商品页面后重试。');
  const picks = Array.isArray(selected) ? result.items.filter(item => selected.includes(item.id)) : result.items;
  if (!picks.length) throw new Error('请选择至少一张图片后再保存。');
  const base = fileBaseName(name, result.name);
  const identity = createHash('sha256').update(JSON.stringify([store.platform, store.productId])).digest('hex');
  const outputFolder = path.join(folder, `${base} [${store.platform}-${identity}]`);
  const saveDownload = dependencies.download || ((url, target) => download(url, target, dependencies.downloadFetch || dependencies.fetch || fetch, 0, store.platform));
  const cover = picks.find(item => item.kind === 'capsule');
  const existingCover = cover && await existingCoverFilename(outputFolder);
  const coverSequence = cover && !existingCover && (dependencies.coverSequence || createCoverSequence({
    stateFile: dependencies.coverStateFile || path.join(DATA, 'cover-counter.json'),
    now: dependencies.coverNow,
  }));
  const coverNumber = coverSequence && await coverSequence.next();

  await Promise.all(picks.map((item, index) => {
    if (item.kind === 'capsule') {
      const extension = path.extname(new URL(item.url).pathname).match(/^\.(jpe?g|png|webp)$/i)?.[0] || '.jpg';
      const filename = existingCover || `${coverNumber.filenamePrefix}\u5c01\u9762\u56fe${extension}`;
      return saveDownload(item.url, path.join(outputFolder, filename))
        .then(() => coverSequence && coverSequence.commit());
    }
    if (item.kind === 'requirements') {
      return fsp.mkdir(outputFolder, { recursive: true }).then(() => fsp.copyFile(item.localPath, path.join(outputFolder, '系统需求.png')));
    }
    const extension = path.extname(new URL(item.url).pathname).match(/^\.(jpe?g|png|webp)$/i)?.[0] || '.jpg';
    const filename = `${base}-screenshot-${index}${extension}`;
    return saveDownload(item.url, path.join(outputFolder, filename));
  }));

  return { platform: store.platform, sourceKey: store.productId, folder: outputFolder, count: picks.length, name: result.name, missing: result.missing };
}

module.exports = { appId, game, lookupGame, safeImage, download, fileBaseName, requirementsPng, saveGame };
