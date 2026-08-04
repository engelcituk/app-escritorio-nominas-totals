import { describe, expect, it } from 'vitest';
import { errorMessage } from '../../src/renderer/utils/errorMessage.js';

describe('mensajes de operaciones', () => {
  it('elimina el envoltorio técnico de Electron y conserva el detalle útil', () => {
    expect(errorMessage(new Error("Error invoking remote method 'payroll:process': Error: No se pudo abrir la base de datos."), 'Error genérico'))
      .toBe('No se pudo abrir la base de datos.');
  });

  it('usa un mensaje claro cuando la causa no contiene detalle', () => {
    expect(errorMessage(undefined, 'No se pudo iniciar el procesamiento.')).toBe('No se pudo iniciar el procesamiento.');
  });

  it('traduce los errores de clonación de Electron a un mensaje accionable', () => {
    expect(errorMessage(new Error('An object could not be cloned.'), 'No se pudo iniciar el procesamiento.'))
      .toBe('No se pudo preparar la configuración para iniciar el procesamiento. Inténtalo nuevamente.');
  });
});
