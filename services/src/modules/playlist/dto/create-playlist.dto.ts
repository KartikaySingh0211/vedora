import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePlaylistDto {
  @ApiProperty({
    description: 'Name of the playlist',
    example: 'Frontend Development',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({
    description: 'Optional description of the playlist',
    example: 'Tutorials and guides for modern frontend web development',
  })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;
}
