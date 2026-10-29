# Steam Image Daily Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read the first 20 valid games from the user's legacy Excel file and save the configured Steam image set every day at 11:30.

**Architecture:** Extract the existing Steam retrieval and file-saving logic from `server.js` into a reusable local module. A command-line batch runner will parse the `.xls` list, save the six images for each valid game, and record a timestamped JSON log. A Windows Task Scheduler wrapper will start the existing collector UI and invoke the batch runner daily.

**Tech Stack:** Node.js 18+, built-in `node:test`, SheetJS `xlsx`, Windows Task Scheduler (`schtasks`).

## Global Constraints

- Read `C:\Users\33756\Desktop\自动化\游戏图片.xls`; use the first 20 non-empty A/B records.
- A is the output folder name and B supplies the Steam AppID.
- Save one cover, the first four screenshots, and one requirements image per game to `D:\图片`.
- Download only Steam official public CDN image resources.
- Continue after individual failures and write a local timestamped run log.
- The existing collector page must open when the scheduled run starts.

---

### Task 1: Parse and validate the game list

**Files:**
- Create: `lib/game-list.js`
- Create: `test/game-list.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: an `.xls` path and an `XLSX` reader implementation.
- Produces: `readGameList(filePath, maxGames = 20) -> Array<{ name: string, appId: string }>`.

- [ ] **Step 1: Write the failing tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { readGameList } = require('../lib/game-list');

test('keeps the first 20 valid name/link rows and extracts AppID', () => {
  const rows = [['游戏名字', '游戏链接'], ['Demo', 'https://store.steampowered.com/app/730/'], ['', 'https://store.steampowered.com/app/10/']];
  assert.deepEqual(readGameList.fromRows(rows), [{ name: 'Demo', appId: '730' }]);
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `node --test test/game-list.test.js`

Expected: failure because `lib/game-list.js` does not exist.

- [ ] **Step 3: Implement minimal parsing**

```js
function appId(value) {
  const match = String(value || '').match(/(?:app\/)?(\d{1,12})(?:[/?#]|$)/);
  return match?.[1] || null;
}

function fromRows(rows, maxGames = 20) {
  return rows.slice(1).flatMap(([name, link]) => {
    const id = appId(link);
    return String(name || '').trim() && id ? [{ name: String(name).trim(), appId: id }] : [];
  }).slice(0, maxGames);
}
```

Add `xlsx` to `dependencies` and make `readGameList` read the first worksheet with `XLSX.readFile` and `XLSX.utils.sheet_to_json(..., { header: 1, defval: '' })`.

- [ ] **Step 4: Run the focused test**

Run: `node --test test/game-list.test.js`

Expected: PASS.

### Task 2: Reuse Steam saving logic from batch mode

**Files:**
- Create: `lib/steam-saver.js`
- Create: `test/steam-saver.test.js`
- Modify: `server.js`

**Interfaces:**
- Consumes: `saveGame({ appId, name, folder })`.
- Produces: `{ folder: string, count: number, name: string }` or a descriptive `Error`.

- [ ] **Step 1: Write the failing focused test**

```js
test('uses the provided spreadsheet name for the output directory', async () => {
  const result = await saveGame({ appId: '730', name: 'Counter Strike', folder: 'D:\\图片' }, fakeSteam);
  assert.match(result.folder, /Counter Strike$/);
  assert.equal(result.count, 6);
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `node --test test/steam-saver.test.js`

Expected: failure because `lib/steam-saver.js` does not exist.

- [ ] **Step 3: Extract the existing behavior without broadening download access**

Move `appId`, `game`, `safeImage`, `download`, `fileBaseName`, and `saveGame` from `server.js` into `lib/steam-saver.js`. Preserve hostname validation and the exact image selection: header, four screenshots, requirements PNG. Inject fetch/download helpers in tests; the production path uses the existing network behavior.

- [ ] **Step 4: Adapt the HTTP endpoint**

Have `/api/save` call the shared saver with the configured folder. Keep all existing endpoint response shapes unchanged.

- [ ] **Step 5: Run focused tests**

Run: `node --test test/steam-saver.test.js test/game-list.test.js`

Expected: PASS.

### Task 3: Build the batch runner and structured run log

**Files:**
- Create: `daily-sync.js`
- Create: `test/daily-sync.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `readGameList`, shared `saveGame`, and `data/settings.json`.
- Produces: `data/logs/daily-sync-YYYY-MM-DDTHH-mm-ss.json` and exit code 0 for completed runs (including per-game failures).

- [ ] **Step 1: Write the failing runner test**

```js
test('continues after one game fails and records both outcomes', async () => {
  const report = await syncGames([{ name: 'A', appId: '1' }, { name: 'B', appId: '2' }], failingSaver);
  assert.equal(report.results.length, 2);
  assert.equal(report.results.filter(x => x.status === 'failed').length, 1);
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `node --test test/daily-sync.test.js`

Expected: failure because `daily-sync.js` is not implemented.

- [ ] **Step 3: Implement the runner**

Load the configured `folder` from `data/settings.json`; reject with a clear error when it is absent. Parse the workbook, process games sequentially, and write one JSON report containing `startedAt`, `finishedAt`, successful result entries, and per-game error messages. Add `"sync:daily": "node daily-sync.js"`.

- [ ] **Step 4: Run all unit tests**

Run: `node --test`

Expected: PASS.

### Task 4: Launch and schedule the daily operation

**Files:**
- Create: `RunSteamDailySync.cmd`
- Create: `scripts/register-daily-sync.ps1`
- Modify: `README.md`

**Interfaces:**
- Consumes: the installed project directory and local Node executable.
- Produces: a Windows scheduled task named `Steam图片每日同步`, set for 11:30 every day.

- [ ] **Step 1: Implement the runner wrapper**

Use the existing `StartSteamImageKeeper.cmd` to open the UI, then invoke `npm run sync:daily` in the project directory. Redirect console output to `data/logs/daily-sync-console.log` while preserving the JSON report.

- [ ] **Step 2: Implement idempotent task registration**

```powershell
schtasks /Create /TN 'Steam图片每日同步' /TR ('"' + $wrapper + '"') /SC DAILY /ST 11:30 /F
```

Validate that `$wrapper` resolves inside the project root before registering. Use `/F` only to replace a task with that exact name.

- [ ] **Step 3: Document configuration and recovery**

Explain the source workbook path, image destination, one-time registration command, and where to inspect JSON/console logs.

- [ ] **Step 4: Verify the task and a manual sync**

Run: `node daily-sync.js` followed by `schtasks /Query /TN 'Steam图片每日同步' /V /FO LIST`.

Expected: a report with all attempted games and a task whose next run time is 11:30.

### Task 5: End-to-end acceptance check

**Files:**
- Modify: `README.md` only if verification reveals user-facing deviations.

- [ ] **Step 1: Confirm output organization**

Inspect `D:\图片` for one sample game directory containing a cover, four screenshots, and a requirements PNG.

- [ ] **Step 2: Confirm failure isolation**

Inspect the newest `data/logs/daily-sync-*.json`; every attempted game must have a `status`, and a failed game must not prevent later games from appearing.

- [ ] **Step 3: Re-run the full test suite**

Run: `node --test`

Expected: PASS.

- [ ] **Step 4: Record the verification result**

Update README only with confirmed commands and behavior, never credentials or machine-specific secrets.

## Self-review

- Spec coverage: Tasks 1-3 implement spreadsheet input, all image types, output naming, and failure logging; Task 4 implements 11:30 startup; Task 5 checks output and scheduled execution.
- Placeholder scan: no incomplete or deferred requirements remain.
- Interface consistency: all batch calls use `{ appId, name, folder }`; parser output feeds the runner directly.
