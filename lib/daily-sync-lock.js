const fs = require('node:fs/promises');
const path = require('node:path');

function defaultIsProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

async function acquireDailySyncLock({ lockFile, pid = process.pid, isProcessRunning = defaultIsProcessRunning }) {
  const payload = JSON.stringify({ pid });

  async function create() {
    await fs.mkdir(path.dirname(lockFile), { recursive: true });
    const handle = await fs.open(lockFile, 'wx');
    await handle.writeFile(payload);
    await handle.close();
  }

  try {
    await create();
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;

    let existing;
    try {
      existing = JSON.parse(await fs.readFile(lockFile, 'utf8'));
    } catch (readError) {
      if (readError.code !== 'ENOENT') throw readError;
    }
    if (Number.isInteger(existing?.pid) && isProcessRunning(existing.pid)) {
      throw new Error(`已有同步正在运行（进程 ${existing.pid}）。`);
    }

    await fs.rm(lockFile, { force: true });
    await create();
  }

  return {
    release: () => fs.rm(lockFile, { force: true }),
  };
}

module.exports = { acquireDailySyncLock };
