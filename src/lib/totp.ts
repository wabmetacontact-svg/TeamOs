import "server-only";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { Secret, TOTP } from "otpauth";

/**
 * Two-factor authentication, by time-based one-time code.
 *
 * The PRD requires it for Owner and Admin — the two roles that can change what
 * everyone else may do — and offers it to everyone else. A password alone is
 * one secret that travels; this adds one that does not.
 *
 * Standard parameters on purpose: SHA-1, 6 digits, 30-second period. They are
 * what Google Authenticator, 1Password, Authy and Microsoft Authenticator all
 * implement. Choosing SHA-256 here would be marginally stronger and would fail
 * silently in some of those apps, which is a worse outcome than the margin.
 */

export const TOTP_DIGITS = 6;
export const TOTP_PERIOD = 30;
/** ±1 step: one code either side, to absorb clock drift and slow typing. */
export const TOTP_WINDOW = 1;
export const RECOVERY_CODE_COUNT = 10;

/** Roles that cannot opt out. Matched by name, because roles are data. */
export const TWO_FACTOR_REQUIRED_ROLES = ["Owner", "Admin"] as const;

export function twoFactorRequiredFor(roleName: string): boolean {
  return (TWO_FACTOR_REQUIRED_ROLES as readonly string[]).includes(roleName);
}

function totp(secret: string, label: string, issuer: string): TOTP {
  return new TOTP({
    issuer,
    label,
    algorithm: "SHA1",
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
    secret: Secret.fromBase32(secret),
  });
}

export function newTotpSecret(): string {
  // 20 bytes is the RFC 4226 recommendation and what every authenticator app
  // expects; base32 because that is what the otpauth:// URI carries.
  return new Secret({ size: 20 }).base32;
}

/** The otpauth:// URI an authenticator app scans. Contains the secret. */
export function totpUri(secret: string, email: string, workspace: string): string {
  return totp(secret, email, workspace).toString();
}

/**
 * Checks a code against the secret, allowing one step either side.
 *
 * Returns the matched time step, which the caller stores: accepting the same
 * step twice would let a code shoulder-surfed or replayed within its 30-second
 * life be used again, which is the one attack a TOTP is supposed to survive.
 */
export function verifyTotp(
  secret: string,
  code: string,
  opts: { lastUsedStep?: number | null } = {},
): { ok: boolean; step?: number } {
  const cleaned = code.replace(/\D/g, "");
  if (cleaned.length !== TOTP_DIGITS) return { ok: false };

  const delta = totp(secret, "x", "x").validate({ token: cleaned, window: TOTP_WINDOW });
  if (delta === null) return { ok: false };

  const step = Math.floor(Date.now() / 1000 / TOTP_PERIOD) + delta;
  if (opts.lastUsedStep != null && step <= opts.lastUsedStep) return { ok: false };

  return { ok: true, step };
}

// ─────────────────────────────────────────────────────── recovery codes ───

/**
 * Ten single-use codes, shown once and stored only as hashes — the same
 * treatment as an invitation token, and for the same reason: a support person
 * reading the database must not be able to sign in as anyone.
 *
 * These are what stands between "lost my phone" and "lost my account", so they
 * are generated and shown at the moment two-factor is switched on, not later.
 */
export function newRecoveryCodes(): { codes: string[]; hashes: string[] } {
  // Crockford-ish: no I, L, O, U, so a code read off paper is unambiguous.
  const alphabet = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const raw = Array.from({ length: 10 }, () => alphabet[randomInt(alphabet.length)]).join("");
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
  return { codes, hashes: codes.map(hashRecoveryCode) };
}

export function hashRecoveryCode(code: string): string {
  // Normalised so the dash and the case a person types do not matter.
  const normalised = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return createHash("sha256").update(normalised).digest("hex");
}

/**
 * Finds which stored hash a code matches, comparing every candidate so the
 * time taken does not reveal how far down the list a match was.
 */
export function matchRecoveryCode(code: string, hashes: string[]): string | null {
  const candidate = Buffer.from(hashRecoveryCode(code), "hex");
  let found: string | null = null;
  for (const stored of hashes) {
    const buf = Buffer.from(stored, "hex");
    if (buf.length === candidate.length && timingSafeEqual(buf, candidate)) found = stored;
  }
  return found;
}

/** A pending-second-factor token: valid for minutes, and for nothing else. */
export function newChallengeNonce(): string {
  return randomBytes(16).toString("base64url");
}
