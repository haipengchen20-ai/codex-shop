const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { download, saveGame } = require('../lib/steam-saver');

test('downloads Steam CDN images through the supplied proxy-aware fetch function', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-download-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const target = path.join(root, 'cover.jpg');
  const requests = [];
  const proxyFetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, status: 200, headers: new Headers(), body: Readable.toWeb(Readable.from(['image-bytes'])) };
  };

  await download('https://cdn.steamstatic.com/header.jpg', target, proxyFetch);

  assert.equal(requests.length, 1);
  assert.equal(await fs.readFile(target, 'utf8'), 'image-bytes');
});

test('rejects an unapproved redirect before fetching its destination', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-redirect-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const requests = [];
  const steamFetch = async (url) => {
    requests.push(url);
    return { status: 302, headers: new Headers({ location: 'https://evil.test/cover.jpg' }) };
  };

  await assert.rejects(download('https://cdn.steamstatic.com/cover.jpg', path.join(root, 'cover.jpg'), steamFetch), /official Steam CDN/);
  assert.deepEqual(requests, ['https://cdn.steamstatic.com/cover.jpg']);
  await assert.rejects(fs.access(path.join(root, 'cover.jpg')), { code: 'ENOENT' });
});

test('follows approved Steam CDN redirects and saves the image', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-redirect-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const requests = [];
  const steamFetch = async (url) => {
    requests.push(url);
    if (url === 'https://cdn.steamstatic.com/cover.jpg') {
      return { status: 302, headers: new Headers({ location: 'https://cdn.steamusercontent.com/final.jpg' }) };
    }
    return { ok: true, status: 200, headers: new Headers(), body: Readable.toWeb(Readable.from(['redirected-image'])) };
  };
  const target = path.join(root, 'cover.jpg');

  await download('https://cdn.steamstatic.com/cover.jpg', target, steamFetch);

  assert.deepEqual(requests, ['https://cdn.steamstatic.com/cover.jpg', 'https://cdn.steamusercontent.com/final.jpg']);
  assert.equal(await fs.readFile(target, 'utf8'), 'redirected-image');
});

test('uses the provided spreadsheet name for the output directory and saves six images', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-saver-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const requirements = path.join(root, 'requirements.png');
  await fs.writeFile(requirements, 'requirements');

  const fakeSteam = {
    fetch: async () => ({
      ok: true,
      json: async () => ({
        730: {
          success: true,
          data: {
            name: 'Steam metadata name',
            header_image: 'https://cdn.steamstatic.com/header.jpg',
            screenshots: [
              { path_full: 'https://cdn.steamstatic.com/one.jpg' },
              { path_full: 'https://cdn.steamstatic.com/two.jpg' },
              { path_full: 'https://cdn.steamstatic.com/three.jpg' },
              { path_full: 'https://cdn.steamstatic.com/four.jpg' },
            ],
            pc_requirements: { minimum: 'Test requirement' },
          },
        },
      }),
    }),
    requirementsPng: async () => requirements,
    download: async (_url, target) => {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, 'image');
    },
  };

  const result = await saveGame({ appId: '730', name: 'Counter Strike', folder: root }, fakeSteam);

  assert.match(path.basename(result.folder), /^Counter Strike \[steam-[a-f0-9]{64}\]$/);
  assert.equal(result.name, 'Steam metadata name');
  assert.equal(result.count, 6);
  assert.equal((await fs.readdir(result.folder)).length, 6);
});

test('uses a separate download fetch for console images after page lookup', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'console-download-fetch-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const pageRequests = [];
  const imageRequests = [];
  const result = await saveGame({ source: 'https://www.xbox.com/en-us/games/store/example/ABC123', name: 'Console game', folder: root }, {
    fetch: async url => {
      pageRequests.push(url);
      return { ok: true, status: 200, headers: new Headers(), text: async () => '<meta property="og:title" content="Console game"><meta property="og:image" content="https://images.xbox.com/cover.jpg">' };
    },
    downloadFetch: async url => {
      imageRequests.push(url);
      return { ok: true, status: 200, headers: new Headers(), body: Readable.toWeb(Readable.from(['image-bytes'])) };
    },
  });

  assert.deepEqual(pageRequests, ['https://www.xbox.com/en-us/games/store/example/ABC123']);
  assert.deepEqual(imageRequests, ['https://images.xbox.com/cover.jpg']);
  assert.equal(result.count, 1);
});

