// ============================================================
// Tringlo AI — WAV to MP3
// ============================================================
//
// Sarvam serves call audio as WAV. A three-minute call is roughly 4 MB that
// way, which is slow to download and awkward to attach to anything; the same
// call is about 300 KB as MP3, and MP3 plays natively in every browser, on
// both phone platforms, and in every mail client.
//
// Encoded with a pure-JavaScript LAME port rather than ffmpeg. A native binary
// would be ~80 MB of dependency and a deployment requirement, and it buys
// nothing here: Sarvam's recordings are 16-bit PCM mono at 11.025 kHz. If Sarvam ever starts
// sending µ-law or A-law telephony audio, `decodeWav` will refuse it with a
// clear reason rather than produce noise — that is the point of checking the
// format tag instead of assuming it.
//
// 11.025 kHz is resampled to 22.05 kHz before encoding. Encoded as-is, LAME
// writes it as "MPEG-2.5", an unofficial extension that Safari, iOS, WhatsApp
// and a good many file managers do not recognise as MP3 at all — which is how
// a perfectly valid file ends up treated as something else. 22.05 kHz is a
// standard MPEG-2 rate that plays everywhere. It adds no audio detail, only
// compatibility.
//
// The result is cached on disk beside the WAV, so each call is encoded once.
// ============================================================

// Loaded through a dynamic import rather than a static one.
//
// The package ships an ESM build that exports Mp3Encoder and a CommonJS build
// that exports nothing usable. A static import resolves to whichever build the
// bundler's conditions pick, which differs between Next and a plain Node test
// run; `import()` always takes the ESM condition. Cached, so the cost is paid
// once per process rather than per recording.
type LameModule = {
  Mp3Encoder: new (channels: number, sampleRate: number, kbps: number) => {
    encodeBuffer(left: Int16Array, right?: Int16Array): Uint8Array;
    flush(): Uint8Array;
  };
};

let lamePromise: Promise<LameModule> | null = null;

function loadLame(): Promise<LameModule> {
  lamePromise ??= import("@breezystack/lamejs").then((module) => {
    const resolved = (module as unknown as { default?: LameModule }).default ?? module;
    return resolved as unknown as LameModule;
  });
  return lamePromise;
}

/**
 * Speech, mono, at 22.05 kHz.
 *
 * The source carries at most 5.5 kHz of audio bandwidth, so 48 kbps is
 * already generous — higher bitrates spend bytes describing detail the
 * recording does not contain. A call stays roughly a quarter of its WAV size.
 */
const BITRATE_KBPS = 48;

/**
 * Sample rates in MPEG-1 and MPEG-2 proper. Anything else is resampled up to
 * the nearest of these, so the encoder never falls back to MPEG-2.5.
 */
const STANDARD_RATES = [16000, 22050, 24000, 32000, 44100, 48000];

function targetRate(rate: number): number {
  if (STANDARD_RATES.includes(rate)) return rate;
  // An exact multiple (11.025 → 22.05 kHz) only fills in midpoints; otherwise
  // the nearest standard rate above.
  return (
    STANDARD_RATES.find((candidate) => candidate > rate && candidate % rate === 0) ??
    STANDARD_RATES.find((candidate) => candidate >= rate) ??
    48000
  );
}

/**
 * Linear-interpolation resampler for interleaved 16-bit PCM.
 *
 * Adequate for upsampling speech: the common case is an exact doubling
 * (11.025 → 22.05 kHz), where it only fills in midpoints and cannot alias.
 */
export function resample(wav: DecodedWav, to: number): DecodedWav {
  if (wav.sampleRate === to) return wav;

  const { channels } = wav;
  const inFrames = Math.floor(wav.samples.length / channels);
  const outFrames = Math.max(1, Math.round((inFrames * to) / wav.sampleRate));
  const out = new Int16Array(outFrames * channels);
  const step = wav.sampleRate / to;

  for (let frame = 0; frame < outFrames; frame++) {
    const position = frame * step;
    const index = Math.floor(position);
    const fraction = position - index;
    const next = Math.min(index + 1, inFrames - 1);
    for (let channel = 0; channel < channels; channel++) {
      const a = wav.samples[Math.min(index, inFrames - 1) * channels + channel];
      const b = wav.samples[next * channels + channel];
      out[frame * channels + channel] = Math.round(a + (b - a) * fraction);
    }
  }

  return { samples: out, sampleRate: to, channels };
}

