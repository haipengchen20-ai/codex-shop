# 多平台商城链接图片采集 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the collector save publicly exposed cover art and screenshots from Nintendo Switch, PlayStation Store and Xbox product links while retaining Steam behavior and scheduled mixed-platform Excel sync.

**Architecture:** Add a small platform registry that identifies a store from its official product URL and routes it to a focused page parser. Normalize every parser result to the existing collector item shape, then use a platform-aware official-CDN allowlist for safe downloads. Refactor subscriptions and batch sync to key work by platform plus canonical product link rather than Steam AppID alone.

**Tech Stack:** Node.js 18+, built-in `fetch`, built-in `node:test`, existing local HTTP UI, existing `xlsx` parser.

**Spec:** `docs/superpowers/specs/2026-10-28-multi-platform-store-link-design.md`

## Global Constraints

- Accept official Steam, Nintendo Switch, PlayStation Store (PS4/PS5), and Xbox/Microsoft Store product links in the existing “游戏链接” spreadsheet column.
- Steam preserves cover + four screenshots + system-requirements PNG; console platforms save only cover + up to four publicly exposed screenshots.
- Use only source-store pages and their official image CDNs; no third-party database, search, or fallback imagery.
- Validate allowed image hostnames before every download and after every redirect.
- Main Codex sync remains every Monday–Saturday at 11:00 and must accept mixed-platform rows.
- A console game with a valid cover but no public screenshots is a successful save and reports zero screenshots.

## Review Focus

- A Nintendo/PlayStation/Xbox URL with query parameters or a locale prefix must still be recognized as its correct platform.
- A lookalike domain or redirected image URL outside a platform’s approved hosts must be rejected before any file is created.
- Console pages exposing only Open Graph cover metadata must save that cover and report zero screenshots, not fail the whole game.
- Two subscriptions for products from different platforms must not overwrite one another even when their IDs match.
- A mixed spreadsheet where one console URL is invalid must record that one failure while saving valid Steam and console rows.

---

### Task 1: Define platform recognition and safe source policy

**Files:**
- Create: `lib/platform-registry.js`
- Create: `test/platform-registry.test.js`
- Modify: `lib/steam-saver.js`

**Interfaces:**
- Produces: `identifyStore(input: string) -> { platform: 'steam'|'switch'|'playstation'|'xbox', canonicalUrl: string, productId: string|null }`.
- Produces: `isAllowedImageUrl(platform: Platform, url: string) -> boolean`.
- Consumes: raw AppID, Steam URL, or official store URL.

- [ ] **Step 1: Write the failing platform-recognition tests**

```js
assert.equal(identifyStore('730').platform, 'steam');
assert.equal(identifyStore('https://www.nintendo.com/us/store/products/example-switch/').platform, 'switch');
assert.equal(identifyStore('https://store.playstation.com/en-us/product/UP0000-EXAMPLE').platform, 'playstation');
assert.equal(identifyStore('https://www.xbox.com/en-US/games/store/example/9ABC').platform, 'xbox');
assert.throws(() => identifyStore('https://not-nintendo.example/game'));
```

- [ ] **Step 2: Run the focused test to verify RED**

Run: `node --test test/platform-registry.test.js`

Expected: failure because the registry does not exist.

- [ ] **Step 3: Implement the registry and per-platform CDN allowlists**

Define official storefront hostname patterns, canonicalize URLs by removing tracking query/hash fragments, preserve the Steam AppID path, and expose a closed image-host set per platform. Update existing Steam URL validation to call the registry policy, without widening Steam hosts.

- [ ] **Step 4: Add the review-focus tests for locale/query recognition and redirected lookalike rejection**

```js
assert.equal(identifyStore('https://www.xbox.com/ja-JP/games/store/example/9ABC?cid=store').platform, 'xbox');
assert.equal(isAllowedImageUrl('xbox', 'https://xbox.com.evil.test/cover.jpg'), false);
```

- [ ] **Step 5: Run focused and existing Steam tests**

Run: `node --test test/platform-registry.test.js test/steam-saver.test.js`

Expected: PASS.

### Task 2: Parse official console product pages into collector items

**Files:**
- Create: `lib/store-page-parser.js`
- Create: `test/store-page-parser.test.js`
- Modify: `lib/steam-saver.js`

**Interfaces:**
- Produces: `parseStorePage({ platform, canonicalUrl, html }) -> { name: string, items: ImageItem[], missing: string[] }`.
- Produces: `lookupGame(input: string, dependencies?) -> { platform: string, id: string, name: string, items: ImageItem[], missing: string[] }`.
- `ImageItem` retains `{ id, kind: 'capsule'|'screenshot', label, url }`.

- [ ] **Step 1: Write fixture-based failing tests for all three page formats**

Use saved, minimal official-page fixtures containing Open Graph cover metadata and structured screenshot URLs. Assert that every parser emits one `capsule` item, limits screenshots to four, de-duplicates URLs, and produces platform-specific labels.

- [ ] **Step 2: Run parser tests to verify RED**

Run: `node --test test/store-page-parser.test.js`

Expected: failure because the parser module does not exist.

- [ ] **Step 3: Implement HTML metadata and structured-data extraction**

Read Open Graph/Twitter cover candidates and embedded JSON data only from the fetched official product HTML; select the first allowlisted cover and up to four allowlisted screenshots. Do not guess images from page CSS or use a third-party source. Keep parser functions pure and use platform-specific extraction rules isolated in the new module.

