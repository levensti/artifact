import "server-only";
import { ImageResponse } from "next/og";
import { getSharePreview } from "./shares";

const WIDTH = 1200;
const HEIGHT = 630;

/// Render the 1200×630 OG image for a share token. Used by both the
/// /share-review and /share-journal og routes — the image content is
/// driven entirely by the share's stored kind, so the URL prefix is
/// presentation only.
export async function renderShareOgImage(token: string): Promise<Response> {
  const preview = await getSharePreview(token).catch(() => null);
  if (!preview) return renderFallback();

  const sharer = preview.sharerFirstName ?? "Someone";
  const isReview = preview.payload.kind === "review";
  const subtitle = isReview ? "shared a paper review" : "shared a journal entry";
  const title = isReview
    ? (preview.payload as Extract<typeof preview.payload, { kind: "review" }>).title
    : (preview.payload as Extract<typeof preview.payload, { kind: "wiki" }>).rootTitle;
  const sourceLine = isReview
    ? buildReviewSource(preview.payload as Extract<typeof preview.payload, { kind: "review" }>)
    : buildWikiSubLine(preview.payload as Extract<typeof preview.payload, { kind: "wiki" }>);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "linear-gradient(180deg, #f6f5f2 0%, #ecebe5 100%)",
          padding: "72px 80px",
          fontFamily: "Inter, sans-serif",
          color: "#37352f",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: "#1e2b5e",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 8px 24px -8px rgba(30, 43, 94, 0.45)",
            }}
          >
            <BrandGlyphSvg color="#ffffff" size={22} />
          </div>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em" }}>
            Artifact
          </div>
        </div>

        <div
          style={{
            marginTop: 80,
            display: "flex",
            fontSize: 16,
            fontWeight: 600,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "#1e2b5e",
            opacity: 0.75,
          }}
        >
          {isReview ? "Paper review" : "Journal entry"}
        </div>

        <div
          style={{
            marginTop: 18,
            display: "flex",
            fontSize: 56,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            lineHeight: 1.1,
            color: "#1d1c1a",
          }}
        >
          {truncate(title, 110)}
        </div>

        {sourceLine ? (
          <div
            style={{
              marginTop: 22,
              display: "flex",
              fontSize: 22,
              color: "#787570",
            }}
          >
            {truncate(sourceLine, 80)}
          </div>
        ) : null}

        <div style={{ flex: 1 }} />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            paddingTop: 24,
            borderTop: "1px solid rgba(55, 53, 47, 0.1)",
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 999,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "color-mix(in srgb, #1e2b5e 12%, transparent)",
              color: "#1e2b5e",
              fontSize: 18,
              fontWeight: 600,
            }}
          >
            {(sharer[0] ?? "·").toUpperCase()}
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 2,
              fontSize: 20,
              color: "#37352f",
            }}
          >
            <div style={{ display: "flex", fontWeight: 600 }}>{sharer}</div>
            <div style={{ display: "flex", color: "#787570", fontSize: 17 }}>
              {subtitle}
            </div>
          </div>
        </div>
      </div>
    ),
    { width: WIDTH, height: HEIGHT },
  );
}

function renderFallback(): Response {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f6f5f2",
          fontFamily: "Inter, sans-serif",
          color: "#37352f",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: "#1e2b5e",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <BrandGlyphSvg color="#ffffff" size={28} />
          </div>
          <div style={{ fontSize: 36, fontWeight: 600 }}>Artifact</div>
        </div>
      </div>
    ),
    { width: WIDTH, height: HEIGHT },
  );
}

function buildReviewSource(payload: {
  arxivId: string | null;
  sourceUrl: string | null;
}): string {
  if (payload.arxivId) return `arXiv:${payload.arxivId}`;
  if (payload.sourceUrl) {
    try {
      return new URL(payload.sourceUrl).hostname.replace(/^www\./, "");
    } catch {
      return payload.sourceUrl;
    }
  }
  return "";
}

function buildWikiSubLine(payload: {
  pageType: string;
  pageCount: number;
  depth: number;
}): string {
  const kind = payload.pageType === "digest" ? "Weekly digest" : "Study session";
  if (payload.depth > 0 && payload.pageCount > 1) {
    return `${kind} · ${payload.pageCount} pages`;
  }
  return kind;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.7 ? cut.slice(0, lastSpace) : cut) + "…";
}

function BrandGlyphSvg({ color, size }: { color: string; size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="4 4 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M 20.5 11.5 Q 16 15, 8 23 Q 7 24, 7.5 24.5 Q 8 25, 9 24 Q 17 16, 21.5 12.5 Z"
        fill={color}
        opacity="0.55"
      />
      <circle cx="22" cy="10" r="3.2" fill={color} />
    </svg>
  );
}
