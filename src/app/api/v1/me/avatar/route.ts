import { NextResponse } from "next/server";

import { authCookieName, getUserAvatarBySession } from "@/lib/auth-db";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export async function GET() {
  const token = (await cookies()).get(authCookieName())?.value ?? "";
  const dataUrl = await getUserAvatarBySession(token);
  if (!dataUrl) return new NextResponse(null, { status: 404 });
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return new NextResponse(null, { status: 404 });
  return new NextResponse(Buffer.from(match[2], "base64"), {
    headers: {
      "Content-Type": match[1],
      "Cache-Control": "private, max-age=300, stale-while-revalidate=60",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
