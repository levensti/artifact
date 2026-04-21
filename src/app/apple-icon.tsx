import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#1e2b5e",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg
          width="180"
          height="180"
          viewBox="0 0 32 32"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M 20.5 11.5 Q 16 15, 8 23 Q 7 24, 7.5 24.5 Q 8 25, 9 24 Q 17 16, 21.5 12.5 Z"
            fill="#fafafa"
            opacity="0.35"
          />
          <circle cx="22" cy="10" r="3.2" fill="#fafafa" />
        </svg>
      </div>
    ),
    size,
  );
}
