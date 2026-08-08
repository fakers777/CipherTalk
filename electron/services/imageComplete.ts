/**
 * 图片 buffer 完整性：尾部零填充裁剪 + EOI/IEND 校验。
 * 供 imageDecryptService 与回归脚本共用。
 */

export function stripTrailingNulBytes(data: Buffer): Buffer {
  if (!data || data.length === 0) return data
  let end = data.length
  while (end > 0 && data[end - 1] === 0x00) end -= 1
  return end === data.length ? data : data.subarray(0, end)
}

/**
 * 验证图片数据是否完整。
 * 会先去掉尾部 0x00 填充（旧微信明文 .dat 常见），再查结束标记。
 */
export function verifyImageComplete(data: Buffer, ext: string): boolean {
  if (!data || data.length < 100) return false

  const trimmed = stripTrailingNulBytes(data)
  if (trimmed.length < 100) return false

  const lowerExt = ext.toLowerCase()

  if (lowerExt === '.jpg' || lowerExt === '.jpeg') {
    const searchLen = Math.min(trimmed.length, 64)
    for (let i = trimmed.length - 2; i >= trimmed.length - searchLen; i--) {
      if (trimmed[i] === 0xFF && trimmed[i + 1] === 0xD9) {
        return true
      }
    }
    // Motion Photo：JPEG 后跟 MP4，EOI 可能在后 1/4 区间
    const quarterStart = Math.floor(trimmed.length * 3 / 4)
    for (let i = quarterStart; i < trimmed.length - 1; i++) {
      if (trimmed[i] === 0xFF && trimmed[i + 1] === 0xD9) {
        return true
      }
    }
    return false
  }

  if (lowerExt === '.png') {
    if (trimmed.length < 12) return false
    const tail = trimmed.subarray(trimmed.length - 12)
    return tail[4] === 0x49 && tail[5] === 0x45 && tail[6] === 0x4E && tail[7] === 0x44
  }

  if (lowerExt === '.gif') {
    return trimmed[trimmed.length - 1] === 0x3B
  }

  return trimmed.length > 100
}
