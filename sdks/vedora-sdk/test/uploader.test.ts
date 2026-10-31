import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

process.env.NODE_ENV = 'test';

import {
  uploadFileDirectly,
  VedoraError,
} from '../dist/index.js';
import type { StorageInitiateData } from '../dist/index.js';

describe('SDK Direct Uploader - Retries, Abort, and Chunk Resume', () => {
  const originalFetch = globalThis.fetch;
  const dummyFile = new Blob(['12345678901234567890'], { type: 'video/mp4' }); // 20 bytes

  const dummyUploadData: StorageInitiateData = {
    objectId: 'obj-123',
    key: 'videos/test-key.mp4',
    uploadId: 'upload-abc',
    partSize: 10, // 2 parts total: Part 1 (10b), Part 2 (10b)
    parts: [
      { partNumber: 1, url: 'https://storage.example.com/part-1' },
      { partNumber: 2, url: 'https://storage.example.com/part-2' },
    ],
  };

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('1. Retry Behavior', () => {
    it('should retry on transient 500 server error and succeed on subsequent attempt', async () => {
      let callCount = 0;
      globalThis.fetch = async (input: RequestInfo | URL) => {
        callCount++;
        const url = String(input);
        if (url.includes('part-1') && callCount === 1) {
          // Fail on 1st attempt
          return new Response('Transient Storage Error', { status: 500, statusText: 'Internal Error' });
        }
        return new Response('', {
          status: 200,
          headers: { etag: '"etag-success"' },
        });
      };

      const result = await uploadFileDirectly(dummyFile, dummyUploadData, { maxRetries: 2 });
      assert.strictEqual(result.completedParts.length, 2);
      assert.strictEqual(callCount, 3); // 2 calls for part 1 (1 fail + 1 retry) + 1 call for part 2
      assert.strictEqual(result.completedParts[0].ETag, 'etag-success');
    });

    it('should not retry on non-retryable 4xx client errors (e.g. 403 Forbidden)', async () => {
      let callCount = 0;
      globalThis.fetch = async () => {
        callCount++;
        return new Response('Access Denied', { status: 403, statusText: 'Forbidden' });
      };

      await assert.rejects(
        async () => {
          await uploadFileDirectly(dummyFile, dummyUploadData, { maxRetries: 3 });
        },
        (err: unknown) => {
          assert.ok(err instanceof VedoraError);
          assert.strictEqual(err.phase, 'upload');
          assert.strictEqual(err.status, 403);
          return true;
        },
      );

      // Must have failed immediately without retrying
      assert.strictEqual(callCount, 1);
    });

    it('should exhaust retries and throw descriptive VedoraError on persistent network failure', async () => {
      let callCount = 0;
      globalThis.fetch = async () => {
        callCount++;
        throw new Error('Connection reset by peer');
      };

      await assert.rejects(
        async () => {
          await uploadFileDirectly(dummyFile, dummyUploadData, { maxRetries: 2 });
        },
        (err: unknown) => {
          assert.ok(err instanceof VedoraError);
          assert.strictEqual(err.phase, 'upload');
          assert.match(err.message, /Failed uploading part 1 after 2 retries/);
          return true;
        },
      );

      // Initial attempt (0) + 2 retries = 3 calls
      assert.strictEqual(callCount, 3);
    });
  });

  describe('2. Abort Behavior', () => {
    it('should cancel upload immediately when signal is already aborted', async () => {
      let fetchCalled = false;
      globalThis.fetch = async () => {
        fetchCalled = true;
        return new Response('', { status: 200 });
      };

      const controller = new AbortController();
      controller.abort();

      await assert.rejects(
        async () => {
          await uploadFileDirectly(dummyFile, dummyUploadData, { signal: controller.signal });
        },
        (err: unknown) => {
          assert.ok(err instanceof VedoraError);
          assert.strictEqual(err.message, 'Upload cancelled by user');
          return true;
        },
      );

      assert.strictEqual(fetchCalled, false);
    });

    it('should abort an in-progress upload and not retry', async () => {
      let attempts = 0;
      const controller = new AbortController();

      globalThis.fetch = async (input, init) => {
        attempts++;
        if (attempts === 1) {
          // Abort during first upload call
          controller.abort();
          const abortErr = new Error('The operation was aborted');
          abortErr.name = 'AbortError';
          throw abortErr;
        }
        return new Response('', { status: 200 });
      };

      await assert.rejects(
        async () => {
          await uploadFileDirectly(dummyFile, dummyUploadData, {
            signal: controller.signal,
            maxRetries: 3,
          });
        },
        (err: unknown) => {
          assert.ok(err instanceof VedoraError);
          assert.strictEqual(err.message, 'Upload cancelled by user');
          return true;
        },
      );

      // Must NOT attempt any retries after abort
      assert.strictEqual(attempts, 1);
    });
  });

  describe('3. Chunk Resume', () => {
    it('should resume an interrupted upload by skipping already-completed parts', async () => {
      const requestedUrls: string[] = [];
      globalThis.fetch = async (input: RequestInfo | URL) => {
        requestedUrls.push(String(input));
        return new Response('', {
          status: 200,
          headers: { etag: '"etag-part-2-new"' },
        });
      };

      // Part 1 was previously completed
      const existingParts = [{ PartNumber: 1, ETag: 'etag-part-1-cached' }];

      const result = await uploadFileDirectly(dummyFile, dummyUploadData, {
        existingParts,
      });

      // Part 1 should NOT have made a network request
      assert.strictEqual(requestedUrls.length, 1);
      assert.strictEqual(requestedUrls[0], 'https://storage.example.com/part-2');

      // Final result must include both parts in order
      assert.strictEqual(result.completedParts.length, 2);
      assert.strictEqual(result.completedParts[0].PartNumber, 1);
      assert.strictEqual(result.completedParts[0].ETag, 'etag-part-1-cached');
      assert.strictEqual(result.completedParts[1].PartNumber, 2);
      assert.strictEqual(result.completedParts[1].ETag, 'etag-part-2-new');
    });

    it('should calculate progress accurately when resuming from existing chunks', async () => {
      globalThis.fetch = async () => {
        return new Response('', { status: 200, headers: { etag: '"etag2"' } });
      };

      const progressHistory: number[] = [];
      await uploadFileDirectly(dummyFile, dummyUploadData, {
        existingParts: [{ PartNumber: 1, ETag: 'etag1' }],
        onProgress: (p) => {
          progressHistory.push(p.percent);
        },
      });

      // With part 1 (10 bytes) cached and part 2 (10 bytes) completed, total should reach 100%
      assert.ok(progressHistory.length > 0);
      assert.strictEqual(progressHistory[progressHistory.length - 1], 100);
    });

    it('should ignore invalid or malformed existingParts (out-of-bounds, empty etags) and re-upload them', async () => {
      const requestedUrls: string[] = [];
      globalThis.fetch = async (input: RequestInfo | URL) => {
        requestedUrls.push(String(input));
        return new Response('', {
          status: 200,
          headers: { etag: '"fresh-etag"' },
        });
      };

      // Part 1 has empty ETag (invalid); Part 99 is out of range
      const malformedExisting = [
        { PartNumber: 1, ETag: '' },
        { PartNumber: 99, ETag: 'fake-etag-out-of-bounds' },
      ];

      const result = await uploadFileDirectly(dummyFile, dummyUploadData, {
        existingParts: malformedExisting,
      });

      // Both valid parts (1 and 2) must be uploaded via network since Part 1 was invalid
      assert.strictEqual(requestedUrls.length, 2);
      assert.strictEqual(result.completedParts.length, 2);
      assert.strictEqual(result.completedParts[0].PartNumber, 1);
      assert.strictEqual(result.completedParts[1].PartNumber, 2);
    });
  });
});
