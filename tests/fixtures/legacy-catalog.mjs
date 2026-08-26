// Frozen legacy fixture normalization; production must never seed these rows.
const canonicalConceptName = value => value.trim().toUpperCase().replace(/\s+/g, ' ').replace(/\bI\s+S\s+R\b/g, 'ISR');
const canonicalizeConceptDescription = value => canonicalConceptName(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '');

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
export const INITIAL_PAYROLL_TYPES = [
  ['SUELDOS', 'Nómina ordinaria'],
  ['COMPENSACION', 'Compensación'],
  ['PAGOS_DIVERSOS', 'Pagos diversos'],
  ['REEXPEDICION_NOMINA', 'Reexpedición de nómina'],
  ['FONDO_AHORRO', 'Fondo de ahorro'],
  ['ESTIMULO_DIA_MADRES', 'Estímulo Día de las Madres'],
  ['PRIMA_VACACIONAL_1', 'Prima vacacional 1er. periodo'],
  ['NOMINA_ESTIMULOS_ANOS_SERVICIO', 'Nómina estímulos x años de servicios'],
  ['ESTIMULO_DIA_EMPLEADO_ESTATAL', 'Estímulo Día del Empleado Estatal'],
  ['ESTIMULO_DIA_PADRE', 'Estímulo por el Día del Padre'],
  ['PAGOS_DIVERSOS_COMPLEMENTARIA', 'Pagos diversos complementaria'],
  ['VALES_ESCOLARES', 'Vales escolares'],
  ['VALES_UTILES_ESCOLARES_MOCHILA', 'Vales útiles escolares p/mochila'],
  ['CANASTA_NAVIDENA', 'Canasta navideña'],
  ['APOYO_DESPENSA_FIN_ANO', 'Apoyo de despensa para fin de año'],
  ['VALES_PAVO_NAVIDENO', 'Vales pavo navideño'],
  ['MOCHILAS_ESCOLARES', 'Mochilas escolares'],
  ['AGUINALDO_1', 'Aguinaldo 1era parte'],
  ['AGUINALDO_2', 'Aguinaldo 2da parte'],
  ['AGUINALDO_COMPENSACION', 'Aguinaldo compensación'],
  ['PRIMA_VACACIONAL_2', 'Prima vacacional 2do. periodo'],
  ['AGUINALDO_ASIMILADOS_SALARIOS', 'Aguinaldo asimilados a salarios'],
  ['BONO_NAVIDENO', 'Bono navideño'],
  ['ESTIMULO_DIA_POLICIA', 'Estímulo Día del Policía'],
  ['LAUDOS', 'Laudos'],
  ['ESTIMULOS_EXTRAORDINARIOS', 'Estímulos extraordinarios'],
  ['NOMINA_EXTRAORDINARIA_SUELDOS', 'Nómina extraordinaria sueldos'],
  ['NOMINA_EXTRAORDINARIA_COMPENSACIONES', 'Nómina extraordinaria compensaciones'],
  ['REEXPEDICION_NOMINA_COMPLEMENTARIA', 'Reexpedición de nómina complementaria'],
  ['ESTIMULOS_EXTRAORDINARIOS_COMPLEMENTARIA', 'Estímulos extraordinarios complementaria'],
];


export function seedLegacyCatalog(database) {
  const now = new Date().toISOString();
  database.transaction(() => {
    const group = Number(database.prepare("INSERT INTO concept_groups(code,name,active,created_at,updated_at) VALUES('ISR','Impuesto sobre la Renta',1,?,?)").run(now,now).lastInsertRowid);
    const concept = database.prepare('INSERT INTO payroll_concepts(code,name,group_id,operation_factor,active,created_at,updated_at) VALUES(?,?,?,?,1,?,?)');
    const alias = database.prepare('INSERT INTO concept_aliases(concept_id,source_description,normalized_description,active,created_at,updated_at) VALUES(?,?,?,1,?,?)');
    for (const source of SEEDED_CONCEPTS) {
      const normalized = canonicalizeConceptDescription(source);
      const code = normalized.replace(/[^A-Z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,72);
      const id = Number(concept.run(code,canonicalConceptName(source),ISR_NAMES.has(normalized)?group:null,normalized==='REINTEGRO DE ISR PAGADO EN EXCESO'?-1:1,now,now).lastInsertRowid);
      alias.run(id,source,normalized,now,now);
    }
    const type = database.prepare('INSERT INTO payroll_types(code,name,sort_order,active,created_at,updated_at) VALUES(?,?,?,1,?,?)');
    INITIAL_PAYROLL_TYPES.forEach(([code,name],index)=>type.run(code,name,index+1,now,now));
  })();
}
