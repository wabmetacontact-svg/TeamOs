import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encryption for the client logins an owner chooses to keep here.
 *
 * TeamOS does not need a client's password for anything it does, and holding
 * one is a liability: whoever reads it can sign in as that customer. So it is
 * kept only because an owner typed it in, only encrypted, and only ever
 * decrypted on an owner's explicit request - never as part of the workspace
 * that every page load sends to the browser.
 *
 * AES-256-GCM with a fresh random IV per value. GCM authenticates as well as
 * encrypts, so a stored value that was edited in the database fails to decrypt
 * instead of decrypting to something else.
 *
 * The key is CLIENT_VAULT_KEY, 32 random bytes in base64, and it is separate
 * from AUTH_SECRET on purpose: rotating the session secret - which signs
 * everybody out, and is the first thing to do after a leak - must not also
 * make every stored password unreadable.
 */

const VERSION = "v1";

function key(): Buffer | null {
  const raw = process.env.CLIENT_VAULT_KEY?.trim();
  if (!raw) return null;
  const k = Buffer.from(raw, "base64");
  // A key of the wrong length is a configuration mistake, and silently padding
  // or truncating it would encrypt with something nobody can reproduce later.
  if (k.length !== 32) throw new Error("CLIENT_VAULT_KEY must be 32 bytes, base64-encoded.");
  return k;
}

/** Whether passwords can be stored at all on this deployment. */
export const vaultReady = (): boolean => {
  try {
    return key() !== null;
  } catch {
    return false;
  }
};

export function seal(plain: string): string {
  const k = key();
  if (!k) throw new Error("CLIENT_VAULT_KEY is not set, so passwords cannot be stored.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), body.toString("base64")].join(":");
}

export function open(sealed: string): string {
  const k = key();
  if (!k) throw new Error("CLIENT_VAULT_KEY is not set, so stored passwords cannot be read.");
  const [version, iv, tag, body] = sealed.split(":");
  if (version !== VERSION || !iv || !tag || !body) throw new Error("This stored value is not in a format TeamOS can read.");
  const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
}
