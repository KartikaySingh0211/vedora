"use client";

import { Eye, EyeOff, Crown, Loader2 } from "lucide-react";
import React, { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchWithAuth, PlayerSettingsItem, SubscriptionItem } from "@/lib/api-client";
import { PageHeader } from "@/components/common";

const Page = () => {
	const { getToken, isLoaded } = useAuth();
	const queryClient = useQueryClient();

	const [enabled, setEnabled] = useState(true);
	const [position, setPosition] = useState("bottom-right");
	const [opacity, setOpacity] = useState(50);
	const [file, setFile] = useState<File | null>(null);
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);

	// Fetch subscription to determine Pro status
	const { data: subscription } = useQuery<SubscriptionItem>({
		queryKey: ["billing-subscription"],
		queryFn: async () => {
			const token = await getToken();
			return fetchWithAuth<SubscriptionItem>("/billing/subscription", token);
		},
		enabled: isLoaded,
	});

	const isProUser = Boolean(
		subscription?.plan && subscription.plan.toLowerCase() !== "free"
	);

	// Fetch existing player settings
	const { data: settings } = useQuery<PlayerSettingsItem>({
		queryKey: ["player-settings"],
		queryFn: async () => {
			const token = await getToken();
			return fetchWithAuth<PlayerSettingsItem>("/player-settings", token);
		},
		enabled: isLoaded,
	});

	useEffect(() => {
		if (settings) {
			const timer = setTimeout(() => {
				if (settings.watermark_position) setPosition(settings.watermark_position);
				if (settings.watermark_opacity !== undefined) setOpacity(settings.watermark_opacity);
			}, 0);
			return () => clearTimeout(timer);
		}
	}, [settings]);

	const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const selected = e.target.files?.[0] || null;
		setFile(selected);
		if (selected) {
			setPreviewUrl(URL.createObjectURL(selected));
		} else {
			setPreviewUrl(null);
		}
	};

	// Mutation to save settings for Pro users
	const saveMutation = useMutation({
		mutationFn: async () => {
			const token = await getToken();
			return fetchWithAuth<PlayerSettingsItem>("/player-settings", token, {
				method: "PUT",
				body: JSON.stringify({
					watermarkPosition: position,
					watermarkOpacity: opacity,
				}),
			});
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["player-settings"] });
			toast.success("Watermark settings saved successfully!");
		},
		onError: (err: Error) => {
			toast.error(`Failed to save settings: ${err.message}`);
		},
	});

	return (
		<div className="text-black dark:text-white">
			<PageHeader
				title="Watermark & Branding"
				description="Personalize your videos by uploading a custom watermark and configuring its appearance."
				breadcrumbs={[
					{ label: "Dashboard", href: "/" },
					{ label: "Watermark & Branding" },
				]}
			/>

			<div className="bg-white dark:bg-slate-900/50 rounded-md p-6 border border-slate-200 dark:border-slate-900 max-w-3xl space-y-6">
				{/* Enable/Disable */}
				<div className="flex justify-between items-center">
					<div>
						<h3 className="text-sm font-semibold">Watermark Visibility</h3>
						<p className="text-xs text-gray-500 dark:text-gray-400">
							The Vedora watermark will be applied by default for free users.
						</p>
					</div>
					<button
						onClick={() => setEnabled(!enabled)}
						disabled={!isProUser}
						className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 ${
							enabled
								? "bg-green-600 text-white"
								: "bg-slate-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300"
						} ${!isProUser ? "cursor-not-allowed opacity-80" : "cursor-pointer"}`}
					>
						{enabled ? <Eye size={16} /> : <EyeOff size={16} />}
						{enabled ? "On" : "Off"}
					</button>
				</div>

				{/* Preview */}
				<div className="bg-slate-100 dark:bg-slate-800/50 p-4 rounded-md flex items-center justify-between">
					<div className="text-sm text-gray-700 dark:text-gray-300 font-medium">
						{isProUser && previewUrl
							? "Custom Watermark Preview"
							: isProUser
							? "Current Watermark Preview"
							: "Vedora Watermark (Default)"}
					</div>
					<div
						className="transition-opacity duration-200 flex items-center"
						style={{ opacity: enabled ? opacity / 100 : 0.2 }}
					>
						{isProUser && previewUrl ? (
							// eslint-disable-next-line @next/next/no-img-element
							<img
								src={previewUrl}
								alt="Custom Watermark"
								className="h-8 max-w-[130px] object-contain"
							/>
						) : (
							<Image
								src="/logo.png"
								alt="Vedora Logo"
								width={130}
								height={40}
								className="h-8 w-auto object-contain"
								priority
							/>
						)}
					</div>
				</div>

				{/* Pro-only settings */}
				<div
					className={`space-y-5 transition-opacity ${
						isProUser ? "opacity-100" : "opacity-50 pointer-events-none"
					}`}
				>
					{/* Upload */}
					<div>
						<label className="text-sm font-medium mb-1 block">
							Upload Custom Watermark
						</label>
						<input
							type="file"
							accept="image/png,image/svg+xml"
							onChange={handleFileChange}
							className="block text-sm text-gray-600 dark:text-gray-400"
						/>
						{file && (
							<p className="text-xs text-green-500 mt-1">
								Selected: {file.name}
							</p>
						)}
					</div>

					{/* Position */}
					<div>
						<label className="text-sm font-medium mb-1 block">
							Watermark Position
						</label>
						<select
							value={position}
							onChange={(e) => setPosition(e.target.value)}
							className="w-full bg-slate-100 dark:bg-slate-800/50 border border-slate-300 dark:border-slate-700 rounded-md px-3 py-2 text-sm"
						>
							<option value="top-left">Top Left</option>
							<option value="top-right">Top Right</option>
							<option value="bottom-left">Bottom Left</option>
							<option value="bottom-right">Bottom Right</option>
							<option value="center">Center</option>
						</select>
					</div>

					{/* Opacity */}
					<div>
						<label className="text-sm font-medium block mb-1">
							Opacity: {opacity}%
						</label>
						<input
							type="range"
							min={0}
							max={100}
							value={opacity}
							onChange={(e) => setOpacity(Number(e.target.value))}
							className="w-full cursor-pointer accent-blue-600"
						/>
					</div>
				</div>

				{/* Pro Prompt */}
				{!isProUser && (
					<div className="bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 p-4 rounded-md flex items-center justify-between">
						<div className="flex items-center gap-2 text-sm font-medium">
							<Crown size={16} />
							Upgrade to Pro to customize your watermark and branding.
						</div>
						<Link
							href="/billing"
							className="text-sm font-semibold text-blue-500 cursor-pointer hover:underline"
						>
							Upgrade
						</Link>
					</div>
				)}

				{/* Save Button */}
				{isProUser && (
					<div className="flex justify-end">
						<button
							onClick={() => saveMutation.mutate()}
							disabled={saveMutation.isPending}
							className="cursor-pointer inline-flex items-center gap-2 px-5 py-2 text-sm rounded-md bg-indigo-600 hover:bg-indigo-700 text-white font-medium transition disabled:opacity-50"
						>
							{saveMutation.isPending && (
								<Loader2 className="w-4 h-4 animate-spin" />
							)}
							{saveMutation.isPending ? "Saving..." : "Save Changes"}
						</button>
					</div>
				)}
			</div>
		</div>
	);
};

export default Page;
