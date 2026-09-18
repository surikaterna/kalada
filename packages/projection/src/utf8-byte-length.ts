export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const width = utf8Width(value, index);
    bytes += width;
    if (width === 4) index += 1;
  }
  return bytes;
}

function utf8Width(value: string, index: number): number {
  const codeUnit = value.charCodeAt(index);
  if (codeUnit <= 0x7f) return 1;
  if (codeUnit <= 0x7ff) return 2;
  if (isHighSurrogate(codeUnit) && isLowSurrogate(value.charCodeAt(index + 1))) return 4;
  return 3;
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}
