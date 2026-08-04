import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inspectPayrollFile } from '../../src/main/services/PreflightService.js';

async function inspect(name: string) {
  const path = resolve(`tests/fixtures/${name}`); const info = await stat(path);
  return inspectPayrollFile(path, { token: '00000000-0000-4000-8000-000000000000', name, size: info.size, modifiedAt: info.mtime.toISOString() });
}
describe('preflight', () => {
  it('habilita una muestra uniforme válida', async () => { const result = await inspect('uniform-valid.txt'); expect(result.canProcess).toBe(true); expect(result.validPercentage).toBe(100); });
  it('bloquea importes inválidos', async () => { const result = await inspect('uniform-invalid-amount.txt'); expect(result.canProcess).toBe(false); expect(result.preview[0]?.errors).toContain('El importe no es válido.'); });
  it('bloquea columnas faltantes', async () => { const result = await inspect('uniform-missing-columns.txt'); expect(result.canProcess).toBe(false); });
  it('acepta percepciones sin cuenta contable durante la revisión estructural', async () => {
    const result = await inspect('uniform-perception-without-account.txt');
    expect(result.canProcess).toBe(true);
    expect(result.validPercentage).toBe(100);
    expect(result.preview[0]?.accountCode).toBe('');
  });
});
