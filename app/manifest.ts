import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BARRICADE",
    short_name: "BARRICADE",
    description: "The daily push to the front. 7 prompts about live music — rarer answers get you closer to the stage.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#05060d",
    theme_color: "#05060d",
    categories: ["games", "music", "entertainment"],
    icons: [
      { src: "/icon", sizes: "32x32", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
