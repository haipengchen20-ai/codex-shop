function fromRows(rows, maxGames = Infinity) {
  return (Array.isArray(rows) ? rows.slice(1) : [])
    .map((row) => {
      const name = String(row?.[0] || '').trim();
      const source = String(row?.[1] || '').trim();
      return name && source ? { name, source } : null;
    })
    .filter(Boolean)
    .slice(0, maxGames);
}

function readGameList(filePath, maxGames = Infinity, XLSX = require('xlsx')) {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  return fromRows(rows, maxGames);
}

readGameList.fromRows = fromRows;

module.exports = readGameList;
