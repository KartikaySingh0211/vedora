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
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiHeader,
  ApiBearerAuth,
  ApiSecurity,
} from '@nestjs/swagger';
import { BillingService, SubscriptionResponse } from './billing.service';
import { BillingWebhookDto } from './dto/billing-webhook.dto';
import {
  BillingWebhookResponseDto,
  SubscriptionResponseDto,
} from './dto/subscription-response.dto';
import { DualAuthGuard } from '../../guards/dual-auth.guard';
import { CurrentUser } from '../../guards/current-user.decorator';
import { ErrorResponseDto } from '../../common/dto/error-response.dto';

@ApiTags('Billing')
@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Stripe webhook receiver for subscription events',
    description:
      'Processes asynchronous Stripe subscription lifecycle events (customer.subscription.updated, customer.subscription.deleted, invoice.paid). Validates stripe-signature header.',
  })
  @ApiHeader({
    name: 'stripe-signature',
    required: true,
    description:
      'Stripe webhook signature header generated with webhook secret',
    example: 't=1730000000,v1=5257a869e7eca...,v0=6ffbb59...',
  })
  @ApiOkResponse({
    description: 'Stripe webhook processed successfully',
    type: BillingWebhookResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid webhook signature or unrecognized event payload',
    type: ErrorResponseDto,
  })
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
  @ApiBearerAuth()
  @ApiSecurity('x-api-key')
  @ApiOperation({
    summary: 'Get current user subscription and playback minutes',
    description:
      'Fetches current plan tier (Free, Starter, Pro, Business), allocated playback minutes, used minutes, remaining minutes, usage percent, and storage cap.',
  })
  @ApiOkResponse({
    description:
      'Subscription details and playback quota returned successfully',
    type: SubscriptionResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Authentication required',
    type: ErrorResponseDto,
  })
  async getSubscription(
    @CurrentUser('id') userId: string,
  ): Promise<SubscriptionResponse> {
    return await this.billingService.getSubscription(userId);
  }
}
