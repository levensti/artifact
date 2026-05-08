import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const alt = "Artifact: a workspace for researchers to push the frontier";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#1e2b5e";
const PAPER = "#f6f5f2";
const PAPER_DARK = "#ecebe5";
const TEXT = "#1d1c1a";
const MUTED = "#787570";
const HAIRLINE = "rgba(55, 53, 47, 0.10)";

export default async function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: `linear-gradient(180deg, ${PAPER} 0%, ${PAPER_DARK} 100%)`,
        padding: "72px 80px",
        fontFamily: "Inter, sans-serif",
        color: TEXT,
        position: "relative",
      }}
    >
      <BrandRow />

      <div
        style={{
          marginTop: 92,
          display: "flex",
          flexDirection: "row",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 64,
          flex: 1,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            maxWidth: 720,
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 16,
              fontWeight: 600,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: INK,
              opacity: 0.75,
            }}
          >
            For researchers
          </div>
          <div
            style={{
              marginTop: 18,
              display: "flex",
              fontSize: 88,
              fontWeight: 600,
              letterSpacing: "-0.035em",
              lineHeight: 1.0,
              color: TEXT,
            }}
          >
            Study anything. Push the frontier.
          </div>
          <div
            style={{
              marginTop: 22,
              display: "flex",
              fontSize: 26,
              lineHeight: 1.35,
              color: MUTED,
              maxWidth: 640,
            }}
          >
            Read papers, blogs, and PDFs alongside a powerful AI assistant.
            Build a journal that compounds with every insight.
          </div>
        </div>

        <PaperCard />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingTop: 24,
          marginTop: 32,
          borderTop: `1px solid ${HAIRLINE}`,
          fontSize: 20,
          color: MUTED,
        }}
      >
        <div style={{ display: "flex" }}>withartifact.com</div>
        <div style={{ display: "flex" }}>
          Open source · MIT licensed · Bring your own keys
        </div>
      </div>
    </div>,
    { ...size },
  );
}

function BrandRow() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          background: INK,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 8px 24px -8px rgba(30, 43, 94, 0.45)",
        }}
      >
        <BrandGlyphSvg color="#ffffff" size={22} />
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: "-0.01em",
          display: "flex",
        }}
      >
        Artifact
      </div>
    </div>
  );
}

/// A stylized hint of the hero's paper card, simplified for the OG canvas.
function PaperCard() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: 360,
        borderRadius: 18,
        background: "#ffffff",
        border: `1px solid ${HAIRLINE}`,
        boxShadow: "0 30px 60px -30px rgba(30, 43, 94, 0.25)",
        overflow: "hidden",
        transform: "rotate(-1.5deg)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "12px 16px",
          background: "#fbfaf6",
          borderBottom: `1px solid ${HAIRLINE}`,
        }}
      >
        <Dot />
        <Dot />
        <Dot />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          padding: "22px 24px 24px",
          gap: 14,
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: INK,
            background: "rgba(30, 43, 94, 0.10)",
            padding: "4px 8px",
            borderRadius: 6,
            alignSelf: "flex-start",
          }}
        >
          arXiv · 1706.03762
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 22,
            fontWeight: 600,
            lineHeight: 1.18,
            letterSpacing: "-0.01em",
            color: TEXT,
          }}
        >
          Attention Is All You Need
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 14,
            color: MUTED,
          }}
        >
          Vaswani et al.
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            marginTop: 6,
          }}
        >
          <SkeletonRow widthPercents={[100, 88]} />
          <SkeletonRow widthPercents={[64, 28]} highlight />
          <SkeletonRow widthPercents={[92]} />
          <SkeletonRow widthPercents={[72]} />
        </div>
      </div>
    </div>
  );
}

function Dot() {
  return (
    <div
      style={{
        width: 8,
        height: 8,
        borderRadius: 999,
        background: "rgba(55, 53, 47, 0.18)",
      }}
    />
  );
}

function SkeletonRow({
  widthPercents,
  highlight = false,
}: {
  widthPercents: number[];
  highlight?: boolean;
}) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {widthPercents.map((w, i) => (
        <div
          key={i}
          style={{
            height: 10,
            borderRadius: 4,
            width: `${w}%`,
            background:
              highlight && i === 0
                ? "rgba(30, 43, 94, 0.18)"
                : "rgba(55, 53, 47, 0.10)",
          }}
        />
      ))}
    </div>
  );
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
