import { neonConfig, Pool as NeonPool } from '@neondatabase/serverless';
import ws from 'ws';
import { drizzle as neonDrizzle, NeonDatabase } from 'drizzle-orm/neon-serverless';
import { Pool as PgPool } from 'pg';
import { drizzle as pgDrizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
import { Global, Module, Logger } from '@nestjs/common';

export const DRIZZLE_DB = 'DRIZZLE_DB';
export type DrizzleDb = NeonDatabase<typeof schema> | NodePgDatabase<typeof schema>;

neonConfig.webSocketConstructor = ws;

@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE_DB,
      useFactory: () => {
        const logger = new Logger('DatabaseModule');
        const connectionString = process.env.DATABASE_URL;
        if (!connectionString) {
          throw new Error('DATABASE_URL environment variable is not set');
        }

        const isNeon =
          connectionString.includes('neon.tech') ||
          process.env.USE_NEON === 'true';

        if (isNeon) {
          logger.log('Initializing Neon Serverless PostgreSQL connection');
          const pool = new NeonPool({ connectionString });
          return neonDrizzle(pool, { schema });
        } else {
          logger.log(
            'Initializing standard Node PostgreSQL connection (Docker/Local)',
          );
          const pool = new PgPool({ connectionString });
          return pgDrizzle(pool, { schema });
        }
      },
    },
  ],
  exports: [DRIZZLE_DB],
})
export class DatabaseModule {}
