/**
 * 连发建议的分隔与分句。
 *
 * 单独成文件是因为主进程的自动发送要按同一规则逐句发出——磁贴上显示几句、就得发几句，
 * 规则一旦两边各写一份必然漂移。这里保持零 import，主进程 bundle 不会因此拉进渲染端依赖链。
 */

/** 连发建议的分隔符：与画像语料里的连发分隔约定一致，模型按此拆条。 */
export const SUGGEST_BURST_JOINER = '／'

/** 把一条建议按连发分隔符拆成若干短句（无分隔符时返回单元素数组）。 */
export function splitSuggestionBursts(text: string): string[] {
  const segs = text.split(SUGGEST_BURST_JOINER).map((t) => t.trim()).filter(Boolean)
  return segs.length > 0 ? segs : [text.trim()]
}
