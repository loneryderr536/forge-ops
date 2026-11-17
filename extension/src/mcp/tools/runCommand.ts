import { spawn, ChildProcess } from 'node:child_process';
import type { CommandResult } from '../../types';

export function runCommand(
  cmd: string,
  cwd: string,
  timeoutS = 120,
  signal?: AbortSignal
): Promise<CommandResult> {
  return new Promise((resolve) => {
    let timedOut = false;
    let outputBuffer = '';
    const maxOutputBytes = 4096;

    const appendOutput = (data: Buffer | string) => {
      outputBuffer += data.toString('utf-8');
      if (outputBuffer.length > maxOutputBytes * 2) {
        outputBuffer = outputBuffer.slice(-maxOutputBytes);
      }
    };

    let child: ChildProcess | null = null;
    try {
      child = spawn(cmd, {
        shell: true,
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err: any) {
      return resolve({
        exitCode: 1,
        output: err.message || 'spawn error',
        timedOut: false,
      });
    }

    child.stdout?.on('data', appendOutput);
    child.stderr?.on('data', appendOutput);

    let timeoutTimer: NodeJS.Timeout | null = null;
    if (timeoutS > 0) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        killChild();
      }, timeoutS * 1000);
    }

    const onAbort = () => {
      killChild();
    };

    if (signal) {
      if (signal.aborted) {
        killChild();
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    function killChild() {
      if (child && !child.killed) {
        try {
          child.kill('SIGTERM');
          setTimeout(() => {
            if (child && !child.killed) {
              child.kill('SIGKILL');
            }
          }, 500);
        } catch {
          // Ignore
        }
      }
    }

    child.on('close', (code) => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (signal) signal.removeEventListener('abort', onAbort);

      // Tail to max 4096 bytes
      const finalOutput = outputBuffer.length > maxOutputBytes
        ? outputBuffer.slice(-maxOutputBytes)
        : outputBuffer;

      resolve({
        exitCode: timedOut || signal?.aborted ? null : code,
        output: finalOutput,
        timedOut,
      });
    });

    child.on('error', (err) => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve({
        exitCode: 1,
        output: err.message,
        timedOut: false,
      });
    });
  });
}

export async function runCommandTool(
  args: { cmd: string; timeout_s?: number },
  cwd: string,
  signal?: AbortSignal
): Promise<string> {
  const timeout = args.timeout_s ?? 120;
  const res = await runCommand(args.cmd, cwd, timeout, signal || new AbortController().signal);
  return `exit ${res.exitCode ?? (res.timedOut ? 'timeout' : 'aborted')}\n${res.output}`;
}
