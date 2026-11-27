// server/base58.js - tiny base58 codec (Solana addresses use the Bitcoin alphabet).
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
/** @type {Map<string, number>} */
const INDEX = new Map([...ALPHABET].map((c, i) => [c, i]));

/**
 * Decode a base58 string to bytes. Throws on an invalid character.
 * @param {string} input
 * @returns {Uint8Array}
 */
export function base58Decode(input) {
  if (typeof input !== 'string' || input.length === 0) throw new Error('empty base58 string');
  let n = 0n;
  for (const ch of input) {
    const v = INDEX.get(ch);
    if (v === undefined) throw new Error('invalid base58 character');
    n = n * 58n + BigInt(v);
  }
  /** @type {number[]} */
  const bytes = [];
  while (n > 0n) {
    bytes.unshift(Number(n % 256n));
    n /= 256n;
  }
  let zeros = 0;
  for (const ch of input) {
    if (ch === '1') zeros += 1;
    else break;
  }
  return Uint8Array.from([...new Array(zeros).fill(0), ...bytes]);
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function base58Encode(bytes) {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = '';
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  let zeros = 0;
  for (const b of bytes) {
    if (b === 0) zeros += 1;
    else break;
  }
  return '1'.repeat(zeros) + out;
}

/**
 * True when the string is a Solana-style address: 32 bytes of base58.
 * @param {string} value
 */
export function isSolanaAddress(value) {
  if (typeof value !== 'string' || value.length < 32 || value.length > 44) return false;
  try {
    return base58Decode(value).length === 32;
  } catch {
    return false;
  }
}
