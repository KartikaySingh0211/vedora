import { test, describe, it } from 'node:test';
import assert from 'node:assert';
import { VedoraClient, VedoraError } from '../dist/index.js';

describe('Vedora SDK', () => {
  it('should initialize VedoraClient with default config', () => {
    const client = new VedoraClient();
    assert.ok(client.videos);
    assert.strictEqual(typeof client.videos.init, 'function');
    assert.strictEqual(typeof client.videos.upload, 'function');
    assert.strictEqual(typeof client.videos.complete, 'function');
    assert.strictEqual(typeof client.videos.list, 'function');
    assert.strictEqual(typeof client.videos.get, 'function');
    assert.strictEqual(typeof client.videos.delete, 'function');
  });

  it('should accept custom baseUrl and apiKey', () => {
    const client = new VedoraClient({
      baseUrl: 'https://api.vedora.com/api/v1',
      apiKey: 'VDR_test_key_123',
    });
    assert.ok(client);
  });

  it('should reject empty or zero-byte file in client.videos.upload', async () => {
    const client = new VedoraClient();
    const emptyFile = new Blob([], { type: 'video/mp4' });

    await assert.rejects(
      async () => {
        await client.videos.upload(emptyFile, {
          title: 'Empty',
          slug: 'empty',
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof VedoraError);
        assert.strictEqual(err.phase, 'init');
        return true;
      },
    );
  });
});
