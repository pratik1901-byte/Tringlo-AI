// ============================================================
// Tringlo AI — object storage (S3-compatible)
// ============================================================
//
// Durable file storage for things that must survive a disk-less, spin-down
// host: call recordings above all. Backed by Neon Object Storage (or any
// S3-compatible store) via the AWS SDK, which reads AWS_ENDPOINT_URL_S3,
// AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_REGION from the environment.
//
// OFF by default: with no credentials configured the app keeps recordings on
// the local disk exactly as before (fine in development). Private objects are
// never exposed directly — the app streams them through its own authenticated
// route, and `signedGetUrl` is available for short-lived links when needed.
// ============================================================

import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const BUCKET = (process.env.TRINGLO_S3_BUCKET || "assets").trim();

let client: S3Client | null = null;
let bucketReady: Promise<void> | null = null;

/** True when object storage is configured; otherwise the local disk is used. */
export function isObjectStoreConfigured(): boolean {
  return Boolean(process.env.AWS_ENDPOINT_URL_S3 && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}

function s3(): S3Client {
  if (!client) {
    // forcePathStyle is required for non-AWS S3 endpoints; endpoint, region and
    // credentials are read from the environment by the SDK.
    client = new S3Client({ forcePathStyle: true });
  }
  return client;
}

/** Create the bucket if it does not exist yet. Idempotent, run once. */
export async function ensureBucket(): Promise<void> {
  if (!bucketReady) {
    bucketReady = (async () => {
      try {
        await s3().send(new CreateBucketCommand({ Bucket: BUCKET }));
      } catch (err) {
        // BucketAlreadyOwnedByYou / BucketAlreadyExists is the normal case.
        const name = (err as { name?: string })?.name ?? "";
        if (!/AlreadyOwned|AlreadyExists/i.test(name)) {
          // A real failure (bad creds, network) — surface it, but only once.
          console.error("[ObjectStore] ensureBucket:", err instanceof Error ? err.message : err);
        }
      }
    })();
  }
  await bucketReady;
}

export async function putObject(key: string, body: Buffer | Uint8Array | string, contentType?: string): Promise<void> {
  await ensureBucket();
  await s3().send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }));
}

/** The object's bytes, or null when it does not exist. */
export async function getObject(key: string): Promise<Buffer | null> {
  try {
    const res = await s3().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const bytes = await res.Body!.transformToByteArray();
    return Buffer.from(bytes);
  } catch (err) {
    const name = (err as { name?: string })?.name ?? "";
    if (/NoSuchKey|NotFound|404/i.test(name)) return null;
    throw err;
  }
}

export async function objectExists(key: string): Promise<boolean> {
  try {
    await s3().send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/** A short-lived signed URL for a private object. Default one hour. */
export async function signedGetUrl(key: string, expiresInSeconds = 3600): Promise<string> {
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: expiresInSeconds });
}
