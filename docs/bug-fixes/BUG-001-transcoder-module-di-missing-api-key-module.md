# BUG-001: NestJS Dependency Injection Failure in TranscoderModule

- **ID**: BUG-001
- **Date**: 2026-10-24
- **Component**: Backend / Transcoder (`services/src/modules/transcoder`)
- **Severity**: Critical (Blocked server bootstrap)
- **Status**: Resolved

---

## 1. Symptoms & Error Log

When running `npm run start:dev` in `services`, NestJS failed during bootstrap with the following dependency injection error:

```text
ERROR [ExceptionHandler] Nest can't resolve dependencies of the DualAuthGuard (?, ConfigService). Please make sure that the argument ApiKeyService at index [0] is available in the TranscoderModule context.

Potential solutions:
- Is TranscoderModule a valid NestJS module?
- If ApiKeyService is a provider, is it part of the current TranscoderModule?
- If ApiKeyService is exported from a separate @Module, is that module imported within TranscoderModule?
  @Module({
    imports: [ /* the Module containing ApiKeyService */ ]
  })
```

---

## 2. Root Cause Analysis

`TranscoderController` protected its webhook and job control endpoints using `@UseGuards(DualAuthGuard)`. `DualAuthGuard` requires `ApiKeyService` injected as its first constructor dependency:

```ts
constructor(
  private readonly apiKeyService: ApiKeyService,
  private readonly configService: ConfigService,
) {}
```

However:
1. `TranscoderModule` did not import `ApiKeyModule`.
2. `ApiKeyModule` was not decorated with `@Global()`, meaning its exported `ApiKeyService` provider was scoped strictly to modules that explicitly imported it.

---

## 3. Implementation Details

1. **Marked `ApiKeyModule` as `@Global()`**:
   - File: `services/src/modules/api-key/api-key.module.ts`
   - Added `@Global()` decorator so `ApiKeyService` and `DualAuthGuard` are accessible across all NestJS modules throughout the application.

2. **Explicitly Imported `ApiKeyModule` into `TranscoderModule`**:
   - File: `services/src/modules/transcoder/transcoder.module.ts`
   - Added `ApiKeyModule` to the `imports` array of `@Module`.

---

## 4. Verification & Testing

- **Command**: `npm run build` in `services/` -> Passed (Exit code 0).
- **Command**: `npm test` in `services/` -> Passed (All 11 suites, 79 tests passed).
- **Command**: `node dist/main.js` boot test -> Successfully bootstrapped with all dependencies loaded.
