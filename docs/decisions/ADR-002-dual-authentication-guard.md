# ADR-002: Dual-Authentication Guard (Clerk JWT & Vedora API Keys)

## Status
**Accepted** (Implemented in Phase 2)

## Context
Vedora must serve both end-users navigating the authenticated dashboard (`apps/main-dashboard`) and automated developer pipelines uploading media programmatically. These two authentication mechanisms have different token Lifecycles, header conventions, and validation pathways.

## Decision
Implement a unified NestJS `DualAuthGuard` that inspects incoming HTTP requests in a prioritized order:
1. **API Key Path**: If `x-api-key` header is present, or if `Authorization: Bearer` begins with `VDR_`, authenticate against `ApiKeyService.verifyApiKey()`.
2. **Clerk Session Path**: If `Authorization: Bearer <jwt>` is present, authenticate against Clerk's backend SDK (`verifyToken`).
3. **Context Injection**: Set `req.user = { id: ... }` and `req.authType = 'clerk' | 'api_key'`, allowing downstream controllers and services to access the authenticated tenant transparently.
4. **Rejection**: If neither credential is present, throw HTTP `401 Unauthorized` with structured error messages.

## Consequences
### Positive
- Unified security boundary: All protected endpoints (playlists, API keys, health checks) use a single decorator `@UseGuards(DualAuthGuard)`.
- Seamless DX: Developers can pass API keys via either `x-api-key` header or standard `Authorization: Bearer VDR_...` header.
- Zero client trust: `req.user.id` is derived strictly from validated server contexts, never from client-submitted body params.

### Negative / Trade-offs
- The server requires both Clerk secret keys and internal digest secrets configured in its environment.
