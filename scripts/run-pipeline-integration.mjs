import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import electronPath from 'electron';

// Chromium releases its profile databases only after Electron exits on Windows.
const root = await mkdtemp(join(tmpdir(), 'sefiplan-monthly-integration-'));
try {
  const child = spawn(electronPath, ['scripts/integration-pipeline.mjs'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, SEFIPLAN_PIPELINE_TEST_ROOT: root } });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); process.stdout.write(chunk); });
  child.stderr.on('data', chunk => process.stderr.write(chunk));
  const timeout = setTimeout(() => child.kill(), 90000);
  try {
    const code = await new Promise((done, reject) => { child.once('error', reject); child.once('close', done); });
    if (code !== 0 || !output.includes('"reportAvailabilityConfirmed":4')) process.exitCode = 1;
  } finally { clearTimeout(timeout); }
} finally {
  await cleanup(root);
}
async function cleanup(root) {
  if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('sefiplan-monthly-integration-')) throw new Error('Unsafe cleanup');
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
