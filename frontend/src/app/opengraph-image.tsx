import { ImageResponse } from "next/og";

// Branded link-preview card for every route (share pages included) — the
// big rich card platforms render when og:image exists. Mirrors the app's
// xAI-derived look: near-black canvas, white ink, the two speech shapes.

export const alt = "Mad World — AI models that argue instead of agreeing with you";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0a0a0a",
          gap: 36,
        }}
      >
        <svg width="140" height="140" viewBox="0 0 32 32">
          <rect x="3" y="6" width="20" height="14" rx="5" fill="#363a3f" />
          <rect x="9" y="12" width="20" height="14" rx="5" fill="#ffffff" />
        </svg>
        <div
          style={{
            display: "flex",
            fontSize: 96,
            color: "#ffffff",
            letterSpacing: "-0.03em",
          }}
        >
          Mad World
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 30,
            color: "#7d8187",
            letterSpacing: "0.02em",
          }}
        >
          AI models that argue it out — instead of agreeing with you
        </div>
      </div>
    ),
    { ...size },
  );
}
