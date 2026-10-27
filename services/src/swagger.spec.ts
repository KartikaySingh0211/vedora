/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import * as fs from 'fs';
import * as path from 'path';

describe('Swagger OpenAPI Documentation Suite', () => {
  let app: INestApplication;
  let document: ReturnType<typeof SwaggerModule.createDocument>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });

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
      .build();

    document = SwaggerModule.createDocument(app, swaggerConfig);

    // Write out the complete OpenAPI document for verification and offline inspection
    const docsDir = path.join(process.cwd(), '..', 'docs');
    if (fs.existsSync(docsDir)) {
      fs.writeFileSync(
        path.join(docsDir, 'openapi.json'),
        JSON.stringify(document, null, 2),
      );
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('should generate valid OpenAPI specification with title and version', () => {
    expect(document.openapi).toMatch(/^3\./);
    expect(document.info.title).toBe('Vedora API');
    expect(document.info.version).toBe('1.0');
    expect(document.paths).toBeDefined();
  });

  it('should document POST /api/v1/videos/init with complete request and response schemas', () => {
    const initPath = document.paths['/api/v1/videos/init'];
    expect(initPath).toBeDefined();
    expect(initPath.post).toBeDefined();

    // Verify Request Body
    const requestBody = initPath.post.requestBody as any;
    expect(requestBody).toBeDefined();
    const requestSchema = requestBody.content['application/json'].schema;
    expect(requestSchema).toBeDefined();

    // Verify 201 Created Response
    const createdResponse = initPath.post.responses['201'] as any;
    expect(createdResponse).toBeDefined();
    expect(createdResponse.content['application/json'].schema).toBeDefined();

    // Verify Error Responses
    expect(initPath.post.responses['400']).toBeDefined();
    expect(initPath.post.responses['401']).toBeDefined();
    expect(initPath.post.responses['403']).toBeDefined();
    expect(initPath.post.responses['413']).toBeDefined();
  });

  it('should document POST /api/v1/videos/complete with complete schemas', () => {
    const completePath = document.paths['/api/v1/videos/complete'];
    expect(completePath).toBeDefined();
    expect(completePath.post).toBeDefined();

    const requestBody = completePath.post.requestBody as any;
    expect(requestBody).toBeDefined();
    expect(completePath.post.responses['200']).toBeDefined();
    expect(completePath.post.responses['400']).toBeDefined();
    expect(completePath.post.responses['404']).toBeDefined();
  });

  it('should document all 10 controllers across paths', () => {
    const paths = Object.keys(document.paths);
    expect(paths).toContain('/api/v1/api-keys');
    expect(paths).toContain('/api/v1/playlists');
    expect(paths).toContain('/api/v1/videos');
    expect(paths).toContain('/api/v1/storage/mock-upload');
    expect(paths).toContain('/api/v1/storage/stream');
    expect(paths).toContain('/api/v1/transcoder/webhook');
    expect(paths).toContain('/api/v1/transcoder/process/{videoId}');
    expect(paths).toContain('/api/v1/player-settings');
    expect(paths).toContain('/api/v1/player-settings/public/{videoId}');
    expect(paths).toContain('/api/v1/analytics/segment-ping');
    expect(paths).toContain('/api/v1/analytics/metrics');
    expect(paths).toContain('/api/v1/billing/webhook');
    expect(paths).toContain('/api/v1/billing/subscription');
  });

  it('should define securitySchemes for bearer and x-api-key', () => {
    const securitySchemes = document.components?.securitySchemes as any;
    expect(securitySchemes).toBeDefined();
    expect(securitySchemes['bearer']).toBeDefined();
    expect(securitySchemes['x-api-key']).toBeDefined();
  });
});
