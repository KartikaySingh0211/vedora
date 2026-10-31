import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Public embed player route is intentionally accessible without Clerk authentication
// to allow third-party iframe embedding of videos
const isPublicRoute = createRouteMatcher(["/embed(.*)"]);

/**
 * Strictly parses and validates Host/hostname strings for local automated test execution.
 * Allows ONLY exact loopback hostnames (localhost, 127.0.0.1, ::1) with optional numeric port.
 * Safely rejects:
 * - Subdomain prefix tricks (e.g. "localhost.attacker.com", "127.0.0.1.attacker.com")
 * - Embedded credentials (e.g. "127.0.0.1@attacker.com")
 * - Non-numeric / malformed ports (e.g. "localhost:evil", "localhost:3000:4000")
 * - Malformed IPv6 literals
 * - Public production domains (e.g. "vedora.tv", "app.vedora.com")
 */
export function isAllowedTestHostname(
  rawHostOrHostname: string | null | undefined,
): boolean {
  if (!rawHostOrHostname || typeof rawHostOrHostname !== "string") {
    return false;
  }

  const trimmed = rawHostOrHostname.trim().toLowerCase();
  if (!trimmed) return false;
  if (trimmed === "::1") return true;

  // Handle IPv6 bracket format e.g. [::1] or [::1]:3001
  if (trimmed.startsWith("[")) {
    const closingBracket = trimmed.indexOf("]");
    if (closingBracket === -1) return false;

    const ip6 = trimmed.substring(1, closingBracket);
    const rest = trimmed.substring(closingBracket + 1);

    if (rest.length > 0) {
      if (!rest.startsWith(":")) return false;
      const port = rest.substring(1);
      if (!/^\d+$/.test(port)) return false;
    }

    return ip6 === "::1";
  }

  // IPv4 or hostname e.g. "localhost", "127.0.0.1:3001"
  const parts = trimmed.split(":");
  if (parts.length > 2) return false;
  if (parts.length === 2 && !/^\d+$/.test(parts[1])) return false;

  const hostOnly = parts[0];
  return hostOnly === "localhost" || hostOnly === "127.0.0.1" || hostOnly === "::1";
}

export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) {
    return NextResponse.next();
  }

  // Local Playwright E2E testing bypass:
  // Strictly restricted to exact loopback hostnames (localhost/127.0.0.1/::1) with valid ports and test tokens.
  // Can never bypass authentication on public domains or production deployments.
  const host = req.headers.get("host") || req.nextUrl?.host || "";
  const isLocalhost = isAllowedTestHostname(host);
  const isProductionDeployment =
    process.env.VERCEL_ENV === "production" ||
    process.env.APP_ENV === "production";

  if (
    process.env.PLAYWRIGHT_TEST === "1" &&
    isLocalhost &&
    !isProductionDeployment &&
    req.headers.get("x-playwright-auth") === "test-runner"
  ) {
    return NextResponse.next();
  }

  const { userId } = await auth();

  if (!userId) {
    return NextResponse.redirect("http://localhost:3000");
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
