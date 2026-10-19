import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PlaylistService } from './playlist.service';
import { DRIZZLE_DB } from '../../database/database.module';

describe('PlaylistService', () => {
  let service: PlaylistService;

  const mockTx = {
    execute: jest.fn().mockResolvedValue([{}]),
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    returning: jest.fn(),
  };

  const mockDb = {
    transaction: jest
      .fn()
      .mockImplementation((cb: (tx: any) => Promise<any>) => cb(mockTx)),
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockResolvedValue([]),
    limit: jest.fn(),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    returning: jest.fn(),
    delete: jest.fn().mockReturnValue({
      where: jest.fn().mockResolvedValue([{ id: 'p1' }]),
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlaylistService,
        {
          provide: DRIZZLE_DB,
          useValue: mockDb,
        },
      ],
    }).compile();

    service = module.get<PlaylistService>(PlaylistService);
  });

  describe('createPlaylist', () => {
    it('should throw UnauthorizedException if userId is missing', async () => {
      await expect(
        service.createPlaylist('', { name: 'Tutorials' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should create playlist when current user count is below limit (10)', async () => {
      const userId = 'user_1';
      // User currently has 2 playlists
      mockTx.where.mockResolvedValueOnce([{ value: 2 }]);
      const mockCreated = {
        id: 'pl-uuid-1',
        user_id: userId,
        name: 'Tutorials',
        description: 'Frontend guides',
        playlist_limit: 10,
        total_videos: 0,
        created_at: new Date(),
      };
      mockTx.returning.mockResolvedValueOnce([mockCreated]);

      const result = await service.createPlaylist(userId, {
        name: 'Tutorials',
        description: 'Frontend guides',
      });

      expect(mockTx.execute).toHaveBeenCalled(); // Advisory lock executed
      expect(result.id).toBe('pl-uuid-1');
      expect(result.name).toBe('Tutorials');
      expect(result.playlistLimit).toBe(10);
      expect(result.totalVideos).toBe(0);
    });

    it('should reject creation with BadRequestException when playlist limit (10) is reached', async () => {
      const userId = 'user_at_limit';
      // User currently has 10 playlists
      mockTx.where.mockResolvedValueOnce([{ value: 10 }]);

      await expect(
        service.createPlaylist(userId, { name: '11th Playlist' }),
      ).rejects.toThrow(BadRequestException);

      expect(mockTx.insert).not.toHaveBeenCalled();
    });
  });

  describe('listPlaylists', () => {
    it('should list only playlists belonging to the authenticated user', async () => {
      const userId = 'user_1';
      const mockList = [
        {
          id: 'p1',
          user_id: userId,
          name: 'React 19',
          description: null,
          playlist_limit: 10,
          total_videos: 5,
          created_at: new Date(),
        },
      ];
      mockDb.orderBy.mockResolvedValueOnce(mockList);

      const result = await service.listPlaylists(userId);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('React 19');
      expect(mockDb.where).toHaveBeenCalled();
    });
  });

  describe('getPlaylist', () => {
    it('should return playlist when found and owned by the user', async () => {
      const userId = 'user_1';
      mockDb.limit.mockResolvedValueOnce([
        {
          id: 'p1',
          user_id: userId,
          name: 'My Playlist',
          description: 'Desc',
          playlist_limit: 10,
          total_videos: 2,
          created_at: new Date(),
        },
      ]);

      const result = await service.getPlaylist(userId, 'p1');
      expect(result.id).toBe('p1');
      expect(result.name).toBe('My Playlist');
    });

    it('should throw NotFoundException if playlist does not exist or belongs to another user', async () => {
      mockDb.limit.mockResolvedValueOnce([]); // No match for (id AND user_id)

      await expect(
        service.getPlaylist('user_attacker', 'p_victim'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updatePlaylist', () => {
    it('should update playlist when owned by user', async () => {
      const userId = 'user_1';
      // Verification check returns playlist
      mockDb.limit.mockResolvedValueOnce([
        {
          id: 'p1',
          user_id: userId,
          name: 'Old Name',
          description: null,
          playlist_limit: 10,
          total_videos: 0,
          created_at: new Date(),
        },
      ]);

      // Update returns updated playlist
      mockDb.returning.mockResolvedValueOnce([
        {
          id: 'p1',
          user_id: userId,
          name: 'New Name',
          description: 'Updated Desc',
          playlist_limit: 10,
          total_videos: 0,
          created_at: new Date(),
        },
      ]);

      const result = await service.updatePlaylist(userId, 'p1', {
        name: 'New Name',
        description: 'Updated Desc',
      });

      expect(result.name).toBe('New Name');
      expect(result.description).toBe('Updated Desc');
    });

    it('should throw NotFoundException when trying to update another users playlist', async () => {
      mockDb.limit.mockResolvedValueOnce([]); // Not found for attacker

      await expect(
        service.updatePlaylist('attacker_id', 'p_victim', { name: 'Hacked' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deletePlaylist', () => {
    it('should delete playlist when owned by user', async () => {
      const userId = 'user_1';
      mockDb.limit.mockResolvedValueOnce([
        {
          id: 'p1',
          user_id: userId,
          name: 'To Delete',
          description: null,
          playlist_limit: 10,
          total_videos: 0,
          created_at: new Date(),
        },
      ]);

      const result = await service.deletePlaylist(userId, 'p1');
      expect(result).toEqual({ success: true, id: 'p1' });
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('should throw NotFoundException when trying to delete another users playlist', async () => {
      mockDb.limit.mockResolvedValueOnce([]); // Not found

      await expect(
        service.deletePlaylist('attacker_id', 'p_victim'),
      ).rejects.toThrow(NotFoundException);
      expect(mockDb.delete).not.toHaveBeenCalled();
    });
  });
});
