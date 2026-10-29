const test = require('node:test');
const assert = require('node:assert/strict');
const { extractFolder, normalizeFolder } = require('../folder-output');

test('extractFolder ignores PowerShell warnings before the selected folder', () => {
  const output = '[WARNING] Ignore caches that are heterogeneous\r\n__STEAM_FOLDER__:D:\\图片';
  assert.equal(extractFolder(output), 'D:\\图片');
});

test('normalizeFolder recovers a valid path from a legacy warning-prefixed setting', () => {
  assert.equal(normalizeFolder('[WARNING] Ignore caches that are heterogeneous\r\nD:\\图片'), 'D:\\图片');
});
