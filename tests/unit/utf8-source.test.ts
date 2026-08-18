import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const TEXT_EXTENSIONS = new Set(['.html', '.json', '.md', '.mjs', '.scss', '.ts', '.txt', '.vue']);
const MOJIBAKE_MARKERS = [0x00c3, 0x00c2, 0x00e2, 0x00f0, 0xfffd, 0x0192].map((point) => String.fromCodePoint(point));

function collectTextFiles(entry: string): string[] {
  const absolute = resolve(entry);
  if (!statSync(absolute).isDirectory()) return [absolute];
  return readdirSync(absolute).flatMap((name) => collectTextFiles(resolve(absolute, name)));
}

describe('integridad UTF-8 de los fuentes', () => {
  it('no contiene marcadores habituales de texto recodificado', () => {
    const files = ['README.md', 'package.json', 'scripts', 'src', 'tests']
      .flatMap(collectTextFiles)
      .filter((file) => TEXT_EXTENSIONS.has(extname(file)));
    const affected = files.filter((file) => {
      const content = readFileSync(file, 'utf8');
      return MOJIBAKE_MARKERS.some((marker) => content.includes(marker));
    });

    expect(affected).toEqual([]);
  });
});
