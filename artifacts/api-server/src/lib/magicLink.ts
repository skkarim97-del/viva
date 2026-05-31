import { randomBytes, createHash } from "crypto";

const TTL_MINUTES = 15;

export function generateMagicLinkToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
}

export function hashMagicLinkToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function magicLinkExpiresAt(): Date {
  return new Date(Date.now() + TTL_MINUTES * 60 * 1000);
}

export function isMagicLinkExpired(expiresAt: Date): boolean {
  return new Date() > expiresAt;
}
