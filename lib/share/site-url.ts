/** Share links follow the active Vercel/custom host, including before DNS cutover. */
export function shareSiteUrl(origin?: string): string {
  const configured = siteUrl();
  if (!origin) return configured;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" && url.protocol !== "http:") return configured;
    const local = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    const trusted = url.hostname.endsWith(".vercel.app") || url.origin === new URL(configured).origin;
    return (url.protocol === "https:" && trusted) || local ? url.origin : configured;
  } catch {
    return configured;
  }
}

/** Public base URL, no trailing slash. NEXT_PUBLIC_SITE_URL || https://fstvl.xyz */
export function siteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL || "https://fstvl.xyz";
  return raw.replace(/\/+$/, "");
}
