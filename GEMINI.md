# Vedora Workspace Rules & Assistant Guidelines

## 1. Documentation-First Policy (Mandatory Before Every Commit)

Before staging (`git add`) and executing any commit (`git commit`), you MUST audit and update all relevant documentation across the repository to keep code and documentation in lockstep:

- **`docs/ENGINEERING_LOG.md`**: Append a new dated run entry for non-trivial features, refactors, and optimization tasks detailing context, decisions, files modified, and test verification.
- **`README.md`**: Keep capability summaries, walkthrough checklists, test badges, and environment setup instructions up to date when user-facing features or architectures change.
- **`docs/decisions/ADR-XXX-*.md`**: Update or create Architecture Decision Records whenever architectural patterns, storage providers, queue models, protocols, or data flows change.
- **`docs/ARCHITECTURE_AND_SYSTEM_DESIGN.md`**: Keep system blueprints, Mermaid sequence diagrams, and service topologies synchronized with implementation changes.
- **`docs/api-docs/` & `docs/openapi.json`**: Update schema documentation in `SCHEMAS_AND_MODELS.md` when DTOs or endpoints change, and regenerate `docs/openapi.json` via `npm --prefix services test -- swagger.spec.ts`.
- **`docs/bug-fixes/`**: Whenever fixing a bug or incident, create `docs/bug-fixes/BUG-XXX-<title>.md` and register it in `docs/bug-fixes/README.md`.

Never commit code changes without their corresponding documentation updates. Stage and commit code and documentation together.

## 2. Bug Fix Logging Policy

Every resolved bug, exception, or upstream provider issue must be documented with:
1. Symptoms and verbatim error logs.
2. Root Cause Analysis (RCA).
3. Concrete implementation details.
4. Empirical verification evidence.

## 3. Engineering Rigor & Testing Standards

- Always run relevant unit and integration test suites (`npm --prefix services test`, `npm --prefix sdks/vedora-sdk test`, `npm --prefix apps/main-dashboard run build`) before committing.
- Do not claim verification unless genuinely executed and verified with evidence.
