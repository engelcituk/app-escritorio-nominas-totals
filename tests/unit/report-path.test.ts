import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getPeriodReportDirectory } from '../../src/main/services/ReportPathService.js';

describe('organización de carpetas de reportes', () => {
  it('crea una ruta por año y quincena con dos dígitos', () => {
    expect(getPeriodReportDirectory('C:\\Reportes\\SEFIPLAN_Nomina', 2026, 11))
      .toBe(join('C:\\Reportes\\SEFIPLAN_Nomina', '2026', 'Q11'));
    expect(getPeriodReportDirectory('C:\\Reportes\\SEFIPLAN_Nomina', 2026, 1))
      .toBe(join('C:\\Reportes\\SEFIPLAN_Nomina', '2026', 'Q01'));
  });

  it('rechaza periodos fuera del calendario quincenal', () => {
    expect(() => getPeriodReportDirectory('C:\\Reportes', 2026, 25)).toThrow('La quincena del reporte no es válida.');
  });
});
