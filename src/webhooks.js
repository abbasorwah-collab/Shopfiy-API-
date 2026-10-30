import crypto from "node:crypto";

// Verifies Shopify's HMAC signature against the raw request body.
export function verifyWebhook(rawBody, hmacHeader) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret || !hmacHeader || !Buffer.isBuffer(rawBody)) return false;

  const digest = crypto.createHmac("sha256", secret).update(rawBody).digest();
  const received = Buffer.from(hmacHeader, "base64");
  return received.length === digest.length && crypto.timingSafeEqual(received, digest);
}
