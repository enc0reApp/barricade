/**
 * App icons as ImageResponses. Integer-scaled pixel maps, so every pixel lands
 * on the device grid (no font needed).
 */

import type { ReactElement } from "react";
import { ImageResponse } from "next/og";
import { NIGHT } from "./colors";
import { ICON_16, ICON_18, ICON_PALETTE } from "./icon-art";
import { PixelArt } from "./og-parts";

export const ICON_SIZE = { width: 32, height: 32 } as const;
export const APPLE_ICON_SIZE = { width: 180, height: 180 } as const;

export function IconArt(): ReactElement {
  return (
    <div style={{ width: 32, height: 32, display: "flex", position: "relative", background: NIGHT.sky0 }}>
      <PixelArt rows={ICON_16} palette={ICON_PALETTE} scale={2} />
    </div>
  );
}

export function AppleIconArt(): ReactElement {
  return (
    <div
      style={{
        width: 180,
        height: 180,
        display: "flex",
        position: "relative",
        backgroundColor: NIGHT.sky0,
        backgroundImage: `linear-gradient(180deg, ${NIGHT.sky0} 0%, ${NIGHT.sky2} 62%, ${NIGHT.sky0} 62%)`,
      }}
    >
      <PixelArt rows={ICON_18} palette={ICON_PALETTE} scale={10} />
    </div>
  );
}

export function iconImageResponse(): ImageResponse {
  return new ImageResponse(<IconArt />, { ...ICON_SIZE });
}

export function appleIconImageResponse(): ImageResponse {
  return new ImageResponse(<AppleIconArt />, { ...APPLE_ICON_SIZE });
}
