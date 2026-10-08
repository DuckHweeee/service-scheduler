// Environment configuration, validated with zod.
import { z } from 'zod';

const ConfigSchema = z.object({
  DATABASE_URL: z.string().min(1).default('postgres://postgres:postgres@localhost:54329/scheduler'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  CLOCK_OVERRIDE: z
    .string()
    .optional()
    .transform((v) => (v === '' ? undefined : v))
    .refine((v) => v === undefined || !Number.isNaN(new Date(v).getTime()), 'CLOCK_OVERRIDE must be an ISO instant'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Config = z.infer<typeof ConfigSchema>;

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => ConfigSchema.parse(env);
