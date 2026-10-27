import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BillingWebhookDto {
  @ApiProperty({
    description: 'Stripe webhook event type name',
    example: 'customer.subscription.updated',
    enum: [
      'customer.subscription.updated',
      'customer.subscription.deleted',
      'invoice.paid',
    ],
  })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiProperty({
    description: 'Stripe event data payload containing event object',
    example: {
      object: {
        id: 'sub_1Q123456789',
        customer: 'cus_123456789',
        status: 'active',
        current_period_start: 1730000000,
        current_period_end: 1732678400,
      },
    },
  })
  @IsObject()
  @IsNotEmpty()
  data: {
    object: Record<string, any>;
  };

  @ApiPropertyOptional({
    description: 'Unique Stripe event identifier',
    example: 'evt_1Qabcdef123456',
  })
  @IsString()
  @IsOptional()
  id?: string;
}
