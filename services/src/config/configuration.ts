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
    apiKey: string;
    bucketId: string;
    baseUrl: string;
  };
  corsOrigins: string[];
}

export default (): AppConfig => ({
  port: parseInt(process.env.PORT || '8080', 10),
  databaseUrl: process.env.DATABASE_URL || '',
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },
  apiKeyDigestSecret:
    process.env.API_KEY_DIGEST_SECRET ||
    'vedora_development_digest_secret_key_change_in_production',
  clerk: {
    secretKey: process.env.CLERK_SECRET_KEY,
    publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  },
  storage: {
    apiKey: process.env.ONEMINUTECLOUD_API_KEY || 'omc_live_placeholder_key',
    bucketId:
      process.env.ONEMINUTECLOUD_BUCKET_ID ||
      '00000000-0000-0000-0000-000000000001',
    baseUrl:
      process.env.ONEMINUTECLOUD_BASE_URL ||
      'https://api.oneminutecloud.com/api/v1',
  },
  corsOrigins: [
    'http://localhost:3000',
    'http://localhost:3001',
    process.env.FRONTEND_URL,
    process.env.DASHBOARD_URL,
  ].filter(Boolean) as string[],
});
