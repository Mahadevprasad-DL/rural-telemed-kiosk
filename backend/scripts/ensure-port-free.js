import { execSync } from 'node:child_process';

const PORT = process.env.PORT || '4000';

function getListeningPidsWindows(port) {
  const output = execSync(`netstat -ano -p tcp | findstr :${port}`, {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });

  const pids = new Set();
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    if (!line.includes('LISTENING')) {
      continue;
    }

    const parts = line.split(/\s+/);
    const pid = parts[parts.length - 1];
    if (pid && /^\d+$/.test(pid)) {
      pids.add(pid);
    }
  }

  return [...pids];
}

function getListeningPidsUnix(port) {
  const output = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN || true`, {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\d+$/.test(line));
}

function killPid(pid) {
  if (process.platform === 'win32') {
    execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
  } else {
    execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
  }
}

function run() {
  try {
    const pids = process.platform === 'win32' ? getListeningPidsWindows(PORT) : getListeningPidsUnix(PORT);

    if (!pids.length) {
      console.log(`[ensure-port-free] Port ${PORT} is already free.`);
      return;
    }

    for (const pid of pids) {
      try {
        killPid(pid);
        console.log(`[ensure-port-free] Stopped PID ${pid} on port ${PORT}.`);
      } catch (error) {
        console.warn(`[ensure-port-free] Could not stop PID ${pid}: ${error.message}`);
      }
    }
  } catch {
    console.log(`[ensure-port-free] No active listener found on port ${PORT}.`);
  }
}

run();
