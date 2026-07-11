import { getMediaCleanupConfig } from "@/lib/env";
import { cleanupExpiredSessions } from "@/lib/auth/session-store";
import { isValidCleanupAuthorization } from "@/lib/media/cleanup-authorization";
import { cleanupAbandonedMediaUploads } from "@/lib/media/media-service";
import { cleanupExpiredRateLimits } from "@/lib/security/rate-limit";

export async function POST(request: Request) {
  const { MEDIA_CLEANUP_SECRET } = getMediaCleanupConfig();
  if (
    !isValidCleanupAuthorization(
      request.headers.get("authorization"),
      MEDIA_CLEANUP_SECRET,
    )
  ) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const [media, expiredSessions, expiredRateLimits] = await Promise.all([
    cleanupAbandonedMediaUploads(),
    cleanupExpiredSessions(),
    cleanupExpiredRateLimits(),
  ]);
  return Response.json(
    { ...media, expiredSessions, expiredRateLimits },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
