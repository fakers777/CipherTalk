import { Anthropic, DeepSeek, Doubao, Gemini, Kimi, Ollama, OpenAI, ProviderIcon, Qwen, SiliconCloud, XiaomiMiMo, XAI, Yuanbao, Zhipu } from '@lobehub/icons'
import { Rocket, Sparkles } from '@gravity-ui/icons'
import DOMPurify from 'dompurify'
import { useEffect, useState } from 'react'

type AIProviderLogoProps = {
  providerId?: string
  logo?: string
  alt: string
  className?: string
  size?: number
}

const SUPPORTED_PROVIDER_IDS = new Set([
  'openai',
  'anthropic',
  'minimax',
  'gemini',
  'zhipu',
  'qwen',
  'deepseek',
  'doubao',
  'kimi',
  'ollama',
  'xai',
  'tencent'
])

function iconClassName(className?: string) {
  return ['text-muted-foreground', className].filter(Boolean).join(' ')
}

// models.dev 的 logo 分两类：abacus.svg 那种 fill="currentColor" 的单色图标，和 302ai.svg 那种
// 硬编码配色的完整品牌图。以前一律拿 CSS mask 单色化，后者的实心底图会被糊成一个纯色块（一坨），
// 所以改成内联 svg：currentColor 跟随主题，带配色的保持原样。远端内容，内联前必须消毒。
const svgCache = new Map<string, string>()

function sanitizeSvg(text: string): string {
  if (!text.trim().startsWith('<svg')) return ''
  return DOMPurify.sanitize(text, { USE_PROFILES: { svg: true, svgFilters: true } })
    // 拉伸型的 preserveAspectRatio 会把宽扁 logo 撑变形，统一按等比缩放居中
    .replace(/preserveAspectRatio="[^"]*"/g, 'preserveAspectRatio="xMidYMid meet"')
}

// 随包快照（scripts/fetch-models-dev-logos.cjs 生成）。models.dev 国内被墙，联网只能兜底，
// 所以 logo 走内置优先；366KB 的 JSON 由 vite 拆成独立 chunk，用到时才加载。
let bundledLogos: Record<string, string> | null = null

async function loadBundledLogo(providerId: string): Promise<string> {
  if (!providerId) return ''
  if (!bundledLogos) {
    bundledLogos = (await import('@/assets/models-dev-logos.json')).default as Record<string, string>
  }
  return bundledLogos[providerId] || ''
}

async function loadLogoSvg(providerId: string, url: string): Promise<string> {
  const bundled = await loadBundledLogo(providerId)
  if (bundled) return sanitizeSvg(bundled)

  // 快照里没有的新 provider 才联网拉一次（国内没代理会失败，接受）
  try {
    const response = await fetch(url)
    if (response.ok) return sanitizeSvg(await response.text())
  } catch {
    // 拉不到就不显示图标
  }
  return ''
}

function useProviderSvg(providerId: string, url: string): string {
  const cacheKey = `${providerId}|${url}`
  const [svg, setSvg] = useState(() => svgCache.get(cacheKey) ?? '')

  useEffect(() => {
    const cached = svgCache.get(cacheKey)
    if (cached !== undefined) {
      setSvg(cached)
      return
    }

    let cancelled = false
    void loadLogoSvg(providerId, url).then((clean) => {
      // ponytail: 失败结果也进缓存，否则断网时每次打开设置页都要重发一堆必败请求；
      // 代价是网络恢复后要重开应用才会重试。真嫌弃了再给失败项加个过期时间。
      svgCache.set(cacheKey, clean)
      if (!cancelled) setSvg(clean)
    })
    return () => { cancelled = true }
  }, [cacheKey, providerId, url])

  return svg
}

