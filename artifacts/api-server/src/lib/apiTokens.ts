import { createHash, randomBytes } from "node:crypto";

// Bearer token storage policy.
//
// We never persist the raw bearer token. The mobile client receives
// the raw token exactly once -- in the JSON response from /login or
// /activate -- and must store it locally (Keychain / Keystore via
// expo-secure-store on the patient app). What lives in `api_tokens.
// token` is a SHA-256 hex digest of the raw token, so a read-only
// dump of the database does not yield usable bearers.
//
// Why SHA-256 (not bcrypt/argon2):
//   The raw token is generated server-side from `randomBytes(32)`,
//   which is 256 bits of entropy. There is nothing to brute-force --
//   an attacker cannot guess a candidate token. The reason we hash
//   is solely to make a stolen DB dump useless, and a single SHA-256
//   already accomplishes that. Bcrypt/argon2 would add per-request
//   CPU cost for zero additional security in this threat model.
//
// Why hex (not base64):
//   Hex is ASCII-safe in URLs, log lines, and Postgres. We don't
//   need it shorter; the raw token is what the network sends, the
//   hash is only used internally for the lookup.

const TOKEN_BYTES = 32;

export function generateRawApiToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashApiToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
