import { describe, expect, it } from 'vitest';
import { serializeExclusions } from '../../src/renderer/utils/serializeExclusions.js';

describe('serialización de exclusiones', () => {
  it('convierte un estado reactivo en datos planos que Electron puede clonar', () => {
    const reactiveState = new Proxy({
      retained: true,
      cancelled: false,
      other: true,
      includeAudit: true,
    }, {});

    expect(() => structuredClone(reactiveState)).toThrow();

    const serialized = serializeExclusions(reactiveState);
    expect(() => structuredClone(serialized)).not.toThrow();
    expect(serialized).toEqual({
      retained: true,
      cancelled: false,
      other: true,
      includeAudit: true,
    });
  });
});
