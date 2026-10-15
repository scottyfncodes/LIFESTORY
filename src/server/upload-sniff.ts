/**
 * Checks that the first bytes of an upload match the declared audio
 * container, so a mislabeled file cannot be stored as audio.
 */
export function bytesMatchAudioType(bytes: Uint8Array, baseType: string): boolean {
  if (bytes.length < 12) return false;
  const ascii = (start: number, len: number) => Buffer.from(bytes.subarray(start, start + len)).toString("latin1");
  switch (baseType) {
    case "audio/webm":
      return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
    case "audio/ogg":
      return ascii(0, 4) === "OggS";
    case "audio/mp4":
    case "audio/x-m4a":
    case "audio/aac":
      return ascii(4, 4) === "ftyp" || (bytes[0] === 0xff && (bytes[1] & 0xf0) === 0xf0);
    case "audio/mpeg":
      return ascii(0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
    case "audio/wav":
    case "audio/x-wav":
      return ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE";
    default:
      return false;
  }
}
