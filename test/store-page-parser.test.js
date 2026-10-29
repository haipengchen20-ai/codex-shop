const test = require('node:test');
const assert = require('node:assert/strict');
const { parseStorePage } = require('../lib/store-page-parser');
const { lookupGame } = require('../lib/steam-saver');

const fixtures = [
  ['switch', 'Switch', 'https://www.nintendo.com/us/store/products/game-switch/', 'https://assets.nintendo.com'],
  ['playstation', 'PlayStation', 'https://store.playstation.com/en-us/product/UP0000-GAME', 'https://image.api.playstation.com'],
  ['xbox', 'Xbox', 'https://www.xbox.com/en-US/games/store/game/ABC123', 'https://images.xbox.com'],
];

for (const [platform, label, canonicalUrl, host] of fixtures) {
  test(`${label} extracts an official cover and up to four unique screenshots`, () => {
    const html = `<meta content="Game &amp; Fun" property="og:title"><meta property="og:image" content="${host}/cover.jpg">
      <script type="application/ld+json">${JSON.stringify({ '@type': 'VideoGame', url: canonicalUrl, screenshot: [1, 1, 2, 3, 4, 5].map(n => `${host}/screen${n}.jpg`).concat('https://evil.test/screen.jpg') })}</script>`;
    const result = parseStorePage({ platform, canonicalUrl, html });
    assert.equal(result.name, 'Game & Fun');
    assert.deepEqual(result.items.map(({ kind, label: itemLabel, url }) => [kind, itemLabel, url]), [
      ['capsule', `${label} 封面图`, `${host}/cover.jpg`],
      ...[1, 2, 3, 4].map(n => ['screenshot', `${label} 游戏截图 ${n}`, `${host}/screen${n}.jpg`]),
    ]);
    assert.equal(new Set(result.items.map(item => item.id)).size, 5);
    assert.deepEqual(result.missing, []);
  });
}

test('cover-only Switch page reports missing screenshots', () => {
  const result = parseStorePage({ platform: 'switch', canonicalUrl: fixtures[0][2], html: '<meta name="twitter:title" content="Solo"><meta name="twitter:image" content="https://assets.nintendo.com/cover.jpg">' });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].kind, 'capsule');
  assert.deepEqual(result.missing, ['screenshots']);
});

test('ignores related product screenshots and publisher data for a cover-only product', () => {
  const canonicalUrl = fixtures[0][2];
  const html = `<script type="application/ld+json">${JSON.stringify({
    '@graph': [
      { '@type': 'Organization', name: 'Publisher', image: 'https://assets.nintendo.com/publisher.jpg' },
      { '@type': 'VideoGame', url: canonicalUrl, name: 'Current Game', image: 'https://assets.nintendo.com/current.jpg' },
      { '@type': 'VideoGame', url: 'https://www.nintendo.com/us/store/products/related-switch/', name: 'Related Game', image: 'https://assets.nintendo.com/related.jpg', screenshot: ['https://assets.nintendo.com/related-screen.jpg'] },
    ],
  })}</script>`;
  const result = parseStorePage({ platform: 'switch', canonicalUrl, html });
  assert.equal(result.name, 'Current Game');
  assert.deepEqual(result.items.map(item => item.url), ['https://assets.nintendo.com/current.jpg']);
  assert.deepEqual(result.missing, ['screenshots']);
});

test('does not attribute an anonymous recommended game to the current product', () => {
  const html = `<meta property="og:title" content="Current"><meta property="og:image" content="https://assets.nintendo.com/current.jpg">
    <script type="application/ld+json">${JSON.stringify({ recommendations: [{ '@type': 'VideoGame', name: 'Other', image: 'https://assets.nintendo.com/other.jpg', screenshot: ['https://assets.nintendo.com/other-screen.jpg'] }] })}</script>`;
  const result = parseStorePage({ platform: 'switch', canonicalUrl: fixtures[0][2], html });
  assert.equal(result.name, 'Current');
  assert.deepEqual(result.items.map(item => item.url), ['https://assets.nintendo.com/current.jpg']);
  assert.deepEqual(result.missing, ['screenshots']);
});