/**
 * True when a buffer is an MP3 in MPEG-1 or MPEG-2 proper.
 *
 * Used to retire files cached before resampling existed, which were written
 * as MPEG-2.5 and are exactly the ones some players refuse.
 */
export function isStandardMp3(buffer: Buffer): boolean {
  let offset = 0;
  // Skip an ID3v2 tag: "ID3", version, flags, then a 4-byte syncsafe size.
  if (buffer.length > 10 && buffer.toString("ascii", 0, 3) === "ID3") {
    offset =
      10 +
      ((buffer[6] & 0x7f) << 21) +
      ((buffer[7] & 0x7f) << 14) +
      ((buffer[8] & 0x7f) << 7) +
      (buffer[9] & 0x7f);
  }
  if (offset + 2 > buffer.length) return false;
  if (buffer[offset] !== 0xff || (buffer[offset + 1] & 0xe0) !== 0xe0) return false;
  const version = (buffer[offset + 1] >> 3) & 0x03;
  // 0 = MPEG-2.5, 1 = reserved, 2 = MPEG-2, 3 = MPEG-1.
  return version === 2 || version === 3;
}

/** One ID3v2.3 text frame. */
function textFrame(id: string, text: string): Buffer {
  // Encoding byte 1 = UTF-16 with BOM, so any name survives.
  const body = Buffer.concat([Buffer.from([1, 0xff, 0xfe]), Buffer.from(text, "utf16le")]);
  const header = Buffer.alloc(10);
  header.write(id, 0, "ascii");
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}

/**
 * Prepends an ID3v2.3 tag, so the file shows a title and "Tringlo AI" in any
 * player or file manager instead of an anonymous blob.
 */
export function withId3Tag(mp3: Buffer, tag: { title: string; artist?: string; year?: string }): Buffer {
  const frames = Buffer.concat(
    [
      textFrame("TIT2", tag.title),
      textFrame("TPE1", tag.artist ?? "Tringlo AI"),
      tag.year ? textFrame("TYER", tag.year) : null,
    ].filter((frame): frame is Buffer => frame !== null)
  );
  const size = frames.length;
  const header = Buffer.from([
    0x49, 0x44, 0x33, 3, 0, 0,
    (size >> 21) & 0x7f,
    (size >> 14) & 0x7f,
    (size >> 7) & 0x7f,
    size & 0x7f,
  ]);
  return Buffer.concat([header, frames, mp3]);
}

/** LAME wants samples in blocks; this is the size its own examples use. */
const BLOCK_SIZE = 1152;

export interface DecodedWav {
  /** Interleaved samples, signed 16-bit. */
  samples: Int16Array;
  sampleRate: number;
  channels: number;
}

export type DecodeResult =
  | { ok: true; wav: DecodedWav }
  | { ok: false; reason: string };

/**
 * WAVE format tags, for reporting what an unsupported file actually is.
 *
 * Only PCM is decoded. The others are named so a failure says "this is µ-law"
 * rather than "unsupported format 7".
 */
const FORMAT_NAMES: Record<number, string> = {
  1: "PCM",
  3: "IEEE float",
  6: "A-law",
  7: "µ-law",
  85: "MP3",
  65534: "WAVE_FORMAT_EXTENSIBLE",
};

/**
 * Reads a WAV file by walking its chunks.
 *
 * Chunk-walking rather than assuming the canonical 44-byte header: real files
 * carry `LIST`, `fact` and other chunks before the data, and a fixed offset
 * would read metadata as audio and produce a burst of noise.
 */
