import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { catalogPathSegment, getMonthlyReportDirectory } from '../../src/main/services/ReportPathService.js';
import { getSourceReportFilename } from '../../src/main/services/ExcelReportBuilder.js';

describe('organización de carpetas de reportes', () => {
  it('reúne TXT completos y totales en la carpeta mensual del grupo', () => {
    expect(getMonthlyReportDirectory('C:\\Reportes\\SEFIPLAN_Nomina', 2026, 6, 'ISR'))
      .toBe(join('C:\\Reportes\\SEFIPLAN_Nomina', '2026', 'M06', 'ISR'));
    expect(getMonthlyReportDirectory('C:\\Reportes\\SEFIPLAN_Nomina', 2026, 1, 'OTRO_GRUPO'))
      .toBe(join('C:\\Reportes\\SEFIPLAN_Nomina', '2026', 'M01', 'OTRO_GRUPO'));
  });

  it('rechaza periodos inválidos y transforma códigos remotos sin permitir rutas arbitrarias', () => {
    expect(() => getMonthlyReportDirectory('C:\\Reportes', 2026, 13, 'ISR')).toThrow('El mes del reporte no es válido.');
    for (const code of ['..', '../outside', 'CON', 'grupo/otro', 'isr', 'C:\\datos']) {
      expect(catalogPathSegment(code)).toMatch(/^central~[a-f0-9]{64}$/);
      expect(getMonthlyReportDirectory('reports', 2026, 6, code)).toBe(join('reports', '2026', 'M06', catalogPathSegment(code)));
      expect(getSourceReportFilename({ fortnight: 12, year: 2026, payroll_type_code: code, version: 1, layout_version: 1 }))
        .toBe(`TXT_Completo_QNA_12_2026_${catalogPathSegment(code)}_V1_L1.xlsx`);
    }
  });
});

describe('nombre del TXT completo', () => {
  it('identifica el layout y no expone el id interno del lote', () => {
    expect(getSourceReportFilename({ fortnight: 12, year: 2026, payroll_type_code: 'SUELDOS', version: 1, layout_version: 1 }))
      .toBe('TXT_Completo_QNA_12_2026_SUELDOS_V1_L1.xlsx');
  });
});
