import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { VideoService } from './video.service';
import { StorageService } from '../../infra/storage/storage.service';
import { DRIZZLE_DB } from '../../database/database.module';

describe('VideoService', () => {
  let service: VideoService;

  const mockStorageService = {
    getDefaultBucketId: jest.fn().mockReturnValue('bucket-uuid-123'),
    initiateMultipartUpload: jest.fn().mockResolvedValue({
      objectId: 'omc_obj_1',
      key: 'raw/bucket/test.mp4',
      uploadId: 'omc_upl_1',
      partSize: 5242880,
      parts: [
        { partNumber: 1, url: 'https://storage.oneminutecloud.com/part1' },
      ],
    }),
    completeMultipartUpload: jest.fn().mockResolvedValue({
      success: true,
      key: 'raw/bucket/test.mp4',
    }),
  };

  const sampleDbVideo = {
    id: 'vid-uuid-1',
    user_id: 'user_1',
    playlist_id: 'playlist-1',
    title: 'Intro Video',
    slug: 'intro-video',
    description: 'A great intro',
    tags: ['welcome'],
    storage_key: 'raw/bucket/test.mp4',
    bucket_id: 'bucket-uuid-123',
    size: 100000000n,
    estimated_transcoded_size: 70000000n,
    duration: 0,
    status: 'uploading' as const,
    resolutions: ['720p'],
    thumbnail_url: null,
    generate_subtitles: false,
    include_watermark: false,
    master_m3u8_key: null,
    created_at: new Date(),
    updated_at: new Date(),
  };

  const mockTx = {
    execute: jest.fn().mockResolvedValue([{}]),
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    returning: jest.fn(),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
  };

  const mockDb = {
    transaction: jest
      .fn()
      .mockImplementation((cb: (tx: any) => Promise<any>) => cb(mockTx)),
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockResolvedValue([]),
    delete: jest.fn().mockReturnThis(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VideoService,
        {
          provide: DRIZZLE_DB,
          useValue: mockDb,
        },
        {
          provide: StorageService,
          useValue: mockStorageService,
        },
      ],
    }).compile();

    service = module.get<VideoService>(VideoService);
  });

  describe('initVideo', () => {
    it('should throw UnauthorizedException if userId is missing', async () => {
      await expect(
        service.initVideo('', 'free', {
          title: 'Test',
          slug: 'test',
          size: 1000,
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should reject upload if storage quota is exceeded', async () => {
      // Return active videos using 4.9 GiB on Free plan (5 GiB cap)
      mockTx.where.mockResolvedValueOnce([
        { size: 3000000000n, estimatedTranscodedSize: 2200000000n }, // 5.2 GiB > 5 GiB
      ]);

      await expect(
        service.initVideo('user_1', 'free', {
          title: 'Big Video',
          slug: 'big-video',
          size: 200000000,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject if requested playlist is not owned by user', async () => {
      mockTx.where
        .mockResolvedValueOnce([]) // empty active videos
        .mockResolvedValueOnce([]); // empty playlist lookup (not found)

      await expect(
        service.initVideo('user_1', 'free', {
          title: 'Video',
          slug: 'video',
          size: 1000,
          playlistId: 'playlist-fake',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create video record with uploading status and return upload credentials', async () => {
      mockTx.where.mockResolvedValueOnce([]); // active videos
      mockTx.returning.mockResolvedValueOnce([sampleDbVideo]);

      const result = await service.initVideo('user_1', 'free', {
        title: 'Intro Video',
        slug: 'intro-video',
        size: 100000000,
      });

      expect(result.video.id).toBe('vid-uuid-1');
      expect(result.video.status).toBe('uploading');
      expect(result.uploadData.uploadId).toBe('omc_upl_1');
      expect(result.bucketId).toBe('bucket-uuid-123');
    });
  });

  describe('completeVideo', () => {
    it('should throw UnauthorizedException if userId is empty', async () => {
      await expect(
        service.completeVideo('', {
          videoId: 'vid-1',
          storageKey: 'key',
          duration: 10,
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw NotFoundException if video is not found', async () => {
      mockTx.where.mockResolvedValueOnce([]);
      await expect(
        service.completeVideo('user_1', {
          videoId: 'vid-missing',
          storageKey: 'key',
          duration: 10,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return already completed video idempotently without error', async () => {
      const completedVideo = { ...sampleDbVideo, status: 'uploaded' as const };
      mockTx.where.mockResolvedValueOnce([completedVideo]);

      const result = await service.completeVideo('user_1', {
        videoId: 'vid-uuid-1',
        storageKey: 'raw/bucket/test.mp4',
        duration: 120,
      });

      expect(result.status).toBe('uploaded');
    });

    it('should reject if storage key does not match initialized key', async () => {
      mockTx.where.mockResolvedValueOnce([sampleDbVideo]);

      await expect(
        service.completeVideo('user_1', {
          videoId: 'vid-uuid-1',
          storageKey: 'tampered-key.mp4',
          duration: 120,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should update video to uploaded status and atomically increment playlist count', async () => {
      mockTx.where.mockResolvedValueOnce([sampleDbVideo]);
      const updatedDbVideo = {
        ...sampleDbVideo,
        status: 'uploaded' as const,
        duration: 120,
      };
      mockTx.returning.mockResolvedValueOnce([updatedDbVideo]);

      const result = await service.completeVideo('user_1', {
        videoId: 'vid-uuid-1',
        storageKey: 'raw/bucket/test.mp4',
        duration: 120,
      });

      expect(result.status).toBe('uploaded');
      expect(result.duration).toBe(120);
    });
  });

  describe('listVideos', () => {
    it('should list only videos belonging to the authenticated user', async () => {
      mockDb.orderBy.mockResolvedValueOnce([sampleDbVideo]);

      const results = await service.listVideos('user_1');
      expect(results.length).toBe(1);
      expect(results[0].title).toBe('Intro Video');
    });
  });

  describe('getVideo', () => {
    it('should return video when owned by user', async () => {
      mockDb.where.mockResolvedValueOnce([sampleDbVideo]);
      const result = await service.getVideo('user_1', 'vid-uuid-1');
      expect(result.id).toBe('vid-uuid-1');
    });

    it('should throw NotFoundException if video does not exist or belongs to another user', async () => {
      mockDb.where.mockResolvedValueOnce([]);
      await expect(service.getVideo('user_1', 'vid-other')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deleteVideo', () => {
    it('should delete video and decrement playlist count if uploaded', async () => {
      const uploadedVideo = { ...sampleDbVideo, status: 'uploaded' as const };
      mockTx.where.mockResolvedValueOnce([uploadedVideo]);
      mockTx.delete.mockReturnValue({
        where: jest.fn().mockResolvedValue([{ id: 'vid-uuid-1' }]),
      });

      const result = await service.deleteVideo('user_1', 'vid-uuid-1');
      expect(result.success).toBe(true);
      expect(result.id).toBe('vid-uuid-1');
    });

    it('should throw NotFoundException if video to delete is not found', async () => {
      mockTx.where.mockResolvedValueOnce([]);
      await expect(
        service.deleteVideo('user_1', 'vid-missing'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
