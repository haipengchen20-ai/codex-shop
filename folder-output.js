const path = require('node:path');

function extractFolder(output) {
  const match = String(output).match(/(?:^|\r?\n)__STEAM_FOLDER__:(.+?)(?:\r?\n|$)/);
  return match ? match[1].trim() || null : null;
}

function normalizeFolder(value) {
  if (typeof value !== 'string') return null;
  return value.split(/\r?\n/).map(line => line.trim()).reverse().find(path.isAbsolute) || null;
}

module.exports = { extractFolder, normalizeFolder };
