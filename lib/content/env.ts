/**
 * Tiny .env reader for offline scripts (no dependencies).
 *
 * `envValue("BARRICADE_SEAL_KEY", root)` returns process.env first, then
 * .env.local, then .env in `root`. Server-only (node:fs).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Parse dotenv text: KEY=value, optional `export `, quotes, # comments. */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    let value = m[2]!;
    const q = value[0];
    if ((q === '"' || q === "'") && value.lastIndexOf(q) > 0) {
      value = value.slice(1, value.lastIndexOf(q));
      if (q === '"') value = value.replace(/\\n/g, "\n").replace(/\\"/g, '"');
    } else {
      const hash = value.search(/\s#/);
      if (hash >= 0) value = value.slice(0, hash);
      value = value.trim();
    }
    out[key] = value;
  }
  return out;
}

export function envValue(name: string, root: string, files: readonly string[] = [".env.local", ".env"]): string | undefined {
  const fromProcess = process.env[name];
  if (fromProcess !== undefined && fromProcess !== "") return fromProcess;
  for (const f of files) {
    const p = join(root, f);
    if (!existsSync(p)) continue;
    const v = parseDotenv(readFileSync(p, "utf8"))[name];
    if (v !== undefined && v !== "") return v;
  }
  return undefined;
}
