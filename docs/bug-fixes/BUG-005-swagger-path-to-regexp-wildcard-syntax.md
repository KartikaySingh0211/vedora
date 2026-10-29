# BUG-005: NestJS Swagger Bootstrap Failure due to path-to-regexp Wildcard Syntax

- **ID**: BUG-005
- **Date**: 2026-10-25
- **Component**: Backend / Swagger (`StorageController`, `services/src/main.ts`)
- **Severity**: Critical (Server crash during bootstrap)
- **Status**: Resolved

---

## 1. Symptoms & Error Log

When running `npm run start:dev` in `services`, the application crashed during Swagger document generation with the following error:

```text
[Nest] 17724  - 25/10/2026, 12:12:28 am     LOG [NestFactory] Starting Nest application...
...
TypeError: Missing parameter name at index 28: /api/v1/storage/mock-upload*; visit https://git.new/pathToRegexpError for info
    at consumeUntil (D:\Dev\Projects\vedora\services\node_modules\path-to-regexp\dist\index.js:108:27)
    at swagger-explorer.js: ...
  originalPath: '/api/v1/storage/mock-upload*'
```

---

## 2. Root Cause Analysis

In `services/src/infra/storage/storage.controller.ts`, the mock upload handler used the decorator:

```ts
@All('mock-upload*')
```

`@nestjs/swagger` parses all controller endpoint routes through `path-to-regexp` v8 to build OpenAPI paths. In `path-to-regexp` v8, an un-named asterisk (`*`) is deprecated/invalid syntax; route tokens must either have explicit parameter names or standard static route paths. The trailing asterisk triggered an uncaught `TypeError: Missing parameter name at index 28`.

---

## 3. Implementation Details

1. **Standardized Controller Route Path**:
   - File: `services/src/infra/storage/storage.controller.ts`
   - Replaced `@All('mock-upload*')` with standard route `@All('mock-upload')`:
     ```ts
     @All('mock-upload')
     @ApiOperation({
       summary:
         'Resilient storage endpoint for multipart chunk uploads in local development or provider fallback mode',
     })
     handleMockUpload(...)
     ```

2. **Updated Fallback Storage URL Generation**:
   - File: `services/src/infra/storage/storage.service.ts`
   - Switched from path-based parameters to clean, standard query parameters:
     ```ts
     url: `${apiBase}/storage/mock-upload?bucketId=${targetBucket}&key=${encodeURIComponent(key)}&partNumber=${i}&uploadId=${uploadId}`,
     ```

---

## 4. Verification & Testing

- Verified with `path-to-regexp`: Tested `pathToRegexp('/api/v1/storage/mock-upload')` — successfully returned valid RegExp without errors.
- Verified Swagger document generation: Bootstrapped `SwaggerModule.createDocument(app, config)` — successfully generated 20 Swagger endpoints.
- Backend build: `npm run build` in `services` passed with exit code 0.
- Backend test suite: `npm test` in `services` passed (11/11 suites, 79/79 tests passed).
