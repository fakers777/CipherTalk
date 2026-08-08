import { fileURLToPath } from 'url'

/**
 * 将 file:// URL（可带 ?v=mtime 缓存戳）转为本地绝对路径。
 * 不要用 replace(/^file:\/\/\//) —— 在 macOS/Linux 上会吃掉路径开头的 `/`。
 */
export function localPathFromFileUrl(urlOrPath: string): string {
  const trimmed = String(urlOrPath || '').trim()
  if (!trimmed) return trimmed
  if (!/^file:/i.test(trimmed)) return trimmed
  const withoutQuery = trimmed.replace(/\?v=\d+$/, '')
  return fileURLToPath(withoutQuery)
}