test('does not use an anonymous recommended game as fallback name or cover', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({ recommendations: [{ '@type': 'Product', name: 'Other', image: 'https://assets.nintendo.com/other.jpg' }] })}</script>`;
  const result = parseStorePage({ platform: 'switch', canonicalUrl: fixtures[0][2], html });
  assert.equal(result.name, fixtures[0][2]);
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.missing, ['cover', 'screenshots']);
});

test('selects matching PlayStation product from embedded product data', () => {
  const canonicalUrl = fixtures[1][2];
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { products: [
    { url: 'https://store.playstation.com/en-us/product/OTHER', name: 'Other', image: 'https://image.api.playstation.com/other.jpg', screenshots: ['https://image.api.playstation.com/other-screen.jpg'] },
    { url: canonicalUrl, name: 'Selected', image: { url: 'https://image.api.playstation.com/selected.jpg' }, screenshots: [{ url: 'https://image.api.playstation.com/selected-screen.jpg' }], publisher: { name: 'Publisher', image: 'https://image.api.playstation.com/publisher.jpg' } },
  ] } })}</script>`;
  const result = parseStorePage({ platform: 'playstation', canonicalUrl, html });
  assert.equal(result.name, 'Selected');
  assert.deepEqual(result.items.map(item => item.url), ['https://image.api.playstation.com/selected.jpg', 'https://image.api.playstation.com/selected-screen.jpg']);
});

test('extracts PlayStation Store cache media for a matching product ID', () => {
  const canonicalUrl = 'https://store.playstation.com/zh-hant-hk/product/HP9000-CUSA07675_00-FULLGAME00000000';
  const media = [
    { role: 'BACKGROUND', type: 'IMAGE', url: 'https://image.api.playstation.com/background.png' },
    { role: 'MASTER', type: 'IMAGE', url: 'https://image.api.playstation.com/master.png' },
    ...[1, 2, 3, 4, 5].map(n => ({ role: 'SCREENSHOT', type: 'IMAGE', url: `https://image.api.playstation.com/screenshot-${n}.jpg` })),
    { role: 'SCREENSHOT', type: 'IMAGE', url: 'https://evil.test/not-allowed.jpg' },
  ];
  const html = `<script type="application/json">${JSON.stringify({ args: { productId: 'HP9000-CUSA07675_00-FULLGAME00000000' }, cache: {
    'Product:HP9000-CUSA07675_00-FULLGAME00000000': { id: 'HP9000-CUSA07675_00-FULLGAME00000000', __typename: 'Product', name: 'Cached game', personalizedMeta: { media } },
    'Product:OTHER': { id: 'OTHER', __typename: 'Product', personalizedMeta: { media: [{ role: 'SCREENSHOT', type: 'IMAGE', url: 'https://image.api.playstation.com/other.jpg' }] } },
  } })}</script>`;
  const result = parseStorePage({ platform: 'playstation', canonicalUrl, html });
  assert.equal(result.name, 'Cached game');
  assert.deepEqual(result.items.map(item => item.url), [
    'https://image.api.playstation.com/master.png',
    ...[1, 2, 3, 4].map(n => `https://image.api.playstation.com/screenshot-${n}.jpg`),
  ]);
});

test('selects Xbox current product by product id within embedded data', () => {
  const canonicalUrl = fixtures[2][2];
  const html = `<script type="application/json">${JSON.stringify({ products: [
    { productId: 'OTHER', title: 'Other', image: 'https://images.xbox.com/other.jpg', screenshots: ['https://images.xbox.com/other-screen.jpg'] },
    { productId: 'ABC123', title: 'Chosen', image: 'https://images.xbox.com/chosen.jpg', screenshots: ['https://images.xbox.com/chosen-screen.jpg'] },
  ] })}</script>`;
  const result = parseStorePage({ platform: 'xbox', canonicalUrl, html });
  assert.equal(result.name, 'Chosen');
  assert.deepEqual(result.items.map(item => item.url), ['https://images.xbox.com/chosen.jpg', 'https://images.xbox.com/chosen-screen.jpg']);
});

