const test = require('node:test');
const assert = require('node:assert/strict');
const readGameList = require('../lib/game-list');

test('fromRows skips the first row and retains rows with a name and source', () => {
  const games = readGameList.fromRows([
    ['Header game', 'https://store.steampowered.com/app/999999/'],
    ['  Counter-Strike 2  ', 'https://store.steampowered.com/app/730/CounterStrike_2/'],
    ['Missing URL', ''],
    ['', 'https://store.steampowered.com/app/570/Dota_2/'],
    ['Not a game URL', 'https://store.steampowered.com/'],
  ]);

  assert.deepEqual(games, [{ name: 'Counter-Strike 2', source: 'https://store.steampowered.com/app/730/CounterStrike_2/' }, { name: 'Not a game URL', source: 'https://store.steampowered.com/' }]);
});

test('fromRows preserves a Steam app URL', () => {
  const games = readGameList.fromRows([
    ['Game name', 'Steam URL'],
    ['Dota 2', 'https://store.steampowered.com/app/570/Dota_2/'],
  ]);

  assert.deepEqual(games, [{ name: 'Dota 2', source: 'https://store.steampowered.com/app/570/Dota_2/' }]);
});

test('fromRows retains unsupported sources along with valid rows', () => {
  const rows = [['Game name', 'Steam URL']];
  rows.push(['Invalid', 'not an app id']);
  for (let index = 1; index <= 21; index += 1) {
    rows.push([`Game ${index}`, `https://store.steampowered.com/app/${index}/`]);
  }

  const games = readGameList.fromRows(rows);

  assert.equal(games.length, 22);
  assert.deepEqual(games[0], { name: 'Invalid', source: 'not an app id' });
  assert.deepEqual(games[1], { name: 'Game 1', source: 'https://store.steampowered.com/app/1/' });
  assert.deepEqual(games[21], { name: 'Game 21', source: 'https://store.steampowered.com/app/21/' });
});
