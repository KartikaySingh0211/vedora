import Link from "next/link";
import Image from "next/image";

export default function Footer() {
	const currentYear = new Date().getFullYear();

	return (
		<footer className="border-t border-white/5 bg-[#08090e]">
			<div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-10">
				<div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
					<div className="lg:col-span-1">
						<Link href="/" className="flex items-center gap-1">
							<Image
								src="/logo.png"
								alt="Logo"
								width={160}
								height={160}
								className="rounded-full"
							/>
						</Link>
						<p className="mt-2 text-xs text-muted-foreground">
							The developer platform for <br /> video production workloads.
						</p>
					</div>

					<div className="flex gap-8 text-xs text-slate-500">
						<Link
							href="/docs"
							target="_blank"
							className="hover:text-slate-300 transition-colors"
						>
							Docs
						</Link>
						<Link
							href="https://x.com/oneminutestack"
							target="_blank"
							className="hover:text-slate-300 transition-colors"
						>
							Twitter
						</Link>
						<Link
							href="https://github.com/one-minute-stack"
							target="_blank"
							className="hover:text-slate-300 transition-colors"
						>
							GitHub
						</Link>
						<Link
							href="https://status.Vedora.com"
							target="_blank"
							className="hover:text-slate-300 transition-colors"
						>
							Status
						</Link>
					</div>
					<a
						href="https://status.Vedora.com"
						target="_blank"
						rel="noreferrer"
						className="flex items-center gap-2"
					>
						<span className="relative flex h-2.5 w-2.5">
							<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
							<span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
						</span>
						<span className="text-xs text-slate-500">
							All systems are operational now
						</span>
					</a>
				</div>

				<div className="mt-8 border-t border-slate-900 pt-8 flex flex-col sm:flex-row justify-between items-center gap-4 text-[0.7rem] text-slate-600">
					<div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-4">
						<div>© {currentYear} Kartikay Singh</div>
						<div className="hidden sm:block text-slate-800">•</div>
						<div className="flex items-center gap-1">
							Built with <span className="text-red-500 mx-1">❤️</span> for
							developers
						</div>
					</div>
					<div className="flex gap-4">
						<Link href="/privacy" className="hover:text-slate-400">
							Privacy
						</Link>
						<Link href="/terms" className="hover:text-slate-400">
							Terms
						</Link>
					</div>
				</div>
			</div>
		</footer>
	);
}
