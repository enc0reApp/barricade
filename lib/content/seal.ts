/**
 * Sealing keeps spoilers out of a public repo.
 *
 * The compiled production pack (and a backup of its sources) are committed only
 * as AES-256-GCM ciphertext. The server unseals at runtime with
 * BARRICADE_SEAL_KEY (32 random bytes, base64). Without the key the app falls
 * back to the public sample pack.
 *
 * Server-only module (node:crypto).
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface SealedFile {
  sealed: 1;
  alg: "aes-256-gcm";
  /** What's inside — informational ("pack" | "source"). */
  label: string;
  iv: string; // base64, 12 bytes
  tag: string; // base64, 16 bytes
  data: string; // base64 ciphertext
}

function keyFrom(base64Key: string): Buffer {
  const key = Buffer.from(base64Key.trim(), "base64");
  if (key.length !== 32) {
    throw new Error(`BARRICADE_SEAL_KEY must decode to 32 bytes (got ${key.length}). Generate one with: pnpm content:keygen`);
  }
  return key;
}

export function seal(plaintext: string, base64Key: string, label: string): SealedFile {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(base64Key), iv);
  cipher.setAAD(Buffer.from(`barricade:${label}`));
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    sealed: 1,
    alg: "aes-256-gcm",
    label,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
}

export function unseal(file: SealedFile, base64Key: string): string {
  if (file.sealed !== 1 || file.alg !== "aes-256-gcm") throw new Error("Not a sealed file");
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(base64Key), Buffer.from(file.iv, "base64"));
  decipher.setAAD(Buffer.from(`barricade:${file.label}`));
  decipher.setAuthTag(Buffer.from(file.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(file.data, "base64")), decipher.final()]).toString("utf8");
}

export function isSealedFile(x: unknown): x is SealedFile {
  return typeof x === "object" && x !== null && (x as SealedFile).sealed === 1;
}
