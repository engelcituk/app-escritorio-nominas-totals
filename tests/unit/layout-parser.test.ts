import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UNIFORM_PAYROLL_COLUMNS, UNIFORM_PAYROLL_LAYOUT, mapUniformColumns } from '../../src/shared/payroll-layouts/uniformPayrollLayout.js';
import { TxtStreamParser } from '../../src/main/services/TxtStreamParser.js';

describe('layout uniforme', () => {
  it('documenta las 22 columnas operativas del TXT en su orden original', () => {
    expect(UNIFORM_PAYROLL_COLUMNS).toHaveLength(UNIFORM_PAYROLL_LAYOUT.expectedColumns);
    expect(UNIFORM_PAYROLL_COLUMNS[4]?.header).toBe('Dato de nómina 1');
    expect(UNIFORM_PAYROLL_COLUMNS[8]?.header).toBe('Fuente');
    expect(UNIFORM_PAYROLL_COLUMNS[9]?.header).toBe('Número de empleado');
    expect(UNIFORM_PAYROLL_COLUMNS[11]?.header).toBe('Nombre del empleado');
    expect(UNIFORM_PAYROLL_COLUMNS[20]?.header).toBe('Fuente de financiamiento');
    expect(UNIFORM_PAYROLL_COLUMNS[21]?.header).toBe('Centro de pago');
  });

  it('centraliza las 22 posiciones y mapea la muestra', () => {
    const columns = '21111|06|1|06|3457|M007C0200000|99999|04001|1508-26-001|22215|4|NOMBRE|PUESTO|800|D|2|101|I S R POR SALARIOS|790.20|CUENTA|CO|1'.split('|');
    const mapped = mapUniformColumns(columns);
    expect(UNIFORM_PAYROLL_LAYOUT.expectedColumns).toBe(22);
    expect(mapped).toMatchObject({ dependencyKey: '21111061-06', sourceKey: '1508-26-001', employeeNumber: '22215', employeeName: 'NOMBRE',
      movementType: 'D', conceptCode: '101', amountRaw: '790.20', fundingSource: 'CO', paymentCenter: '1' });
  });

  it('ignora líneas vacías y audita columnas faltantes', async () => {
    const parser = new TxtStreamParser();
    const rows = [];
    for await (const row of parser.parse(resolve('tests/fixtures/uniform-mixed.txt'))) rows.push(row);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.record?.conceptCode).toBe('101');
    expect(rows[1]?.record).toBeNull();
    expect(rows[1]?.error).toContain('22 columnas');
  });
});
