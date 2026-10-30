# BUG-016: Static Linux FFprobe SIGSEGV on MPEG-TS Segment Probing in CI

## Bug Metadata
- **ID**: `BUG-016`
- **Date**: 2026-10-30
- **Component**: CI / Live E2E Transcoder Test / FFprobe
- **Severity**: Medium
- **Resolution Status**: Resolved

---

## 1. Symptoms & Error Logs

During GitHub Actions CI execution on the `main` branch under the `Backend Services (Tests & Build)` job, the step `Run backend unit and integration test suites` failed with exit code 1:

```text
FAIL src/modules/transcoder/transcoder-live-e2e.spec.ts
● TranscoderService Synthetic Live E2E Pipeline (Phase 3) › Synthetic Live Video Ingestion & HLS Packaging › should complete queue dispatch, ffprobe media inspection, and HLS variant generation without mocks

Command failed: /home/runner/work/vedora/vedora/services/node_modules/@ffprobe-installer/linux-x64/ffprobe -v quiet -print_format json -show_format -show_streams /tmp/vedora-phase3-live-e2e-1793372938828/probe-verify.ts
    at Object.<anonymous> (modules/transcoder/transcoder-live-e2e.spec.ts:324:30)

Test Suites: 1 failed, 17 passed, 18 total
Tests:       1 failed, 160 passed, 161 total
Snapshots:   0 total
Time:        4.617 s
Ran all test suites.
Error: Process completed with exit code 1.
```

---

## 2. Root Cause Analysis (RCA)

1. **Platform-Specific Binary Demuxer Crash**:
   In `transcoder-live-e2e.spec.ts`, Step 7 verified generated media output by directly executing `ffprobe` against the first HLS Transport Stream chunk (`segment_000.ts`) saved to disk.
   The project consumes `@ffprobe-installer/linux-x64`, which bundles an older static Linux build of FFprobe 4.1 (John Van Sickle build from 2018).
   When this static binary's MPEG-TS demuxer reads standalone `.ts` files on modern Linux environments (such as Ubuntu 24.04 GitHub Actions runner kernels with glibc 2.39+), it encounters a memory fault resulting in `SIGSEGV` (signal 11, Segmentation fault).
2. **Platform Discrepancy (Windows vs Linux)**:
   On Windows (`@ffprobe-installer/win32-x64/ffprobe.exe`), the bundled binary demuxes standalone `.ts` files without crashing, which allowed the test to pass during local development on Windows.
   Furthermore, probing MP4 container formats (`source.mp4`) does not crash on either platform.
3. **MPEG-TS Bitstream Validity**:
   Empirical byte-level inspection of the generated `.ts` buffer confirmed that FFmpeg generated completely valid MPEG-2 Transport Stream data: exactly 222 packets, 188-byte aligned, each beginning with the standard ISO/IEC 13818-1 sync byte `0x47` (71 decimal). The failure was solely an upstream demuxer parsing bug in the legacy static Linux binary.

---

## 3. Implementation Details

1. **Strict Buffer-Level MPEG-TS Packet Alignment Assertion (`services/src/modules/transcoder/transcoder-live-e2e.spec.ts`)**:
   Enhanced Step 6 of the live E2E test to deterministically validate transport stream packet framing directly in Node.js buffer memory:
   - Verified that `segmentBuffer.length % 188 === 0` (guaranteeing exact 188-byte packet boundary alignment).
   - Iterated through every 188-byte offset, asserting `segmentBuffer[offset] === 0x47` across 100% of packets (`syncPacketCount === segmentBuffer.length / 188`).
2. **Container Remuxing Prior to FFprobe Stream Inspection**:
   In Step 7, remuxed the `.ts` segment to `.mp4` using `ffmpeg -y -i probe-verify.ts -c copy probe-verify.mp4` prior to invoking `ffprobe`:
   - Using `-c copy` performs a lossless bitstream pass-through without transcoding or re-encoding.
   - The operation completes in <10ms and bypasses the static Linux `ffprobe` MPEG-TS demuxer `SIGSEGV`.
   - `ffprobe` inspects the remuxed container and strictly validates stream properties (`h264` codec, `640x360` resolution, and stream metadata) identically across Linux and Windows runners.

---

## 4. Verification & Testing Evidence

1. **Linux Container Diagnostic Verification**:
   - Executed probe reproduction in a clean Linux container (`node:20` glibc):
     - Direct `.ts` probe exited with signal `SIGSEGV`.
     - Remuxed MP4 probe exited with code `0`, returning full JSON streams output: `h264 640x360`.
2. **Local Test Suite Run**:
   - `npm --prefix services test -- transcoder-live-e2e.spec.ts`: Passed (2/2 tests, 6.18s).
   - `npm --prefix services test`: Passed all 18 test suites (161/161 tests, 24.58s).
   - `npm --prefix services run build`: Successful NestJS compilation.
   - `npm --prefix sdks/vedora-sdk test`: Passed (3/3 tests).
   - `npm --prefix apps/main-dashboard run build`: Successful Next.js production build.
3. **Repository Check**:
   - `git diff --check`: Clean, no whitespace errors.

---

## 5. Prevention & Safeguards

- For media inspection in CI pipelines across heterogeneous OS runners, avoid probing raw MPEG-TS segments with legacy static FFprobe builds if container remuxing (`-c copy`) or direct bitstream packet analysis can provide equivalent verification without risking upstream binary crashes.
- Combine low-level binary buffer checks (e.g. sync byte and packet alignment) with high-level container inspection for maximum empirical rigor.
