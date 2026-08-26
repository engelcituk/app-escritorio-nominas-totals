import { z } from 'zod';

export const loginInputSchema = z.strictObject({
  email: z.string().trim().email().max(255),
  password: z.string().min(1).max(255),
  deviceName: z.string().trim().min(1).max(120),
});
