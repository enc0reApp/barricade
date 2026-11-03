/** Public base URL, no trailing slash. NEXT_PUBLIC_SITE_URL || https://fstvl.xyz */
export function siteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL || "https://fstvl.xyz";
  return raw.replace(/\/+$/, "");
}
