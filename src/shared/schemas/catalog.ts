import { z } from 'zod';
export const catalogQuerySchema = z.strictObject({
  entity: z.enum(['concepts', 'groups', 'types']), page: z.number().int().min(1).max(100_000).default(1),
  pageSize: z.number().int().min(10).max(100).default(25), search: z.string().trim().max(120).default(''),
  filter: z.enum(['all', 'active', 'inactive', 'legacy']).default('all'),
});
export const catalogDetailSchema = z.strictObject({ id: z.number().int().positive(), page: z.number().int().min(1).max(100_000).default(1) });
export const catalogConflictQuerySchema = z.strictObject({ page: z.number().int().min(1).max(100_000).default(1) });
