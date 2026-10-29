const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createCoverSequence } = require('../lib/cover-sequence');

test('allocates sequential numbers and resets on the next local day', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cover-sequence-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stateFile = path.join(root, 'cover-counter.json');
  let now = new Date(2026, 7, 7, 10, 0, 0);
  const sequence = createCoverSequence({ stateFile, now: () => now });

  assert.deepEqual(await sequence.next(), { date: '2026-08-07', number: 1, filenamePrefix: '01' });
  await sequence.commit();
  assert.deepEqual(await sequence.next(), { date: '2026-08-07', number: 2, filenamePrefix: '02' });
  await sequence.commit();

  now = new Date(2026, 7, 8, 0, 0, 1);
  assert.deepEqual(await sequence.next(), { date: '2026-08-08', number: 1, filenamePrefix: '01' });
});
