import { z } from 'zod';
import { PayrollType } from '../enums/payroll.js';

export const fileTokenSchema = z.object({ fileToken: z.string().uuid(), includePreview: z.boolean().default(false) });
const conceptIdsSchema = z.array(z.number().int().positive()).min(1).max(250).transform((items) => [...new Set(items)]);
const employeeNumbersSchema = z.array(z.string().trim().min(1).max(40)).max(500).transform((items) => [...new Set(items)]);
const importFileSchema = z.object({
  fileToken: z.string().uuid(), fortnight: z.number().int().min(1).max(24), payrollType: z.nativeEnum(PayrollType),
  selectedConceptIds: conceptIdsSchema, retainedEmployeeNumbers: employeeNumbersSchema, missingAcknowledged: z.boolean(),
  duplicateDecision: z.literal('REPROCESS').optional(),
});

export const processImportGroupRequestSchema = z.object({
  year: z.number().int().min(2000).max(2200), files: z.array(importFileSchema).min(1).max(100),
  exportDirectoryToken: z.string().uuid().optional(), replacedGroupId: z.number().int().positive().optional(),
}).superRefine((value, context) => {
  const tokens = value.files.map((file) => file.fileToken);
  if (new Set(tokens).size !== tokens.length) context.addIssue({ code: 'custom', message: 'No se puede agregar el mismo archivo dos veces.', path: ['files'] });
});

export const retainedValidationSchema = z.object({ files: z.array(importFileSchema.pick({ fileToken: true, payrollType: true,
  selectedConceptIds: true, retainedEmployeeNumbers: true })).min(1).max(100) });
export const conceptGroupDraftSchema = z.object({ id: z.number().int().positive().optional(), code: z.string().trim().regex(/^[A-Z0-9_]+$/).max(60),
  name: z.string().trim().min(2).max(120), active: z.boolean() });
export const payrollConceptDraftSchema = z.object({ id: z.number().int().positive().optional(), code: z.string().trim().regex(/^[A-Z0-9_]+$/).max(80),
  name: z.string().trim().min(2).max(180), groupId: z.number().int().positive().nullable(), operationFactor: z.union([z.literal(1), z.literal(-1)]),
  active: z.boolean(), sourceDescription: z.string().trim().min(2).max(220).optional() });
export const conceptAliasDraftSchema = z.object({ conceptId: z.number().int().positive(), sourceDescription: z.string().trim().min(2).max(220) });
export const historyQuerySchema = z.object({ page: z.number().int().min(1).default(1), pageSize: z.number().int().min(10).max(100).default(25),
  year: z.number().int().optional(), fortnight: z.number().int().min(1).max(24).optional(), payrollType: z.nativeEnum(PayrollType).optional(),
  status: z.string().max(40).optional(), search: z.string().max(120).optional() });
export type HistoryQuery = z.infer<typeof historyQuerySchema>;
