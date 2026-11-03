import { siteImageResponse } from "@/lib/share/site-og";

export const alt = "BARRICADE — the daily push. A pixel festival crowd in front of a lit stage.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return siteImageResponse();
}
