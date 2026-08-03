import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { resolve } from 'node:path';

const requested = Number.parseInt(process.argv[2] ?? '500000', 10);
if (!Number.isInteger(requested) || requested < 1) throw new Error('Indica una cantidad positiva de líneas.');
const destination = resolve(process.argv[3] ?? 'benchmark-500k.txt');
const output = createWriteStream(destination, { encoding: 'utf8' });
for (let index = 1; index <= requested; index += 1) {
  const amount = `${100 + (index % 900)}.${String(index % 100).padStart(2, '0')}`;
  const line = `21111|06|1|06|${index}|M007C0200000|99999|04001|1508-26-001|26|4|EMPLEADO SINTETICO ${index}|PUESTO|800|D|2|101|I S R POR SALARIOS|${amount}|2.1.1.7.26.1.5.8.6.1.1.1|CO|1\n`;
  if (!output.write(line)) await once(output, 'drain');
}
output.end();
await once(output, 'finish');
console.log(`Archivo sintético generado: ${destination} (${requested.toLocaleString('es-MX')} líneas)`);
