import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdatePlaylistDto {
  @ApiPropertyOptional({
    description: 'Updated name of the playlist',
    example: 'Advanced Frontend Development',
  })
  @IsString()
  @IsOptional()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    description: 'Updated description of the playlist',
    example: 'Updated playlist notes and documentation',
  })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;
}
