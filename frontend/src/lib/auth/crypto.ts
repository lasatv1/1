/**
 * Browser-side decryption of a login-protected snapshot (see backend/app/snapshot_crypto.py).
 *
 *   key  = PBKDF2-HMAC-SHA256("<username>:<password>", salt, iterations) -> 256 bits
 *   file = iv (12 bytes) || AES-256-GCM ciphertext+tag of gzip(JSON bundle)
 *
 * A wrong username or password fails GCM authentication, so it can never yield garbage.
 */
export interface KdfParams {
  name: 'PBKDF2';
  hash: 'SHA-256';
  iterations: number;
  salt: string; // base64
}

const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
export const bytesToB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
export { b64ToBytes };

/** Derives the raw 32-byte key (kept only in sessionStorage for this tab). */
export async function deriveKeyBytes(username: string, password: string, kdf: KdfParams): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(`${username}:${password}`), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: kdf.hash, salt: b64ToBytes(kdf.salt), iterations: kdf.iterations },
    material,
    256,
  );
  return new Uint8Array(bits);
}

export class WrongCredentialsError extends Error {
  constructor() {
    super('Invalid username or password');
  }
}

export async function decryptSnapshot<T>(keyBytes: Uint8Array, blob: ArrayBuffer): Promise<T> {
  const key = await crypto.subtle.importKey('raw', new Uint8Array(keyBytes), 'AES-GCM', false, ['decrypt']);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(blob, 0, 12) }, key, new Uint8Array(blob, 12));
  } catch {
    throw new WrongCredentialsError();
  }
  const stream = new Blob([plaintext]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text()) as T;
}
