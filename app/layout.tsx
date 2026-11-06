import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./tokens.css";
import "./globals.css";

/*
 * Geist Pixel (Vercel × basement.studio, SIL OFL 1.1) — downloaded from the
 * official vercel/geist-font v1.9.0 release into app/fonts/. TTF copies for
 * the OG image renderer live in assets/fonts/.
 */
const pixelSquare = localFont({
  src: "./fonts/GeistPixel-Square.woff2",
  variable: "--font-geist-pixel-square",
  weight: "500",
  display: "swap",
});
const pixelGrid = localFont({
  src: "./fonts/GeistPixel-Grid.woff2",
  variable: "--font-geist-pixel-grid",
  weight: "500",
  display: "swap",
});
const pixelCircle = localFont({
  src: "./fonts/GeistPixel-Circle.woff2",
  variable: "--font-geist-pixel-circle",
  weight: "500",
  display: "swap",
});
const pixelLine = localFont({
  src: "./fonts/GeistPixel-Line.woff2",
  variable: "--font-geist-pixel-line",
  weight: "500",
  display: "swap",
});
const pixelTriangle = localFont({
  src: "./fonts/GeistPixel-Triangle.woff2",
  variable: "--font-geist-pixel-triangle",
  weight: "500",
  display: "swap",
});
const mono = localFont({
  src: "./fonts/GeistMonoVF.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  display: "swap",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://fstvl.xyz";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "BARRICADE — the daily push to the front",
    template: "%s · BARRICADE",
  },
  description:
    "5 prompts. 25 seconds each. Name artists, festivals, venues, cities, genres and sound systems — the rarer your answer, the closer you get to the stage.",
  applicationName: "BARRICADE",
  openGraph: {
    type: "website",
    siteName: "BARRICADE",
    title: "BARRICADE — the daily push to the front",
    description: "Rarer answers get you closer to the stage. A daily live-music game.",
    url: SITE_URL,
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: "#05060d",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const fontVars = [pixelSquare, pixelGrid, pixelCircle, pixelLine, pixelTriangle, mono]
    .map((f) => f.variable)
    .join(" ");
  return (
    <html lang="en" className={fontVars}>
      <body>{children}</body>
    </html>
  );
}
