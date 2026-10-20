import { IsInt, IsNotEmpty, IsString, IsUUID, Max, Min } from 'class-validator';

export class SegmentPingDto {
  @IsUUID('4', { message: 'videoId must be a valid UUIDv4' })
  @IsNotEmpty()
  videoId: string;

  @IsString()
  @IsNotEmpty()
  sessionId: string;

  @IsInt()
  @Min(1)
  @Max(60) // Enforce server-side bounds to prevent duration inflation
  watchDurationSeconds: number;

  @IsInt()
  @Min(1)
  @Max(20)
  segmentsRequested: number;
}
