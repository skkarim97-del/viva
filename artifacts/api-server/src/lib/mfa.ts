import { authenticator } from "otplib";
import QRCode from "qrcode";
import { createHash, randomBytes } from "node:crypto";

// TOTP MFA helper for the HIPAA pilot doctor flow (T007).
//
// Why otplib: maintained, RFC-6238 compliant, drop-in compatible with
// Google Authenticator, 1Password, Authy, Bitwarden, etc. Default
// window is 30s with a +/- 1 step tolerance which is what every TOTP
// app on the market uses; we widen to +/- 1 explicitly so a doctor
// can tolerate a few seconds of clock drift between phone and server.
authenticator.options = {
  step: 30,
  window: 1,
  digits: 6,
};

const ISSUER = "Viva Clinic";

// otplib uses base32 (RFC 4648) for the secret. authenticator.generateSecret()
// returns a 32-character base32 string by default which corresponds to
// 160 bits of entropy -- the recommendation in RFC 4226 / RFC 6238.
export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

// otpauth:// URL is what QR scanners read. The label is "Viva Clinic:<email>"
// and the issuer query param matches; both Google Authenticator and 1Password
// honor the issuer to namespace the credential.
export function buildOtpauthUrl(secret: string, accountLabel: string): string {
  return authenticator.keyuri(accountLabel, ISSUER, secret);
}

// QR code as a data URL so the browser can render <img src=...> with no
// extra plumbing. Width caps at 256 to keep the payload small (~3-4KB).
export async function generateQrcodeDataUrl(
  otpauthUrl: string,
): Promise<string> {
  return QRCode.toDataURL(otpauthUrl, {
    width: 256,
    margin: 1,
    errorCorrectionLevel: "M",
  });
}

// Verify a 6-digit TOTP code against the stored secret. Constant-time
// comparison is handled by otplib internally.
export function verifyTotpCode(secret: string, code: string): boolean {
  try {
    return authenticator.verify({ token: code, secret });
  } catch {
    return false;
  }
}

// Recovery codes are formatted as xxxx-xxxx (10 hex chars + dash for
// readability). 10 codes is the conventional count -- enough that a
// doctor can survive losing their phone without being locked out.
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_BYTES = 5; // 10 hex chars

export function generateRecoveryCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i += 1) {
    const hex = randomBytes(RECOVERY_CODE_BYTES).toString("hex");
    codes.push(`${hex.slice(0, 5)}-${hex.slice(5)}`);
  }
  return codes;
}

// Recovery codes are stored as sha256 hex digests (never plaintext).
// Same primitive as bearer tokens (lib/apiTokens.ts) so we don't pull
// in another hash dependency.
export function hashRecoveryCode(code: string): string {
  return createHash("sha256")
    .update(code.trim().toLowerCase())
    .digest("hex");
}

// NOTE: single-use consumption of a recovery code is enforced by an
// atomic UPDATE in routes/mfa.ts using array_remove + ANY in a single
// SQL statement. We deliberately do NOT expose a JS-side "consume"
// helper here, because a select-then-update pattern is racy: two
// concurrent /verify requests with the same code could both observe
// the code present and both succeed. See `POST /me/mfa/verify` for
// the atomic implementation.
