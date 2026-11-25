import { spawn, type ChildProcess } from 'node:child_process';

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function launch(script: string): ChildProcess {
  return spawn(npmCmd, ['run', script], {
    stdio: 'inherit',
    env: process.env,
  });
}

const server = launch('dev:server');
const client = launch('dev:client');

function shutdown(code = 0): void {
  server.kill('SIGTERM');
  client.kill('SIGTERM');
  process.exit(code);
}

server.on('exit', (code) => {
  if (code !== null && code !== 0) {
    shutdown(code);
  }
});

client.on('exit', (code) => {
  if (code !== null && code !== 0) {
    shutdown(code);
  }
});

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
