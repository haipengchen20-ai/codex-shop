const fs = require('node:fs/promises');
const path = require('node:path');

function localDate(value) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

async function readState(stateFile) {
  try {
    return JSON.parse(await fs.readFile(stateFile, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { date: null, lastNumber: 0 };
    throw error;
  }
}

function createCoverSequence({ stateFile, now = () => new Date() }) {
  let pending;

  async function next() {
    const date = localDate(now());
    const state = await readState(stateFile);
    const lastNumber = state.date === date && Number.isInteger(state.lastNumber) ? state.lastNumber : 0;
    const number = lastNumber + 1;
    pending = { date, number, filenamePrefix: String(number).padStart(2, '0') };
    return pending;
  }

  async function commit() {
    if (!pending) throw new Error('No cover number is pending');
    await fs.mkdir(path.dirname(stateFile), { recursive: true });
    await fs.writeFile(stateFile, JSON.stringify({ date: pending.date, lastNumber: pending.number }));
    pending = undefined;
  }

  return { next, commit };
}

module.exports = { createCoverSequence };
