export interface AppConfig {
  port: number;
  databaseUrl: string;
  redis: {
    host: string;
    port: number;
    password?: string;
  };
  apiKeyDigestSecret: string;
  clerk: {
    secretKey?: string;
    publishableKey?: string;
  };
  storage: {
    cdnUrl?: string;
  };
  r2: {
    accountId?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    bucketName?: string;
    publicUrl?: string;
  };
  billing: {
    stripeSecretKey?: string;
    stripeWebhookSecret?: string;
  };
  transcoder: {
    webhookSecret?: string;
  };
  corsOrigins: string[];
}

export default (): AppConfig => ({
  port: parseInt(process.env.PORT || '8080', 10),
  databaseUrl: process.env.DATABASE_URL || '',
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || 'vedorasecret',
  },
  apiKeyDigestSecret:
    process.env.API_KEY_DIGEST_SECRET ||
    'vedora_development_digest_secret_key_change_in_production',
  clerk: {
    secretKey: process.env.CLERK_SECRET_KEY,
    publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  },
  storage: {
    cdnUrl: process.env.STORAGE_CDN_URL || process.env.R2_PUBLIC_URL,
  },
  r2: {
    accountId: process.env.R2_ACCOUNT_ID,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucketName: process.env.R2_BUCKET_NAME,
    publicUrl: process.env.R2_PUBLIC_URL || process.env.STORAGE_CDN_URL,
  },
  billing: {
    stripeSecretKey: process.env.STRIPE_SECRET_KEY,
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  },
  transcoder: {
    webhookSecret: process.env.TRANSCODER_WEBHOOK_SECRET,
  },
  corsOrigins: [
    'http://localhost:3000',
    'http://localhost:3001',
    process.env.FRONTEND_URL,
    process.env.DASHBOARD_URL,
  ].filter(Boolean) as string[],
});
