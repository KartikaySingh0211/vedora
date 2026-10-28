import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { DRIZZLE_DB } from '../../database/database.module';
import { RedisService } from '../../infra/redis/redis.service';

describe('HealthController', () => {
  let controller: HealthController;
  let mockDb: any;
  let mockRedisService: any;

  beforeEach(async () => {
    mockDb = {
      execute: jest.fn().mockResolvedValue([{ 1: 1 }]),
    };

    mockRedisService = {
      isHealthy: jest.fn().mockReturnValue(true),
      ping: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: DRIZZLE_DB, useValue: mockDb },
        { provide: RedisService, useValue: mockRedisService },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return status ok and 200 when database and redis are up', async () => {
    const mockRes: any = {
      status: jest.fn(),
    };

    const result = await controller.checkHealth(mockRes);

    expect(result.status).toBe('ok');
    expect(result.dependencies.database).toBe('up');
    expect(result.dependencies.redis).toBe('up');
    expect(mockRes.status).not.toHaveBeenCalledWith(503);
  });

  it('should return status degraded and 503 when database is down', async () => {
    mockDb.execute.mockRejectedValueOnce(new Error('Connection timeout'));
    const mockRes: any = {
      status: jest.fn(),
    };

    const result = await controller.checkHealth(mockRes);

    expect(result.status).toBe('degraded');
    expect(result.dependencies.database).toBe('down');
    expect(mockRes.status).toHaveBeenCalledWith(503);
  });

  it('should report fallback active when redis ping fails', async () => {
    mockRedisService.ping.mockResolvedValueOnce(false);
    mockRedisService.isHealthy.mockReturnValueOnce(false);
    const mockRes: any = {
      status: jest.fn(),
    };

    const result = await controller.checkHealth(mockRes);

    expect(result.status).toBe('ok'); // DB is up, so system is operational with DB fallback
    expect(result.dependencies.redis).toContain('fallback to db active');
  });
});

