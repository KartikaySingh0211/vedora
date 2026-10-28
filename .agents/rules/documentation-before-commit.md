---
description: Mandatory rule to audit and update all relevant documentation before executing any git commit
globs: ["**/*"]
---

# Documentation Update Policy Before Commits

Before staging (`git add`) and executing any commit (`git commit`), you MUST audit and update all relevant documentation in the repository to prevent documentation drift. Never commit code or configuration changes without synchronizing the corresponding documentation.

## Mandatory Pre-Commit Documentation Audit Checklist

Evaluate which documentation files are impacted by the changes and update them before committing:

1. **Master Engineering Log (`docs/ENGINEERING_LOG.md`)**:
   - **When to update**: Every non-trivial change, feature addition, refactor, or optimization run.
   - **Content required**: Append a new chronological entry with date, problem statement, exact technical decisions, files changed, and test/verification evidence.

2. **Project README (`README.md`)**:
   - **When to update**: When user-facing features, core capabilities, test counts, walkthrough table items, environment requirements, or architecture diagrams are impacted.
   - **Content required**: Keep test badges, capability lists, and quick-start instructions accurate and current.

3. **Architecture Decision Records (`docs/decisions/ADR-XXX-*.md`)**:
   - **When to update**: When architectural patterns, storage providers, queue models, protocols, or data flows change.
   - **Content required**: Update existing ADRs or author a new sequential ADR explaining status, context, decision, and consequences.

4. **System Architecture Blueprints (`docs/ARCHITECTURE_AND_SYSTEM_DESIGN.md`)**:
   - **When to update**: When component topology, sequence diagrams, security boundaries, or inter-service communications change.
   - **Content required**: Keep Mermaid sequence/flowchart diagrams and textual specifications aligned with code.

5. **API Documentation & OpenAPI Specifications (`docs/api-docs/` & `docs/openapi.json`)**:
   - **When to update**: When any controller route, query param, header, DTO schema, validation constraint, or webhook changes.
   - **Content required**: Update `docs/api-docs/SCHEMAS_AND_MODELS.md`, `docs/api-docs/README.md`, and regenerate `docs/openapi.json` via `services/src/swagger.spec.ts`.

6. **Bug Fix Incident Ledger (`docs/bug-fixes/`)**:
   - **When to update**: Whenever resolving a bug, runtime exception, or integration failure.
   - **Content required**: Create `docs/bug-fixes/BUG-XXX-<title>.md` following the standard template and append the entry to the index table in `docs/bug-fixes/README.md`.

## Execution Workflow

1. **Verify Implementation**: Run relevant test suites and production builds.
2. **Audit & Update Documentation**: Edit all impacted documentation files identified in the checklist above.
3. **Stage Atomically**: Stage the code changes together with the documentation updates in the same commit.
4. **Commit**: Write a concise, conventional commit message describing the work.
