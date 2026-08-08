/**
 * Regression: V3 plaintext .dat must skip XOR; trailing NUL padding must still
 * count as complete after stripTrailingNulBytes / verifyImageComplete.
 *
 * Run: npx tsx scripts/test-dat-v3-plaintext.ts
 */
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { decryptDatLegacy, detectImageExtension } from '../electron/services/datDecryptCore'
import { stripTrailingNulBytes, verifyImageComplete } from '../electron/services/imageComplete'

const JPEG_MIN = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x00, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xd9,
])
const PNG_MIN = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xde, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
])

function padToMinSize(data: Buffer, min = 120): Buffer {
  if (data.length >= min) return data
  // 在结束标记前填充非零字节，避免破坏 EOI/IEND；再由调用方自行加尾部 0x00
  const body = Buffer.alloc(min - data.length, 0x11)
  // JPEG: insert before last 2 bytes (EOI); PNG: insert before last 12 (IEND chunk)
  if (data[0] === 0xff && data[1] === 0xd8) {
    return Buffer.concat([data.subarray(0, data.length - 2), body, data.subarray(data.length - 2)])
  }
  if (data[0] === 0x89 && data[1] === 0x50) {
    return Buffer.concat([data.subarray(0, data.length - 12), body, data.subarray(data.length - 12)])
  }
  return Buffer.concat([data, body])
}

function xorBuffer(data: Buffer, key: number): Buffer {
  const out = Buffer.alloc(data.length)
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ key
  return out
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

const dir = mkdtempSync(join(tmpdir(), 'ciphertalk-dat-v3-'))
try {
  const xorKey = 0x73
  const jpeg = padToMinSize(JPEG_MIN)
  const png = padToMinSize(PNG_MIN)

  // 1) Plaintext JPEG .dat + configured XOR key must stay JPEG
  const plainJpg = join(dir, 'plain.jpg.dat')
  writeFileSync(plainJpg, jpeg)
  const plainJpgOut = decryptDatLegacy(plainJpg, xorKey, null).data
  assert(detectImageExtension(plainJpgOut) === '.jpg', `plaintext jpg corrupted: ${plainJpgOut.subarray(0, 8).toString('hex')}`)
  assert(plainJpgOut.equals(jpeg), 'plaintext jpg bytes changed')

  // 2) Plaintext PNG .dat
  const plainPng = join(dir, 'plain.png.dat')
  writeFileSync(plainPng, png)
  const plainPngOut = decryptDatLegacy(plainPng, xorKey, null).data
  assert(detectImageExtension(plainPngOut) === '.png', `plaintext png corrupted: ${plainPngOut.subarray(0, 8).toString('hex')}`)
  assert(plainPngOut.equals(png), 'plaintext png bytes changed')

  // 3) Real V3 XOR-encrypted JPEG still decrypts
  const encJpg = join(dir, 'enc.jpg.dat')
  writeFileSync(encJpg, xorBuffer(jpeg, xorKey))
  const encJpgOut = decryptDatLegacy(encJpg, xorKey, null).data
  assert(detectImageExtension(encJpgOut) === '.jpg', `encrypted jpg failed: ${encJpgOut.subarray(0, 8).toString('hex')}`)
  assert(encJpgOut.equals(jpeg), 'encrypted jpg decrypt mismatch')

  // 4) Trailing NUL padding: production PNG/JPEG must still be "complete"
  const jpegPadded = Buffer.concat([jpeg, Buffer.alloc(16, 0x00)])
  const pngPadded = Buffer.concat([png, Buffer.alloc(16, 0x00)])

  assert(verifyImageComplete(jpegPadded, '.jpg'), 'JPEG with trailing NULs must be complete')
  assert(verifyImageComplete(pngPadded, '.png'), 'PNG with trailing NULs must be complete')
  // 对照：未裁剪且只看末 12 字节时 PNG 会失败（复现 review 场景）
  const rawPngTail = pngPadded.subarray(pngPadded.length - 12)
  assert(!(rawPngTail[4] === 0x49 && rawPngTail[5] === 0x45), 'sanity: raw padded PNG tail is not IEND')

  const paddedJpgPath = join(dir, 'plain-pad.jpg.dat')
  writeFileSync(paddedJpgPath, jpegPadded)
  const paddedJpgOut = decryptDatLegacy(paddedJpgPath, xorKey, null).data
  assert(paddedJpgOut.equals(jpeg), 'plaintext JPEG decrypt should strip trailing NULs')
  assert(verifyImageComplete(paddedJpgOut, '.jpg'), 'stripped JPEG must verify complete')

  const paddedPngPath = join(dir, 'plain-pad.png.dat')
  writeFileSync(paddedPngPath, pngPadded)
  const paddedPngOut = decryptDatLegacy(paddedPngPath, xorKey, null).data
  assert(paddedPngOut.equals(png), 'plaintext PNG decrypt should strip trailing NULs')
  assert(verifyImageComplete(paddedPngOut, '.png'), 'stripped PNG must verify complete')
  assert(stripTrailingNulBytes(pngPadded).equals(png), 'stripTrailingNulBytes should remove pad')

  console.log('PASS: V3 plaintext skip XOR; trailing NUL padding treated as complete')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
