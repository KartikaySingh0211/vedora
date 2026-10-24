---
description: Mandatory workflow for documenting bug fixes in the Vedora repository
globs: ["**/*"]
---

# Bug Fix Logging Policy

Every time a bug, runtime exception, schema omission, configuration mismatch, or upstream integration failure is resolved:

1. **Create a Dedicated Bug Log File**:
   - Location: `docs/bug-fixes/BUG-XXX-<kebab-case-title>.md`
   - Increment the sequential ID (`BUG-001`, `BUG-002`, `BUG-005`, etc.).

2. **Mandatory Sections in Bug Log**:
   - **Header**: ID, Date, Component, Severity (`Critical` | `High` | `Medium` | `Low`), Status (`Resolved`).
   - **1. Symptoms & Error Log**: Exact stack traces, console messages, or failing HTTP response codes.
   - **2. Root Cause Analysis (RCA)**: Deep technical breakdown of why the bug occurred.
   - **3. Implementation Details**: Concrete code changes, files modified, and architectural rationale.
   - **4. Verification & Testing**: Commands and test results validating the fix.

3. **Update Central Index**:
   - Add the new bug fix entry to the table in `docs/bug-fixes/README.md`.
