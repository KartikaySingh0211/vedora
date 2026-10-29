"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Upload, Code, LineChart, Loader2 } from "lucide-react";
import GeographicalMap, { GeoCountryData } from "../components/charts/geoMap";
import { useAuth, useUser } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import {
	fetchWithAuth,
	VideoItem,
	AnalyticsMetricsResponse,
} from "../lib/api-client";

const Page = () => {
	const { user, isLoaded } = useUser();
	const { getToken } = useAuth();

	const greeting = useMemo(() => {
		const hour = new Date().getHours();
		if (hour >= 6 && hour < 12) return "Good Morning";
		if (hour >= 12 && hour < 18) return "Good Afternoon";
		return "Good Evening";
	}, []);

	// 1. Fetch user's videos to compute active storage and total count
	const { data: videos, isLoading: videosLoading } = useQuery<VideoItem[]>({
		queryKey: ["videos"],
		queryFn: async () => {
			const token = await getToken();
			return fetchWithAuth<VideoItem[]>("/videos", token);
		},
		enabled: isLoaded && !!user,
	});

	// 2. Fetch aggregated analytics metrics for the last 30 days
	const { data: metrics, isLoading: metricsLoading } = useQuery<AnalyticsMetricsResponse>({
		queryKey: ["analytics-metrics", "30d"],
		queryFn: async () => {
			const token = await getToken();
			return fetchWithAuth<AnalyticsMetricsResponse>(
				"/analytics/metrics?window=30d",
				token,
			);
		},
		enabled: isLoaded && !!user,
	});

	// Derived Bandwidth / Minutes Streamed values
	const totalWatchMinutes =
		metrics?.totalWatchTimeMinutes ??
		Math.round((metrics?.totalWatchTimeSeconds ?? 0) / 60);

	// Derived Requests and Growth
	const totalRequests = metrics?.totalViews ?? 0;
	const avgRequestsPerDay = Math.round(totalRequests / 30);
	const viewsOverTime = metrics?.viewsOverTime ?? [];

	const growthRate = useMemo(() => {
		if (viewsOverTime.length < 2) return 0;
		const mid = Math.floor(viewsOverTime.length / 2);
		const firstHalf = viewsOverTime
			.slice(0, mid)
			.reduce((sum, d) => sum + d.views, 0);
		const secondHalf = viewsOverTime
			.slice(mid)
			.reduce((sum, d) => sum + d.views, 0);
		if (firstHalf === 0) return secondHalf > 0 ? 100 : 0;
		return Math.round(((secondHalf - firstHalf) / firstHalf) * 100);
	}, [viewsOverTime]);

	// Derived Storage Usage
	const videoList = videos ?? [];
	const videoCount = videoList.length;

	const totalStorageBytes = useMemo(() => {
		return videoList.reduce((acc, v) => {
			const raw = Number(v.size || 0);
			const transcoded = Number(v.estimatedTranscodedSize || 0);
			return acc + raw + transcoded;
		}, 0);
	}, [videoList]);

	const storageCapBytes = 500 * 1024 * 1024 * 1024; // 500 GB default storage cap
	const storageUsagePercent =
		storageCapBytes > 0
			? Math.min(100, Math.round((totalStorageBytes / storageCapBytes) * 100))
			: 0;

	const formatBytes = (bytes: number) => {
		if (bytes >= 1024 * 1024 * 1024) {
			return {
				value: (bytes / (1024 * 1024 * 1024)).toFixed(2),
				unit: "GB",
			};
		}
		return {
			value: (bytes / (1024 * 1024)).toFixed(1),
			unit: "MB",
		};
	};

	const usedStorageFormatted = formatBytes(totalStorageBytes);
	const totalCapGb = (storageCapBytes / (1024 * 1024 * 1024)).toFixed(0);
	const freeStorageBytes = Math.max(0, storageCapBytes - totalStorageBytes);
	const freeStorageFormatted = formatBytes(freeStorageBytes);

	// Derived Country Geography & Top URLs
	const geoCountryData: GeoCountryData[] = useMemo(() => {
		return (
			metrics?.countryBreakdown?.map((c) => ({
				name: c.country,
				visitors: c.visitors,
			})) ?? []
		);
	}, [metrics?.countryBreakdown]);

	const topURLs = useMemo(() => {
		if (metrics?.topReferrers && metrics.topReferrers.length > 0) {
			return metrics.topReferrers;
		}
		return [];
	}, [metrics?.topReferrers]);

	const isLoadingAny = videosLoading || metricsLoading;

	if (!isLoaded) {
		return null;
	}

	return (
		<div className="text-black dark:text-white">
			{/* Greeting */}
			<div className="mb-8">
				<h1 className="text-2xl font-semibold">
					{greeting},{" "}
					{user?.fullName?.split(" ")[0] ||
						user?.emailAddresses[0]?.emailAddress?.split("@")[0] ||
						"User"}{" "}
					👋
				</h1>
				<p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
					Here&apos;s what&apos;s happening with your video infrastructure
					today.
				</p>

				{/* Onboarding Panel - Shown when user has 0 uploaded videos */}
				{!videosLoading && videoCount === 0 && (
					<div className="mt-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-linear-to-br from-slate-50 to-white dark:from-slate-900 dark:to-slate-950 p-6 shadow-sm">
						<h3 className="text-base font-semibold text-slate-900 dark:text-white mb-2 flex items-center gap-2">
							🚀 Getting Started with Vedora
						</h3>
						<p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
							Complete these quick steps to ingest, deliver, and monitor your first video.
						</p>
						<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
							<Link
								href="/my-videos"
								className="flex items-start gap-4 p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-blue-500 dark:hover:border-blue-500/50 bg-white/50 dark:bg-slate-900/50 transition-colors group cursor-pointer"
							>
								<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
									<Upload size={18} />
								</div>
								<div>
									<span className="text-sm font-medium text-slate-900 dark:text-white group-hover:text-blue-500 transition-colors">
										1. Upload your first video
									</span>
									<p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
										Direct-to-cloud chunked upload with automated adaptive HLS ladder.
									</p>
								</div>
							</Link>

							<Link
								href="/my-videos"
								className="flex items-start gap-4 p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-purple-500 dark:hover:border-purple-500/50 bg-white/50 dark:bg-slate-900/50 transition-colors group cursor-pointer"
							>
								<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400">
									<Code size={18} />
								</div>
								<div>
									<span className="text-sm font-medium text-slate-900 dark:text-white group-hover:text-purple-500 transition-colors">
										2. Copy embed code
									</span>
									<p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
										Embed responsive video players into Next.js, React, or plain HTML.
									</p>
								</div>
							</Link>

							<Link
								href="/analytics"
								className="flex items-start gap-4 p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-green-500 dark:hover:border-green-500/50 bg-white/50 dark:bg-slate-900/50 transition-colors group cursor-pointer"
							>
								<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400">
									<LineChart size={18} />
								</div>
								<div>
									<span className="text-sm font-medium text-slate-900 dark:text-white group-hover:text-green-500 transition-colors">
										3. Track real-time views
									</span>
									<p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
										Monitor watch minutes, geography, devices, and retention.
									</p>
								</div>
							</Link>
						</div>
					</div>
				)}
			</div>

			{/* Stats Cards */}
			<div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
				{/* Bandwidth Card */}
				<div className="rounded-xl bg-white dark:bg-[#101217] border border-gray-200 dark:border-[#1f2023] shadow-sm p-5 flex flex-col justify-between gap-3">
					<div>
						<div className="flex items-center justify-between mb-1">
							<p className="text-sm font-medium text-gray-500 dark:text-gray-400">
								Watch Time Streamed
							</p>
							<span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">
								Last 30 Days
							</span>
						</div>
						<h2 className="text-3xl font-bold text-gray-900 dark:text-white">
							{metricsLoading ? (
								<span className="inline-block w-24 h-8 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
							) : (
								<>
									{totalWatchMinutes.toLocaleString()}{" "}
									<span className="text-lg text-gray-400 font-normal">
										mins
									</span>
								</>
							)}
						</h2>
					</div>
					<div>
						<div className="flex justify-between text-xs text-gray-500 dark:text-gray-500 mb-2">
							<span>Audience</span>
							<span>{(metrics?.uniqueViewers ?? 0).toLocaleString()} viewers</span>
						</div>
						<div className="w-full h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden mb-2">
							<div
								className="h-full bg-blue-500 rounded-full transition-all duration-500"
								style={{ width: `${Math.min(100, (metrics?.uniqueViewers ?? 0) > 0 ? 100 : 0)}%` }}
							/>
						</div>
						<div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
							<span>• {(metrics?.totalWatchTimeSeconds ?? 0).toLocaleString()} seconds total play duration</span>
						</div>
					</div>
				</div>

				{/* Requests Card */}
				<div className="rounded-xl bg-white dark:bg-[#101217] border border-gray-200 dark:border-[#1f2023] shadow-sm p-5 flex flex-col justify-between gap-3">
					<div>
						<div className="flex items-center justify-between mb-1">
							<p className="text-sm font-medium text-gray-500 dark:text-gray-400">
								Total Requests
							</p>
							<span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400">
								Real-time
							</span>
						</div>
						<h2 className="text-3xl font-bold text-gray-900 dark:text-white">
							{metricsLoading ? (
								<span className="inline-block w-20 h-8 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
							) : (
								totalRequests.toLocaleString()
							)}
						</h2>
					</div>
					<div className="space-y-2">
						<p className="text-xs text-gray-500 dark:text-gray-400">
							Total times your videos were requested or played across all
							regions.
						</p>
						<div className="border-t border-gray-100 dark:border-gray-800 pt-2 flex gap-6 text-xs text-gray-500 dark:text-gray-400">
							<div className="flex flex-col">
								<span className="font-semibold text-gray-700 dark:text-gray-300">
									{avgRequestsPerDay.toLocaleString()}
								</span>
								<span>Avg / Day</span>
							</div>
							<div className="flex flex-col">
								<span
									className={`font-semibold ${
										growthRate >= 0 ? "text-green-500" : "text-red-500"
									}`}
								>
									{growthRate >= 0 ? `+${growthRate}%` : `${growthRate}%`}
								</span>
								<span>Growth</span>
							</div>
						</div>
					</div>
				</div>

				{/* Storage Card */}
				<div className="rounded-xl bg-white dark:bg-[#101217] border border-gray-200 dark:border-[#1f2023] shadow-sm p-5 flex flex-col justify-between gap-3">
					<div>
						<div className="flex items-center justify-between mb-1">
							<p className="text-sm font-medium text-gray-500 dark:text-gray-400">
								Storage Used
							</p>
							<span className="text-xs font-medium px-2 py-0.5 rounded-full bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400">
								Allocated
							</span>
						</div>
						<h2 className="text-3xl font-bold text-gray-900 dark:text-white">
							{videosLoading ? (
								<span className="inline-block w-24 h-8 bg-gray-200 dark:bg-gray-800 rounded animate-pulse" />
							) : (
								<>
									{usedStorageFormatted.value}{" "}
									<span className="text-lg text-gray-400 font-normal">
										{usedStorageFormatted.unit}
									</span>
								</>
							)}
						</h2>
					</div>
					<div>
						<div className="flex justify-between text-xs text-gray-500 dark:text-gray-500 mb-2">
							<span>{storageUsagePercent}% Used</span>
							<span>{totalCapGb} GB Total</span>
						</div>
						<div className="w-full h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden mb-2">
							<div
								className="h-full bg-purple-500 rounded-full transition-all duration-500"
								style={{ width: `${Math.min(100, storageUsagePercent)}%` }}
							/>
						</div>
						<div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
							<span>
								• {videoCount} {videoCount === 1 ? "Video" : "Videos"}
							</span>
							<span>
								• {freeStorageFormatted.value} {freeStorageFormatted.unit} Free
							</span>
						</div>
					</div>
				</div>
			</div>

			{/* Geo map & Top URLs */}
			<div className="mt-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
				{/* Top Visitor Countries */}
				<div className="lg:col-span-7 flex flex-col">
					<div className="mb-4">
						<h2 className="text-lg font-semibold text-gray-900 dark:text-white">
							Top Visitor Countries
						</h2>
						<p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
							Based on requests served in the last 30 days.
						</p>
					</div>
					<div className="rounded-xl border border-gray-200 dark:border-[#1f2023] bg-white dark:bg-[#101217] shadow-sm p-4 overflow-hidden">
						<GeographicalMap data={geoCountryData} isLoading={metricsLoading} />
					</div>
				</div>

				{/* Top URLs Table */}
				<div className="lg:col-span-5 flex flex-col">
					<div className="mb-4">
						<h2 className="text-lg font-semibold text-gray-900 dark:text-white">
							Top Requested URLs
						</h2>
						<p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
							Pathnames where your videos were most frequently requested in the
							last 30 days.
						</p>
					</div>
					<div className="rounded-xl border border-gray-200 dark:border-[#1f2023] bg-white dark:bg-[#101217] shadow-sm overflow-hidden">
						<div className="overflow-x-auto">
							<table className="w-full text-left border-collapse">
								<thead>
									<tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50/75 dark:bg-[#16181d]">
										<th className="w-14 px-4 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 tracking-wider uppercase">
											#
										</th>
										<th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 tracking-wider uppercase">
											Pathname
										</th>
										<th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 tracking-wider uppercase">
											Requests
										</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-gray-100 dark:divide-gray-800/60 text-sm">
									{metricsLoading && (
										<tr>
											<td colSpan={3} className="text-center py-12">
												<div className="flex items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400">
													<Loader2 size={16} className="animate-spin text-blue-500" />
													Loading real-time requests...
												</div>
											</td>
										</tr>
									)}

									{!metricsLoading && topURLs?.length === 0 && (
										<tr>
											<td
												colSpan={3}
												className="text-center py-12 text-sm text-gray-500 dark:text-gray-400"
											>
												No requests recorded in the last 30 days.
											</td>
										</tr>
									)}

									{!metricsLoading &&
										topURLs?.map((row, index) => (
											<tr
												key={index}
												className="group hover:bg-blue-50/50 dark:hover:bg-[#171a20] transition-colors"
											>
												{/* Rank */}
												<td className="w-14 px-4 py-3.5 text-center text-sm font-bold text-gray-500 dark:text-gray-400 align-middle">
													{index === 0
														? "🥇"
														: index === 1
														? "🥈"
														: index === 2
														? "🥉"
														: `${index + 1}`}
												</td>

												{/* Path with icon badge */}
												<td className="px-4 py-3.5 align-middle">
													<div className="flex items-center gap-2.5 min-w-0">
														<div className="w-6 h-6 rounded-md bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700/60 flex items-center justify-center text-xs font-bold text-gray-700 dark:text-gray-300 shrink-0">
															{row.pathname.charAt(0) === "/"
																? row.pathname.charAt(1)?.toUpperCase() || "/"
																: row.pathname.charAt(0).toUpperCase()}
														</div>
														<span
															className="truncate max-w-[220px] font-medium text-gray-800 dark:text-gray-200"
															title={row.pathname}
														>
															{row.pathname}
														</span>
													</div>
												</td>

												{/* Requests */}
												<td className="px-5 py-3.5 text-right font-semibold text-blue-600 dark:text-blue-400 align-middle">
													{row.requests.toLocaleString()}
												</td>
											</tr>
										))}
								</tbody>
							</table>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
};

export default Page;