/**
 * AI 作图服务 —— 独立的图像生成配置（AI 助手 generate_image 工具用），与聊天模型分开。
 * 配置存 ConfigService.imageGenConfig；openai/google 协议走 AI SDK generateImage，
 * openai-compatible 走 baseURL + /images/generations，custom 直接请求完整 URL。
 * 直连接口使用 OpenAI 图片生成请求体 + 宽容解析（国内厂商多返回 url 而非 b64_json）。
 * 可在主进程与 AI 子进程复用（ConfigService 在两边都能解析路径）。
 */
import fs from 'fs'
import path from 'path'
import { generateImage } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createGoogle } from '@ai-sdk/google'
import { ConfigService } from '../config'
import { createProxyFetch, getResolvedProxyUrl } from './proxyFetch'

export interface ImageGenConfig {
  enabled: boolean
  protocol: 'openai-compatible' | 'openai' | 'google' | 'custom'
  apiKey: string
  baseURL: string
  model: string
  /** 图片尺寸，如 1024x1024；空 = 由 AI 工具按构图自选（未传时再交服务商默认）。 */
  size: string
  /** 作图请求超时，毫秒。 */
  timeoutMs: number
}

export interface ImageGenResult {
  success: boolean
  /** 生成图片的本地绝对路径（成功时），渲染端用 local-image:// 协议展示 */
  filePath?: string
  mimeType?: string
  error?: string
}

const DEFAULT_IMAGE_GEN_TIMEOUT_MS = 3_600_000
const MIN_IMAGE_GEN_TIMEOUT_MS = 60000
const MAX_IMAGE_GEN_TIMEOUT_MS = 3_600_000

function normalizeImageGenTimeoutMs(value: unknown): number {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_IMAGE_GEN_TIMEOUT_MS
  return Math.max(MIN_IMAGE_GEN_TIMEOUT_MS, Math.min(MAX_IMAGE_GEN_TIMEOUT_MS, n))
}

function normalizeImageGenConfig(cfg: ImageGenConfig | Partial<ImageGenConfig>): ImageGenConfig {
  return {
    enabled: Boolean(cfg.enabled),
    protocol: cfg.protocol === 'openai' || cfg.protocol === 'google' || cfg.protocol === 'custom' ? cfg.protocol : 'openai-compatible',
    apiKey: String(cfg.apiKey || ''),
    baseURL: String(cfg.baseURL || ''),
    model: String(cfg.model || ''),
    size: String(cfg.size || ''),
    timeoutMs: normalizeImageGenTimeoutMs(cfg.timeoutMs),
  }
}

/** 读取持久化的作图配置。 */
export function getImageGenConfig(): ImageGenConfig {
  const cs = new ConfigService()
  try {
    return normalizeImageGenConfig(cs.get('imageGenConfig'))
  } finally {
    cs.close()
  }
}

/** 写入作图配置（部分字段合并）。 */
export function saveImageGenConfig(patch: Partial<ImageGenConfig>): ImageGenConfig {
  const cs = new ConfigService()
  try {
    const next = normalizeImageGenConfig({ ...cs.get('imageGenConfig'), ...patch })
    cs.set('imageGenConfig', next)
    return next
  } finally {
    cs.close()
  }
}

/** 作图是否可用：启用且配了 key/模型。engine 据此决定是否挂 generate_image 工具。 */
export function isImageGenAvailable(cfg: ImageGenConfig = getImageGenConfig()): boolean {
  return cfg.enabled && Boolean(cfg.apiKey) && Boolean(cfg.model)
}

function imageOutputDir(): string {
  const cs = new ConfigService()
  try {
    const dir = path.join(cs.getCacheBasePath(), 'ai-images')
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    return dir
  } finally {
    cs.close()
  }
}

function extensionOf(mimeType: string): string {
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg'
  if (mimeType.includes('webp')) return 'webp'
  return 'png'
}

