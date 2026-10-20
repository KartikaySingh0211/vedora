"use client";

import { useState } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import {
  ChevronRight,
  Eye,
  Clock,
  Users,
  TrendingUp,
  Loader2,
  AlertCircle,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from "recharts";
import { useAuth, useUser } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import {
  fetchWithAuth,
  AnalyticsMetricsResponse,
} from "../../lib/api-client";

interface FullMetricsResponse extends AnalyticsMetricsResponse {
  topVideos?: {
    id: string;
    title: string;
    views: number;
    watchTimeMinutes: number;
    avgDurationSeconds: number;
  }[];
}

const rangeLabels = {
  "7d": "Last 7 Days",
  "30d": "Last 30 Days",
  "90d": "Last 90 Days",
};

export default function AnalyticsPage() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [range, setRange] = useState<"7d" | "30d" | "90d">("30d");
  const { isLoaded } = useUser();
  const { getToken } = useAuth();

  const axisColor = isDark ? "#6b7280" : "#9ca3af";
  const gridColor = isDark ? "#1f2023" : "#e5e7eb";
  const tooltipBg = isDark ? "#101217" : "#ffffff";
  const tooltipBorder = isDark ? "#1f2023" : "#e5e7eb";
  const tooltipText = isDark ? "#ffffff" : "#111827";

  const { data: metrics, isLoading, error } = useQuery<FullMetricsResponse>({
    queryKey: ["analytics-metrics", range],
    queryFn: async () => {
      const token = await getToken();
      return fetchWithAuth<FullMetricsResponse>(
        `/analytics/metrics?window=${range}`,
        token,
      );
    },
    enabled: isLoaded,
  });

  if (!isLoaded) return null;

  const totalViews = metrics?.totalViews ?? 0;
  const watchTimeHours = metrics
    ? `${(metrics.totalWatchTimeMinutes / 60).toFixed(1)}h`
    : "0h";
  const uniqueViewers = metrics?.uniqueViewers ?? 0;
  const avgDuration = metrics
    ? `${Math.floor(metrics.avgDurationSeconds / 60)}m ${metrics.avgDurationSeconds % 60}s`
    : "0m 0s";

  const overviewCards = [
    {
      label: "Total Views",
      value: totalViews.toLocaleString(),
      change: "+12.4%",
      positive: true,
      icon: Eye,
      badge: "blue" as const,
    },
    {
      label: "Watch Time",
      value: watchTimeHours,
      change: "+8.1%",
      positive: true,
      icon: Clock,
      badge: "green" as const,
    },
    {
      label: "Unique Viewers",
      value: uniqueViewers.toLocaleString(),
      change: "+5.3%",
      positive: true,
      icon: Users,
      badge: "purple" as const,
    },
    {
      label: "Avg Duration",
      value: avgDuration,
      change: "+2.5%",
      positive: true,
      icon: TrendingUp,
      badge: "blue" as const,
    },
  ];

  const viewsData =
    metrics?.viewsOverTime && metrics.viewsOverTime.length > 0
      ? metrics.viewsOverTime
      : [
          { date: "Day 1", views: 0 },
          { date: "Day 2", views: 0 },
          { date: "Day 3", views: 0 },
        ];

  const deviceData =
    metrics?.deviceBreakdown && metrics.deviceBreakdown.length > 0
      ? metrics.deviceBreakdown
      : [
          { name: "Desktop", value: 1, color: "#3b82f6" },
          { name: "Mobile", value: 0, color: "#10b981" },
        ];

  const browserData =
    metrics?.browserBreakdown && metrics.browserBreakdown.length > 0
      ? metrics.browserBreakdown
      : [{ browser: "Chrome", share: 100 }];

  const topVideos = metrics?.topVideos || [];

  return (
    <div className="text-black dark:text-white">
      {/* Breadcrumb */}
      <nav className="flex items-center text-sm text-gray-500 dark:text-gray-400 mb-6">
        <Link href="/" className="hover:underline">
          Dashboard
        </Link>
        <ChevronRight size={16} className="mx-2" />
        <span className="text-gray-700 dark:text-gray-300 font-medium">
          Analytics
        </span>
      </nav>

      {/* Title */}
      <div className="space-y-1 mb-6">
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Track views, watch time, and segment telemetry insights across your video library.
        </p>
      </div>

      {/* Date Range Selector */}
      <div className="flex items-center gap-2 mb-8">
        {(["7d", "30d", "90d"] as const).map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={`cursor-pointer px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
              range === r
                ? "bg-blue-600 border-blue-600 text-white"
                : "bg-white dark:bg-[#101217] border-gray-200 dark:border-[#1f2023] text-gray-600 dark:text-gray-400 hover:border-blue-400 dark:hover:border-blue-600"
            }`}
          >
            {rangeLabels[r]}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center p-16 text-gray-400">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      ) : error ? (
        <div className="p-8 rounded-xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 text-red-600 flex items-center gap-3">
          <AlertCircle className="w-6 h-6 shrink-0" />
          <p className="text-sm">Failed to load analytics: {(error as Error).message}</p>
        </div>
      ) : (
        <>
          {/* Overview Stat Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
            {overviewCards.map(({ label, value, change, positive, icon: Icon }) => (
              <div
                key={label}
                className="rounded-xl bg-white dark:bg-[#101217] border border-gray-200 dark:border-[#1f2023] shadow-sm p-5 flex flex-col gap-3"
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                    {label}
                  </p>
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">
                    <Icon size={12} className="inline mr-1" />
                    {label.split(" ")[0]}
                  </span>
                </div>
                <h2 className="text-3xl font-bold text-gray-900 dark:text-white">
                  {value}
                </h2>
                <p className={`text-xs font-medium ${positive ? "text-green-500" : "text-red-400"}`}>
                  {change} vs last period
                </p>
              </div>
            ))}
          </div>

          {/* Views Over Time Chart */}
          <div className="mt-8 rounded-xl bg-white dark:bg-[#101217] border border-gray-200 dark:border-[#1f2023] shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">
              Views Over Time
            </h2>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={viewsData}
                  margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="viewsGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                  <XAxis dataKey="date" stroke={axisColor} fontSize={12} tickLine={false} />
                  <YAxis stroke={axisColor} fontSize={12} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: tooltipBg,
                      borderColor: tooltipBorder,
                      color: tooltipText,
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="views"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#viewsGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Breakdowns: Devices & Browsers */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
            {/* Device Breakdown */}
            <div className="rounded-xl bg-white dark:bg-[#101217] border border-gray-200 dark:border-[#1f2023] shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Device Categories
              </h2>
              <div className="h-64 flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={deviceData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={85}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {deviceData.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={entry.color || ["#3b82f6", "#10b981", "#a855f7"][index % 3]}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: tooltipBg,
                        borderColor: tooltipBorder,
                        color: tooltipText,
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex justify-center gap-6 mt-4">
                {deviceData.map((item) => (
                  <div key={item.name} className="flex items-center gap-2 text-xs">
                    <span
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: item.color || "#3b82f6" }}
                    />
                    <span className="text-gray-600 dark:text-gray-400">{item.name}</span>
                    <span className="font-semibold text-gray-900 dark:text-white">
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Browser Share */}
            <div className="rounded-xl bg-white dark:bg-[#101217] border border-gray-200 dark:border-[#1f2023] shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Top Browsers
              </h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={browserData}
                    layout="vertical"
                    margin={{ top: 10, right: 30, left: 10, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} stroke={axisColor} fontSize={12} unit="%" />
                    <YAxis dataKey="browser" type="category" stroke={axisColor} fontSize={12} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: tooltipBg,
                        borderColor: tooltipBorder,
                        color: tooltipText,
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Bar dataKey="share" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Top Videos Table */}
          {topVideos.length > 0 && (
            <div className="mt-8 rounded-xl bg-white dark:bg-[#101217] border border-gray-200 dark:border-[#1f2023] shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Top Performing Videos
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-[#1f2023] text-gray-400 text-xs uppercase">
                      <th className="py-3 px-4">Title</th>
                      <th className="py-3 px-4">Views</th>
                      <th className="py-3 px-4">Watch Time</th>
                      <th className="py-3 px-4">Avg Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topVideos.map((video) => (
                      <tr
                        key={video.id}
                        className="border-b border-gray-100 dark:border-[#171a21] hover:bg-gray-50/50 dark:hover:bg-[#151820]"
                      >
                        <td className="py-3 px-4 font-medium text-gray-900 dark:text-white">
                          {video.title}
                        </td>
                        <td className="py-3 px-4">{video.views.toLocaleString()}</td>
                        <td className="py-3 px-4">{video.watchTimeMinutes}m</td>
                        <td className="py-3 px-4">{video.avgDurationSeconds}s</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
