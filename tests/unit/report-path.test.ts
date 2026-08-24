import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getMonthlyReportDirectory } from '../../src/main/services/ReportPathService.js';
import { getSourceReportFilename } from '../../src/main/services/ExcelReportBuilder.js';

describe('organización de carpetas de reportes', () => {
  it('reúne TXT completos y totales en la carpeta mensual del grupo', () => {
    expect(getMonthlyReportDirectory('C:\\Reportes\\SEFIPLAN_Nomina', 2026, 6, 'ISR'))
      .toBe(join('C:\\Reportes\\SEFIPLAN_Nomina', '2026', 'M06', 'ISR'));
    expect(getMonthlyReportDirectory('C:\\Reportes\\SEFIPLAN_Nomina', 2026, 1, 'OTRO_GRUPO'))
      .toBe(join('C:\\Reportes\\SEFIPLAN_Nomina', '2026', 'M01', 'OTRO_GRUPO'));
  });

  it('rechaza periodos y códigos de carpeta inválidos', () => {
    expect(() => getMonthlyReportDirectory('C:\\Reportes', 2026, 13, 'ISR')).toThrow('El mes del reporte no es válido.');
    expect(() => getMonthlyReportDirectory('C:\\Reportes', 2026, 6, '..')).toThrow('El grupo de conceptos del reporte no es válido.');
  });
});

describe('nombre del TXT completo', () => {
  it('identifica el layout y no expone el id interno del lote', () => {
    expect(getSourceReportFilename({ fortnight: 12, year: 2026, payroll_type_code: 'SUELDOS', version: 1, layout_version: 1 }))
      .toBe('TXT_Completo_QNA_12_2026_SUELDOS_V1_L1.xlsx');
  });
});
