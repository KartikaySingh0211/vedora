import { detectBrowser, detectDevice, cleanReferrer } from './user-agent.util';

describe('UserAgent Utilities', () => {
  describe('detectBrowser', () => {
    it('should identify Chrome', () => {
      expect(
        detectBrowser(
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ),
      ).toBe('Chrome');
    });

    it('should identify Edge', () => {
      expect(
        detectBrowser(
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
        ),
      ).toBe('Edge');
    });

    it('should identify Safari', () => {
      expect(
        detectBrowser(
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        ),
      ).toBe('Safari');
    });

    it('should identify Firefox', () => {
      expect(
        detectBrowser(
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
        ),
      ).toBe('Firefox');
    });

    it('should fallback to Other for unknown or empty user agents', () => {
      expect(detectBrowser('')).toBe('Other');
      expect(detectBrowser('CustomBot/1.0')).toBe('Other');
      expect(detectBrowser(undefined)).toBe('Other');
    });
  });

  describe('detectDevice', () => {
    it('should identify mobile devices', () => {
      expect(
        detectDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'),
      ).toBe('mobile');
      expect(
        detectDevice('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari'),
      ).toBe('mobile');
    });

    it('should identify tablet devices', () => {
      expect(
        detectDevice('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)'),
      ).toBe('tablet');
      expect(
        detectDevice('Mozilla/5.0 (PlayBook; U; RIM Tablet OS 2.1.0)'),
      ).toBe('tablet');
    });

    it('should fallback to desktop for standard desktop or empty user agents', () => {
      expect(detectDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(
        'desktop',
      );
      expect(detectDevice('')).toBe('desktop');
      expect(detectDevice(undefined)).toBe('desktop');
    });
  });

  describe('cleanReferrer', () => {
    it('should extract hostname without www prefix', () => {
      expect(cleanReferrer('https://www.youtube.com/watch?v=123')).toBe(
        'youtube.com',
      );
      expect(cleanReferrer('http://subdomain.example.org/path')).toBe(
        'subdomain.example.org',
      );
    });

    it('should return direct for empty or undefined referrers', () => {
      expect(cleanReferrer('')).toBe('direct');
      expect(cleanReferrer(undefined)).toBe('direct');
    });

    it('should return direct for malformed URLs', () => {
      expect(cleanReferrer('not a valid url')).toBe('direct');
    });
  });
});