test('Xbox JSON-LD selects the matching product instead of a preceding WebPage', () => {
  const canonicalUrl = 'https://www.xbox.com/en-us/games/store/minecraft/9NBLGGH2JHXJ';
  const pageUrl = 'https://www.xbox.com/en-US/games/store/minecraft-for-windows/9nblggh2jhxj';
  const html = `<script type="application/ld+json">${JSON.stringify({ '@graph': [
    { '@type': 'WebPage', url: pageUrl, name: 'Buy Minecraft | XBOX' },
    { '@type': ['Product', 'VideoGame'], url: pageUrl, name: 'Minecraft for Windows', image: ['https://store-images.s-microsoft.com/image/cover'] },
    { '@type': 'Product', url: 'https://www.xbox.com/en-us/games/store/other/OTHER', image: 'https://store-images.s-microsoft.com/image/other' },
  ] })}</script>`;
  const result = parseStorePage({ platform: 'xbox', canonicalUrl, html });
  assert.equal(result.name, 'Minecraft for Windows');
  assert.deepEqual(result.items.map(item => item.url), ['https://store-images.s-microsoft.com/image/cover']);
  assert.deepEqual(result.missing, ['screenshots']);
});

test('Xbox preloaded product screenshots use only the matching product and trusted hosts', () => {
  const canonicalUrl = 'https://www.xbox.com/en-us/games/store/minecraft/9NBLGGH2JHXJ';
  const root = { core2: { products: { productSummaries: {
    '9NBLGGH2JHXJ': { productId: '9NBLGGH2JHXJ', images: { screenshots: [{url:'https://evil.test/bad'}, ...[1,2,3,4,5].map(n => ({url: `https://store-images.s-microsoft.com/image/${n}`}))] } },
    OTHER: { productId: 'OTHER', images: { screenshots: [{url:'https://store-images.s-microsoft.com/image/other'}] } },
  } } } };
  const html = `<script>window.__PRELOADED_STATE__ = ${JSON.stringify(root)}; window.other = 1;</script>`;
  const result = parseStorePage({platform:'xbox', canonicalUrl, html});
  assert.deepEqual(result.items.map(x=>x.url), [1,2,3,4].map(n=>`https://store-images.s-microsoft.com/image/${n}`));
  root.core2.products.productSummaries['9NBLGGH2JHXJ'].productId='OTHER';
  assert.deepEqual(parseStorePage({platform:'xbox',canonicalUrl,html:`<script>window.__PRELOADED_STATE__ = ${JSON.stringify(root)};</script>`}).items, []);
});

test('Nintendo matches current Apollo product gallery IDs to allowed ImageObjects only', () => {
  const canonicalUrl = 'https://www.nintendo.com/us/store/products/game-switch/';
  const gallery = [1,2,3,4,5].map(n=>({__typename:'CloudinaryAsset', resourceType:'image', publicId:`store/software/switch/123/${n}`}));
  const state = { props:{pageProps:{initialApolloState:{
    'Product:1': {__typename:'Product',urlKey:'game-switch',productGallery:gallery},
    'Product:2': {__typename:'Product',urlKey:'other-switch',productGallery:[{resourceType:'image',publicId:'store/software/switch/other/1'}]},
  }}} };
  const images = gallery.map(x=>({'@type':'ImageObject',contentUrl:`https://assets.nintendo.com/image/upload/q_auto/${x.publicId}`}));
  images.unshift({'@type':'ImageObject',contentUrl:'https://evil.test/store/software/switch/123/1'}, {'@type':'ImageObject',contentUrl:'https://assets.nintendo.com/image/upload/store/software/switch/other/1'});
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(state)}</script><script type="application/ld+json">${JSON.stringify({'@graph':images})}</script>`;
  const result = parseStorePage({platform:'switch',canonicalUrl,html});
  assert.deepEqual(result.items.map(x=>x.url), gallery.slice(0,4).map(x=>`https://assets.nintendo.com/image/upload/q_auto/${x.publicId}`));
});

