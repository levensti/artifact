import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const alt =
  "Artifact: an AI-native workspace for researchers to discover and read papers";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#1e2b5e";
const PAPER = "#f6f5f2";
const PAPER_DARK = "#ecebe5";
const TEXT = "#37352f";
const MUTED = "#787570";
const SUBTEXT = "rgba(55, 53, 47, 0.82)";
const KICKER = "rgba(30, 43, 94, 0.72)";
const HAIRLINE = "rgba(55, 53, 47, 0.12)";

const HEADLINE_LEAD = "Explore the";
const HEADLINE_ACCENT = "frontier.";
const KICKER_TEXT = "Open source · Free to use";
const SUB_LEAD = "Discover and read papers, blogs, and PDFs alongside";
const SUB_ACCENT = "a powerful, personalized AI assistant.";
const FOOT_URL = "withartifact.com";
const FOOT_TAG = "An AI-native workspace for researchers";

/// Every glyph rendered on the canvas — used to subset the Google Font
/// requests (which also forces a truetype response that satori can parse).
const GLYPHS = [
  "Artifact",
  KICKER_TEXT,
  HEADLINE_LEAD,
  HEADLINE_ACCENT,
  SUB_LEAD,
  SUB_ACCENT,
  FOOT_URL,
  FOOT_TAG,
].join(" ");

/// Fetch a single weight/style of a Google Font as a truetype buffer. Passing
/// `&text=` subsets the file and makes Google serve truetype (not woff2), which
/// is the only format satori/next-og can consume.
async function loadGoogleFont(family: string, text: string): Promise<ArrayBuffer> {
  const url = `https://fonts.googleapis.com/css2?family=${family}&text=${encodeURIComponent(
    text,
  )}`;
  // No browser User-Agent: Google then serves truetype (satori can't read
  // woff2), and `&text=` subsetting keeps each file tiny.
  const css = await (await fetch(url)).text();
  const resource = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/);
  if (!resource) throw new Error(`Failed to parse font source for ${family}`);
  const res = await fetch(resource[1]);
  if (!res.ok) throw new Error(`Failed to download font for ${family}`);
  return res.arrayBuffer();
}

export default async function OpengraphImage() {
  const [inter400, inter600, inter700, interItalic500, mono500] =
    await Promise.all([
      loadGoogleFont("Inter:wght@400", GLYPHS),
      loadGoogleFont("Inter:wght@600", GLYPHS),
      loadGoogleFont("Inter:wght@700", GLYPHS),
      loadGoogleFont("Inter:ital,wght@1,500", GLYPHS),
      loadGoogleFont("JetBrains+Mono:wght@500", GLYPHS),
    ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: `linear-gradient(180deg, ${PAPER} 0%, ${PAPER_DARK} 100%)`,
          padding: "76px 84px 64px",
          fontFamily: "Inter",
          color: TEXT,
          position: "relative",
        }}
      >
        {/* Oversized ghost glyph — quiet brand texture bleeding off-canvas. */}
        <div
          style={{
            position: "absolute",
            right: -70,
            bottom: -150,
            display: "flex",
            opacity: 0.05,
          }}
        >
          <BrandGlyphSvg color={INK} size={560} />
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <BrandRow />
          <div
            style={{
              display: "flex",
              fontFamily: "JetBrains Mono",
              fontSize: 15,
              fontWeight: 500,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: KICKER,
            }}
          >
            {KICKER_TEXT}
          </div>
        </div>

        <div
          style={{
            marginTop: "auto",
            display: "flex",
            flexWrap: "wrap",
            columnGap: 30,
            fontSize: 108,
            lineHeight: 0.95,
            letterSpacing: "-0.045em",
            fontWeight: 700,
          }}
        >
          <span style={{ color: TEXT }}>{HEADLINE_LEAD}</span>
          <span
            style={{
              fontStyle: "italic",
              fontWeight: 500,
              letterSpacing: "-0.035em",
              color: INK,
            }}
          >
            {HEADLINE_ACCENT}
          </span>
        </div>

        <Subhead />

        <div
          style={{
            marginTop: "auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: 26,
            borderTop: `1px solid ${HAIRLINE}`,
          }}
        >
          <div style={{ display: "flex", fontSize: 20, fontWeight: 600, color: TEXT }}>
            {FOOT_URL}
          </div>
          <div
            style={{
              display: "flex",
              fontFamily: "JetBrains Mono",
              fontSize: 15,
              letterSpacing: "0.04em",
              color: MUTED,
            }}
          >
            {FOOT_TAG}
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Inter", data: inter400, weight: 400, style: "normal" },
        { name: "Inter", data: inter600, weight: 600, style: "normal" },
        { name: "Inter", data: inter700, weight: 700, style: "normal" },
        { name: "Inter", data: interItalic500, weight: 500, style: "italic" },
        { name: "JetBrains Mono", data: mono500, weight: 500, style: "normal" },
      ],
    },
  );
}

function BrandRow() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
      <div
        style={{
          width: 42,
          height: 42,
          borderRadius: 11,
          background: INK,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 10px 26px -10px rgba(30, 43, 94, 0.55)",
        }}
      >
        <BrandGlyphSvg color="#ffffff" size={21} />
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 21,
          fontWeight: 600,
          letterSpacing: "-0.01em",
        }}
      >
        Artifact
      </div>
    </div>
  );
}

/// Reading-font subhead with a single italic accent on the closing phrase.
/// Rendered as per-word spans so satori can wrap it inside a flex container.
function Subhead() {
  const words: { text: string; accent: boolean }[] = [
    ...SUB_LEAD.split(" ").map((text) => ({ text, accent: false })),
    ...SUB_ACCENT.split(" ").map((text) => ({ text, accent: true })),
  ];
  return (
    <div
      style={{
        marginTop: 30,
        maxWidth: 770,
        display: "flex",
        flexWrap: "wrap",
        columnGap: 9,
        rowGap: 12,
        fontSize: 26,
        color: SUBTEXT,
      }}
    >
      {words.map((w, i) => (
        <span
          key={i}
          style={{
            display: "flex",
            ...(w.accent
              ? { fontStyle: "italic", fontWeight: 500, color: INK }
              : {}),
          }}
        >
          {w.text}
        </span>
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
      <polygon points="5,24 12,7 19,24" fill={color} opacity="0.55" />
      <polygon points="13,24 20,12 27,24" fill={color} />
    </svg>
  );
}
