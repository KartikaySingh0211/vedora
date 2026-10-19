import { handleStorageRequest } from "@oneminutecloud/storage-bucket-next";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export async function POST(
  request: Request,
  props: { params: Promise<{ provider: string }> },
) {
  // 1. Enforce user authentication with Clerk
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json(
      { error: "Authentication required to upload media" },
      { status: 401 },
    );
  }

  // 2. Load OneMinute Cloud credentials securely server-side
  const apiKey =
    process.env.ONEMINUTECLOUD_API_KEY || "omc_live_placeholder_key";

  return handleStorageRequest({
    request,
    props,
    apiKey,
  });
}