function RemoteProviderLogo({ providerId, url, alt, className, size }: { providerId: string; url: string; alt: string; className: string; size: number }) {
  const svg = useProviderSvg(providerId, url)
  if (!svg) return null

  return (
    <span
      aria-label={alt}
      className={`${className} [&>svg]:block [&>svg]:size-full`}
      dangerouslySetInnerHTML={{ __html: svg }}
      role="img"
      style={{ display: 'inline-block', height: size, width: size }}
    />
  )
}

function normalizeProviderId(providerId?: string) {
  if (!providerId) return ''
  if (providerId === 'custom-responses') return 'openai'
  if (providerId === 'openai-codex') return 'openai'
  if (providerId === 'openai-compatible') return 'custom'
  if (providerId === 'google') return 'gemini'
  if (providerId === 'alibaba-cn') return 'qwen'
  if (providerId === 'moonshotai-cn') return 'kimi'
  if (providerId === 'siliconflow' || providerId === 'siliconflow-cn') return 'siliconcloud'
  if (providerId === 'tencent-tokenhub') return 'tencent'
  if (providerId === 'xiaomi') return 'xiaomimimo'
  return providerId
}

export default function AIProviderLogo({ providerId, logo, alt, className, size = 24 }: AIProviderLogoProps) {
  const normalizedProviderId = normalizeProviderId(providerId)
  // 快照的 key 是 models.dev 的原始 provider id；logo URL 只在快照缺这个 provider 时才用
  const logoUrl = logo || (normalizedProviderId ? `https://models.dev/logos/${normalizedProviderId}.svg` : '')
  const unifiedClassName = iconClassName(className)

  if (normalizedProviderId === 'custom') {
    return <Sparkles width={size} height={size} className={unifiedClassName} />
  }

  if (normalizedProviderId === 'relayone') {
    return <Rocket width={size} height={size} className={unifiedClassName} />
  }

  if (normalizedProviderId === 'gemini') {
    return <Gemini size={size} className={unifiedClassName} color="currentColor" />
  }

  if (normalizedProviderId === 'kimi') {
    return <Kimi size={size} className={unifiedClassName} color="currentColor" />
  }

  if (normalizedProviderId === 'siliconcloud') {
    return <SiliconCloud size={size} className={unifiedClassName} color="currentColor" />
  }

  if (normalizedProviderId === 'xiaomimimo') {
    return <XiaomiMiMo size={size} className={unifiedClassName} color="currentColor" />
  }

  if (normalizedProviderId === 'tencent') {
    return <Yuanbao size={size} className={unifiedClassName} color="currentColor" />
  }

  if (normalizedProviderId === 'openai') {
    return <OpenAI size={size} className={unifiedClassName} color="currentColor" />
  }

  if (normalizedProviderId === 'anthropic') {
    return <Anthropic size={size} className={unifiedClassName} color="currentColor" />
  }

  if (normalizedProviderId === 'qwen') {
    return <Qwen size={size} className={unifiedClassName} color="currentColor" />
  }

  if (normalizedProviderId === 'zhipu') {
    return <Zhipu size={size} className={unifiedClassName} color="currentColor" />
  }

  if (normalizedProviderId === 'deepseek') {
    return <DeepSeek size={size} className={unifiedClassName} color="currentColor" />
  }

  if (normalizedProviderId === 'doubao') {
    return <Doubao size={size} className={unifiedClassName} color="currentColor" />
  }

  if (normalizedProviderId === 'ollama') {
    return <Ollama size={size} className={unifiedClassName} color="currentColor" />
  }

  if (normalizedProviderId === 'xai') {
    return <XAI size={size} className={unifiedClassName} color="currentColor" />
  }

  if (normalizedProviderId && SUPPORTED_PROVIDER_IDS.has(normalizedProviderId)) {
    return <ProviderIcon provider={normalizedProviderId} type="mono" forceMono size={size} className={unifiedClassName} />
  }

  if (providerId || logoUrl) {
    return <RemoteProviderLogo alt={alt} className={unifiedClassName} providerId={providerId || ''} size={size} url={logoUrl} />
  }

  return null
}
