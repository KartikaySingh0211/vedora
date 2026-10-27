import { ApiProperty } from '@nestjs/swagger';

export class SubscriptionResponseDto {
  @ApiProperty({
    description: 'Unique UUIDv4 identifier of the subscription record',
    example: 'sub_rec_1234567890',
  })
  id: string;

  @ApiProperty({
    description: 'User ID of the subscriber',
    example: 'user_2NNEqL2Kz9X4abcdef123456',
  })
  userId: string;

  @ApiProperty({
    description: 'Subscription tier name',
    example: 'pro',
    enum: ['free', 'starter', 'pro', 'business'],
  })
  plan: string;

  @ApiProperty({
    description: 'Display name for the subscription tier',
    example: 'Pro Plan',
  })
  displayName: string;

  @ApiProperty({
    description: 'Lifecycle status of the subscription',
    example: 'active',
    enum: ['active', 'past_due', 'canceled', 'trialing'],
  })
  status: string;

  @ApiProperty({
    description: 'Total monthly playback minutes allocated for this tier',
    example: 10000,
  })
  allocatedMinutes: number;

  @ApiProperty({
    description:
      'Total playback minutes consumed by viewers in current billing cycle',
    example: 1833,
  })
  usedMinutes: number;

  @ApiProperty({
    description:
      'Remaining playback minutes available in current billing cycle',
    example: 8167,
  })
  remainingMinutes: number;

  @ApiProperty({
    description: 'Playback minutes consumption percentage (0 to 100)',
    example: 18,
  })
  usagePercent: number;

  @ApiProperty({
    description: 'Storage quota cap in bytes represented as string',
    example: '26843545600',
  })
  storageCapBytes: string;

  @ApiProperty({
    description: 'Start date of the current billing cycle period',
    nullable: true,
    example: '2026-10-01T00:00:00.000Z',
  })
  currentPeriodStart: Date | null;

  @ApiProperty({
    description: 'Renewal or expiration date of current billing period',
    nullable: true,
    example: '2026-11-01T00:00:00.000Z',
  })
  currentPeriodEnd: Date | null;
}

export class BillingWebhookResponseDto {
  @ApiProperty({
    description: 'Whether Stripe webhook processing succeeded',
    example: true,
  })
  success: boolean;

  @ApiProperty({
    description: 'Handled event type or processing action',
    example: 'customer.subscription.updated',
  })
  event: string;
}
