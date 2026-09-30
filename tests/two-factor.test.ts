/**
 * Stage 0 — two-factor authentication.
 *
 * Three things here are easy to get wrong and invisible when you do: a code
 * that can be used twice inside its thirty seconds, a recovery code that can be
 * spent twice, and a half-authenticated token that a bug lets through as a full
 * session. Each gets a test.
 */
import { describe, expect, test } from "vitest";
import { Secret, TOTP } from "otpauth";
import {
  hashRecoveryCode,
  matchRecoveryCode,
  newChallengeNonce,
  newRecoveryCodes,
  newTotpSecret,
  RECOVERY_CODE_COUNT,
  totpUri,
  TOTP_DIGITS,
  TOTP_PERIOD,
  twoFactorRequiredFor,
  verifyTotp,
} from "../src/lib/totp";
import { signChallenge, signSession, verifyChallenge, verifySession } from "../src/lib/session";

process.env.AUTH_SECRET ??= "test-secret-that-is-long-enough-32-chars";

/** Generates the code an authenticator app would show, for a given moment. */
function codeAt(secret: string, timestamp = Date.now()): string {
  return new TOTP({
    algorithm: "SHA1",
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
    secret: Secret.fromBase32(secret),
  }).generate({ timestamp });
}

describe("the shared secret", () => {
  test("it is fresh every time and the right size for an authenticator app", () => {
    const secrets = new Set(Array.from({ length: 50 }, () => newTotpSecret()));
    expect(secrets.size).toBe(50);

    // 20 bytes, base32 — 32 characters, which is what RFC 4226 recommends and
    // what every app expects.
    expect([...secrets].every((s) => /^[A-Z2-7]{32}$/.test(s))).toBe(true);
  });

  test("the otpauth URI names the workspace and the account, with standard parameters", () => {
    const secret = newTotpSecret();
    const uri = totpUri(secret, "priya@company.com", "Hephaestus");

    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    expect(uri).toContain("issuer=Hephaestus");
    expect(uri).toContain("priya%40company.com");
    expect(uri).toContain(`secret=${secret}`);
    // Deviating from these is how a QR code scans fine and then never matches.
    expect(uri).toContain("algorithm=SHA1");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });
});

describe("verifying a code", () => {
  test("the code an app is showing right now is accepted", () => {
    const secret = newTotpSecret();
    expect(verifyTotp(secret, codeAt(secret)).ok).toBe(true);
  });

  test("a code from another secret is not", () => {
    expect(verifyTotp(newTotpSecret(), codeAt(newTotpSecret())).ok).toBe(false);
  });

  test("one step of drift either way is tolerated; two is not", () => {
    const secret = newTotpSecret();
    const step = TOTP_PERIOD * 1000;

    expect(verifyTotp(secret, codeAt(secret, Date.now() - step)).ok).toBe(true);
    expect(verifyTotp(secret, codeAt(secret, Date.now() + step)).ok).toBe(true);

    // A phone this far out of sync needs its clock fixed, not a wider window.
    expect(verifyTotp(secret, codeAt(secret, Date.now() - step * 3)).ok).toBe(false);
    expect(verifyTotp(secret, codeAt(secret, Date.now() + step * 3)).ok).toBe(false);
  });

  test("anything that is not six digits is rejected before the maths runs", () => {
    const secret = newTotpSecret();
    for (const bad of ["", "12345", "1234567", "abcdef", "12 34 56 78"]) {
      expect(verifyTotp(secret, bad).ok).toBe(false);
    }
    // Spaces and dashes inside a six-digit code are forgiven, because people
    // and password managers both add them.
    const good = codeAt(secret);
    expect(verifyTotp(secret, `${good.slice(0, 3)} ${good.slice(3)}`).ok).toBe(true);
  });

  test("the same code cannot be used twice inside its own thirty seconds", () => {
    const secret = newTotpSecret();
    const code = codeAt(secret);

    const first = verifyTotp(secret, code);
    expect(first.ok).toBe(true);
    expect(typeof first.step).toBe("number");

    // This is the replay: same code, seconds later, still inside its window.
    // Recording the step it matched is what closes it.
    expect(verifyTotp(secret, code, { lastUsedStep: first.step }).ok).toBe(false);
  });

  test("recording a step does not block the next code", () => {
    const secret = newTotpSecret();
    const used = verifyTotp(secret, codeAt(secret));

    const next = codeAt(secret, Date.now() + TOTP_PERIOD * 1000);
    const result = verifyTotp(secret, next, { lastUsedStep: used.step });

    expect(result.ok).toBe(true);
    expect(result.step!).toBeGreaterThan(used.step!);
  });
});

