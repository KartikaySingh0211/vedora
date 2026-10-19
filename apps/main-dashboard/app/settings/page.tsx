"use client";

import React, { useState } from "react";
import {
	ChevronRight,
	ChevronDown,
	Trash2,
	AlertTriangle,
	Activity,
	Mail,
	Plus,
	X,
	Check,
	Copy,
	RotateCw,
	Loader2,
	Key,
	ShieldAlert,
} from "lucide-react";
import Link from "next/link";
import SecuritySection from "@/components/security";
import DeleteAccountModal from "@/components/modals/delete-account.modal";
import { useUser, useAuth } from "@clerk/nextjs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "timeago.js";
import { toast } from "sonner";
import {
	fetchWithAuth,
	ApiKeyItem,
	CreatedApiKeyItem,
} from "@/lib/api-client";

const tabs = ["General", "Developer Access", "Security"];
const REGEN_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

export default function SettingsPage() {
	const [activeTab, setActiveTab] = useState("General");
	const [openDropdown, setOpenDropdown] = useState<string | null>(null);
	const [usageThreshold, setUsageThreshold] = useState(80);
	const [emailAlertsEnabled, setEmailAlertsEnabled] = useState(true);
	const [showDeleteModal, setShowDeleteModal] = useState(false);

	// One-time newly generated key state
	const [newKeyData, setNewKeyData] = useState<CreatedApiKeyItem | null>(null);
	const [copied, setCopied] = useState(false);

	// Current time for pure reactive cooldown rendering
	const [currentTime, setCurrentTime] = useState<number>(0);
	React.useEffect(() => {
		setCurrentTime(Date.now());
		const interval = setInterval(() => setCurrentTime(Date.now()), 10000);
		return () => clearInterval(interval);
	}, []);

	const { user, isLoaded } = useUser();
	const { getToken } = useAuth();
	const queryClient = useQueryClient();

	// 1. Fetch API keys
	const {
		data: apiKeys,
		isLoading: isKeysLoading,
		isError: isKeysError,
		error: keysError,
	} = useQuery<ApiKeyItem[]>({
		queryKey: ["api-keys"],
		queryFn: async () => {
			const token = await getToken();
			return fetchWithAuth<ApiKeyItem[]>("/api-keys", token);
		},
		enabled: isLoaded && !!user,
	});

	// 2. Create API key mutation
	const createKeyMutation = useMutation({
		mutationFn: async () => {
			const token = await getToken();
			return fetchWithAuth<CreatedApiKeyItem>("/api-keys", token, {
				method: "POST",
			});
		},
		onSuccess: (data) => {
			queryClient.invalidateQueries({ queryKey: ["api-keys"] });
			setNewKeyData(data);
			toast.success("API key successfully created");
		},
		onError: (err: Error) => {
			toast.error(err.message || "Failed to create API key");
		},
	});

	// 3. Regenerate API key mutation
	const regenerateKeyMutation = useMutation({
		mutationFn: async (id: string) => {
			const token = await getToken();
			return fetchWithAuth<CreatedApiKeyItem>(`/api-keys/${id}/regenerate`, token, {
				method: "POST",
			});
		},
		onSuccess: (data) => {
			queryClient.invalidateQueries({ queryKey: ["api-keys"] });
			setNewKeyData(data);
			toast.success("API key regenerated. Previous key revoked.");
		},
		onError: (err: Error) => {
			toast.error(err.message || "Failed to regenerate API key");
		},
	});

	// 4. Revoke API key mutation
	const revokeKeyMutation = useMutation({
		mutationFn: async (id: string) => {
			const token = await getToken();
			return fetchWithAuth<{ success: boolean; id: string }>(
				`/api-keys/${id}/revoke`,
				token,
				{ method: "POST" },
			);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["api-keys"] });
			toast.success("API key revoked");
		},
		onError: (err: Error) => {
			toast.error(err.message || "Failed to revoke API key");
		},
	});

	const handleCopy = () => {
		if (!newKeyData?.key) return;
		navigator.clipboard.writeText(newKeyData.key);
		setCopied(true);
		toast.success("Copied to clipboard");
		setTimeout(() => setCopied(false), 2000);
	};

	const toggleDropdown = (key: string) => {
		setOpenDropdown((prev) => (prev === key ? null : key));
	};

	if (!isLoaded) {
		return null;
	}

	return (
		<div className="text-black dark:text-white max-w-5xl">
			{/* Breadcrumb */}
			<nav className="flex items-center text-sm text-gray-500 dark:text-gray-400 mb-6">
				<Link href="/" className="hover:underline">
					Dashboard
				</Link>
				<ChevronRight size={16} className="mx-2" />
				<span className="text-gray-700 dark:text-gray-300 font-medium">
					Settings
				</span>
			</nav>

			{/* Title */}
			<div className="space-y-1 mb-6">
				<h1 className="text-2xl font-semibold">Settings</h1>
				<p className="text-sm text-gray-500 dark:text-gray-400 max-w-md">
					Manage your account preferences, access control, and security options.
				</p>
			</div>

			{/* Tabs */}
			<div className="border-b border-slate-300 dark:border-slate-800 mb-6">
				<div className="flex gap-6 text-sm font-medium">
					{tabs.map((tab) => (
						<button
							key={tab}
							onClick={() => setActiveTab(tab)}
							className={`pb-2 transition cursor-pointer ${
								activeTab === tab
									? "border-b-2 border-blue-500 text-blue-500 font-semibold"
									: "text-gray-500 dark:text-gray-400 hover:text-blue-400"
							}`}
						>
							{tab}
						</button>
					))}
				</div>
			</div>

			{/* Tab Content */}
			<div className="rounded-md space-y-6">
				{activeTab === "General" && (
					<>
						{/* Plan Usage Alert */}
						<div className="md:w-[70%]">
							<div className="flex items-center justify-between px-3 pb-1">
								<div className="flex items-start gap-3">
									<Activity size={22} className="text-purple-500 mt-1" />
									<div>
										<div className="text-base font-medium">
											Plan Usage Alert
										</div>
										<p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
											Get notified when usage exceeds your set threshold
											(default: 80%).
										</p>
									</div>
								</div>
								<button
									onClick={() => toggleDropdown("usage")}
									className="w-7 h-7 flex items-center justify-center rounded-full border border-gray-400 dark:border-gray-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
								>
									{openDropdown === "usage" ? (
										<ChevronDown size={16} />
									) : (
										<ChevronRight size={16} />
									)}
								</button>
							</div>

							{openDropdown === "usage" && (
								<div className="px-5 py-3">
									<label className="text-sm mb-1 block">
										Alert Threshold (%):
									</label>
									<input
										type="number"
										min={20}
										max={80}
										value={usageThreshold}
										onChange={(e) =>
											setUsageThreshold(parseInt(e.target.value) || 20)
										}
										className="w-24 px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-slate-800 text-sm"
									/>
									<p className="text-xs text-gray-400 mt-1">
										Must be between 20% and 80%.
									</p>
								</div>
							)}
						</div>

						{/* Video Upload Email Alert */}
						<div className="md:w-[70%]">
							<div className="flex items-center justify-between px-3 pb-1">
								<div className="flex items-start gap-3">
									<Mail size={22} className="text-green-500 mt-1" />
									<div>
										<div className="text-base font-medium">
											Upload Completion Email
										</div>
										<p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
											Email{" "}
											<span className="font-medium text-indigo-500">
												{user?.emailAddresses[0]?.emailAddress}
											</span>{" "}
											when a video processing is completed.
										</p>
									</div>
								</div>
								<button
									onClick={() => toggleDropdown("upload")}
									className="w-7 h-7 flex items-center justify-center rounded-full border border-gray-400 dark:border-gray-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
								>
									{openDropdown === "upload" ? (
										<ChevronDown size={16} />
									) : (
										<ChevronRight size={16} />
									)}
								</button>
							</div>

							{openDropdown === "upload" && (
								<div className="px-5 py-3 flex items-center justify-between">
									<span className="text-sm text-gray-500 dark:text-gray-300">
										Email notifications:
									</span>
									<button
										onClick={() => setEmailAlertsEnabled(!emailAlertsEnabled)}
										className={`w-10 h-5 rounded-full relative transition ${
											emailAlertsEnabled
												? "bg-green-500"
												: "bg-gray-400 dark:bg-gray-600"
										}`}
									>
										<span
											className={`absolute w-4 h-4 bg-white rounded-full top-0.5 transition ${
												emailAlertsEnabled ? "left-5" : "left-1"
											}`}
										/>
									</button>
								</div>
							)}
						</div>

						{/* Danger Zone */}
						<div className="pt-4 md:w-[70%] border-t border-slate-200 dark:border-slate-800">
							<h3 className="text-xl text-red-500 font-semibold mb-3 flex items-center gap-2">
								<AlertTriangle size={22} className="text-red-500" />
								Danger Zone
							</h3>
							<div
								className="flex items-center justify-between p-3 rounded-lg hover:bg-red-500/10 cursor-pointer transition"
								onClick={() => setShowDeleteModal(true)}
							>
								<div className="flex items-start gap-3">
									<Trash2 size={22} className="mt-1 text-red-500" />
									<div>
										<div className="text-base font-medium">Delete Account</div>
										<p className="text-sm text-red-400 mt-0.5">
											Permanently delete your Vedora account. This action cannot
											be undone.
										</p>
									</div>
								</div>
								<button className="w-7 h-7 flex items-center justify-center rounded-full border border-red-400 hover:bg-red-100 dark:hover:bg-red-900 transition cursor-pointer">
									<ChevronRight size={16} className="text-red-400" />
								</button>
							</div>
						</div>
					</>
				)}

				{activeTab === "Developer Access" && (
					<div className="md:w-[85%] space-y-6">
						{/* Guidelines */}
						<div className="text-sm text-gray-400 leading-relaxed space-y-2 p-4 rounded-lg bg-slate-50 dark:bg-[#0E1525] border border-slate-200 dark:border-slate-800">
							<p>
								Developer secret keys are used to programmatically access the
								Vedora API and upload/embed secured videos. Do{" "}
								<span className="text-red-400 font-semibold">not share</span> your
								secret key publicly or client-side.
							</p>
							<p>
								If you suspect a key is compromised, you can immediately{" "}
								<span className="text-yellow-400 font-medium">regenerate</span> or{" "}
								<span className="text-red-400 font-medium">revoke</span> it below.
							</p>
						</div>

						{/* Header */}
						<div className="flex justify-between items-center pt-2">
							<div>
								<h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
									<Key size={18} className="text-blue-500" />
									Developer Secret Keys
								</h2>
								<p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
									Keys used for server-to-server authorization with Vedora API.
								</p>
							</div>

							<button
								onClick={() => createKeyMutation.mutate()}
								disabled={createKeyMutation.isPending}
								className="flex items-center cursor-pointer gap-2 text-xs px-3.5 py-2 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 transition disabled:opacity-50"
							>
								{createKeyMutation.isPending ? (
									<Loader2 size={15} className="animate-spin" />
								) : (
									<Plus size={16} />
								)}
								Generate New Key
							</button>
						</div>

						{/* Key List & States */}
						{isKeysLoading && (
							<div className="py-12 flex flex-col items-center justify-center text-gray-400 gap-2">
								<Loader2 size={28} className="animate-spin text-blue-500" />
								<p className="text-sm">Loading your developer keys...</p>
							</div>
						)}

						{isKeysError && (
							<div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-3">
								<ShieldAlert size={20} className="shrink-0" />
								<p>
									Failed to load API keys:{" "}
									{keysError instanceof Error ? keysError.message : "Unknown error"}
								</p>
							</div>
						)}

						{!isKeysLoading && !isKeysError && apiKeys && apiKeys.length === 0 && (
							<div className="py-10 border border-dashed border-slate-300 dark:border-slate-800 rounded-lg text-center space-y-2">
								<p className="text-sm text-gray-500 dark:text-gray-400">
									No active API keys found.
								</p>
								<p className="text-xs text-gray-400">
									Click &quot;Generate New Key&quot; above to create your first developer secret key.
								</p>
							</div>
						)}

						{!isKeysLoading && !isKeysError && apiKeys && apiKeys.length > 0 && (
							<div className="space-y-3">
								{apiKeys.map((k) => {
									const isRevoked = !!k.revokedAt;
									const createdAtMs = new Date(k.createdAt).getTime();
									const cooldownOver =
										currentTime > 0 && currentTime - createdAtMs > REGEN_COOLDOWN_MS;

									return (
										<div
											key={k.id}
											className={`p-4 rounded-lg border transition ${
												isRevoked
													? "bg-slate-100/50 dark:bg-slate-900/30 border-slate-300 dark:border-slate-800/50 opacity-60"
													: "bg-slate-50 dark:bg-[#0E1525] border-slate-200 dark:border-slate-800 shadow-sm"
											}`}
										>
											<div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
												<div className="space-y-1 font-mono text-sm">
													<div className="flex items-center gap-2">
														<span className="font-semibold text-slate-800 dark:text-slate-200">
															{k.prefix}
														</span>
														<span className="text-xs font-sans text-gray-400">
															(ID: {k.id.slice(0, 8)}...)
														</span>
														{isRevoked && (
															<span className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400 font-sans font-medium">
																Revoked
															</span>
														)}
													</div>
													<div className="text-xs text-gray-500 dark:text-gray-400 font-sans space-x-3">
														<span>
															Created {format(k.createdAt)}
														</span>
														<span>•</span>
														<span>
															Last used:{" "}
															{k.lastUsedAt ? format(k.lastUsedAt) : "Never used"}
														</span>
													</div>
												</div>

												{!isRevoked && (
													<div className="flex items-center gap-2 shrink-0">
														{cooldownOver ? (
															<button
																onClick={() => regenerateKeyMutation.mutate(k.id)}
																disabled={regenerateKeyMutation.isPending}
																title="Revoke and generate a new key"
																className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-yellow-600/40 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/10 transition cursor-pointer"
															>
																<RotateCw size={13} />
																Regenerate
															</button>
														) : (
															<span className="text-xs text-gray-400 italic">
																Cooldown active (5m)
															</span>
														)}

														<button
															onClick={() => revokeKeyMutation.mutate(k.id)}
															disabled={revokeKeyMutation.isPending}
															title="Revoke key immediately"
															className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded border border-red-500/30 text-red-500 hover:bg-red-500/10 transition cursor-pointer"
														>
															<Trash2 size={13} />
															Revoke
														</button>
													</div>
												)}
											</div>
										</div>
									);
								})}
							</div>
						)}
					</div>
				)}

				{activeTab === "Security" && <SecuritySection />}
			</div>

			<DeleteAccountModal
				open={showDeleteModal}
				onClose={() => setShowDeleteModal(false)}
			/>

			{/* One-Time Plaintext Key Modal */}
			{newKeyData && (
				<div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center px-4 animate-in fade-in duration-150">
					<div className="relative w-full max-w-lg bg-[#0E1525] text-white rounded-xl p-6 shadow-2xl border border-blue-600/30">
						<button
							onClick={() => setNewKeyData(null)}
							className="absolute top-4 right-4 text-slate-400 hover:text-white transition cursor-pointer"
						>
							<X size={18} />
						</button>

						<div className="flex justify-center mb-4">
							<div className="p-3 bg-blue-600/20 border border-blue-600/40 rounded-full text-blue-400">
								<Key size={26} />
							</div>
						</div>

						<h2 className="text-xl font-semibold text-center mb-1">
							Your New Secret Key
						</h2>
						<p className="text-xs text-center text-yellow-400 font-medium mb-4">
							This secret key is visible only once. Copy and store it in a safe place!
						</p>

						<div className="relative bg-slate-900 border border-slate-700/80 rounded-lg p-3 font-mono text-xs break-all pr-12 text-blue-200">
							{newKeyData.key}
							<button
								onClick={handleCopy}
								title="Copy to clipboard"
								className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-blue-400 transition cursor-pointer"
							>
								{copied ? (
									<Check size={16} className="text-green-400" />
								) : (
									<Copy size={16} />
								)}
							</button>
						</div>

						<p className="text-xs text-gray-400 mt-4 leading-relaxed text-center">
							For security reasons, this plaintext secret will never be displayed again.
							If lost, you will need to regenerate a replacement key.
						</p>

						<div className="flex justify-center mt-6">
							<button
								onClick={() => setNewKeyData(null)}
								className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 text-sm font-medium rounded-md transition cursor-pointer"
							>
								I have saved this key
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
