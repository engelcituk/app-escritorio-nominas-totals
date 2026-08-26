import { z } from 'zod';
export const syncQuerySchema = z.strictObject({
  page: z.number().int().min(1).max(1_000_000), pageSize: z.union([z.literal(25), z.literal(50), z.literal(100)]),
  status: z.enum(['all', 'PENDING', 'IN_PROGRESS', 'RETRY', 'SYNCED', 'FAILED', 'CONFLICT']), search: z.string().trim().max(120),
});
export const syncOperationSchema = z.strictObject({ operationUuid: z.string().uuid() });
