import { z } from 'zod';

// Verified against docs/contracts/tools-sefiplan.openapi.json. No `data` envelope.
const timestamp = z.string().datetime({ offset: true }).nullable();
export const deviceResponseSchema = z.object({
  uuid: z.string().uuid(), name: z.string().min(1).max(255), installationUuid: z.string().uuid(),
  appVersion: z.string().max(50), platform: z.string().max(50),
  lastSeenAt: timestamp, revokedAt: timestamp, createdAt: timestamp,
});
export const loginResponseSchema = z.object({
  token: z.string().min(1).max(16_384), tokenType: z.literal('Bearer'),
  abilities: z.array(z.string().max(120)).max(100), device: deviceResponseSchema,
});
export const heartbeatResponseSchema = z.object({ receivedAt: timestamp });
export const logoutResponseSchema = z.object({ message: z.string().max(1000) });