describe("recovery codes", () => {
  test("ten are issued, all different, and only their hashes are meant to be kept", () => {
    const { codes, hashes } = newRecoveryCodes();

    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    expect(hashes.every((h) => /^[0-9a-f]{64}$/.test(h))).toBe(true);
    // No hash contains its code, so the stored set reveals nothing.
    expect(hashes.some((h, i) => h.includes(codes[i]!))).toBe(false);
  });

  test("they avoid the characters people misread off paper", () => {
    const { codes } = newRecoveryCodes();
    // I/1, L, O/0 and U are the ones that get transcribed wrong.
    expect(codes.join("")).not.toMatch(/[ILOU01]/);
    expect(codes.every((c) => /^[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(c))).toBe(true);
  });

  test("a code matches however it was typed back", () => {
    const { codes, hashes } = newRecoveryCodes();
    const code = codes[3]!;

    expect(matchRecoveryCode(code, hashes)).toBe(hashes[3]);
    expect(matchRecoveryCode(code.toLowerCase(), hashes)).toBe(hashes[3]);
    expect(matchRecoveryCode(code.replace("-", ""), hashes)).toBe(hashes[3]);
    expect(matchRecoveryCode(code.replace("-", " "), hashes)).toBe(hashes[3]);
  });

  test("a code from a different set matches nothing", () => {
    const mine = newRecoveryCodes();
    const theirs = newRecoveryCodes();

    expect(matchRecoveryCode(theirs.codes[0]!, mine.hashes)).toBeNull();
    expect(matchRecoveryCode("AAAAA-AAAAA", mine.hashes)).toBeNull();
    expect(matchRecoveryCode("", mine.hashes)).toBeNull();
  });

  test("once removed from the stored set, a code no longer works", () => {
    const { codes, hashes } = newRecoveryCodes();
    const spent = matchRecoveryCode(codes[0]!, hashes)!;
    const remaining = hashes.filter((h) => h !== spent);

    expect(remaining).toHaveLength(RECOVERY_CODE_COUNT - 1);
    expect(matchRecoveryCode(codes[0]!, remaining)).toBeNull();
    // The others are untouched.
    expect(matchRecoveryCode(codes[1]!, remaining)).toBe(hashes[1]);
  });

  test("hashing is stable, so a code stored today still matches tomorrow", () => {
    expect(hashRecoveryCode("ABCDE-FGHJK")).toBe(hashRecoveryCode("abcde fghjk"));
    expect(hashRecoveryCode("ABCDE-FGHJK")).not.toBe(hashRecoveryCode("ABCDE-FGHJM"));
  });
});

describe("the gap between the two factors", () => {
  test("a challenge token is not a session token", async () => {
    const challenge = await signChallenge({ uid: "u1", tid: "t1", nonce: newChallengeNonce() });

    // This is the whole point: proving a password must not, through any path,
    // be mistaken for having completed sign-in.
    expect(await verifySession(challenge)).toBeNull();
    expect(await verifyChallenge(challenge)).toMatchObject({ uid: "u1", tid: "t1" });
  });

  test("a session token is not a challenge token either", async () => {
    const session = await signSession({ sid: "s1", uid: "u1", tid: "t1" });

    expect(await verifyChallenge(session)).toBeNull();
    expect(await verifySession(session)).toMatchObject({ sid: "s1" });
  });

  test("the redirect target is carried across, and only if it is a local path", async () => {
    const withNext = await signChallenge({ uid: "u", tid: "t", nonce: "n", next: "/people" });
    expect((await verifyChallenge(withNext))?.next).toBe("/people");

    const without = await signChallenge({ uid: "u", tid: "t", nonce: "n" });
    expect((await verifyChallenge(without))?.next).toBeUndefined();
  });

  test("a tampered or unsigned token is refused", async () => {
    const token = await signChallenge({ uid: "u", tid: "t", nonce: "n" });

    expect(await verifyChallenge(`${token}x`)).toBeNull();
    expect(await verifyChallenge(undefined)).toBeNull();
    expect(await verifyChallenge("not.a.token")).toBeNull();
  });

  test("each challenge carries a distinct nonce", () => {
    expect(new Set(Array.from({ length: 100 }, newChallengeNonce)).size).toBe(100);
  });
});

describe("who has to have it", () => {
  test("the two roles that can change everyone else's access", () => {
    expect(twoFactorRequiredFor("Owner")).toBe(true);
    expect(twoFactorRequiredFor("Admin")).toBe(true);
  });

  test("and it stays optional for the rest", () => {
    expect(twoFactorRequiredFor("Finance")).toBe(false);
    expect(twoFactorRequiredFor("Manager")).toBe(false);
    expect(twoFactorRequiredFor("Member")).toBe(false);
    // Roles are data, so an invented one is not accidentally exempted by
    // matching some prefix — it is simply not on the list.
    expect(twoFactorRequiredFor("Administrator")).toBe(false);
  });
});
