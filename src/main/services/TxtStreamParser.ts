import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { UNIFORM_PAYROLL_LAYOUT, mapUniformColumns } from '../../shared/payroll-layouts/uniformPayrollLayout.js';
import type { ParsedPayrollRecord } from '../../shared/types/payroll.js';

export interface StreamedLine {
  record: ParsedPayrollRecord | null;
  lineNumber: number;
  rawLine: string;
  error?: string;
}

export class TxtStreamParser {
  async *parse(filePath: string, isCancelled: () => boolean = () => false): AsyncGenerator<StreamedLine> {
    const stream = createReadStream(filePath, { encoding: 'utf8' });
    const reader = createInterface({ input: stream, crlfDelay: Infinity });
    let lineNumber = 0;
    try {
      for await (const rawLine of reader) {
        lineNumber += 1;
        if (isCancelled()) break;
        if (!rawLine.trim()) continue;
        const columns = rawLine.split(UNIFORM_PAYROLL_LAYOUT.delimiter);
        if (columns.length !== UNIFORM_PAYROLL_LAYOUT.expectedColumns) {
          yield { record: null, lineNumber, rawLine, error: `La línea ${lineNumber} no tiene ${UNIFORM_PAYROLL_LAYOUT.expectedColumns} columnas.` };
          continue;
        }
        yield { record: { lineNumber, ...mapUniformColumns(columns) }, lineNumber, rawLine };
      }
    } finally {
      reader.close();
      stream.destroy();
    }
  }
}
