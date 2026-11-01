# FFmpeg Video Transcoding Engine

This directory contains the architecture, auditing documentation, implementation logs, and operational guides for Vedora's real FFmpeg-based HLS video transcoding infrastructure.

## Documentation Index

- **[PHASE_1_AUDIT_AND_ARCHITECTURE.md](PHASE_1_AUDIT_AND_ARCHITECTURE.md)**: Comprehensive audit of the codebase, identification of simulated components, proposed real FFmpeg architecture, rendition ladder, queue reliability model, and implementation plan.
- **[PHASE_1_IMPLEMENTATION_AND_VERIFICATION.md](PHASE_1_IMPLEMENTATION_AND_VERIFICATION.md)**: Implementation details of the real FFmpeg engine, probing logic, rendition ladder packaging, and end-to-end verification.
- **[PHASE_2_RELIABILITY_AND_FAILURE_TESTING.md](PHASE_2_RELIABILITY_AND_FAILURE_TESTING.md)**: Reliability audit, failure modes, token-verified Redis lock ownership and heartbeats, stranded job crash recovery, HLS MIME validation, 404 missing segment handling, and expanded test suite matrix.

## Visual Evidence & Screencasts

- 🎥 **[Application Walkthrough Video](../assets/demo/main-walkthrough.mp4)**: Complete video demonstrating upload ingestion, transcode progress, and adaptive HLS playback.
- 🎥 **[Cloudflare R2 Storage Walkthrough Video](../assets/demo/R2.mp4)**: Screencast showing the generated HLS variant playlists and MPEG-TS segments in Cloudflare R2 storage.
- 📸 **[Background Transcoding Execution Logs](../assets/screenshots/transcoding-logs.png)**: Terminal screenshot showing live FFmpeg transcoding, media probing, and multi-rendition ladder packaging.