function saveImageBuffer(data: Uint8Array, mimeType: string): string {
  if (!data || data.byteLength === 0) {
    throw new Error('生成图片数据为空')
  }
  const filePath = path.join(
    imageOutputDir(),
    `img-${Date.now()}-${Math.floor(Math.random() * 1e6)}.${extensionOf(mimeType)}`,
  )
  fs.writeFileSync(filePath, data)
  return filePath
}

function normalizeSize(size?: string): `${number}x${number}` | undefined {
  const value = String(size || '').trim()
  return /^\d+x\d+$/.test(value) ? (value as `${number}x${number}`) : undefined
}

/**
 * 厂商拒绝尺寸时从报错里挑一个它支持的尺寸重试。
 * 各家白名单不同且会变，不内置尺寸表，直接用报错里列出的那批；
 * 有原尺寸就选宽高比最接近的，没有就选最方的。
 */
function pickSupportedSize(error: string | undefined, requested?: string): string {
  const message = String(error || '')
  if (!/size|尺寸|resolution|dimension/i.test(message)) return ''

  const candidates = (message.match(/\b\d{2,5}x\d{2,5}\b/gi) || [])
    .map((item) => item.toLowerCase())
    .filter((item, index, list) => list.indexOf(item) === index && item !== String(requested || '').trim().toLowerCase())
  // 报错只说 size 必填、没给白名单时，用几乎所有厂商都支持的方图兜底
  if (candidates.length === 0) return /required|必填|missing|不能为空/i.test(message) ? '1024x1024' : ''

  const ratioOf = (size: string) => {
    const [w, h] = size.split('x').map(Number)
    return w > 0 && h > 0 ? w / h : 1
  }
  const target = /^\d+x\d+$/.test(String(requested || '').trim()) ? ratioOf(String(requested).trim()) : 1
  return candidates.reduce((best, item) =>
    Math.abs(ratioOf(item) - target) < Math.abs(ratioOf(best) - target) ? item : best)
}

/** openai / google 协议：AI SDK generateImage。 */
async function generateViaAiSdk(prompt: string, cfg: ImageGenConfig, size?: string, signal?: AbortSignal): Promise<ImageGenResult> {
  const fetch = createProxyFetch(getResolvedProxyUrl())
  const model = cfg.protocol === 'google'
    ? createGoogle({ apiKey: cfg.apiKey, baseURL: cfg.baseURL || undefined, name: 'image-gen', fetch }).imageModel(cfg.model)
    : createOpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL || undefined, name: 'image-gen', fetch }).imageModel(cfg.model)

  const { image } = await generateImage({
    model,
    prompt,
    n: 1,
    size: normalizeSize(size || cfg.size),
    maxRetries: 1,
    abortSignal: signal,
  })

  const mimeType = image.mediaType || 'image/png'
  if (!image.uint8Array || image.uint8Array.byteLength === 0) {
    return { success: false, error: '作图接口返回成功，但 AI SDK 未返回有效图片数据（图片字节为空）' }
  }
  return { success: true, filePath: saveImageBuffer(image.uint8Array, mimeType), mimeType }
}

/**
 * openai-compatible 协议：直连 /images/generations。
 * 不带 response_format（部分厂商会拒绝），响应同时兼容 data[].b64_json / data[].url / images[].url。
 */
