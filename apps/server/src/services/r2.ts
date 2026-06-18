/**
 * Cloudflare R2 media uploads (S3-compatible) via Bun's native S3 client.
 *
 * A seller can upload a real photo / song file; we store it in R2 and hand back
 * its public URL, which becomes the piece's gated `content`. The file bytes live
 * in R2, not in the store — the store only ever holds the URL. Disabled (throws)
 * unless R2 is configured; the rest of the product works without it.
 *
 * Bun's S3Client is imported dynamically (like bun:sqlite) so the type-check and
 * Vitest suite — which run under plain Node — never need it.
 */

import { randomUUID } from "node:crypto";
import { config } from "../config.js";

/** True when R2 credentials are present and uploads are available. */
export function r2Enabled(): boolean {
  return Boolean(config.r2);
}

/** Allowed upload content types → file extension. Keeps the bucket sane. */
const EXT_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
  "audio/webm": "weba",
};

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB

export function isAllowedUploadType(type: string): boolean {
  return type in EXT_BY_TYPE;
}

export interface UploadResult {
  /** Public, servable URL of the stored object (becomes the piece content). */
  url: string;
  /** The object key within the bucket. */
  key: string;
  contentType: string;
  bytes: number;
}

/**
 * Upload bytes to R2 under a random key and return the public URL. Throws if R2
 * is not configured, the type is not allowed, or the payload is too large.
 */
export async function uploadMedia(
  data: Uint8Array,
  contentType: string,
  opts: { prefix?: string } = {},
): Promise<UploadResult> {
  const r2 = config.r2;
  if (!r2) throw new Error("R2 is not configured (set R2_ENDPOINT / keys / R2_PUBLIC_URL)");
  if (!isAllowedUploadType(contentType)) throw new Error(`unsupported upload type: ${contentType}`);
  if (data.byteLength > MAX_UPLOAD_BYTES) throw new Error("file too large (max 15 MB)");

  const ext = EXT_BY_TYPE[contentType]!;
  const key = `${opts.prefix ?? "pieces"}/${randomUUID()}.${ext}`;

  // Bun's built-in S3 client speaks R2's S3 API. Dynamic import keeps it off the
  // Node-based type-check/test path.
  const { S3Client } = (await import("bun")) as unknown as {
    S3Client: new (o: Record<string, unknown>) => { write: (k: string, d: Uint8Array, o?: { type?: string }) => Promise<unknown> };
  };
  const client = new S3Client({
    accessKeyId: r2.accessKeyId,
    secretAccessKey: r2.secretAccessKey,
    endpoint: r2.endpoint,
    bucket: r2.bucket,
    region: "auto",
  });
  await client.write(key, data, { type: contentType });

  const base = r2.publicUrl.replace(/\/$/, "");
  return { url: `${base}/${key}`, key, contentType, bytes: data.byteLength };
}
