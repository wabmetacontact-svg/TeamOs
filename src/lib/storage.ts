import "server-only";
import { createHash, createHmac, randomBytes } from "node:crypto";

/**
 * Object storage for receipts, spoken to over the S3 API.
 *
 * S3 the protocol, not S3 the product: Cloudflare R2, Backblaze B2, MinIO and
 * AWS all answer it, so the choice stays the operator's. R2 is the one this is
 * documented against in DEPLOY.md because its free tier is 10 GB and it charges
 * nothing for egress, which for a pile of receipt PDFs is the whole cost.
 *
 * The signing is written out by hand rather than pulled from the AWS SDK. Two
 * reasons: the SDK is about 15 MB for three functions, and a presigned URL is a
 * hash of a string — having it visible here is worth more than having it
 * hidden behind a dependency that also wants to manage credentials, retries and
 * a region resolver.
 *
 * Nothing here is required for the application to run. With no bucket
 * configured, `storageConfigured()` is false and the attachment UI says so
 * rather than failing at the moment somebody tries to upload.
 */

export type StorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export function storageConfig(): StorageConfig | null {
  const endpoint = process.env.S3_ENDPOINT;
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;

  return {
    endpoint: endpoint.replace(/\/+$/, ""),
    // R2 ignores the region but the signature does not; "auto" is what it wants.
    region: process.env.S3_REGION ?? "auto",
    bucket,
    accessKeyId,
    secretAccessKey,
  };
}

export function storageConfigured(): boolean {
  return storageConfig() !== null;
}

/** 10 MB. A receipt that does not fit is a photograph, not a receipt. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const ALLOWED_UPLOAD_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
] as const;

export function isAllowedUploadType(contentType: string): boolean {
  return (ALLOWED_UPLOAD_TYPES as readonly string[]).includes(contentType.toLowerCase());
}

/**
 * The key an object is stored under.
 *
 * Tenant first, so a bucket policy or a lifecycle rule can be written per
 * tenant without parsing anything. Random middle, so a key cannot be guessed
 * from a transaction id — the signed URL is the access control, and a
 * predictable key would let somebody skip it if the bucket were ever
 * misconfigured. Original filename last, so a download has a sensible name.
 */
export function objectKey(tenantId: string, transactionId: string, filename: string): string {
  const safe = filename
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "-")
    .slice(-80) || "file";
  return `${tenantId}/${transactionId}/${randomBytes(12).toString("hex")}/${safe}`;
}

// ───────────────────────────────────────────────── AWS Signature v4 ───

const ALGORITHM = "AWS4-HMAC-SHA256";
/** The literal S3 uses when a presigned URL's body is not signed. */
const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

/** Every path segment is escaped, and `/` is not — S3 signs it that way. */
function encodeKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

function signingKey(config: StorageConfig, date: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, date), config.region), "s3"), "aws4_request");
}

/**
 * A presigned URL, valid for `expiresIn` seconds.
 *
 * `PUT` for an upload, `GET` for a download. The browser talks to the bucket
 * directly with it, so a 10 MB receipt never travels through this server — it
 * would cost a serverless function's whole memory budget and its timeout.
 */
export function presign(
  method: "GET" | "PUT" | "DELETE",
  key: string,
  options: { expiresIn?: number; contentType?: string; downloadAs?: string } = {},
): string | null {
  const config = storageConfig();
  if (!config) return null;

  const expiresIn = Math.min(Math.max(options.expiresIn ?? 300, 30), 3600);
  const now = new Date();
  const stamp = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // 20260929T120000Z
  const date = stamp.slice(0, 8);

  const host = new URL(config.endpoint).host;
  const path = `/${config.bucket}/${encodeKey(key)}`;
  const credential = `${config.accessKeyId}/${date}/${config.region}/s3/aws4_request`;

  const query = new Map<string, string>([
    ["X-Amz-Algorithm", ALGORITHM],
    ["X-Amz-Credential", credential],
    ["X-Amz-Date", stamp],
    ["X-Amz-Expires", String(expiresIn)],
    ["X-Amz-SignedHeaders", "host"],
  ]);

  // Makes the browser save the file under its original name rather than the
  // random key, and as an attachment rather than rendering a PDF inline.
  if (method === "GET" && options.downloadAs) {
    query.set("response-content-disposition", `attachment; filename="${options.downloadAs.replace(/"/g, "")}"`);
  }

  // Canonical query: sorted by key, every character escaped the strict way.
  const canonicalQuery = [...query.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${strictEncode(k)}=${strictEncode(v)}`)
    .join("&");

  const canonicalRequest = [
    method,
    path,
    canonicalQuery,
    `host:${host}\n`,
    "host",
    UNSIGNED_PAYLOAD,
  ].join("\n");

  const stringToSign = [ALGORITHM, stamp, `${date}/${config.region}/s3/aws4_request`, sha256Hex(canonicalRequest)].join("\n");
  const signature = hmac(signingKey(config, date), stringToSign).toString("hex");

  return `${config.endpoint}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/** encodeURIComponent, plus the characters S3 wants escaped that it leaves. */
function strictEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * Deletes an object, from the server. A delete is not something a browser
 * should be handed a signed URL for — that URL would sit in history, in logs
 * and in whatever proxy is between, and it destroys rather than reads.
 *
 * Returns false rather than throwing when storage is unconfigured or the call
 * fails: the caller has already removed the database row, and a receipt left
 * behind in a bucket is a tidiness problem, not a correctness one.
 */
export async function deleteObject(key: string): Promise<boolean> {
  const url = presign("DELETE", key, { expiresIn: 60 });
  if (!url) return false;

  const response = await fetch(url, { method: "DELETE" }).catch(() => null);
  // S3 answers 204 for a delete, and also for one that was already gone.
  return Boolean(response && (response.ok || response.status === 404));
}
