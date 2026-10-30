/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { PlayerSettingsService } from './player-settings.service';
import { DRIZZLE_DB } from '../../database/database.module';
import { StorageService } from '../../infra/storage/storage.service';
import { ConfigService } from '@nestjs/config';

describe('PlayerSettingsService', () => {
  let service: PlayerSettingsService;
  let mockDb: any;
  let mockStorageService: any;

  const mockSettings = {
    id: 'ps-1',
    user_id: 'user_1',
    primary_color: '#2563eb',
    control_bar_bg: 'rgba(0, 0, 0, 0.7)',
    play_icon_style: 'default',
    watermark_url: 'https://cdn.example.com/logo.png',
    watermark_position: 'top-right',
    watermark_opacity: 80,
    enable_subtitles: true,
    enabled_controls: ['Play / Pause', 'Full Screen'],
  };

  beforeEach(async () => {
    mockDb = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([mockSettings]),
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      returning: jest.fn().mockResolvedValue([mockSettings]),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
    };

    mockStorageService = {
      getPublicUrl: jest.fn((key: string) => `https://cdn.vedora.com/${key}`),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlayerSettingsService,
        { provide: DRIZZLE_DB, useValue: mockDb },
        { provide: StorageService, useValue: mockStorageService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((k: string) =>
              k === 'storage.cdnUrl' ? 'https://cdn.vedora.com' : undefined,
            ),
          },
        },
      ],
    }).compile();

    service = module.get<PlayerSettingsService>(PlayerSettingsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getSettings', () => {
    it('should return existing player settings for user', async () => {
      const res = await service.getSettings('user_1');
      expect(res).toEqual(mockSettings);
      expect(mockDb.select).toHaveBeenCalled();
    });

    it('should insert default settings if not existing', async () => {
      mockDb.limit.mockResolvedValueOnce([]); // no existing settings
      const res = await service.getSettings('user_2');
      expect(mockDb.insert).toHaveBeenCalled();
      expect(res).toBeDefined();
    });
  });

  describe('updateSettings', () => {
    it('should update provided fields and return updated settings', async () => {
      mockDb.returning.mockResolvedValueOnce([
        { ...mockSettings, primary_color: '#10b981' },
      ]);

      const res = await service.updateSettings('user_1', {
        primaryColor: '#10b981',
      });

      expect(res.primary_color).toBe('#10b981');
      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  describe('getPublicPlayerConfig', () => {
    it('should default to "Powered by Vedora" text when no custom watermark is configured', async () => {
      const video = {
        id: '00000000-0000-0000-0000-000000000001',
        user_id: 'user_1',
        title: 'Video without custom watermark',
        duration: 120,
        status: 'ready',
        master_m3u8_key: 'videos/vid-1/master.m3u8',
      };

      const settingsWithoutWatermark = {
        ...mockSettings,
        watermark_url: null,
      };

      // 1. video query
      // 2. settings query
      mockDb.limit
        .mockResolvedValueOnce([video])
        .mockResolvedValueOnce([settingsWithoutWatermark]);

      const config = await service.getPublicPlayerConfig(video.id);

      expect(config.watermarkText).toBe('Powered by Vedora');
      expect(config.watermarkUrl).toBeNull();
      expect(config.streamUrl).toBe(
        'https://cdn.vedora.com/videos/vid-1/master.m3u8',
      );
    });

    it('should serve custom watermark URL when configured', async () => {
      const video = {
        id: '00000000-0000-0000-0000-000000000002',
        user_id: 'user_2',
        title: 'Video with custom watermark',
        duration: 240,
        status: 'ready',
        master_m3u8_key: 'videos/vid-2/master.m3u8',
      };

      mockDb.limit
        .mockResolvedValueOnce([video])
        .mockResolvedValueOnce([mockSettings]);

      const config = await service.getPublicPlayerConfig(video.id);

      expect(config.watermarkText).toBeNull();
      expect(config.watermarkUrl).toBe('https://cdn.example.com/logo.png');
    });

    it('should fallback to storage_key when master_m3u8_key is null', async () => {
      const video = {
        id: '00000000-0000-0000-0000-000000000003',
        user_id: 'user_3',
        title: 'Raw Uploaded Video',
        duration: 60,
        status: 'uploaded',
        master_m3u8_key: null,
        storage_key: 'videos/vid-3/raw.mp4',
      };

      mockDb.limit
        .mockResolvedValueOnce([video])
        .mockResolvedValueOnce([mockSettings]);

      const config = await service.getPublicPlayerConfig(video.id);

      expect(config.streamUrl).toBe(
        'https://cdn.vedora.com/videos/vid-3/raw.mp4',
      );
    });

    it('should return resilient default player configuration if database settings retrieval fails', async () => {
      const video = {
        id: '00000000-0000-0000-0000-000000000004',
        user_id: 'user_4',
        title: 'Resilient Video',
        duration: 90,
        status: 'ready',
        master_m3u8_key: 'videos/vid-4/master.m3u8',
      };

      mockDb.limit
        .mockResolvedValueOnce([video])
        .mockRejectedValueOnce(new Error('DB connection drop'));

      const config = await service.getPublicPlayerConfig(video.id);

      expect(config.primaryColor).toBe('#2563eb');
      expect(config.watermarkText).toBe('Powered by Vedora');
      expect(config.streamUrl).toBe(
        'https://cdn.vedora.com/videos/vid-4/master.m3u8',
      );
    });
  });
});
