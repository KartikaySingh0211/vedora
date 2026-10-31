import { test, expect } from '@playwright/test';

test.describe('Dashboard CI Smoke Suite', () => {
  test.beforeEach(async ({ page }) => {
    // Mock Clerk client SDK session endpoint to run deterministically without external network calls
    await page.route('**/v1/client/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          response: {
            sessions: [
              {
                id: 'sess_smoke_test',
                status: 'active',
                user: { id: 'user_smoke_tester', firstName: 'Vedora', lastName: 'Tester' },
              },
            ],
          },
        }),
      });
    });
  });

  test('Smoke: Upload Studio UI renders expected inputs and controls', async ({ page }) => {
    await page.goto('/uploads');
    await expect(page).toHaveTitle(/Vedora/i);

    // Verify file dropzone or upload form element exists
    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toHaveCount(1);

    // Verify upload button exists
    const uploadButton = page.getByRole('button', { name: /upload video/i });
    await expect(uploadButton).toBeVisible();
  });

  test('Smoke: Standalone Embed Player page loads viewport and video container', async ({ page }) => {
    await page.goto('/embed/smoke-test-video-id');

    // Embed player loads viewport with player controls
    const playButton = page.getByRole('button', { name: /play/i }).first();
    await expect(playButton).toBeVisible();
  });

  test('Smoke: Custom Player Settings page renders preview and styling controls', async ({ page }) => {
    await page.goto('/player');
    await expect(page).toHaveTitle(/Vedora/i);

    // Verify page header or preview player container is visible
    const previewContainer = page.locator('h1, h2, div').filter({ hasText: /Player/i }).first();
    await expect(previewContainer).toBeVisible();
  });
});