test('PlayStation official error redirect explains the unavailable product instead of reporting an invalid input', async () => {
  const source = 'https://store.playstation.com/en-us/product/UP9000-CUSA10249_00-GODOFWARDIGITAL0';
  await assert.rejects(lookupGame(source, { fetch: async () => ({ status: 302, headers: new Headers({ location: '/en-us/error?widgetStatusCode=204' }) }) }), /PlayStation.*(?:unavailable|不可用)/i);
});

test('PlayStation three-part locale error redirect explains the unavailable product', async () => {
  const source = 'https://store.playstation.com/zh-hans-hk/concept/202140';
  await assert.rejects(lookupGame(source, { fetch: async () => ({ status: 302, headers: new Headers({ location: '/zh-hans-hk/error?widgetStatusCode=204' }) }) }), /PlayStation.*(?:unavailable|不可用)/i);
});

test('console lookup rejects a redirect to an untrusted host without requesting it', async () => {
  const requests = [];
  await assert.rejects(lookupGame(fixtures[1][2], { fetch: async url => { requests.push(url); return { status: 302, headers: new Headers({ location: 'https://store.playstation.com.evil.test/en-us/error' }) }; } }));
  assert.deepEqual(requests, [fixtures[1][2]]);
});

test('console lookup follows an official redirect with the same product identity', async () => {
  const original = 'https://www.xbox.com/en-us/games/store/old-slug/ABC123';
  const canonical = 'https://www.xbox.com/en-US/games/store/new-slug/abc123';
  const requests = [];
  const result = await lookupGame(original, { fetch: async url => {
    requests.push(url);
    return url === original
      ? { status: 302, headers: new Headers({ location: canonical }) }
      : { status: 200, ok: true, text: async () => '<meta property="og:title" content="Game"><meta property="og:image" content="https://images.xbox.com/cover.jpg">' };
  } });
  assert.deepEqual(requests, [original, canonical]);
  assert.equal(result.id, 'ABC123');
  assert.equal(result.items[0].url, 'https://images.xbox.com/cover.jpg');
});

test('console lookup rejects an official redirect to a different product before requesting it', async () => {
  const original = 'https://www.xbox.com/en-us/games/store/first/ABC123';
  const requests = [];
  await assert.rejects(lookupGame(original, { fetch: async url => {
    requests.push(url);
    return { status: 302, headers: new Headers({ location: 'https://www.xbox.com/en-us/games/store/second/OTHER456' }) };
  } }), /different product/i);
  assert.deepEqual(requests, [original]);
});

test('console lookup uses supplied fetch and returns the collector shape', async () => {
  const requests = [];
  const result = await lookupGame('https://www.xbox.com/en-US/games/store/game/ABC123?tracking=1', {
    fetch: async (url, options) => { requests.push({ url, options }); return { ok: true, status: 200, text: async () => '<meta property="og:title" content="Xbox Game"><meta property="og:image" content="https://images.xbox.com/cover.jpg">' }; },
  });
  assert.equal(requests[0].url, 'https://www.xbox.com/en-US/games/store/game/ABC123');
  assert.equal(result.platform, 'xbox');
  assert.equal(result.id, 'ABC123');
  assert.equal(result.name, 'Xbox Game');
  assert.deepEqual(result.missing, ['screenshots']);
});

test('Steam lookup retains API items and reports missing images', async () => {
  const result = await lookupGame('730', {
    fetch: async () => ({ ok: true, json: async () => ({ 730: { success: true, data: { name: 'Steam Game', header_image: 'https://cdn.steamstatic.com/cover.jpg', screenshots: [], pc_requirements: {} } } }) }),
    requirementsPng: async () => 'requirements.png',
  });
  assert.equal(result.platform, 'steam');
  assert.equal(result.id, '730');
  assert.equal(result.name, 'Steam Game');
  assert.deepEqual(result.items.map(item => item.kind), ['capsule', 'requirements']);
  assert.deepEqual(result.missing, ['screenshots']);
});
