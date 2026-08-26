import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import electronPath from 'electron';

// Parent owns cleanup: Chromium holds userData files until Electron exits on Windows.
const root = await mkdtemp(join(tmpdir(), 'sefiplan-auth-integration-'));
try {
  let input = process.env.SEFIPLAN_TEST_INPUT_JSON ?? '';
  delete process.env.SEFIPLAN_TEST_INPUT_JSON;
  if (!input) for await (const chunk of process.stdin) { input += chunk.toString(); if (input.length > 4096) throw new Error('Invalid input'); }
  const child = spawn(electronPath, ['scripts/integration-auth.mjs'], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, SEFIPLAN_AUTH_TEST_ROOT: root, SEFIPLAN_TEST_INPUT_JSON: input },
  });
  input = '';
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); process.stdout.write(chunk); });
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  const timeout = setTimeout(() => child.kill(), 90_000);
  try {
    const code = await new Promise((resolveExit, reject) => { child.once('error', reject); child.once('close', resolveExit); });
    if (code !== 0 || !output.includes('"remoteLogout":"confirmed-401"')) process.exitCode = 1;
  } finally { clearTimeout(timeout); }
} finally {
  await cleanup(root);
}

async function cleanup(root) {
  if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('sefiplan-auth-integration-')) throw new Error('Unsafe cleanup');
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
