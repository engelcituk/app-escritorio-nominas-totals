import Database from 'better-sqlite3';
import { canonicalConceptName, canonicalizeConceptDescription } from '../../shared/utils/normalization.js';
import { MigrationService } from './MigrationService.js';

const SEEDED_CONCEPTS = `
I S R  POR SALARIOS
ISSSTE 3 375%
ISSSTE 1 125%
SEG RET  6 125%
AHOR SOL EMP  2%
FONDO DE AHORRO EMP 5%
FONDO DE AHORRO GOB 5%
PREST C PLAZO
DXN EXPRESS S.A. DE C.V. SOFOM
PUBLISEG,  S.A.P.I. DE C.V. SO
FOFYA
SUELDO CONFIANZA
APOYO VIVIENDA
AYUDA DE TRANS
ESTIMULO POR DESEMPEÑO
QUINQUENIO
FOVISSSTE 5%
SAR 5 175%
ISSSTE 1 875%
ISSSTE 8 095%
AHOR SOL GOB 2%
PREST HIPOTECARIO
SEGUROS FOVISSSTE
VIDA CARA
METLIFE MEXICO, S A
CONSUBANCO S.A
COMP  X SERV  ESP  CONF
CUOTA SINDICAL
SUELDO BASE
COMP  X SER ESP
COMPENSACION
RIESGO POR DESEMPEÑO
VATORO S..A.P.I. DE C..V.
PENSION ALIMENTICIA
ONOMASTICO BASE
APOYO EDUCATIVO
FAPREI SAPI DE CV SOFOM ENR
ONOMASTICO CONF
FALTAS CONF
AHOR SOL EMP  1%
AHOR SOL GOB 1%
PREST  HIPOTECARIO CUOTA
SEGURO VIDA GRUPO NACIONAL PRO
PRESTAMO FOFYA
SEGUROS INBURSA S.A.
TRIBUS CAPITAL
FALTAS BASE
APOYO DE LENTES
COOPERATIVA ACREIMEX, S.C DE C.V
CREDI VIVE PENINSULAR
CREDIFOM SAPI DE C.V. SOFOM ENR
PRIMA DOMINICAL
PREST HIPOTECARIO PARA TODOS
ADEUDO MERCANTIL ACTIVO
DESCUENTO POR PAGOS EN EXCESO
PRESTAMO FODIVIPP
RESPONSABILIDAD DE MANDO
APOYO DE GASTOS FUNERARIOS
ESTIMULO ESPECIAL
SUELDO MINIMO VITAL
FONACOT
FISOFO S.A. DE C.V. SOFOM ENR
REINT QUINQUENIO
APOYO A TU ECONOMIA S.A.
ESTIMULO POR PUNTUALIDAD Y ASISTENCIA
I S R EVENTUALES
SUELDO EVENTUAL
ISR RETRO
RETRO ISSSTE 3 375%
RETRO ISSSTE 1 125%
RETRO SEG RET  6 125%
RETRO FONDO DE AHORRO GOB 5%
RETRO FONDO DE AHORRO EMP 5%
RETRO SUELDO CONFIANZA
RETRO APOYO VIVIENDA
RETRO AYUDA DE TRANS
RETRO FOVISSSTE 5%
RETRO SAR 5 175%
RETRO ISSSTE 1 875%
RETRO ISSSTE 8 095%
DIRECTODO MEXICO S.A.P.I. DE C
FALTAS EVENTUAL
ISR EVENTUALES RETRO
RETRO SUELDO EVENTUAL
COMPENSACION HAC
PRESTAMO FOFYA COMPENSACION
REINT COMP HDA
RETRO COMPENSACION HAC
REINTEGRO DE ISR PAGADO EN EXCESO`.trim().split('\n');

const ISR_NAMES = new Set(['ISR POR SALARIOS', 'ISR EVENTUALES', 'ISR RETRO', 'ISR EVENTUALES RETRO', 'REINTEGRO DE ISR PAGADO EN EXCESO']);
const PAYROLL_TYPES = [
  ['SUELDOS', 'Sueldos'], ['ASIMILADOS', 'Asimilados'], ['COMPENSACIONES', 'Compensaciones'],
  ['HONORARIOS', 'Honorarios'], ['HONORARIOS_FASP', 'Honorarios FASP'], ['EXTRAORDINARIOS', 'Extraordinarios'],
  ['RETROACTIVOS', 'Retroactivos'], ['PRIMA_VACACIONAL', 'Prima vacacional'], ['PAGOS_DIVERSOS', 'Pagos diversos'], ['OTROS', 'Otros'],
] as const;

export class IncompatibleSchemaError extends Error {
  constructor() { super('La base local usa un esquema de desarrollo anterior.'); this.name = 'IncompatibleSchemaError'; }
}

