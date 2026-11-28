/** Launches both development servers and waits for shutdown before exiting. */

import { spawn, type ChildProcess } from 'node:child_process';
import { constants } from 'node:os';

const windows = process.platform === 'win32';
const npmCmd = windows ? 'npm.cmd' : 'npm';

function launch(script: string): ChildProcess {
  return spawn(npmCmd, ['run', script], {
    stdio: 'inherit', env: process.env, shell: windows, detached: !windows,
  });
}

function signalTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  if (windows) {
    const args = ['/PID', String(child.pid), '/T'];
    if (signal === 'SIGKILL') args.push('/F');
    const killer = spawn('taskkill', args, { stdio: 'ignore' });
    killer.on('error', () => child.kill(signal));
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch (err: unknown) {
    if (!(err instanceof Error) || !('code' in err) || err.code !== 'ESRCH') throw err;
  }
}

const children = [launch('dev:server'), launch('dev:client')];
let forceTimer: ReturnType<typeof setTimeout> | undefined;
let closed = 0;

function shutdown(code: number): void {
  if (forceTimer !== undefined) return;
  process.exitCode = code;
  children.forEach((child) => signalTree(child, 'SIGTERM'));
  forceTimer = setTimeout(() => {
    children.forEach((child) => signalTree(child, 'SIGKILL'));
  }, 1500);
}

function attachProcessLifecycle(child: ChildProcess): void {
  child.once('error', () => shutdown(1));
  child.once('exit', (code, signal) => {
    shutdown(code ?? (signal === null ? 1 : 128 + constants.signals[signal]));
  });
  child.once('close', () => {
    closed += 1;
    if (closed === children.length && forceTimer !== undefined && windows) {
      clearTimeout(forceTimer);
    }
  });
}

children.forEach(attachProcessLifecycle);
process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));
