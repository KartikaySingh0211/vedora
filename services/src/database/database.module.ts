import { neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import { drizzle, NeonDatabase } from 'drizzle-orm/neon-serverless';
import * as schema from './schema';
import { Global, Module } from '@nestjs/common';
import { Pool } from '@neondatabase/serverless';

export const DRIZZLE_DB = 'DRIZZLE_DB';
export type DrizzleDb = NeonDatabase<typeof schema>;

neonConfig.webSocketConstructor = ws;

@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE_DB,
      useFactory: () => {
        const connectionString = process.env.DATABASE_URL;
        if (!connectionString) {
          throw new Error('DATABASE_URL environment variable is not set');
        }
        const pool = new Pool({ connectionString });
        return drizzle(pool, { schema });
      },
    },
  ],
  exports: [DRIZZLE_DB],
})
export class DatabaseModule {}
