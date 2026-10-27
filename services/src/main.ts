import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AllExceptionsFilter } from './utils/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // Global exception filter for secure error masking and logging
  app.useGlobalFilters(new AllExceptionsFilter());

  // Global ValidationPipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Global API route prefix
  app.setGlobalPrefix('api');

  // URI-based API versioning -> /api/v1/...
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // CORS configuration
  const corsOrigins = configService.get<string[]>('corsOrigins') || [
    'http://localhost:3000',
    'http://localhost:3001',
  ];

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
      if (!origin) {
        callback(null, true);
        return;
      }
      const isAllowed =
        corsOrigins.includes(origin) ||
        origin.startsWith('http://localhost:') ||
        origin.endsWith('.vercel.app');

      if (isAllowed) {
        callback(null, true);
      } else {
        callback(new Error(`CORS blocked for origin: ${origin}`), false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
    exposedHeaders: ['ETag'],
  });

  // Swagger Documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Vedora API')
    .setDescription(
      'Vedora Video Infrastructure Platform API — End-to-end video ingestion, direct-to-cloud upload authorization, multipart S3-compatible chunking, BullMQ distributed HLS transcoding, pseudonymous telemetry & segment-level analytics, customizable video player styling, and Stripe billing.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Clerk Bearer Auth',
        description:
          'Clerk user session JWT token for dashboard and browser requests',
      },
      'bearer',
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: 'x-api-key',
        in: 'header',
        description: 'Server-to-server or SDK API key (e.g. ved_live_...)',
      },
      'x-api-key',
    )
    .addTag('System', 'Platform root status and greetings')
    .addTag('Health', 'PostgreSQL and Redis connectivity health monitoring')
    .addTag(
      'API Keys',
      'Programmatic API key generation, listing, regeneration, and revocation',
    )
    .addTag(
      'Playlists',
      'User video playlist categorization and 10-playlist quota management',
    )
    .addTag(
      'Videos',
      'Direct-to-cloud upload authorization, completion, listing, and lifecycle management',
    )
    .addTag(
      'Storage',
      'S3-compatible multipart chunk upload endpoints and video streaming',
    )
    .addTag(
      'Transcoder',
      'HLS rendition transcoding dispatch and external worker webhooks',
    )
    .addTag(
      'Player Settings',
      'Video player styling, brand accent colors, watermarking, and public embed config',
    )
    .addTag(
      'Analytics',
      'Playback heartbeat ping telemetry and aggregated audience metrics',
    )
    .addTag(
      'Billing',
      'Stripe subscription webhook processing and playback minutes tracking',
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = configService.get<number>('port') || 8080;
  await app.listen(port);
  console.log(`Vedora backend API running on port ${port} (prefix: /api/v1)`);
}

void bootstrap();
