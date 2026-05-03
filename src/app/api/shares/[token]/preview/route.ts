import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { errorResponse } from "@/server/api";
import { getSharePreview } from "@/server/shares";

type Ctx = { params: Promise<{ token: string }> };

/// Public, unauthenticated. Returns share metadata for the landing page
/// and link unfurls. The `isOwner` flag is set from the active session
/// (when present) so the landing UI can short-circuit to the original
/// instead of cloning.
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { token } = await params;
    const preview = await getSharePreview(token);
    if (!preview) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const session = await auth().catch(() => null);
    const viewerUserId = session?.user?.id ?? null;
    const isOwner = !!viewerUserId && preview.ownerUserId === viewerUserId;
    const response = NextResponse.json({ ...preview, isOwner });
    // Edge-cacheable for unfurls. SWR window is short to make
    // revoke / metadata-update propagate within 5 min.
    response.headers.set(
      "Cache-Control",
      "public, max-age=0, s-maxage=300, stale-while-revalidate=600",
    );
    return response;
  } catch (err) {
    return errorResponse(err);
  }
}
