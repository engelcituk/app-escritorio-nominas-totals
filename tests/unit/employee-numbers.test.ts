import { describe, expect, it } from 'vitest';
import { parseEmployeeNumbers } from '../../src/shared/utils/employeeNumbers.js';

describe('captura de empleados retenidos', () => {
  it('acepta saltos de línea, comas y punto y coma sin duplicados', () => {
    expect(parseEmployeeNumbers('22215\n24772, 31344;31348\r\n22215')).toEqual(['22215', '24772', '31344', '31348']);
  });
});
