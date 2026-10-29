# Vedora — Swagger / OpenAPI 3.0 Engineering Guide

This guide documents the architecture, configuration, standards, and operational workflows for the **Swagger UI** and **OpenAPI 3.0 specification** in the Vedora backend.

---

## 📌 Table of Contents

1. [Architecture & Setup](#1-architecture--setup)
2. [Accessing Swagger UI & OpenAPI Specification](#2-accessing-swagger-ui--openapi-specification)
3. [Interactive Swagger UI Testing Guide](#3-interactive-swagger-ui-testing-guide)
4. [DTO & Controller Decorator Standards](#4-dto--controller-decorator-standards)
5. [Automated CI Validation & Specification Export](#5-automated-ci-validation--specification-export)
6. [API Client Code Generation](#6-api-client-code-generation)
7. [Troubleshooting & Common Pitfalls](#7-troubleshooting--common-pitfalls)

---

## 1. Architecture & Setup

Vedora uses NestJS's native `@nestjs/swagger` module integrated directly into the HTTP application lifecycle. The configuration is defined in [`services/src/main.ts`](services/src/main.ts).

### Configuration (`services/src/main.ts`)

```typescript
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

const swaggerConfig = new DocumentBuilder()
  .setTitle('Vedora Video Platform API')
  .setDescription(
    'Production REST API for Vedora — Video Ingestion, HLS Transcoding, Analytics Telemetry, Player Customization, and Open-Source Infrastructure.',
  )
  .setVersion('1.0.0')
  .addBearerAuth(
    {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      name: 'Authorization',
      description: 'Clerk session JWT (format: Bearer <clerk_token>)',
      in: 'header',
    },
    'bearer',
  )
  .addApiKey(
    {
      type: 'apiKey',
      name: 'x-api-key',
      description: 'Vedora live API key (format: ved_live_<prefix>_<secret>)',
      in: 'header',
    },
    'x-api-key',
  )
  .addTag('System', 'System root and meta routes')
  .addTag('Health', 'Platform health check and dependency connectivity')
  .addTag('API Keys', 'Developer API key creation, listing, regeneration, and revocation')
  .addTag('Playlists', 'Playlist organization and concurrency-safe quota management')
  .addTag('Videos', 'Direct-to-cloud upload authorization, upload completion, and video catalog')
  .addTag('Storage', 'Multipart upload handler and HTTP 206 Partial Content video streaming')
  .addTag('Transcoder', 'HLS transcoding job orchestration and signed webhook receiver')
  .addTag('Player Settings', 'Custom video player theming, controls, watermark, and public config')
  .addTag('Analytics', 'High-throughput playback telemetry ingestion and aggregated metrics')
  .build();

const document = SwaggerModule.createDocument(app, swaggerConfig);
SwaggerModule.setup('api/docs', app, document, {
  swaggerOptions: {
    persistAuthorization: true,
    tagsSorter: 'alpha',
    operationsSorter: 'alpha',
    docExpansion: 'list',
    filter: true,
  },
  customSiteTitle: 'Vedora API Documentation',
});
```

### Key Architectural Decisions

1. **Dual Security Schemes**:
   - `bearer`: Maps to Clerk user session JWTs used by the web dashboard.
   - `x-api-key`: Maps to high-performance, Argon2id-hashed API keys used by SDKs and backend integrations.
2. **Persistence**: `persistAuthorization: true` ensures auth tokens remain active in localStorage during browser page reloads while testing.
3. **Discovery & Filtering**: `filter: true` enables an instant real-time search box at the top of Swagger UI.
4. **Deterministic Ordering**: Tags and operations are alphabetized for predictable navigation.

---

## 2. Accessing Swagger UI & OpenAPI Specification

When the backend is running (`npm run start:dev` inside `services/`):

| Endpoint | Description | Content-Type |
| :--- | :--- | :--- |
| **`http://localhost:8080/api/docs`** | Interactive Swagger UI web interface | `text/html` |
| **`http://localhost:8080/api/docs-json`** | Raw OpenAPI 3.0 specification | `application/json` |
| **[`docs/openapi.json`](docs/openapi.json)** | Statically exported, version-controlled OpenAPI JSON spec | `application/json` (109 KB) |

---

## 3. Interactive Swagger UI Testing Guide

### Step 1: Open Swagger UI
Navigate to `http://localhost:8080/api/docs` in your browser.

### Step 2: Authorize Your Session
Click the green **Authorize 🔓** button located at the top right of the Swagger UI interface.

```
┌─────────────────────────────────────────────────────────────┐
│ Available authorizations                                 [X] │
├─────────────────────────────────────────────────────────────┤
│ bearer (http, Bearer)                                       │
│ Clerk session JWT (format: Bearer <clerk_token>)            │
│ Value: [ eyJhbGciOiJSUzI1NiIs...                         ]  │
│                                           [ Authorize ]     │
├─────────────────────────────────────────────────────────────┤
│ x-api-key (apiKey, Header)                                  │
│ Vedora live API key (format: ved_live_<prefix>_<secret>)    │
│ Value: [ ved_live_d84b2591_9f83ab2c4e61d85203ef189b      ]  │
│                                           [ Authorize ]     │
└─────────────────────────────────────────────────────────────┘
```

- **For Dashboard / User testing**: Paste your Clerk JWT into the **bearer** field.
- **For SDK / Server testing**: Paste your generated API key into the **x-api-key** field.
- Click **Authorize**, then click **Close**. All protected endpoints will now display a locked padlock icon 🔒 and send the appropriate header automatically.

### Step 3: Executing "Try it out" Requests

#### Example 1: Direct-to-Cloud Upload Init (`POST /api/v1/videos/init`)
1. Expand the `Videos` tag and click `POST /api/v1/videos/init`.
2. Click **Try it out**.
3. Notice that the request body is pre-populated with a realistic, production-tested JSON example:
   ```json
   {
     "title": "Vedora Direct Upload Tutorial",
     "slug": "vedora-direct-upload-tutorial",
     "size": 104857600,
     "duration": 120,
     "resolutions": ["720p", "1080p"],
     "playlistId": "a0b1c2d3-e4f5-4a6b-8c9d-0e1f2a3b4c5d",
     "description": "In-depth demonstration of multipart upload pipeline and HLS transcode ladder",
     "tags": ["tutorial", "streaming", "hls"],
     "generateSubtitles": true,
     "includeWatermark": false
   }
   ```
4. Click **Execute**.
5. Swagger UI executes the request and renders the HTTP 201 response with complete multipart upload URLs and part IDs.

#### Example 2: Stream Video with HTTP Byte-Range (`GET /api/v1/storage/stream`)
1. Expand the `Storage` tag and click `GET /api/v1/storage/stream`.
2. Click **Try it out**.
3. Under `key`, enter: `videos/sample-video-id/master.m3u8`.
4. Under `Range`, enter: `bytes=0-1048575`.
5. Click **Execute**. Swagger UI displays the response stream and confirms the `206 Partial Content` status with `Content-Range: bytes 0-1048575/104857600`.

---

## 4. DTO & Controller Decorator Standards

To maintain clean, accurate, and type-safe OpenAPI documentation, adhere to the following standards when creating or updating endpoints.

### Controller Level Decorators

Every controller MUST specify its API Tag, security requirements, and standard error schemas:

```typescript
@ApiTags('Videos')
@ApiBearerAuth('bearer')
@ApiSecurity('x-api-key')
@Controller('api/v1/videos')
export class VideoController { ... }
```

### Method Level Decorators

Every route handler MUST specify:
- `@ApiOperation({ summary: '...', description: '...' })`
- Status-specific response decorators (`@ApiOkResponse`, `@ApiCreatedResponse`, `@ApiAcceptedResponse`) referencing strongly typed DTOs.
- Explicit error decorators (`@ApiBadRequestResponse`, `@ApiUnauthorizedResponse`, `@ApiForbiddenResponse`, `@ApiNotFoundResponse`, `@ApiPayloadTooLargeResponse`).
- Parameter descriptions (`@ApiParam`, `@ApiQuery`, `@ApiHeader`).

```typescript
@Post('init')
@UseGuards(DualAuthGuard, UploadVideoGuard)
@ApiOperation({
  summary: 'Initialize direct-to-cloud video upload',
  description:
    'Atomically reserves storage quota allowance for caller, validates plan-based file size limits, and returns presigned multipart upload credentials.',
})
@ApiCreatedResponse({
  description: 'Upload initiated successfully. Returns storage presigned URLs and parts.',
  type: VideoInitResponseDto,
})
@ApiBadRequestResponse({
  description: 'Invalid input parameters or validation constraints failed.',
  type: ValidationErrorResponseDto,
})
@ApiUnauthorizedResponse({
  description: 'Missing, expired, or invalid Bearer token or API key.',
  type: ErrorResponseDto,
})
@ApiPayloadTooLargeResponse({
  description: 'File size exceeds maximum upload allowance (10 GiB default).',
  type: ErrorResponseDto,
})
async initUpload(@Body() dto: CreateVideoInitDto) { ... }
```

### DTO Property Decorators

Every field in request and response DTOs MUST be decorated with `@ApiProperty` or `@ApiPropertyOptional`:

```typescript
export class CreateVideoInitDto {
  @ApiProperty({
    description: 'Video title displayed in dashboard and player',
    example: 'Vedora Direct Upload Tutorial',
    minLength: 1,
    maxLength: 255,
  })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({
    description: 'Total video file size in raw bytes',
    example: 104857600,
    minimum: 1,
  })
  @IsNumber()
  @IsPositive()
  size: number;

  @ApiPropertyOptional({
    description: 'Target HLS transcoding resolutions requested',
    example: ['720p', '1080p'],
    type: [String],
    enum: ['360p', '480p', '720p', '1080p'],
    default: ['720p'],
  })
  @IsOptional()
  @IsArray()
  resolutions?: ('360p' | '480p' | '720p' | '1080p')[];
}
```

> [!IMPORTANT]
> **Array Type Syntax in Swagger**: When documenting string arrays, use `type: [String]` instead of `{ isArray: true }`. In NestJS Swagger, `{ isArray: true }` without explicit item typing can generate invalid nested schemas (`"items": { "type": "array" }`).

---

## 5. Automated CI Validation & Specification Export

To prevent documentation drift, Vedora includes an automated Jest test suite dedicated to Swagger: [`services/src/swagger.spec.ts`](services/src/swagger.spec.ts).

### What the Test Verifies

1. **Bootstrap Validity**: Confirms `AppModule` compiles without circular dependency errors.
2. **Schema Integrity**: Generates the OpenAPI 3.0 document and verifies `openapi: '3.0.0'` metadata.
3. **Tag Taxonomy**: Asserts all 9 core tags (`System`, `Health`, `API Keys`, `Playlists`, `Videos`, `Storage`, `Transcoder`, `Player Settings`, `Analytics`) are registered.
4. **Endpoint Completeness**: Validates that all 19 endpoints exist in the OpenAPI paths object.
5. **Security Scheme Registration**: Confirms both `bearer` (JWT) and `x-api-key` (API key) are registered under `components.securitySchemes`.
6. **Automatic Disk Export**: Serializes the generated document to [`docs/openapi.json`](docs/openapi.json).

### Running the Validation

```bash
# Run the Swagger test suite
npm --prefix services run test -- src/swagger.spec.ts
```

Output:
```text
PASS src/swagger.spec.ts
  Swagger / OpenAPI Specification
    ✓ should compile AppModule and generate valid OpenAPI 3.0 document (1240 ms)
    ✓ should contain all required tags (2 ms)
    ✓ should register both bearer and x-api-key security schemes (1 ms)
    ✓ should register all core endpoint paths (3 ms)
    ✓ should export openapi.json to docs/ directory (28 ms)
```

---

## 6. API Client Code Generation

The exported [`docs/openapi.json`](docs/openapi.json) file can be used to generate strongly-typed API clients in any major programming language.

### 1. TypeScript (Axios / Fetch)
```bash
npx @openapitools/openapi-generator-cli generate \
  -i docs/openapi.json \
  -g typescript-axios \
  -o clients/typescript-axios \
  --additional-properties=supportsES6=true,npmName=@vedora/api-client
```

### 2. Python
```bash
npx @openapitools/openapi-generator-cli generate \
  -i docs/openapi.json \
  -g python \
  -o clients/python \
  --additional-properties=packageName=vedora_api
```

### 3. Go
```bash
npx @openapitools/openapi-generator-cli generate \
  -i docs/openapi.json \
  -g go \
  -o clients/go \
  --additional-properties=packageName=vedora
```

### 4. Postman & Insomnia
- **Postman**: Click **Import** in the top navigation -> Drag & drop `docs/openapi.json` -> Select **Import as API collection**.
- **Insomnia**: Click **Preferences / Data** -> **Import Data** -> **From File** -> Select `docs/openapi.json`.

---

## 7. Troubleshooting & Common Pitfalls

### 1. Request Body Displays `{}` in Swagger UI
**Cause**: The controller route handler uses a plain interface instead of a TypeScript class decorated with `@ApiProperty()`, or the DTO class lacks `@ApiProperty()` decorators on its properties.  
**Fix**: Ensure every DTO is a TypeScript `class` (not an `interface`) and every property has `@ApiProperty(...)` or `@ApiPropertyOptional(...)`.

### 2. Security Padlock Stays Unlocked or Returns 401
**Cause**: The security scheme name in `@ApiBearerAuth('bearer')` does not match the name configured in `.addBearerAuth(..., 'bearer')` in `main.ts`.  
**Fix**: Verify that decorator names match the DocumentBuilder registration keys exactly.

### 3. Binary Stream Displays Corrupted Characters in Swagger UI
**Cause**: Missing `@ApiProduces('video/mp4', 'application/vnd.apple.mpegurl')` on streaming routes.  
**Fix**: Add `@ApiProduces` to inform Swagger UI that the response is a binary stream rather than a JSON payload.

### 4. Lint Warning on Unsafe Swagger Spec Types
**Cause**: `@typescript-eslint` flagging untyped inspection of the OpenAPI document object in test files.  
**Fix**: Add scoped ESLint disable comments at the top of test files when inspecting dynamic OpenAPI properties:
```typescript
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
```
