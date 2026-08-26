import { z } from 'zod';

const uuid = z.string().uuid();
const count = z.number().int().nonnegative().safe();
const cents = z.number().int().safe();
const date = z.string().datetime({ offset: true });
export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const filenameSchema = z.string().min(1).max(255).refine(value => !/[\\/]/.test(value) && ![...value].some(char => char.charCodeAt(0) < 32));
const period = { year: z.number().int().min(2000).max(2100), month: z.number().int().min(1).max(12) };
const counters = { totalLines: count, validLines: count, excludedLines: count, invalidLines: count, totalAmountCents: cents };
const balanced = (value: z.infer<typeof reconciliationBase>) => value.totalLines === value.validLines + value.excludedLines + value.invalidLines;
const reconciliationBase = z.strictObject({ ...period, ...counters, conceptGroupUuid: uuid, status: z.literal('COMPLETED'),
  fileCount: count, completedFiles: count, startedAt: date, completedAt: date });
export const reconciliationPayloadSchema = reconciliationBase.refine(balanced).refine(value => value.completedFiles <= value.fileCount && Date.parse(value.completedAt) >= Date.parse(value.startedAt));
export const batchPayloadSchema = z.strictObject({ ...period, ...counters, payrollTypeUuid: uuid, sourceOrder: count.min(1),
  fortnight: z.union([z.literal(1), z.literal(2)]), layoutCode: z.string().min(1).max(72), layoutVersion: z.string().min(1).max(30),
  originalFilename: filenameSchema, fileSize: count, fileHashSha256: sha256Schema, catalogRevision: count.min(1), status: z.literal('COMPLETED'),
  startedAt: date, completedAt: date, unclassifiedLines: count, matchingLines: count,
  conceptSnapshots: z.array(z.strictObject({ conceptUuid: uuid, code: z.string().min(1).max(72), name: z.string().min(1).max(160), operationFactor: z.union([z.literal(-1), z.literal(1)]) })).min(1),
  aliasSnapshots: z.array(z.strictObject({ aliasUuid: uuid, payrollConceptUuid: uuid, sourceDescription: z.string().min(1).max(255), normalizedDescription: z.string().min(1).max(255) })),
  totals: z.array(z.strictObject({ conceptUuid: uuid, lineCount: count, amountCents: cents })).min(1),
}).superRefine((value, ctx) => {
  const concepts = new Set(value.conceptSnapshots.map(item => item.conceptUuid));
  if (value.totalLines !== value.validLines + value.excludedLines + value.invalidLines
    || value.matchingLines + value.unclassifiedLines > value.validLines
    || Date.parse(value.completedAt) < Date.parse(value.startedAt)
    || concepts.size !== value.conceptSnapshots.length
    || new Set(value.aliasSnapshots.map(item => item.aliasUuid)).size !== value.aliasSnapshots.length
    || new Set(value.totals.map(item => item.conceptUuid)).size !== value.totals.length
    || value.aliasSnapshots.some(item => !concepts.has(item.payrollConceptUuid))
    || value.totals.some(item => !concepts.has(item.conceptUuid))
    || value.totals.reduce((sum, item) => sum + item.amountCents, 0) !== value.totalAmountCents) {
    ctx.addIssue({ code: 'custom', message: 'Inconsistent batch snapshot.' });
  }
});
const reportFields = { originalFilename: filenameSchema.refine(value => /\.xlsx$/i.test(value)),
  sizeBytes: count.min(1).max(100 * 1024 * 1024), sha256: sha256Schema, generatedAt: date };
export const reportPayloadSchema = z.union([
  z.strictObject({ ...reportFields, reportType: z.literal('SOURCE'), payrollBatchUuid: uuid }),
  z.strictObject({ ...reportFields, reportType: z.literal('MONTHLY_TOTALS'), monthlyReconciliationUuid: uuid }),
]);
// Responses are projected, not forwarded to the renderer. Laravel may add fields.
export const resourceResponseSchema = z.object({ uuid });
export const reportResponseSchema = z.object({ uuid, reportType: z.enum(['SOURCE', 'MONTHLY_TOTALS']),
  payrollBatchUuid: uuid.nullable(), monthlyReconciliationUuid: uuid.nullable(), operationUuid: uuid,
  originalFilename: filenameSchema, sizeBytes: count, sha256: sha256Schema,
  uploadStatus: z.enum(['PENDING', 'UPLOADING', 'AVAILABLE', 'FAILED']), generatedAt: date.nullable(), uploadedAt: date.nullable() });
export const remoteHistorySchema = z.object({ uuid, ...period, ...counters, status: z.string().max(30), revision: count,
  batches: z.array(z.object({ uuid, payrollTypeUuid: uuid, fortnight: count, version: count, status: z.string().max(30), active: z.boolean(),
    originalFilename: filenameSchema, totalAmountCents: cents })).max(10000) });
export type RemoteHistory = z.infer<typeof remoteHistorySchema> & { checkedAt: string };
