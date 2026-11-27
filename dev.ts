/**
 * Local development orchestrator launching Express API and Vite dev servers concurrently.
 */

import { spawn, type ChildProcess } from 'node:child_process';

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function launch(script: string): ChildProcess {
  return spawn(npmCmd, ['run', script], {
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });
}

const server = launch('dev:server');
const client = launch('dev:client');
let shuttingDown = false;

function shutdown(code = 0): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  server.kill('SIGTERM');
  client.kill('SIGTERM');
  process.exit(code);
}

function attachProcessLifecycle(child: ChildProcess): void {
  child.on('error', () => {
    shutdown(1);
  });
  child.on('exit', (code) => {
    if (code !== null && code !== 0) {
      shutdown(code);
    }
  });
}

attachProcessLifecycle(server);
attachProcessLifecycle(client);

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