export class DatabaseService {
  readonly connection: Database.Database;

  constructor(path: string) {
    this.connection = new Database(path);
    try {
      this.connection.pragma('journal_mode = WAL');
      this.connection.pragma('foreign_keys = ON');
      this.connection.pragma('busy_timeout = 5000');
      new MigrationService(this.connection).run();
      this.validateSchema();
      this.seed();
    } catch (error) { this.connection.close(); throw error; }
  }

  close(): void { this.connection.close(); }

  private seed(): void {
    this.seedPayrollTypes();
    const count = (this.connection.prepare('SELECT COUNT(*) AS count FROM payroll_concepts').get() as { count: number }).count;
    if (count > 0) { this.synchronizeSeededConceptNames(); return; }
    const now = new Date().toISOString();
    this.connection.transaction(() => {
      const groupId = Number(this.connection.prepare(`INSERT INTO concept_groups(code, name, active, created_at, updated_at)
        VALUES ('ISR', 'Impuesto sobre la Renta', 1, ?, ?)`).run(now, now).lastInsertRowid);
      const insertConcept = this.connection.prepare(`INSERT INTO payroll_concepts(code, name, group_id, operation_factor, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)`);
      const insertAlias = this.connection.prepare(`INSERT INTO concept_aliases(concept_id, source_description, normalized_description, active, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?)`);
      for (const sourceName of SEEDED_CONCEPTS) {
        const name = canonicalConceptName(sourceName);
        const canonical = canonicalizeConceptDescription(sourceName);
        const code = stableCode(canonical);
        const isRefund = canonical === 'REINTEGRO DE ISR PAGADO EN EXCESO';
        const conceptId = Number(insertConcept.run(code, name, ISR_NAMES.has(canonical) ? groupId : null, isRefund ? -1 : 1, now, now).lastInsertRowid);
        insertAlias.run(conceptId, sourceName, canonical, now, now);
      }
    })();
  }

  private seedPayrollTypes(): void {
    const now = new Date().toISOString();
    const insert = this.connection.prepare(`INSERT INTO payroll_types(code,name,active,created_at,updated_at)
      VALUES (?,?,1,?,?) ON CONFLICT(code) DO NOTHING`);
    this.connection.transaction(() => { for (const [code, name] of PAYROLL_TYPES) insert.run(code, name, now, now); })();
  }

  private synchronizeSeededConceptNames(): void {
    const now = new Date().toISOString();
    const update = this.connection.prepare(`UPDATE payroll_concepts SET name=?,updated_at=? WHERE code=? AND name<>?`);
    let changed = 0;
    this.connection.transaction(() => {
      for (const sourceName of SEEDED_CONCEPTS) {
        const name = canonicalConceptName(sourceName); const code = stableCode(canonicalizeConceptDescription(sourceName));
        changed += update.run(name, now, code, name).changes;
      }
      if (changed) this.connection.prepare(`INSERT INTO audit_logs(action,entity_type,description,metadata_json,created_at)
        VALUES ('NORMALIZE_NAMES','PAYROLL_CONCEPT','Se normalizaron nombres canónicos del catálogo sembrado.',?,?)`)
        .run(JSON.stringify({ changed }), now);
    })();
  }

  private validateSchema(): void {
    const required = ['concept_groups', 'payroll_concepts', 'concept_aliases', 'payroll_types', 'monthly_reconciliations',
      'payroll_batches', 'batch_concept_snapshots', 'batch_retained_employees', 'batch_totals', 'report_artifacts'];
    const tables = new Set((this.connection.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string }>).map((row) => row.name));
    if (required.some((name) => !tables.has(name))) throw new IncompatibleSchemaError();
    const requiredColumns: Record<string, string[]> = {
      monthly_reconciliations: ['year', 'month', 'concept_group_id', 'revision', 'total_amount_cents'],
      payroll_batches: ['reconciliation_id', 'month', 'fortnight', 'payroll_type_id', 'file_hash_sha256', 'is_active', 'replaced_batch_id'],
      payroll_concepts: ['code', 'group_id', 'operation_factor', 'active'],
      concept_aliases: ['concept_id', 'normalized_description', 'active'],
      batch_retained_employees: ['batch_id', 'employee_number', 'missing_acknowledged'],
      batch_totals: ['batch_id', 'source_key', 'account_code', 'total_amount_cents'],
    };
    for (const [table, columns] of Object.entries(requiredColumns)) {
      const actual = new Set((this.connection.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name));
      if (columns.some((column) => !actual.has(column))) throw new IncompatibleSchemaError();
    }
  }
}

function stableCode(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 72);
}
