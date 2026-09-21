export const HOST_COMPILE_FINGERPRINT_VERSION = "kalada-host-compile-fingerprint-v1";
export const HOST_LINK_FINGERPRINT_VERSION = "kalada-host-link-fingerprint-v1";

export function createFingerprint(marker: string, input: unknown): string {
  return `${marker}:sha256:${sha256(stableText(input))}`;
}

function stableText(input: unknown): string {
  if (input === null || typeof input === "boolean" || typeof input === "number") {
    return JSON.stringify(input);
  }
  if (typeof input === "string") return JSON.stringify(input);
  if (Array.isArray(input)) return `[${input.map(stableText).join(",")}]`;
  if (typeof input !== "object") return JSON.stringify(String(input));
  return stableRecord(input as Readonly<Record<string, unknown>>);
}

function stableRecord(input: Readonly<Record<string, unknown>>): string {
  return `{${Object.keys(input)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableText(input[key])}`)
    .join(",")}}`;
}

const ROUND_CONSTANTS = Object.freeze([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256(input: string): string {
  const bytes = paddedBytes(new TextEncoder().encode(input));
  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  for (let offset = 0; offset < bytes.length; offset += 64) compress(bytes, offset, state);
  return [...state].map((value) => value.toString(16).padStart(8, "0")).join("");
}

function paddedBytes(input: Uint8Array): Uint8Array {
  const length = Math.ceil((input.length + 9) / 64) * 64;
  const output = new Uint8Array(length);
  output.set(input);
  output[input.length] = 0x80;
  const bits = BigInt(input.length) * 8n;
  for (let index = 0; index < 8; index += 1) {
    output[length - 1 - index] = Number((bits >> BigInt(index * 8)) & 0xffn);
  }
  return output;
}

function compress(bytes: Uint8Array, offset: number, state: Uint32Array): void {
  const words = new Uint32Array(64);
  for (let index = 0; index < 16; index += 1) words[index] = readWord(bytes, offset + index * 4);
  for (let index = 16; index < 64; index += 1) {
    const first = words[index - 15] as number;
    const second = words[index - 2] as number;
    words[index] = add(
      smallSigma0(first),
      words[index - 16],
      smallSigma1(second),
      words[index - 7],
    );
  }
  const working = [...state];
  for (let index = 0; index < 64; index += 1) shaRound(working, words[index] as number, index);
  for (let index = 0; index < 8; index += 1) state[index] = add(state[index], working[index]);
}

function shaRound(working: number[], word: number, index: number): void {
  const [a, b, c, d, e, f, g, h] = working as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const first = add(h, bigSigma1(e), (e & f) ^ (~e & g), ROUND_CONSTANTS[index], word);
  const second = add(bigSigma0(a), (a & b) ^ (a & c) ^ (b & c));
  working[0] = add(first, second);
  working[1] = a;
  working[2] = b;
  working[3] = c;
  working[4] = add(d, first);
  working[5] = e;
  working[6] = f;
  working[7] = g;
}

function readWord(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] as number) << 24) |
    ((bytes[offset + 1] as number) << 16) |
    ((bytes[offset + 2] as number) << 8) |
    (bytes[offset + 3] as number)
  );
}

function add(...values: readonly (number | undefined)[]): number {
  let result = 0;
  for (const value of values) result = (result + (value ?? 0)) >>> 0;
  return result;
}

function rotate(value: number, count: number): number {
  return (value >>> count) | (value << (32 - count));
}

function smallSigma0(value: number): number {
  return rotate(value, 7) ^ rotate(value, 18) ^ (value >>> 3);
}

function smallSigma1(value: number): number {
  return rotate(value, 17) ^ rotate(value, 19) ^ (value >>> 10);
}

function bigSigma0(value: number): number {
  return rotate(value, 2) ^ rotate(value, 13) ^ rotate(value, 22);
}

function bigSigma1(value: number): number {
  return rotate(value, 6) ^ rotate(value, 11) ^ rotate(value, 25);
}
