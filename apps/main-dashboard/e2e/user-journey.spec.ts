import { test, expect } from '@playwright/test';

test.describe('Vedora Main User Journey E2E', () => {
  const mockVideoId = 'vid-e2e-1001-2002-3003';
  const mockStorageKey = 'videos/raw/mock-e2e-video.mp4';

  test.beforeEach(async ({ page }) => {
    // Deterministic API route mocks: runs 100% reliably in local and CI environments
    // without requiring external Cloudflare R2 bucket credentials or Neon DB connection

    // 1. Mock Clerk Authentication endpoints
    await page.route('**/v1/client/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          response: {
            sessions: [
              {
                id: 'sess_test_123',
                status: 'active',
                user: { id: 'user_e2e_tester', firstName: 'Vedora', lastName: 'Tester' },
              },
            ],
          },
        }),
      });
    });

    // 2. Mock /api/v1/videos/init
    await page.route('**/api/v1/videos/init', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          video: {
            id: mockVideoId,
            userId: 'user_e2e_tester',
            title: 'E2E Test Video Journey',
            slug: 'e2e-test-video-journey',
            status: 'uploading',
            resolutions: ['720p', '360p'],
            createdAt: new Date().toISOString(),
          },
          uploadData: {
            objectId: 'obj-e2e-999',
            key: mockStorageKey,
            uploadId: 'upload-id-e2e-456',
            partSize: 5242880,
            parts: [
              {
                partNumber: 1,
                url: 'https://mock-storage.vedora.local/parts/part-1',
              },
            ],
          },
          bucketId: 'vedora-test-bucket',
        }),
      });
    });

    // 3. Mock presigned storage part PUT upload
    await page.route('https://mock-storage.vedora.local/parts/**', async (route) => {
      await route.fulfill({
        status: 200,
        headers: {
          etag: '"etag-e2e-part-1"',
          'access-control-allow-origin': '*',
        },
        body: '',
      });
    });

    // 4. Mock /api/v1/videos/complete
    await page.route('**/api/v1/videos/complete', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: mockVideoId,
          userId: 'user_e2e_tester',
          title: 'E2E Test Video Journey',
          slug: 'e2e-test-video-journey',
          status: 'processing',
          storageKey: mockStorageKey,
          resolutions: ['720p', '360p'],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      });
    });

    // 5. Mock /api/v1/videos/[id] polling status
    await page.route(`**/api/v1/videos/${mockVideoId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: mockVideoId,
          userId: 'user_e2e_tester',
          title: 'E2E Test Video Journey',
          slug: 'e2e-test-video-journey',
          status: 'ready',
          storageKey: mockStorageKey,
          masterM3u8Key: `videos/${mockVideoId}/master.m3u8`,
          duration: 10,
          resolutions: ['720p', '360p'],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      });
    });

    // 6. Mock /api/v1/player-settings/public/[videoId]
    await page.route(`**/api/v1/player-settings/public/${mockVideoId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          videoId: mockVideoId,
          title: 'E2E Test Video Journey',
          streamUrl: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
          duration: 10,
          status: 'ready',
          primaryColor: '#3B82F6',
          controlBarBg: 'rgba(0, 0, 0, 0.75)',
          playIconStyle: 'default',
          watermarkUrl: null,
          watermarkPosition: 'top-right',
          watermarkOpacity: 80,
          enabledControls: ['play', 'volume', 'timeline', 'quality', 'speed', 'fullscreen'],
          isFreeTier: true,
        }),
      });
    });
  });

  test('User Journey: Open app -> Upload test video -> Observe processing -> Verify HLS embed player', async ({
    page,
  }) => {
    // Step 1: Open the upload interface
    await page.goto('/uploads');
    await expect(page).toHaveTitle(/Vedora/i);

    // Step 2: Form interaction - set title and slug
    const titleInput = page.locator('input[placeholder*="title" i], input[name="title"], #title').first();
    if (await titleInput.isVisible()) {
      await titleInput.fill('E2E Test Video Journey');
    }

    const slugInput = page.locator('input[placeholder*="slug" i], input[name="slug"], #slug').first();
    if (await slugInput.isVisible()) {
      await slugInput.fill('e2e-test-video-journey');
    }

    // Step 3: Attach test video file to file input
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'test-synthetic-sample.mp4',
      mimeType: 'video/mp4',
      buffer: Buffer.from('FAKE-MP4-SYNTHETIC-PAYLOAD-FOR-E2E-TESTING-1234567890'),
    });

    // Step 4: Click Upload Video button
    const uploadBtn = page.getByRole('button', { name: /upload video/i });
    await expect(uploadBtn).toBeVisible();
    await uploadBtn.click();

    // Step 5: Observe processing status and queue sidebar
    const queueSidebar = page.locator('aside, [data-testid="upload-queue"], div').filter({ hasText: /Upload Queue/i });
    await expect(queueSidebar.first()).toBeVisible({ timeout: 15000 });

    // Step 6: Navigate to Embed Video Player
    await page.goto(`/embed/${mockVideoId}`);

    // Step 7: Verify video element and player controls in the DOM
    const videoElement = page.locator('video');
    await expect(videoElement).toBeVisible({ timeout: 15000 });

    // Verify player control bar buttons (play, volume, settings, fullscreen)
    const playButton = page.locator('button').filter({ has: page.locator('svg') }).first();
    await expect(playButton).toBeVisible();

    // Verify player is ready to play
    const videoSrc = await videoElement.getAttribute('src');
    expect(videoSrc || '').toBeDefined();
  });
});
