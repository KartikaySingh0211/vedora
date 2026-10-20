import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class BillingWebhookDto {
  @IsString()
  @IsNotEmpty()
  type: string;

  @IsObject()
  @IsNotEmpty()
  data: {
    object: Record<string, any>;
  };

  @IsString()
  @IsOptional()
  id?: string;
}
