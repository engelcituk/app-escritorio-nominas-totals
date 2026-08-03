import { z } from 'zod';
import { PayrollType } from '../enums/payroll.js';

export const fileTokenSchema = z.object({ fileToken: z.string().uuid() });

export const processPayrollRequestSchema = z.object({
  fileToken: z.string().uuid(),
  year: z.number().int().min(2000).max(2200),
  fortnight: z.number().int().min(1).max(24),
  payrollType: z.nativeEnum(PayrollType),
  conceptFamily: z.literal('ISR'),
  exportDirectoryToken: z.string().uuid().optional(),
  exclusions: z.object({
    retained: z.boolean(),
    cancelled: z.boolean(),
    other: z.boolean(),
    includeAudit: z.boolean(),
  }),
  duplicateAction: z.enum(['CANCEL', 'REPLACE', 'NEW_VERSION']).optional(),
});

export const historyQuerySchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(10).max(100).default(25),
  year: z.number().int().optional(),
  fortnight: z.number().int().min(1).max(24).optional(),
  payrollType: z.nativeEnum(PayrollType).optional(),
  status: z.string().max(40).optional(),
  search: z.string().max(120).optional(),
});

export type HistoryQuery = z.infer<typeof historyQuerySchema>;
