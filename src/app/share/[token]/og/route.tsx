import { renderShareOgImage } from "@/server/share-og";

export const runtime = "nodejs";
export const revalidate = 3600;

type Ctx = { params: Promise<{ token: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { token } = await params;
  return renderShareOgImage(token);
}
