import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { BillingService, SubscriptionResponse } from './billing.service';
import { BillingWebhookDto } from './dto/billing-webhook.dto';
import { DualAuthGuard } from '../../guards/dual-auth.guard';
import { CurrentUser } from '../../guards/current-user.decorator';

@ApiTags('Billing')
@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stripe webhook receiver for subscription events' })
  @ApiResponse({ status: 200, description: 'Webhook processed' })
  async handleWebhook(
    @Headers('stripe-signature') signature: string | undefined,
    @Body() payload: BillingWebhookDto,
  ): Promise<{ success: boolean; event: string }> {
    const rawBody = JSON.stringify(payload);
    return await this.billingService.handleStripeWebhook(
      signature,
      rawBody,
      payload,
    );
  }

  @Get('subscription')
  @UseGuards(DualAuthGuard)
  @ApiOperation({
    summary: 'Get current user subscription and playback minutes',
  })
  @ApiResponse({ status: 200, description: 'Subscription details returned' })
  async getSubscription(
    @CurrentUser('id') userId: string,
  ): Promise<SubscriptionResponse> {
    return await this.billingService.getSubscription(userId);
  }
}
