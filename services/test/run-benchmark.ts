import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ConfigService } from '@nestjs/config';
import { FfmpegService } from '../src/modules/transcoder/ffmpeg.service';

interface BenchmarkResult {
  clipName: string;
  sourceResolution: string;
  sourceDurationSec: number;
  sourceSizeBytes: number;
  renditionsGenerated: string[];
  wallClockDurationMs: number;
  speedFactor: number;
  outputSizeBytes: number;
  compressionRatio: number;
  totalFilesGenerated: number;
  segmentCount: number;
  memoryRssDeltaMb: number;
}

async function runBenchmarks() {
  console.log('=== Vedora Empirical Transcoding Benchmark Suite ===\n');

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ffprobeInstaller = require('@ffprobe-installer/ffprobe');
  const ffmpegPath = ffmpegInstaller.path;
  const ffprobePath = ffprobeInstaller.path;

  const ffmpegVer = cp.execFileSync(ffmpegPath, ['-version']).toString('utf8').split('\n')[0];
  const cpus = os.cpus();
  const cpuModel = cpus.length > 0 ? cpus[0].model : 'Unknown';
  const cpuCores = cpus.length;
  const totalMemGb = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);

  console.log('Environment Specifications:');
  console.log(`- Host OS: ${os.type()} ${os.release()} (${os.arch()})`);
  console.log(`- CPU: ${cpuModel} (${cpuCores} logical threads)`);
  console.log(`- Total RAM: ${totalMemGb} GB`);
  console.log(`- Node.js: ${process.version}`);
  console.log(`- FFmpeg: ${ffmpegVer}`);
  console.log('');

  const benchDir = path.join(os.tmpdir(), `vedora-benchmarks-${Date.now()}`);
  fs.mkdirSync(benchDir, { recursive: true });

  const configService = new ConfigService();
  const ffmpegService = new FfmpegService(configService);

  const testMatrix = [
    { name: 'Standard 360p Short Clip', width: 640, height: 360, duration: 10, maxQuality: '360p' },
    { name: 'Adaptive 720p HD Clip', width: 1280, height: 720, duration: 10, maxQuality: '720p' },
    { name: 'Full Ladder 1080p FHD Clip', width: 1920, height: 1080, duration: 10, maxQuality: '1080p' },
  ];

  const results: BenchmarkResult[] = [];

  for (const matrix of testMatrix) {
    console.log(`Running benchmark: ${matrix.name} (${matrix.width}x${matrix.height}, ${matrix.duration}s)...`);
    const inputPath = path.join(benchDir, `input-${matrix.maxQuality}.mp4`);
    const outputDir = path.join(benchDir, `output-${matrix.maxQuality}`);
    fs.mkdirSync(outputDir, { recursive: true });

    // 1. Synthesize standardized test clip with real audio
    cp.execFileSync(ffmpegPath, [
      '-y',
      '-f', 'lavfi', '-i', `testsrc=duration=${matrix.duration}:size=${matrix.width}x${matrix.height}:rate=30`,
      '-f', 'lavfi', '-i', `sine=frequency=1000:duration=${matrix.duration}`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      inputPath,
    ]);

    const inputSizeBytes = fs.statSync(inputPath).size;

    // 2. Probe media
    const probe = await ffmpegService.probeMedia(inputPath);
    const renditions = ffmpegService.selectRenditions(probe, [matrix.maxQuality]);

    // 3. Transcode with timing & memory measurement
    const initialMem = process.memoryUsage().rss;
    const startHr = process.hrtime.bigint();

    const jobResult = await ffmpegService.transcodeToHls({
      inputPath,
      outputDir,
      videoId: `bench-${matrix.maxQuality}`,
      probe,
      renditions,
    });

    const endHr = process.hrtime.bigint();
    const finalMem = process.memoryUsage().rss;

    const wallClockMs = Number(endHr - startHr) / 1_000_000;
    const speedFactor = matrix.duration / (wallClockMs / 1000);
    const outputSizeBytes = Number(jobResult.totalTranscodedBytes);
    const compressionRatio = outputSizeBytes / inputSizeBytes;
    const segmentCount = jobResult.generatedFiles.filter((f) => f.relativePath.endsWith('.ts')).length;

    results.push({
      clipName: matrix.name,
      sourceResolution: `${matrix.width}x${matrix.height}`,
      sourceDurationSec: matrix.duration,
      sourceSizeBytes: inputSizeBytes,
      renditionsGenerated: renditions.map((r) => r.name),
      wallClockDurationMs: Math.round(wallClockMs),
      speedFactor: Number(speedFactor.toFixed(2)),
      outputSizeBytes,
      compressionRatio: Number(compressionRatio.toFixed(3)),
      totalFilesGenerated: jobResult.generatedFiles.length + 1, // +1 for master.m3u8
      segmentCount,
      memoryRssDeltaMb: Number(((finalMem - initialMem) / 1024 / 1024).toFixed(2)),
    });

    console.log(`  -> Completed in ${Math.round(wallClockMs)}ms (speed: ${speedFactor.toFixed(2)}x, files: ${jobResult.generatedFiles.length + 1})\n`);
  }

  // Cleanup benchmark dir
  try {
    fs.rmSync(benchDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup
  }

  console.log('### Benchmark Summary Table\n');
  console.log('| Workload Profile | Input Resolution | Input Duration | Rendition Ladder | Transcode Time | Speed Factor | Total HLS Output | Segments | RSS Delta |');
  console.log('| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |');
  for (const r of results) {
    console.log(
      `| ${r.clipName} | ${r.sourceResolution} | ${r.sourceDurationSec}s | ${r.renditionsGenerated.join(', ')} | ${r.wallClockDurationMs}ms | **${r.speedFactor}x** | ${(r.outputSizeBytes / 1024).toFixed(1)} KB | ${r.segmentCount} chunks | ${r.memoryRssDeltaMb} MB |`
    );
  }

  console.log('\nJSON Output:');
  console.log(JSON.stringify({
    environment: {
      os: `${os.type()} ${os.release()} (${os.arch()})`,
      cpu: `${cpuModel} (${cpuCores} logical threads)`,
      ramGb: totalMemGb,
      node: process.version,
      ffmpeg: ffmpegVer,
    },
    results,
  }, null, 2));
}

runBenchmarks().catch(console.error);
