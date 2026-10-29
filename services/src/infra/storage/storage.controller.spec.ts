import { Test, TestingModule } from '@nestjs/testing';
import * as fs from 'fs';
import * as path from 'path';
import { PassThrough } from 'stream';
import { StorageController } from './storage.controller';
import { DRIZZLE_DB } from '../../database/database.module';

describe('StorageController HLS Delivery', () => {
  let controller: StorageController;
  let objectsDir: string;
  let testMasterKey: string;
  let testVariantKey: string;
  let testSegmentKey: string;

  const createMockResponse = () => {
    const res = new PassThrough() as any;
    res.headers = {};
    res.statusCode = 200;
    res.setHeader = jest.fn((k: string, v: any) => {
      res.headers[k] = v;
    });
    res.status = jest.fn((code: number) => {
      res.statusCode = code;
      return res;
    });
    res.json = jest.fn((data: any) => {
      res.jsonData = data;
      return res;
    });
    res.redirect = jest.fn();
    return res;
  };

  beforeAll(() => {
    objectsDir = path.join(process.cwd(), 'storage_local', 'objects');
    fs.mkdirSync(objectsDir, { recursive: true });

    testMasterKey = 'videos/test-hls-vid/master.m3u8';
    testVariantKey = 'videos/test-hls-vid/720p/index.m3u8';
    testSegmentKey = 'videos/test-hls-vid/720p/segment_000.ts';

    // Write real sample files in storage_local/objects
    fs.writeFileSync(
      path.join(objectsDir, testMasterKey.replace(/[/\\]/g, '_')),
      '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720\n720p/index.m3u8\n',
    );
    fs.writeFileSync(
      path.join(objectsDir, testVariantKey.replace(/[/\\]/g, '_')),
      '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:4\n#EXTINF:4.000,\nsegment_000.ts\n#EXT-X-ENDLIST\n',
    );
    fs.writeFileSync(
      path.join(objectsDir, testSegmentKey.replace(/[/\\]/g, '_')),
      Buffer.from([0x47, 0x40, 0x00, 0x10, 0x00, 0x00, 0xb0, 0x0d]), // MPEG-TS sync byte 0x47
    );
  });

  afterAll(async () => {
    // Wait briefly for read streams to finish closing before deleting
    await new Promise((r) => setTimeout(r, 200));
    try {
      const f1 = path.join(objectsDir, testMasterKey.replace(/[/\\]/g, '_'));
      const f2 = path.join(objectsDir, testVariantKey.replace(/[/\\]/g, '_'));
      const f3 = path.join(objectsDir, testSegmentKey.replace(/[/\\]/g, '_'));
      if (fs.existsSync(f1)) fs.unlinkSync(f1);
      if (fs.existsSync(f2)) fs.unlinkSync(f2);
      if (fs.existsSync(f3)) fs.unlinkSync(f3);
    } catch {
      // Best effort cleanup
    }
  });

  beforeEach(async () => {
    const mockDb = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StorageController],
      providers: [{ provide: DRIZZLE_DB, useValue: mockDb }],
    }).compile();

    controller = module.get<StorageController>(StorageController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should deliver HLS master playlist with application/vnd.apple.mpegurl MIME type', async () => {
    const mockRes = createMockResponse();
    const mockReq: any = {
      url: `/api/v1/storage/hls/${testMasterKey}`,
      headers: {},
    };

    await controller.handleHlsStream(mockReq, mockRes);

    expect(mockRes.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/vnd.apple.mpegurl',
    );
    expect(mockRes.status).toHaveBeenCalledWith(200);
  });

  it('should deliver HLS variant playlist with application/vnd.apple.mpegurl MIME type', async () => {
    const mockRes = createMockResponse();
    const mockReq: any = {
      url: `/api/v1/storage/hls/${testVariantKey}`,
      headers: {},
    };

    await controller.handleHlsStream(mockReq, mockRes);

    expect(mockRes.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/vnd.apple.mpegurl',
    );
    expect(mockRes.status).toHaveBeenCalledWith(200);
  });

  it('should deliver media segments with video/mp2t MIME type', async () => {
    const mockRes = createMockResponse();
    const mockReq: any = {
      url: `/api/v1/storage/hls/${testSegmentKey}`,
      headers: {},
    };

    await controller.handleHlsStream(mockReq, mockRes);

    expect(mockRes.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'video/mp2t',
    );
    expect(mockRes.status).toHaveBeenCalledWith(200);
  });

  it('should return HTTP 206 Partial Content when Range header is provided for segment seeking', async () => {
    const mockRes = createMockResponse();
    const mockReq: any = {
      url: `/api/v1/storage/hls/${testSegmentKey}`,
      headers: { range: 'bytes=0-3' },
    };

    await controller.handleHlsStream(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(206);
    expect(mockRes.headers['Content-Range']).toMatch(/^bytes 0-3\/\d+/);
    expect(mockRes.headers['Content-Length']).toBe(4);
  });

  it('should return 404 Not Found rather than redirecting for missing .ts segments', async () => {
    const mockRes = createMockResponse();
    const mockReq: any = {
      url: '/api/v1/storage/hls/videos/non-existent/720p/segment_999.ts',
      headers: {},
    };

    await controller.handleHlsStream(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(404);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        error: 'Not Found',
      }),
    );
    expect(mockRes.redirect).not.toHaveBeenCalled();
  });

  it('should return 404 Not Found rather than redirecting for missing .m3u8 playlists', async () => {
    const mockRes = createMockResponse();
    const mockReq: any = {
      url: '/api/v1/storage/hls/videos/non-existent/master.m3u8',
      headers: {},
    };

    await controller.handleHlsStream(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(404);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
      }),
    );
    expect(mockRes.redirect).not.toHaveBeenCalled();
  });

  it('should return 400 Bad Request when HLS path key is missing', async () => {
    const mockRes = createMockResponse();
    const mockReq: any = {
      url: '/api/v1/storage/hls/',
      headers: {},
    };

    await controller.handleHlsStream(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'HLS path key is required',
      }),
    );
  });

  it('should return 404 Not Found rather than redirecting to sample video for non-existent video files', async () => {
    const mockRes = createMockResponse();
    const mockReq: any = {
      url: '/api/v1/storage/stream?key=videos/non-existent.mp4',
      headers: {},
    };

    await controller.handleStreamVideo('videos/non-existent.mp4', mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(404);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        error: 'Not Found',
      }),
    );
    expect(mockRes.redirect).not.toHaveBeenCalled();
  });
});