async function generateViaCompatible(prompt: string, cfg: ImageGenConfig, size?: string, signal?: AbortSignal): Promise<ImageGenResult> {
  if (!cfg.baseURL) return { success: false, error: cfg.protocol === 'custom' ? '未配置作图完整接口地址' : '未配置作图接口地址' }
  const fetchImpl = createProxyFetch(getResolvedProxyUrl()) || fetch
  const endpoint = cfg.protocol === 'custom'
    ? cfg.baseURL.trim()
    : `${cfg.baseURL.trim().replace(/\/+$/, '')}/images/generations`
  const sizeValue = normalizeSize(size || cfg.size)

  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      prompt,
      n: 1,
      ...(sizeValue ? { size: sizeValue, image_size: sizeValue } : {}),
    }),
    signal,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    let message = `HTTP ${response.status}`
    try {
      const payload = JSON.parse(text)
      message = payload?.error?.message || payload?.message || message
    } catch { /* 用原始状态码 */ }
    return { success: false, error: `作图请求失败: ${message}` }
  }

  const payload: any = await response.json().catch(() => null)
  const item = payload?.data?.[0] || payload?.images?.[0]
  const b64 = String(item?.b64_json || '').trim()
  if (b64) {
    const data = Buffer.from(b64, 'base64')
    if (data.byteLength === 0) {
      return { success: false, error: '作图接口返回成功，但 b64_json 解码后为空' }
    }
    return { success: true, filePath: saveImageBuffer(data, 'image/png'), mimeType: 'image/png' }
  }
  const url = String(item?.url || '').trim()
  if (url) {
    const imageResponse = await fetchImpl(url, { signal })
    if (!imageResponse.ok) return { success: false, error: `下载生成图片失败: HTTP ${imageResponse.status}` }
    const mimeType = imageResponse.headers.get('content-type')?.split(';')[0] || 'image/png'
    const data = new Uint8Array(await imageResponse.arrayBuffer())
    if (data.byteLength === 0) {
      return { success: false, error: '下载生成图片失败：图片响应为空' }
    }
    return { success: true, filePath: saveImageBuffer(data, mimeType), mimeType }
  }
  return { success: false, error: '作图接口返回成功，但未找到图片数据（b64_json/url 均为空）' }
}

/** 生成图片并落盘。cfg 缺省读持久化配置（测试时传 overrides）。 */
export async function generateImageToFile(
  prompt: string,
  options: { size?: string; config?: Partial<ImageGenConfig>; signal?: AbortSignal } = {},
): Promise<ImageGenResult> {
  const cfg = normalizeImageGenConfig({ ...getImageGenConfig(), ...options.config })
  if (!cfg.apiKey) return { success: false, error: '未配置作图 API Key' }
  if (!cfg.model) return { success: false, error: '未配置作图模型' }
  const input = String(prompt || '').trim()
  if (!input) return { success: false, error: '作图提示词为空' }

  const controller = new AbortController()
  const timeoutMs = normalizeImageGenTimeoutMs(cfg.timeoutMs)
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  options.signal?.addEventListener('abort', () => controller.abort())

  const attempt = async (size?: string): Promise<ImageGenResult> => {
    try {
      if (cfg.protocol === 'openai-compatible' || cfg.protocol === 'custom') {
        return await generateViaCompatible(input, cfg, size, controller.signal)
      }
      return await generateViaAiSdk(input, cfg, size, controller.signal)
    } catch (e) {
      if (controller.signal.aborted && !options.signal?.aborted) {
        return { success: false, error: `作图请求超时（>${Math.round(timeoutMs / 1000)}秒），请稍后重试` }
      }
      const err = e as { responseBody?: string; message?: string }
      return { success: false, error: [err?.message, err?.responseBody].filter(Boolean).join(' · ') || String(e) }
    }
  }

  try {
    const requested = options.size || cfg.size
    const result = await attempt(options.size)
    if (result.success || controller.signal.aborted) return result

    const fallbackSize = pickSupportedSize(result.error, requested)
    if (!fallbackSize) return result
    console.warn(`[ImageGen] 尺寸 ${requested || '(未指定)'} 被拒，改用报错里支持的 ${fallbackSize} 重试`)
    const retried = await attempt(fallbackSize)
    return retried.success ? retried : result
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * 测试配置：真实生成一张图验证全链路（会消耗少量额度）。
 * 不指定 size，用配置里的图片尺寸；很多厂商只接受白名单尺寸，写死小图会被拒。
 */
export async function testImageGenConfig(cfg: Partial<ImageGenConfig>): Promise<ImageGenResult> {
  return generateImageToFile('一只可爱的橘猫，扁平插画风格', { config: cfg })
}
