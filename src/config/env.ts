import { z } from 'zod';

export const envSchema = z.object({
  PORT: z.string().default('3000').transform(Number),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  BLUEBUBBLES_URL: z.string().url(),
  BLUEBUBBLES_PASSWORD: z.string().min(1),
  CRM_WEBHOOK_URL: z.string().url().optional(),
  ALERT_WEBHOOK_URL: z.string().url().optional(),
  API_KEY: z.string().min(16).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  ENABLE_PRETTY_LOGS: z
    .string()
    .default('false')
    .transform((val) => val === 'true'),
  DEFAULT_COUNTRY_CODE: z.string().default('US'),
  RATE_LIMIT_CAPACITY: z.string().default('100').transform(Number),
  RATE_LIMIT_REFILL_PER_HOUR: z.string().default('4').transform(Number),
  RETRY_QUEUE_MAX_SIZE: z.string().default('1000').transform(Number),
  HEALTH_POLL_INTERVAL_MS: z.string().default('60000').transform(Number),
  ALERT_AFTER_FAILURES: z.string().default('2').transform(Number),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = z.infer<typeof envSchema>;