test('returns only the documented save result fields', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-saver-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const requirements = path.join(root, 'requirements.png');
  await fs.writeFile(requirements, 'requirements');

  const result = await saveGame({ appId: '730', name: 'Counter Strike', folder: root }, {
    fetch: async () => ({
      ok: true,
      json: async () => ({
        730: {
          success: true,
          data: { name: 'Steam metadata name', header_image: 'https://cdn.steamstatic.com/header.jpg', screenshots: [], pc_requirements: {} },
        },
      }),
    }),
    requirementsPng: async () => requirements,
    download: async (_url, target) => {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, 'image');
    },
  });

  assert.deepEqual(result, {
    platform: 'steam',
    sourceKey: '730',
    folder: path.join(root, 'Counter Strike [steam-251449186e033ed9b01cc029dc1c00de3b44c52a2458f2f6859600abc353135e]'),
    count: 2,
    name: 'Steam metadata name',
    missing: ['screenshots'],
  });
});

async function coverDependencies(root, download) {
  const requirements = path.join(root, 'requirements.png');
  await fs.writeFile(requirements, 'requirements');
  return {
    coverStateFile: path.join(root, 'cover-counter.json'),
    coverNow: () => new Date(2026, 7, 7, 10, 0, 0),
    fetch: async () => ({
      ok: true,
      json: async () => ({
        730: {
          success: true,
          data: {
            name: 'Steam metadata name',
            header_image: 'https://cdn.steamstatic.com/header.jpg',
            screenshots: [{ path_full: 'https://cdn.steamstatic.com/one.jpg' }],
            pc_requirements: {},
          },
        },
      }),
    }),
    requirementsPng: async () => requirements,
    download,
  };
}

test('increments the cover counter only after a cover download succeeds', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-saver-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dependencies = await coverDependencies(root, async (_url, target) => {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, 'image');
  });

  const result = await saveGame({ appId: '730', name: 'Counter Strike', folder: root, selected: ['capsule-0'] }, dependencies);

  assert.equal(await fs.readFile(path.join(result.folder, '01\u5c01\u9762\u56fe.jpg'), 'utf8'), 'image');
  assert.deepEqual(JSON.parse(await fs.readFile(dependencies.coverStateFile, 'utf8')), {
    date: '2026-08-07',
    lastNumber: 1,
  });
});

test('numbers covers sequentially across consecutive save calls sharing one counter state', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-saver-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dependencies = await coverDependencies(root, async (_url, target) => {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, 'image');
  });

  const first = await saveGame({ appId: '730', name: 'First Game', folder: root, selected: ['capsule-0'] }, dependencies);
  const second = await saveGame({ appId: '730', name: 'Second Game', folder: root, selected: ['capsule-0'] }, dependencies);

  assert.equal(await fs.readFile(path.join(first.folder, '01\u5c01\u9762\u56fe.jpg'), 'utf8'), 'image');
  assert.equal(await fs.readFile(path.join(second.folder, '02\u5c01\u9762\u56fe.jpg'), 'utf8'), 'image');
});

test('reuses a game cover filename when the same game is saved again on the same day', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-saver-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let downloadCount = 0;
  const dependencies = await coverDependencies(root, async (_url, target) => {
    downloadCount += 1;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, `image-${downloadCount}`);
  });

  const result = await saveGame({ appId: '730', name: 'Counter Strike', folder: root, selected: ['capsule-0'] }, dependencies);
  await saveGame({ appId: '730', name: 'Counter Strike', folder: root, selected: ['capsule-0'] }, dependencies);

  const files = await fs.readdir(result.folder);
  assert.deepEqual(files, ['01\u5c01\u9762\u56fe.jpg']);
  assert.equal(await fs.readFile(path.join(result.folder, '01\u5c01\u9762\u56fe.jpg'), 'utf8'), 'image-2');
  assert.deepEqual(JSON.parse(await fs.readFile(dependencies.coverStateFile, 'utf8')), {
    date: '2026-08-07',
    lastNumber: 1,
  });
});

test('does not increment the cover counter when a cover download fails', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-saver-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dependencies = await coverDependencies(root, async () => { throw new Error('download failed'); });

  await assert.rejects(
    saveGame({ appId: '730', name: 'Counter Strike', folder: root, selected: ['capsule-0'] }, dependencies),
    /download failed/,
  );

  await assert.rejects(fs.access(dependencies.coverStateFile), { code: 'ENOENT' });
});

test('does not increment the cover counter for a screenshot-only selection', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-saver-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dependencies = await coverDependencies(root, async (_url, target) => {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, 'image');
  });

  await saveGame({ appId: '730', name: 'Counter Strike', folder: root, selected: ['screenshot-1'] }, dependencies);

  await assert.rejects(fs.access(dependencies.coverStateFile), { code: 'ENOENT' });
});

test('does not create or advance cover counter state for a requirements-only selection', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-saver-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dependencies = await coverDependencies(root, async (_url, target) => {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, 'image');
  });

  await saveGame({ appId: '730', name: 'Counter Strike', folder: root, selected: ['requirements-2'] }, dependencies);

  await assert.rejects(fs.access(dependencies.coverStateFile), { code: 'ENOENT' });
});
