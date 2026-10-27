"use client";

import React, { useState } from "react";
import {
  CreditCard,
  ExternalLink,
  Zap,
} from "lucide-react";
import PaymentCard from "../../components/cards/payment.card";
import AddOnCard from "../../components/cards/addon.card";
import { useAuth, useUser } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { fetchWithAuth, SubscriptionItem } from "../../lib/api-client";
import { PageHeader } from "@/components/common";

interface FullSubscriptionItem extends SubscriptionItem {
  displayName?: string;
  remainingMinutes?: number;
  usagePercent?: number;
  storageCapBytes?: string;
}

export default function BillingPage() {
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");
  const { isLoaded } = useUser();
  const { getToken } = useAuth();

  const { data: subscription } = useQuery<FullSubscriptionItem>({
    queryKey: ["billing-subscription"],
    queryFn: async () => {
      const token = await getToken();
      return fetchWithAuth<FullSubscriptionItem>("/billing/subscription", token);
    },
    enabled: isLoaded,
  });

  if (!isLoaded) {
    return null;
  }

  const currentPlan = subscription?.plan?.toLowerCase() || "free";
  const allocatedMinutes = subscription?.allocatedMinutes || 1000;
  const usedMinutes = subscription?.usedMinutes || 0;
  const remainingMinutes = Math.max(0, allocatedMinutes - usedMinutes);
  const usagePercent =
    allocatedMinutes > 0
      ? Math.min(100, Math.round((usedMinutes / allocatedMinutes) * 100))
      : 0;

  const renewalDate = subscription?.currentPeriodEnd
    ? new Date(subscription.currentPeriodEnd).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "Next cycle";

  return (
    <div className="text-black dark:text-white">
      <PageHeader
        title="Billing & Subscriptions"
        description="Track your current subscription plan, playback minutes consumption, and storage allowances."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Billing" },
        ]}
      />

      {/* Current Active Plan & Playback Minutes Usage Card */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* Active Plan Overview */}
        <div className="rounded-xl p-5 border border-gray-200 dark:border-[#1f2023] dark:bg-[#101217] flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs uppercase tracking-wider font-semibold text-gray-400">
                Current Plan
              </span>
              <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 capitalize">
                {currentPlan} Tier
              </span>
            </div>
            <h2 className="text-2xl font-bold capitalize text-gray-900 dark:text-white mb-1">
              {currentPlan} Plan
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Billing cycle renews on {renewalDate}. Storage allocations do not expire monthly.
            </p>
          </div>
          <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <span className="text-xs text-gray-400">Status</span>
            <span className="text-xs font-semibold text-green-500 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              Active
            </span>
          </div>
        </div>

        {/* Playback Minutes Accounting */}
        <div className="lg:col-span-2 rounded-xl p-5 border border-gray-200 dark:border-[#1f2023] dark:bg-[#101217]">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-500" />
              <h3 className="text-sm font-semibold">Monthly Playback Minutes</h3>
            </div>
            <span className="text-xs font-mono text-gray-400">
              {usedMinutes.toLocaleString()} / {allocatedMinutes.toLocaleString()} min
            </span>
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            Aggregated from verified segment playback sessions. Resets on the first of each month.
          </p>

          {/* Progress Bar */}
          <div className="w-full bg-gray-200 dark:bg-gray-800 h-2.5 rounded-full overflow-hidden mb-3">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                usagePercent > 90
                  ? "bg-red-500"
                  : usagePercent > 75
                  ? "bg-amber-500"
                  : "bg-blue-600"
              }`}
              style={{ width: `${Math.max(2, usagePercent)}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>{usagePercent}% used</span>
            <span>{remainingMinutes.toLocaleString()} minutes remaining</span>
          </div>
        </div>
      </div>

      {/* Manage Billing Card */}
      <div className="flex items-center justify-between rounded-xl p-5 mb-8 border border-gray-200 dark:border-[#1f2023] dark:bg-[#101217]">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-50 dark:bg-blue-900/20">
            <CreditCard size={20} className="text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Payment & Customer Portal</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Manage your payment methods, past invoices, and billing details securely via Stripe.
            </p>
          </div>
        </div>
        <button
          onClick={() => {
            window.open("https://billing.stripe.com/p/login/test", "_blank");
          }}
          className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md border border-gray-300 dark:border-slate-800 hover:bg-gray-100 dark:hover:bg-slate-900/50 transition-colors"
        >
          <ExternalLink size={14} />
          Open Stripe Portal
        </button>
      </div>

      {/* Choose Plans Section */}
      <div className="dark:bg-[#101217] rounded-xl p-6 mb-8 border border-gray-200 dark:border-[#1f2023]">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
            Available Subscription Tiers
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Select the plan that matches your video ingestion volume and streaming audience.
          </p>
        </div>

        {/* Toggle monthly / yearly */}
        <div className="flex items-center gap-6 mb-8 border-b border-gray-200 dark:border-slate-800">
          {(["monthly", "yearly"] as const).map((cycle) => (
            <button
              key={cycle}
              onClick={() => setBillingCycle(cycle)}
              className={`cursor-pointer relative pb-2 text-sm font-medium transition-all ${
                billingCycle === cycle
                  ? "text-blue-600 after:absolute after:left-0 after:bottom-0 after:w-full after:h-0.5 after:bg-blue-600"
                  : "text-gray-500 dark:text-gray-400 hover:text-white"
              }`}
            >
              {cycle === "monthly" ? "Monthly" : "Yearly"}
              {cycle === "yearly" && (
                <span className="ml-1 text-xs text-green-500">(Save 10%)</span>
              )}
            </button>
          ))}
        </div>

        <div className="w-full grid md:grid-cols-4 gap-5">
          <PaymentCard
            name="Free Plan"
            price="$0"
            isCurrent={currentPlan === "free"}
            isFree
            features={[
              "5 GiB storage cap",
              "1,000 playback minutes / month",
              "720p HD streaming only",
              "Mandatory Vedora branding",
              "Basic analytics",
              "API & SDK Access",
              { label: "1080p full HD streaming", available: false },
              { label: "Custom watermark branding", available: false },
              { label: "Multi-bitrate ladder (1080p)", available: false },
            ]}
          />
          <PaymentCard
            name="Starter Plan"
            price={billingCycle === "monthly" ? "$14.99" : "$12.99"}
            isCurrent={currentPlan === "starter"}
            features={[
              "250 GiB storage cap",
              "10,000 playback minutes / month",
              "Full 1080p streaming permitted",
              "Custom watermark branding",
              "Multi-bitrate adaptive ladder (360p–1080p)",
              "Full analytics & telemetry",
              "API & SDK Access",
              "Email support",
            ]}
          />
          <PaymentCard
            name="Pro Plan"
            price={billingCycle === "monthly" ? "$29.99" : "$27.99"}
            isCurrent={currentPlan === "pro"}
            features={[
              "600 GiB storage cap",
              "22,000 playback minutes / month",
              "Full 1080p streaming permitted",
              "Custom watermark branding",
              "Multi-bitrate adaptive ladder (360p–1080p)",
              "Subtitles & captions generation",
              "Advanced analytics & telemetry",
              "Priority support",
            ]}
          />
          <PaymentCard
            name="Business Plan"
            price={billingCycle === "monthly" ? "$64.99" : "$60.99"}
            isCurrent={currentPlan === "business"}
            features={[
              "2 TiB storage cap",
              "50,000 playback minutes / month",
              "Full 1080p streaming permitted",
              "Custom watermark branding",
              "Full multi-bitrate adaptive ladder",
              "Custom domain white-listing",
              "Dedicated support engineer",
              "99.9% uptime SLA",
            ]}
          />
        </div>
      </div>

      {/* Add-ons Section */}
      <div className="dark:bg-[#101217] rounded-xl mb-6 p-6 border border-gray-200 dark:border-[#1f2023]">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
          Bandwidth & Storage Add-ons
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          Extend your streaming capacity with instant add-ons as your audience scales.
        </p>

        <div className="grid md:grid-cols-4 gap-5">
          <AddOnCard
            title="100GB Extra Storage"
            price="$5/mo"
            description="Extend your raw and transcoded storage capacity"
          />
          <AddOnCard
            title="250GB Extra Storage"
            price="$10/mo"
            description="Extend your raw and transcoded storage capacity"
          />
          <AddOnCard
            title="500GB Extra Storage"
            price="$20/mo"
            description="Extend your raw and transcoded storage capacity"
          />
          <AddOnCard
            title="10,000 Extra Playback Mins"
            price="$15/mo"
            description="Add extra streaming minutes to your monthly allocation"
          />
        </div>
      </div>
    </div>
  );
}