- [ ] **Step 4: Add the review-focus test for a cover-only console page**

```js
const result = parseStorePage({ platform: 'switch', canonicalUrl: url, html: coverOnlyFixture });
assert.equal(result.items.filter(x => x.kind === 'capsule').length, 1);
assert.equal(result.items.filter(x => x.kind === 'screenshot').length, 0);
assert.deepEqual(result.missing, ['screenshots']);
```

- [ ] **Step 5: Route console URLs through `lookupGame` and retain Steam output**

Have Steam calls continue using the current API path. Console calls fetch the recognized official page via the existing proxy-aware fetch path, invoke `parseStorePage`, and return the common result format.

- [ ] **Step 6: Run all parser and Steam saver tests**

Run: `node --test test/store-page-parser.test.js test/platform-registry.test.js test/steam-saver.test.js`

Expected: PASS.

### Task 3: Save, subscription, and batch-sync by platform key

**Files:**
- Modify: `lib/steam-saver.js`
- Modify: `lib/game-list.js`
- Modify: `daily-sync.js`
- Modify: `server.js`
- Create: `test/multi-platform-sync.test.js`

**Interfaces:**
- Replaces: `saveGame({ appId, name, folder, selected }, dependencies?)` with `saveGame({ source, name, folder, selected }, dependencies?)`, where `source` is a raw supported URL or Steam AppID.
- Produces: `{ platform, sourceKey, folder, count, name, missing }`.
- Produces: `readGameList(filePath, maxGames) -> Array<{ name: string, source: string }>`.

- [ ] **Step 1: Write failing mixed-sync and subscription-key tests**

```js
assert.deepEqual(readGameList.fromRows([['游戏名字', '游戏链接'], ['Switch game', nintendoUrl]])[0], { name: 'Switch game', source: nintendoUrl });
assert.notEqual(subscriptionKey({ platform: 'steam', sourceKey: '730' }), subscriptionKey({ platform: 'xbox', sourceKey: '730' }));
```

- [ ] **Step 2: Run the focused test to verify RED**

Run: `node --test test/multi-platform-sync.test.js`

Expected: failure because source-based sync and subscription keys do not exist.

- [ ] **Step 3: Implement source-based save flow and exact-result logging**

Use `lookupGame` for every source. Save console cover/screenshots through the platform-aware downloader; only Steam appends its requirements image. Include `platform`, `sourceKey`, `count`, and `missing` in API and batch results. Keep one failed game from aborting a mixed batch.

- [ ] **Step 4: Implement subscription migration**

Read legacy `{ id, filename, items }` subscriptions as Steam records for backward compatibility, while all new records persist `{ platform, source, sourceKey, filename, items }`. Use `subscriptionKey` for upsert/delete and display platform + name in the existing task list.

- [ ] **Step 5: Add the review-focus test for one invalid console URL in a mixed batch**

```js
const results = await syncGames([{ name: 'Steam', source: '730' }, { name: 'Bad', source: 'https://example.test' }], saver);
assert.equal(results.filter(x => x.status === 'saved').length, 1);
assert.equal(results.filter(x => x.status === 'failed').length, 1);
```

- [ ] **Step 6: Run the full test suite**

Run: `node --test`

Expected: PASS.

### Task 4: Update the collector interface and verify real official links

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `README.md`
- Test: `test/server.test.js`

**Interfaces:**
- The lookup endpoint accepts `source` instead of Steam-only `id`, while accepting legacy `id` as a compatibility alias.
- UI reads the returned `platform` and `missing` fields.

- [ ] **Step 1: Write the failing endpoint compatibility test**

```js
const response = await request('/api/game?source=' + encodeURIComponent(playstationUrl));
assert.equal(response.platform, 'playstation');
assert.ok(response.items.some(x => x.kind === 'capsule'));
```

- [ ] **Step 2: Run the endpoint test to verify RED**

Run: `node --test test/server.test.js`

Expected: failure because the server only accepts Steam `id` input.

- [ ] **Step 3: Update page copy and result presentation**

Rename the app to “多平台游戏图片收藏器”, update the input placeholder to mention official Steam/Nintendo/PlayStation/Xbox links, display a platform label, and show a non-error notice when the console page has no public screenshots. Preserve item selection and folder selection behavior.

- [ ] **Step 4: Update endpoint and README copy**

Accept `source` and legacy `id`; route saves/subscriptions through the source-based interface. Document accepted official URL types, console image differences, Excel mixed-link usage, and that only publicly exposed images are supported.

- [ ] **Step 5: Verify each official platform with one real URL**

Use one official Nintendo, PlayStation, and Xbox product URL plus one Steam URL. Confirm the response platform, saved image count, and saved files are in the configured folder. Record any source that exposes only a cover as a successful cover-only result.

- [ ] **Step 6: Run final regression suite**

Run: `node --test`

Expected: PASS.

## Self-review

- Spec coverage: Task 1 owns trusted source recognition; Task 2 owns official-page image discovery; Task 3 owns saving, scheduled mixed Excel input, and subscription safety; Task 4 owns UI, compatibility, documentation, and live verification.
- Review focus coverage: Task 1 tests URL normalization and hostile hosts; Task 2 tests cover-only pages; Task 3 tests colliding subscription keys and isolated mixed-batch errors; Task 4 verifies actual official links.
- Interface consistency: all new calls use `source`, recognized results expose `platform` and `sourceKey`, and saved output retains common image item shape.
