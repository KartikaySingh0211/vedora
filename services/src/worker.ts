import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WorkerModule } from './worker.module';

async function bootstrapWorker(): Promise<void> {
  process.env.APP_ROLE = 'worker';
  const logger = new Logger('VedoraWorker');

  logger.log(
    'Starting Vedora Transcoding Worker (Headless Application Context)...',
  );
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['log', 'error', 'warn', 'debug', 'verbose'],
  });

  app.enableShutdownHooks();

  logger.log(
    'Vedora Transcoding Worker started successfully. Consuming Redis queue with concurrency=1.',
  );
}

void bootstrapWorker();
