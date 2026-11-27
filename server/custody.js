// server/custody.js - the one rule that keeps this app non-custodial.
// Nothing in this server ever touches a private key or a seed phrase.

export const FORBIDDEN_INPUT_FIELDS = [
  'secretKey',
  'privateKey',
  'seedPhrase',
  'mnemonic',
  'secret',
  'keypair',
  'signer',
  'walletSecret',
];

/**
 * Refuse any request body that carries key material. Works for nested objects too.
 * @param {unknown} body
 * @returns {string|null} the offending field name, or null when clean
 */
export function findKeyMaterial(body) {
  if (body === null || typeof body !== 'object') return null;
  if (Array.isArray(body)) {
    for (const item of body) {
      const hit = findKeyMaterial(item);
      if (hit) return hit;
    }
    return null;
  }
  for (const [k, v] of Object.entries(body)) {
    if (FORBIDDEN_INPUT_FIELDS.some((f) => f.toLowerCase() === k.toLowerCase())) return k;
    const nested = findKeyMaterial(v);
    if (nested) return nested;
  }
  return null;
}

/**
 * Mask anything that looks like a secret before it is written anywhere.
 * @param {string} text
 */
export function redact(text) {
  return String(text)
    .replace(/sb_sk_[A-Za-z0-9_-]{8,}/g, '[redacted api key]')
    .replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, '[redacted ip]')
    .replace(/\b([A-Za-z0-9+/]{40,}={0,2})\b/g, '[redacted long string]');
}

export const CUSTODY_STATEMENT =
  'This app never asks for, receives or stores a private key or seed phrase. Trades are signed by your own wallet.';
