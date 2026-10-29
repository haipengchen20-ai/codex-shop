const test = require('node:test');
const assert = require('node:assert/strict');
const { identifyStore, isAllowedImageUrl } = require('../lib/platform-registry');

test('recognizes a raw Steam AppID and canonicalizes Steam product URLs', () => {
  assert.deepEqual(identifyStore('730'), { platform: 'steam', canonicalUrl: 'https://store.steampowered.com/app/730/', productId: '730' });
  assert.deepEqual(identifyStore('https://store.steampowered.com/app/730/Counter_Strike/?utm_source=test#details'), { platform: 'steam', canonicalUrl: 'https://store.steampowered.com/app/730/', productId: '730' });
});

test('recognizes a Nintendo US product URL', () => {
  assert.deepEqual(identifyStore('https://www.nintendo.com/us/store/products/mario-kart-8-deluxe-switch/?utm_source=test#info'), { platform: 'switch', canonicalUrl: 'https://www.nintendo.com/us/store/products/mario-kart-8-deluxe-switch/', productId: 'mario-kart-8-deluxe-switch' });
});

test('recognizes a Nintendo Hong Kong eShop title URL', () => {
  assert.deepEqual(identifyStore('https://ec.nintendo.com/HK/zh/titles/70010000011025?utm_source=test#info'), { platform: 'switch', canonicalUrl: 'https://ec.nintendo.com/HK/zh/titles/70010000011025', productId: '70010000011025' });
});

test('recognizes a PlayStation Store product URL', () => {
  assert.deepEqual(identifyStore('https://store.playstation.com/en-us/product/UP9000-CUSA00001_00-EXAMPLE000000000?tracking=1'), { platform: 'playstation', canonicalUrl: 'https://store.playstation.com/en-us/product/UP9000-CUSA00001_00-EXAMPLE000000000', productId: 'UP9000-CUSA00001_00-EXAMPLE000000000' });
});

test('recognizes PlayStation Store concept and three-part locale URLs', () => {
  assert.deepEqual(identifyStore('https://store.playstation.com/zh-hans-hk/concept/202140?tracking=1'), { platform: 'playstation', canonicalUrl: 'https://store.playstation.com/zh-hans-hk/concept/202140', productId: '202140' });
  assert.deepEqual(identifyStore('https://store.playstation.com/zh-hant-hk/product/HP9000-CUSA07675_00-FULLGAME00000000'), { platform: 'playstation', canonicalUrl: 'https://store.playstation.com/zh-hant-hk/product/HP9000-CUSA07675_00-FULLGAME00000000', productId: 'HP9000-CUSA07675_00-FULLGAME00000000' });
});

test('recognizes a PlayStation official game information page', () => {
  assert.deepEqual(identifyStore('https://www.playstation.com/zh-hant-tw/games/shadow-of-the-colossus/?tracking=1#overview'), { platform: 'playstation', canonicalUrl: 'https://www.playstation.com/zh-hant-tw/games/shadow-of-the-colossus/', productId: 'shadow-of-the-colossus' });
});

test('recognizes Xbox product URLs with locale and query parameters', () => {
  assert.deepEqual(identifyStore('https://www.xbox.com/en-US/games/store/example/9NBLGGH4R315?cid=test#section'), { platform: 'xbox', canonicalUrl: 'https://www.xbox.com/en-US/games/store/example/9NBLGGH4R315', productId: '9NBLGGH4R315' });
});

test('rejects lookalike storefront domains', () => {
  assert.throws(() => identifyStore('https://www.xbox.com.evil.test/en-US/games/store/example/9NBLGGH4R315'));
});

test('uses closed official image host policies', () => {
  assert.equal(isAllowedImageUrl('steam', 'https://cdn.steamstatic.com/cover.jpg'), true);
  assert.equal(isAllowedImageUrl('steam', 'https://cdn.steamusercontent.com/cover.jpg'), true);
  assert.equal(isAllowedImageUrl('steam', 'https://cdn.example.com/cover.jpg'), false);
  assert.equal(isAllowedImageUrl('xbox', 'https://xbox.com.evil.test/cover.jpg'), false);
  assert.equal(isAllowedImageUrl('xbox', 'https://xbox.com/cover.jpg'), true);
  assert.equal(isAllowedImageUrl('switch', 'https://assets.nintendo.com/cover.jpg'), true);
  assert.equal(isAllowedImageUrl('playstation', 'https://image.api.playstation.com/cover.jpg'), true);
  assert.equal(isAllowedImageUrl('xbox', 'http://xbox.com/cover.jpg'), false);
  assert.equal(isAllowedImageUrl('xbox', 'not a URL'), false);
  assert.equal(isAllowedImageUrl('unknown', 'https://xbox.com/cover.jpg'), false);
});
