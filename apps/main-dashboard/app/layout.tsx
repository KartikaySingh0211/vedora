import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import QueryProvider from "@/providers/query-provider";
import ThemeWrapper from "@/providers/theme-provider";
import { Toaster } from "sonner";
import DashboardShell from "@/components/dashboard-shell";

const geistSans = Geist({
	variable: "--font-geist-sans",
	subsets: ["latin"],
});

const geistMono = Geist_Mono({
	variable: "--font-geist-mono",
	subsets: ["latin"],
});

export const metadata: Metadata = {
	title: "Dashboard - Vedora",
	description:
		"Modern APIs for ingesting, transcoding, and streaming video at scale. Ship upload flows, on-demand playback, and live pipelines without building your own media stack.",
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<ClerkProvider>
			<html lang="en" suppressHydrationWarning>
				<body
					className={`${geistSans.variable} ${geistMono.variable} antialiased`}
				>
					<ThemeWrapper>
						<QueryProvider>
							<DashboardShell>{children}</DashboardShell>
							<Toaster
								position="top-right"
								theme="system"
								toastOptions={{
									className: "bg-[#0A0C10] text-white border border-[#23262e]",
									closeButton: true,
								}}
							/>
						</QueryProvider>
					</ThemeWrapper>
				</body>
			</html>
		</ClerkProvider>
	);
}
