# 每日封面编号 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为所有游戏的新增封面图提供按本机日期重置的全局递增编号文件名。

**Architecture:** 在 `lib/cover-sequence.js` 中集中管理当天的编号状态和跨进程状态锁文件。`saveGame` 只在成功写入已选中的封面图后提交编号，手动保存和 `daily-sync.js` 因为共用同一个状态文件与锁而使用同一序列。

**Tech Stack:** Node.js 18+、`node:fs/promises`、`node:test`。

## Global Constraints

- 名称格式为至少两位的 `<编号>封面图.<扩展名>`，例如 `01封面图.jpg`；100 及以上不截断。
- 序列在所有游戏与保存文件夹之间共用，并按运行机器的本地日期在 00:00 后首次保存时重置。
- 只有已选中且成功下载的封面图才占用编号；截图和系统需求图不占用编号。
- 不重命名、移动或删除既有文件。
- 当前工作目录不是 Git 仓库，跳过提交步骤。

---

### Task 1: 实现每日编号状态管理器

**Files:**
- Create: `lib/cover-sequence.js`
- Test: `test/cover-sequence.test.js`

**Interfaces:**
- Produces: `createCoverSequence({ stateFile, now? })`，返回 `{ reserve(), commit(reservation), release(reservation) }`。
- `reserve()` 返回 `{ date: 'YYYY-MM-DD', number: 1, filenamePrefix: '01', lock }`；`lock` 持有跨进程排他锁。
- `commit(reservation)` 仅在下载成功后将 `{ date, lastNumber }` 写入 `stateFile`。

- [ ] **Step 1: 写失败测试，验证当天递增和两位补零**

```js
test('allocates 01 then 02 on the same local date', async (t) => {
  const sequence = createCoverSequence({ stateFile, now: () => new Date('2026-08-07T10:00:00') });
  const first = await sequence.reserve();
  await sequence.commit(first);
  const second = await sequence.reserve();
  assert.deepEqual(first, { date: '2026-08-07', number: 1, filenamePrefix: '01' });
  assert.equal(second.filenamePrefix, '02');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/cover-sequence.test.js`

Expected: FAIL，因为 `../lib/cover-sequence` 尚不存在。

- [ ] **Step 3: 写失败测试，验证跨日重置与失败不消耗编号**

```js
test('resets after local midnight and releases failed reservations', async () => {
  const sequence = createCoverSequence({ stateFile, now: () => currentTime });
  const pending = await sequence.reserve();
  await sequence.release(pending);
  assert.equal((await sequence.reserve()).filenamePrefix, '01');
  await sequence.commit(await sequence.reserve());
  currentTime = new Date('2026-08-08T00:00:01');
  assert.equal((await sequence.reserve()).filenamePrefix, '01');
});
```

- [ ] **Step 4: 实现状态文件与跨进程锁**

```js
function localDate(value) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function createCoverSequence({ stateFile, now = () => new Date() }) {
  // 用 fs.open(`${stateFile}.lock`, 'wx') 取得锁；文件存在则重试。
  // 读取 { date, lastNumber }；日期不同视为 lastNumber: 0；commit/release 都释放锁。
}
```

- [ ] **Step 5: 运行编号测试确认通过**

Run: `node --test test/cover-sequence.test.js`

Expected: PASS，覆盖当天连续编号、跨日重置、失败释放和 100 以上编号。

- [ ] **Step 6: 提交**

当前目录没有 `.git`，不执行提交。

### Task 2: 在保存流程中使用每日封面编号

**Files:**
- Modify: `lib/steam-saver.js`
- Modify: `test/steam-saver.test.js`

**Interfaces:**
- Consumes: `createCoverSequence({ stateFile })`。
- Updates: `saveGame({ appId, name, folder, selected }, dependencies?)` 接受可选 `dependencies.coverSequence`，其余调用方保持兼容。
- Produces: 成功的封面文件名为 `<prefix>封面图<extension>`；未选中封面或封面下载失败时不提交编号。

- [ ] **Step 1: 写失败测试，验证封面按编号命名而其他图片不占号**

```js
test('names only selected cover images with the daily sequence', async () => {
  const result = await saveGame({ appId: '730', name: 'Game', folder: root, selected: ['capsule-0'] }, {
    ...fakeSteam,
    coverSequence: fakeSequence,
  });
  assert.deepEqual(savedBasenames, ['01封面图.jpg']);
  assert.equal(fakeSequence.committed.length, 1);
});
```

- [ ] **Step 2: 运行该测试确认失败**

Run: `node --test test/steam-saver.test.js`

Expected: FAIL，当前封面仍写为固定名称。

- [ ] **Step 3: 在 `saveGame` 中先保留编号、下载成功后提交**

```js
if (item.kind === 'capsule') {
  const reservation = await coverSequence.reserve();
  const target = path.join(outputFolder, `${reservation.filenamePrefix}封面图${extension}`);
  try { await saveDownload(item.url, target); await coverSequence.commit(reservation); }
  catch (error) { await coverSequence.release(reservation); throw error; }
}
```

- [ ] **Step 4: 扩展测试，验证失败下载不会消耗编号**

```js
test('does not commit a cover number when its download fails', async () => {
  await assert.rejects(() => saveGame({ appId: '730', name: 'Game', folder: root }, failingDependencies));
  assert.equal(failingDependencies.coverSequence.committed.length, 0);
});
```

- [ ] **Step 5: 运行保存流程测试确认通过**

Run: `node --test test/steam-saver.test.js`

Expected: PASS，原有六图保存行为仍存在，封面命名改为每日编号，截图和系统需求不消耗编号。

- [ ] **Step 6: 提交**

当前目录没有 `.git`，不执行提交。

### Task 3: 全量验证与用户说明

**Files:**
- Modify: `README.md`
- Test: `test/cover-sequence.test.js`
- Test: `test/steam-saver.test.js`

**Interfaces:**
- Documents: 手动保存和每日自动同步共用的每日全局封面编号规则。

- [ ] **Step 1: 更新使用说明**

在保存规则段落中加入：`封面图按当天全局顺序保存为 01封面图、02封面图；本机日期跨过 00:00 后从 01 重新开始。`

- [ ] **Step 2: 执行完整测试套件**

Run: `node --test`

Expected: PASS，现有保存、系统需求 PNG、文件夹选择和新增编号测试全部通过。

- [ ] **Step 3: 执行语法检查**

Run: `node --check server.js && node --check lib/steam-saver.js && node --check lib/cover-sequence.js && node --check daily-sync.js`

Expected: 所有命令退出码为 0。

- [ ] **Step 4: 提交**

当前目录没有 `.git`，不执行提交。
