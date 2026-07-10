import { deflateSync } from "node:zlib"

const pngSignature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const u32 = (value: number): Uint8Array => {
  const bytes = new Uint8Array(4)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, value, false)
  return bytes
}

const ascii = (value: string): Uint8Array => new TextEncoder().encode(value)

const concat = (parts: ReadonlyArray<Uint8Array>): Uint8Array => {
  const size = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const typeBytes = ascii(type)
  return concat([u32(data.length), typeBytes, data, u32(crc32(concat([typeBytes, data])))])
}

/** Just an ftyp box plus a marker string — enough for artifact tests, not a playable video. */
export const makeStubMp4 = (): Uint8Array =>
  concat([
    u32(0x18),
    ascii("ftypisom"),
    u32(0x200),
    ascii("isommp41"),
    ascii("dfarm stub recording"),
  ])

export const makeStubPng = (counter: number): Uint8Array => {
  const width = 48
  const height = 32
  const raw = new Uint8Array((width * 4 + 1) * height)
  let offset = 0
  for (let y = 0; y < height; y += 1) {
    raw[offset++] = 0
    for (let x = 0; x < width; x += 1) {
      raw[offset++] = (counter * 29 + x * 3) % 256
      raw[offset++] = (counter * 47 + y * 5) % 256
      raw[offset++] = (counter * 13 + x + y) % 256
      raw[offset++] = 255
    }
  }

  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, width, false)
  view.setUint32(4, height, false)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return concat([
    pngSignature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  ])
}