export function decodeWav(buffer: Buffer): DecodeResult {
  if (buffer.length < 12) return { ok: false, reason: "File is too short to be a WAV." };
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    return { ok: false, reason: "Not a RIFF/WAVE file." };
  }

  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataStart = -1;
  let dataLength = 0;

  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;

    if (id === "fmt " && body + 16 <= buffer.length) {
      format = buffer.readUInt16LE(body);
      channels = buffer.readUInt16LE(body + 2);
      sampleRate = buffer.readUInt32LE(body + 4);
      bitsPerSample = buffer.readUInt16LE(body + 14);

      // EXTENSIBLE carries the real tag in its sub-format GUID; the first two
      // bytes of that GUID are the format code.
      if (format === 65534 && body + 26 <= buffer.length) {
        format = buffer.readUInt16LE(body + 24);
      }
    } else if (id === "data") {
      dataStart = body;
      // A streamed file can declare size 0 or a length past the buffer; the
      // bytes actually present are what can be decoded.
      dataLength = size === 0 ? buffer.length - body : Math.min(size, buffer.length - body);
    }

    // Chunks are word-aligned, so an odd size is followed by a pad byte.
    offset = body + size + (size % 2);
    if (size === 0 && id !== "data") break;
  }

  if (dataStart < 0 || dataLength <= 0) return { ok: false, reason: "No audio data in the file." };
  if (format !== 1) {
    const name = FORMAT_NAMES[format] ?? `format ${format}`;
    return { ok: false, reason: `Audio is ${name}; only PCM can be converted.` };
  }
  if (channels < 1 || channels > 2) {
    return { ok: false, reason: `Unsupported channel count (${channels}).` };
  }
  if (sampleRate <= 0) return { ok: false, reason: "Missing sample rate." };

  // 8-bit WAV is unsigned and centred on 128; 16-bit is signed. Both are
  // normalised to signed 16-bit, which is what the encoder takes.
  let samples: Int16Array;

  if (bitsPerSample === 16) {
    const count = Math.floor(dataLength / 2);
    samples = new Int16Array(count);
    for (let i = 0; i < count; i++) {
      samples[i] = buffer.readInt16LE(dataStart + i * 2);
    }
  } else if (bitsPerSample === 8) {
    samples = new Int16Array(dataLength);
    for (let i = 0; i < dataLength; i++) {
      samples[i] = (buffer[dataStart + i] - 128) * 256;
    }
  } else {
    return { ok: false, reason: `Unsupported bit depth (${bitsPerSample}).` };
  }

  return { ok: true, wav: { samples, sampleRate, channels } };
}

export type EncodeResult =
  | { ok: true; mp3: Buffer }
  | { ok: false; reason: string };

/**
 * Encodes decoded PCM to MP3.
 *
 * Stereo is de-interleaved into two channel arrays, which is the shape LAME
 * expects; mono goes straight through.
 */
export async function encodeMp3(source: DecodedWav): Promise<EncodeResult> {
  try {
    const wav = resample(source, targetRate(source.sampleRate));
    const { Mp3Encoder } = await loadLame();
    const encoder = new Mp3Encoder(wav.channels, wav.sampleRate, BITRATE_KBPS);
    const chunks: Buffer[] = [];

    if (wav.channels === 1) {
      for (let i = 0; i < wav.samples.length; i += BLOCK_SIZE) {
        const block = wav.samples.subarray(i, i + BLOCK_SIZE);
        const encoded = encoder.encodeBuffer(block);
        if (encoded.length > 0) chunks.push(Buffer.from(encoded));
      }
    } else {
      const frames = Math.floor(wav.samples.length / 2);
      const left = new Int16Array(BLOCK_SIZE);
      const right = new Int16Array(BLOCK_SIZE);

      for (let i = 0; i < frames; i += BLOCK_SIZE) {
        const size = Math.min(BLOCK_SIZE, frames - i);
        for (let j = 0; j < size; j++) {
          left[j] = wav.samples[(i + j) * 2];
          right[j] = wav.samples[(i + j) * 2 + 1];
        }
        const encoded = encoder.encodeBuffer(
          left.subarray(0, size),
          right.subarray(0, size)
        );
        if (encoded.length > 0) chunks.push(Buffer.from(encoded));
      }
    }

    // Flushes the final partial frame; without it the last moment of the call
    // is missing, which on a short call is the part that matters.
    const tail = encoder.flush();
    if (tail.length > 0) chunks.push(Buffer.from(tail));

    const mp3 = Buffer.concat(chunks);
    if (mp3.length === 0) return { ok: false, reason: "Encoder produced no audio." };

    return { ok: true, mp3 };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "Encoding failed.",
    };
  }
}

/** Decode and encode in one step. */
export async function wavToMp3(buffer: Buffer): Promise<EncodeResult> {
  const decoded = decodeWav(buffer);
  if (!decoded.ok) return { ok: false, reason: decoded.reason };
  return encodeMp3(decoded.wav);
}
