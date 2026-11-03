import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/share/site-url";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const pages: { path: string; changeFrequency: "daily" | "weekly" | "monthly"; priority: number }[] = [
    { path: "/", changeFrequency: "daily", priority: 1 },
    { path: "/how", changeFrequency: "monthly", priority: 0.6 },
    { path: "/archive", changeFrequency: "daily", priority: 0.7 },
    { path: "/crowd", changeFrequency: "daily", priority: 0.7 },
  ];
  return pages.map((p) => ({
    url: `${base}${p.path === "/" ? "" : p.path}`,
    changeFrequency: p.changeFrequency,
    priority: p.priority,
  }));
}
