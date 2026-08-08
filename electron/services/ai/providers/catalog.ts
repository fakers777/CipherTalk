import fs from 'fs'
import path from 'path'
import { BaseAIProvider, type ProviderKind } from './base'
import { getAppPath, getUserDataPath, isElectronPackaged } from '../../runtimePaths'
import { createProxyFetch, getResolvedProxyUrl } from '../proxyFetch'
import { getCodexSubscriptionAuthPath, CODEX_SUBSCRIPTION_DUMMY_API_KEY } from '../codexSubscriptionAuth'

export type AIProviderProtocol = ProviderKind

export interface AIProviderMetadata {
  id: string
  name: string
  displayName: string
  description: string
  protocol: AIProviderProtocol
  baseURL: string
  models: string[]
  modelDetails?: AIModelInfo[]
  pricing: string
  pricingDetail: {
    input: number
    output: number
  }
  website?: string
  logo?: string
  optionalApiKey?: boolean
  accountAuth?: boolean
  allowCustomBaseURL?: boolean
  protocolOptions?: AIProviderProtocol[]
}

export interface AIModelInfo {
  id: string
  name: string
  providerId: string
  family?: string
  modalities: {
    input: string[]
    output: string[]
  }
  capabilities: {
    attachment: boolean
    reasoning: boolean
    toolCall: boolean
    structuredOutput: boolean
    temperature: boolean
    openWeights: boolean
  }
  limits: {
    context?: number
    input?: number
    output?: number
  }
  cost?: {
    input?: number
    output?: number
    cacheRead?: number
    cacheWrite?: number
    inputAudio?: number
    outputAudio?: number
    reasoning?: number
    tiers?: unknown[]
    contextOver200k?: unknown
  }
  status?: string
  knowledge?: string
  releaseDate?: string
  lastUpdated?: string
  interleaved?: {
    field?: string
  }
  provider?: {
    npm?: string
    api?: string
    shape?: string
  }
}

const EMPTY_PRICING = {
  pricing: '在线获取',
  pricingDetail: { input: 0, output: 0 }
}

const CUSTOM_PROVIDER_DEFINITION: AIProviderMetadata = {
  id: 'custom',
  name: 'custom',
  displayName: '自定义',
  description: '自定义 OpenAI、Anthropic 或 Gemini 兼容接口',
  protocol: 'openai-compatible',
  baseURL: '',
  models: [],
  modelDetails: [],
  pricing: '自定义',
  pricingDetail: { input: 0, output: 0 },
  allowCustomBaseURL: true,
  protocolOptions: ['openai-responses', 'openai-compatible', 'anthropic', 'google']
}

const RELAYONE_PROVIDER_DEFINITION: AIProviderMetadata = {
  id: 'relayone',
  name: 'relayone',
  displayName: 'RelayOne（官方推荐）',
  description: '一个 Key 直连全模型，国内可用，注册即用',
  protocol: 'openai-responses',
  baseURL: 'https://aiapi.aiqji.cn/v1',
  models: [],
  modelDetails: [],
  pricing: '低于官方价',
  pricingDetail: { input: 0, output: 0 },
  website: 'https://hicccc.cc',
  // 中转站里同时挂了多种模型（GPT / Claude / Gemini 等），不同模型走的接口格式不一样，需要手选
  protocolOptions: ['openai-responses', 'openai-compatible', 'anthropic', 'google']
}

export const CODEX_SUBSCRIPTION_PROVIDER_ID = 'openai-codex'

/** Codex 订阅模型的能力都一样，只有名字和上下文长度不同（上下文由 /wham/models 给出） */
export function buildCodexSubscriptionModelDetail(id: string, name?: string, contextWindow?: number): AIModelInfo {
  const context = contextWindow || 272_000
  return {
    id,
    name: name || id,
    providerId: CODEX_SUBSCRIPTION_PROVIDER_ID,
    family: 'gpt',
    modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
    capabilities: { attachment: true, reasoning: true, toolCall: true, structuredOutput: true, temperature: false, openWeights: false },
    limits: { context, input: context, output: 128_000 },
  }
}

// 未登录时下拉框的占位；登录后一律以 /wham/models 拉到的为准
const CODEX_SUBSCRIPTION_MODEL_DETAILS: AIModelInfo[] = [
  buildCodexSubscriptionModelDetail('gpt-5.6-terra', 'GPT-5.6 Terra'),
  buildCodexSubscriptionModelDetail('gpt-5.6-luna', 'GPT-5.6 Luna'),
  buildCodexSubscriptionModelDetail('gpt-5.5', 'GPT-5.5'),
]

const CODEX_SUBSCRIPTION_PROVIDER_DEFINITION: AIProviderMetadata = {
  id: CODEX_SUBSCRIPTION_PROVIDER_ID,
  name: CODEX_SUBSCRIPTION_PROVIDER_ID,
  displayName: 'ChatGPT 订阅',
  description: '使用 ChatGPT 账号登录，直连 ChatGPT Codex Responses 接口调用订阅内额度',
  protocol: 'codex-subscription',
  baseURL: '',
  models: CODEX_SUBSCRIPTION_MODEL_DETAILS.map((model) => model.id),
  modelDetails: CODEX_SUBSCRIPTION_MODEL_DETAILS,
  pricing: '订阅额度',
  pricingDetail: { input: 0, output: 0 },
  optionalApiKey: true,
  accountAuth: true,
  logo: 'openai'
}

const PROVIDER_ID_ALIASES: Record<string, string> = {
  gemini: 'google',
  qwen: 'alibaba-cn',
  kimi: 'moonshotai-cn',
  siliconflow: 'siliconflow-cn',
  zhipu: 'zhipuai',
  tencent: 'tencent-tokenhub',
  'custom-responses': 'openai'
}
let modelsDevCache: { updatedAt: number; data: any } | null = null
const MODELS_DEV_CACHE_MS = 1000 * 60 * 60 * 6
const MODELS_DEV_SOURCE = process.env.CIPHERTALK_MODELS_URL || 'https://models.dev'
// 国内直连 models.dev 必失败，没挂代理的用户只能靠自家 R2 镜像（域名国内可达，api.json 和 logo 都由
// 发版流水线上传，见 .github/workflows/release.yml 的 mirror-r2）。自建了主源又没指定镜像的，就只认主源。
const MODELS_DEV_MIRROR_BASE = (process.env.CIPHERTALK_MODELS_MIRROR_BASE
  ?? (process.env.CIPHERTALK_MODELS_URL ? '' : 'https://miyuapp.aiqji.com')).replace(/\/+$/, '')
const MODELS_DEV_MIRROR_URL = MODELS_DEV_MIRROR_BASE ? `${MODELS_DEV_MIRROR_BASE}/models-dev.json` : ''
const MODELS_DEV_CACHE_PATH = process.env.CIPHERTALK_MODELS_PATH || path.join(
  getUserDataPath(),
  MODELS_DEV_SOURCE === 'https://models.dev' ? 'models-dev.json' : `models-dev-${Buffer.from(MODELS_DEV_SOURCE).toString('hex').slice(0, 16)}.json`
)
let modelsDevFetchPromise: Promise<any> | null = null
let modelsDevRefreshAttemptAt = 0

function toMetadata(provider: Omit<AIProviderMetadata, 'models' | 'modelDetails' | 'pricing' | 'pricingDetail'>, modelDetails: AIModelInfo[] = [], pricing = EMPTY_PRICING): AIProviderMetadata {
  return {
    ...provider,
    models: modelDetails.map(model => model.id),
    modelDetails,
    pricing: pricing.pricing,
    pricingDetail: { ...pricing.pricingDetail }
  }
}

function cloneMetadata(provider: AIProviderMetadata): AIProviderMetadata {
  return {
    ...provider,
    models: [...provider.models],
    protocolOptions: provider.protocolOptions ? [...provider.protocolOptions] : undefined,
    modelDetails: provider.modelDetails?.map(model => ({
      ...model,
      modalities: { input: [...model.modalities.input], output: [...model.modalities.output] },
      capabilities: { ...model.capabilities },
      limits: { ...model.limits },
      cost: model.cost ? { ...model.cost, tiers: model.cost.tiers ? [...model.cost.tiers] : undefined } : undefined,
      interleaved: model.interleaved ? { ...model.interleaved } : undefined,
      provider: model.provider ? { ...model.provider } : undefined
    })),
    pricingDetail: { ...provider.pricingDetail }
  }
}

export function normalizeProviderId(providerId: string): string {
  return PROVIDER_ID_ALIASES[providerId] || providerId
}

function readModelsDevCacheFile(): { updatedAt: number; data: any } | null {
  try {
    if (!fs.existsSync(MODELS_DEV_CACHE_PATH)) return null
    const stat = fs.statSync(MODELS_DEV_CACHE_PATH)
    const data = JSON.parse(fs.readFileSync(MODELS_DEV_CACHE_PATH, 'utf-8'))
    return { updatedAt: stat.mtimeMs, data }
  } catch (error) {
    console.warn('[AIProviderCatalog] 读取 models.dev 缓存失败:', error instanceof Error ? error.message : String(error))
    return null
  }
}

function writeModelsDevCacheFile(data: any): void {
  try {
    fs.mkdirSync(path.dirname(MODELS_DEV_CACHE_PATH), { recursive: true })
    fs.writeFileSync(MODELS_DEV_CACHE_PATH, JSON.stringify(data), 'utf-8')
  } catch (error) {
    console.warn('[AIProviderCatalog] 写入 models.dev 缓存失败:', error instanceof Error ? error.message : String(error))
  }
}

function getBundledModelsDevPath(): string {
  return isElectronPackaged()
    ? path.join(process.resourcesPath, 'assets', 'models-dev.json')
    : path.join(getAppPath(), 'electron', 'assets', 'models-dev.json')
}

function readBundledModelsDevData(): any | null {
  try {
    const bundledPath = getBundledModelsDevPath()
    if (!fs.existsSync(bundledPath)) return null
    return JSON.parse(fs.readFileSync(bundledPath, 'utf-8'))
  } catch (error) {
    console.warn('[AIProviderCatalog] 读取内置 models.dev 快照失败:', error instanceof Error ? error.message : String(error))
    return null
  }
}

function readAvailableModelsDevData(): any | null {
  if (modelsDevCache?.data) return modelsDevCache.data

  const diskCache = readModelsDevCacheFile()
  if (diskCache) {
    modelsDevCache = diskCache
    return diskCache.data
  }

  const bundled = readBundledModelsDevData()
  if (bundled) {
    modelsDevCache = { updatedAt: Date.now(), data: bundled }
    return bundled
  }

  return null
}

function getModelsDevProviders(data: any): Record<string, any> {
  const providers = data?.providers || data
  return providers && typeof providers === 'object' && !Array.isArray(providers) ? providers : {}
}

function inferProtocolFromModelsDevProvider(provider: any): AIProviderProtocol | null {
  const npmPackage = String(provider?.npm || '').trim()
  if (npmPackage === '@ai-sdk/openai-compatible') return 'openai-compatible'
  if (npmPackage === '@ai-sdk/xai') return 'openai-compatible'
  if (npmPackage === '@openrouter/ai-sdk-provider') return 'openai-compatible'
  if (npmPackage === '@ai-sdk/openai') return 'openai-responses'
  if (npmPackage === '@ai-sdk/anthropic') return 'anthropic'
  if (npmPackage === '@ai-sdk/google') return 'google'
  return null
}

function getModelsDevProviderBaseURL(provider: any): string {
  const configured = String(provider?.api || '').trim().replace(/\/+$/, '')
  if (configured) return configured
  if (String(provider?.npm || '').trim() === '@ai-sdk/xai') return 'https://api.x.ai/v1'
  return ''
}

function getModelsDevProviderLogo(providerId: string): string {
  // 渲染端优先用随包的 logo 快照，这个地址只在快照缺该 provider 时兜底（国内没代理会拉不到）
  return `${MODELS_DEV_SOURCE.replace(/\/+$/, '')}/logos/${providerId}.svg`
}

function buildModelsDevProviderMetadata(
  providerId: string,
  modelsDevProvider: any
): AIProviderMetadata | null {
  const protocol = inferProtocolFromModelsDevProvider(modelsDevProvider)
  if (!protocol) return null

  const baseURL = getModelsDevProviderBaseURL(modelsDevProvider)
  if (!baseURL && protocol === 'openai-compatible') return null

  const connection = {
    id: providerId,
    name: providerId,
    displayName: String(modelsDevProvider?.name || providerId),
    description: `${protocol} · ${modelsDevProvider?.npm || 'models.dev'}`,
    protocol,
    baseURL,
    website: modelsDevProvider?.doc || '',
    logo: getModelsDevProviderLogo(providerId)
  }

  return toMetadata(
    connection,
    readModelDetailsFromModelsDevProvider(connection.id, modelsDevProvider),
    getPricingFromModelsDevProvider(modelsDevProvider)
  )
}

// models.dev 在国内被 DNS 污染 + SNI 阻断（拿真实 Cloudflare IP 直连一样握手就被 RST），直连必失败。
// 别处的 AI 请求早就走 createProxyFetch 了，只有这里还是裸 fetch —— 用户挂了梯子也更新不到模型目录。
function getModelsDevFetch(): typeof globalThis.fetch {
  try {
    return createProxyFetch(getResolvedProxyUrl()) || fetch
  } catch {
    return fetch // 读不到代理配置（比如 config 还没就绪）就直连，行为跟以前一致
  }
}

async function fetchModelsDevData(): Promise<any> {
  const fetchImpl = getModelsDevFetch()
  const urls = [`${MODELS_DEV_SOURCE.replace(/\/+$/, '')}/api.json`, MODELS_DEV_MIRROR_URL].filter(Boolean)
  let lastError: unknown = new Error('没有可用的 models.dev 源')

  for (const url of urls) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    try {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'CipherTalk' }
      })
      if (!response.ok) {
        throw new Error(`请求失败: ${response.status}`)
      }
      return await response.json()
    } catch (error) {
      lastError = error
      console.warn(`[AIProviderCatalog] 源不可用，换下一个: ${url}`, error instanceof Error ? error.message : String(error))
    } finally {
      clearTimeout(timeout)
    }
  }

  throw lastError
}

async function fetchAndCacheModelsDevData(): Promise<any> {
  if (!modelsDevFetchPromise) {
    modelsDevFetchPromise = fetchModelsDevData()
      .then((data) => {
        modelsDevCache = { updatedAt: Date.now(), data }
        writeModelsDevCacheFile(data)
        return data
      })
      .finally(() => {
        modelsDevFetchPromise = null
      })
  }

  return modelsDevFetchPromise
}

// 过期不阻塞：本地有数据（内存/磁盘/内置快照）就先返回，联网刷新丢到后台。
// models.dev 在国内网络下常常直接超时（10s），以前这 10s 是顶在"AI 接入"等页面打开路径上的。
async function getModelsDevData(): Promise<any> {
  const now = Date.now()
  if (modelsDevCache && now - modelsDevCache.updatedAt < MODELS_DEV_CACHE_MS) {
    return modelsDevCache.data
  }

  if (!modelsDevCache) {
    const diskCache = readModelsDevCacheFile()
    if (diskCache) modelsDevCache = diskCache
  }

  const offlineOnly = process.env.CIPHERTALK_DISABLE_MODELS_FETCH === '1'
  const stale = modelsDevCache?.data ?? readBundledModelsDevData()
  if (stale) {
    // 内置快照没有真实时间，按"最旧"记，后台刷新成功后会被覆盖
    if (!modelsDevCache) modelsDevCache = { updatedAt: 0, data: stale }
    if (!offlineOnly && now - modelsDevRefreshAttemptAt >= MODELS_DEV_CACHE_MS) {
      modelsDevRefreshAttemptAt = now
      void fetchAndCacheModelsDevData().catch((error) => {
        console.warn('[AIProviderCatalog] models.dev 后台刷新失败，继续用本地数据:', error instanceof Error ? error.message : String(error))
      })
    }
    return stale
  }

  // 本地什么都没有（首装 + 快照缺失）才只能等网络
  if (offlineOnly) return {}
  modelsDevRefreshAttemptAt = now
  return await fetchAndCacheModelsDevData()
}

export async function refreshModelsDevCache(force = false): Promise<void> {
  const now = Date.now()
  const diskCache = readModelsDevCacheFile()
  if (!force && diskCache && now - diskCache.updatedAt < MODELS_DEV_CACHE_MS) {
    modelsDevCache = diskCache
    return
  }

  if (process.env.CIPHERTALK_DISABLE_MODELS_FETCH === '1') {
    if (diskCache) modelsDevCache = diskCache
    return
  }

  const data = await fetchModelsDevData()
  modelsDevCache = { updatedAt: Date.now(), data }
  writeModelsDevCacheFile(data)
}

function normalizeModelsDevProviderId(providerId: string): string[] {
  const aliases: Record<string, string[]> = {
    gemini: ['google'],
    qwen: ['alibaba-cn'],
    doubao: ['bytedance', 'volcengine', 'doubao'],
    kimi: ['moonshotai-cn'],
    siliconflow: ['siliconflow-cn'],
    zhipu: ['zhipuai'],
    tencent: ['tencent-tokenhub']
  }
  return aliases[providerId] || [providerId]
}

function getModelsDevProvider(data: any, providerId: string): any | undefined {
  const providers = getModelsDevProviders(data)
  for (const candidate of normalizeModelsDevProviderId(providerId)) {
    if (providers?.[candidate]) return providers[candidate]
  }
  return undefined
}

function getModelsDevModelEntries(provider: any): any[] {
  const models = provider?.models || provider
  if (Array.isArray(models)) return models
  if (models && typeof models === 'object') return Object.values(models)
  return []
}

function isTextChatModel(model: any): boolean {
  const input = Array.isArray(model?.modalities?.input) ? model.modalities.input : []
  const output = Array.isArray(model?.modalities?.output) ? model.modalities.output : []
  if (output.length > 0 && !output.includes('text')) return false
  if (input.length > 0 && !input.includes('text')) return false
  const id = String(model?.id || model?.name || '').toLowerCase()
  return !['embedding', 'rerank', 'whisper', 'tts', 'transcribe', 'speech', 'moderation', 'dall-e', 'image'].some(pattern => id.includes(pattern))
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => String(item || '').trim()).filter(Boolean) : []
}

function optionalNumber(value: unknown): number | undefined {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : undefined
}

function readModelDetailsFromModelsDevProvider(providerId: string, provider: any): AIModelInfo[] {
  return getModelsDevModelEntries(provider)
    .filter(isTextChatModel)
    .map((model: any): AIModelInfo | null => {
      const id = String(model?.id || model?.name || '').replace(/^models\//, '').trim()
      if (!id) return null

      return {
        id,
        name: String(model?.name || id),
        providerId,
        family: model?.family ? String(model.family) : undefined,
        modalities: {
          input: toStringArray(model?.modalities?.input),
          output: toStringArray(model?.modalities?.output)
        },
        capabilities: {
          attachment: Boolean(model?.attachment),
          reasoning: Boolean(model?.reasoning),
          toolCall: Boolean(model?.tool_call),
          structuredOutput: Boolean(model?.structured_output),
          temperature: model?.temperature !== false,
          openWeights: Boolean(model?.open_weights)
        },
        limits: {
          context: optionalNumber(model?.limit?.context),
          input: optionalNumber(model?.limit?.input),
          output: optionalNumber(model?.limit?.output)
        },
        cost: model?.cost ? {
          input: optionalNumber(model.cost.input),
          output: optionalNumber(model.cost.output),
          cacheRead: optionalNumber(model.cost.cache_read),
          cacheWrite: optionalNumber(model.cost.cache_write),
          inputAudio: optionalNumber(model.cost.input_audio),
          outputAudio: optionalNumber(model.cost.output_audio),
          reasoning: optionalNumber(model.cost.reasoning),
          tiers: Array.isArray(model.cost.tiers) ? model.cost.tiers : undefined,
          contextOver200k: model.cost.context_over_200k
        } : undefined,
        status: model?.status ? String(model.status) : undefined,
        knowledge: model?.knowledge ? String(model.knowledge) : undefined,
        releaseDate: model?.release_date ? String(model.release_date) : undefined,
        lastUpdated: model?.last_updated ? String(model.last_updated) : undefined,
        interleaved: model?.interleaved ? { field: model.interleaved.field ? String(model.interleaved.field) : undefined } : undefined,
        provider: (model?.provider || provider?.npm || provider?.api) ? {
          npm: model?.provider?.npm ? String(model.provider.npm) : (provider?.npm ? String(provider.npm) : undefined),
          api: model?.provider?.api ? String(model.provider.api) : (provider?.api ? String(provider.api) : undefined),
          shape: model?.provider?.shape ? String(model.provider.shape) : undefined
        } : undefined
      }
    })
    .filter((model): model is AIModelInfo => Boolean(model))
}

function getPricingFromModelsDevProvider(provider: any): { pricing: string; pricingDetail: { input: number; output: number } } {
  const pricedModels = getModelsDevModelEntries(provider)
    .filter(isTextChatModel)
    .map((model: any) => ({
      input: Number(model?.cost?.input),
      output: Number(model?.cost?.output)
    }))
    .filter(item => Number.isFinite(item.input) && Number.isFinite(item.output))

  if (pricedModels.length === 0) return EMPTY_PRICING

  const cheapest = pricedModels.reduce((best, item) => (
    item.input + item.output < best.input + best.output ? item : best
  ), pricedModels[0])

  return {
    pricing: `$${cheapest.input}/1M input, $${cheapest.output}/1M output 起`,
    pricingDetail: {
      input: cheapest.input / 1000,
      output: cheapest.output / 1000
    }
  }
}

function sortProviderDefinitions(providers: AIProviderMetadata[]): AIProviderMetadata[] {
  return [...providers].sort((a, b) => {
    return a.displayName.localeCompare(b.displayName, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
  })
}

function withCustomProvider(providers: AIProviderMetadata[]): AIProviderMetadata[] {
  return [
    cloneMetadata(RELAYONE_PROVIDER_DEFINITION),
    cloneMetadata(CUSTOM_PROVIDER_DEFINITION),
    cloneMetadata(CODEX_SUBSCRIPTION_PROVIDER_DEFINITION),
    ...providers.filter(provider => provider.id !== RELAYONE_PROVIDER_DEFINITION.id && provider.id !== CUSTOM_PROVIDER_DEFINITION.id && provider.id !== CODEX_SUBSCRIPTION_PROVIDER_ID)
  ]
}

function getProviderDefinitionsFromModelsDevData(data: any): AIProviderMetadata[] {
  const result = new Map<string, AIProviderMetadata>()
  const providers = getModelsDevProviders(data)
  for (const [providerId, modelsDevProvider] of Object.entries(providers)) {
    const metadata = buildModelsDevProviderMetadata(providerId, modelsDevProvider)
    if (!metadata || metadata.modelDetails?.length === 0) continue
    result.set(metadata.id, metadata)
  }

  return sortProviderDefinitions(Array.from(result.values()))
}

export async function getProviderDefinitions(): Promise<AIProviderMetadata[]> {
  try {
    const data = await getModelsDevData()
    return withCustomProvider(getProviderDefinitionsFromModelsDevData(data))
  } catch (error) {
    console.warn('[AIProviderCatalog] models.dev 获取失败，使用可用缓存:', error instanceof Error ? error.message : String(error))
    const data = readAvailableModelsDevData()
    if (data) return withCustomProvider(getProviderDefinitionsFromModelsDevData(data))
    return withCustomProvider([])
  }
}

export function getProviderDefinition(providerId: string): AIProviderMetadata | undefined {
  const resolvedProviderId = normalizeProviderId(providerId)
  if (resolvedProviderId === CODEX_SUBSCRIPTION_PROVIDER_ID) {
    return cloneMetadata(CODEX_SUBSCRIPTION_PROVIDER_DEFINITION)
  }
  if (resolvedProviderId === CUSTOM_PROVIDER_DEFINITION.id) {
    return cloneMetadata(CUSTOM_PROVIDER_DEFINITION)
  }
  if (resolvedProviderId === RELAYONE_PROVIDER_DEFINITION.id) {
    return cloneMetadata(RELAYONE_PROVIDER_DEFINITION)
  }

  const data = readAvailableModelsDevData()
  if (data) {
    const definition = getProviderDefinitionsFromModelsDevData(data).find(provider => provider.id === resolvedProviderId)
    if (definition) return cloneMetadata(definition)
  }

  return undefined
}

export async function getProviderDefinitionOnline(providerId: string): Promise<AIProviderMetadata | undefined> {
  const resolvedProviderId = normalizeProviderId(providerId)
  if (resolvedProviderId === CODEX_SUBSCRIPTION_PROVIDER_ID) {
    return cloneMetadata(CODEX_SUBSCRIPTION_PROVIDER_DEFINITION)
  }
  if (resolvedProviderId === CUSTOM_PROVIDER_DEFINITION.id) {
    return cloneMetadata(CUSTOM_PROVIDER_DEFINITION)
  }
  if (resolvedProviderId === RELAYONE_PROVIDER_DEFINITION.id) {
    return cloneMetadata(RELAYONE_PROVIDER_DEFINITION)
  }

  const data = await getModelsDevData()
  const definition = getProviderDefinitionsFromModelsDevData(data).find(provider => provider.id === resolvedProviderId)
  return definition
}

export class CatalogAIProvider extends BaseAIProvider {
  name: string
  displayName: string
  models: string[]
  pricing: { input: number; output: number }
  private definition: AIProviderMetadata

  constructor(definition: AIProviderMetadata, apiKey: string, baseURL?: string) {
    const effectiveBaseURL = baseURL || definition.baseURL
    super(
      definition.protocol === 'codex-subscription' ? CODEX_SUBSCRIPTION_DUMMY_API_KEY : apiKey,
      definition.protocol === 'codex-subscription' ? 'https://api.openai.com/v1' : effectiveBaseURL,
      definition.protocol,
      definition.protocol === 'codex-subscription' ? getCodexSubscriptionAuthPath() : undefined,
    )
    this.definition = definition
    this.name = definition.name
    this.displayName = definition.displayName
    this.models = definition.models
    this.pricing = definition.pricingDetail
  }

  protected getDefaultHeaders(): Record<string, string> | undefined {
    if (this.definition.id !== 'tencent' || !this.apiKey.includes('|')) {
      return undefined
    }

    const [secretId, secretKey] = this.apiKey.split('|').map(part => part.trim())
    if (!secretId || !secretKey) return undefined
    return { Authorization: `Bearer ${secretId};${secretKey}` }
  }

}

export async function getModelsDevModels(providerId: string): Promise<string[]> {
  const resolvedProviderId = normalizeProviderId(providerId)
  if (resolvedProviderId === CUSTOM_PROVIDER_DEFINITION.id || resolvedProviderId === CODEX_SUBSCRIPTION_PROVIDER_ID) return []

  const data = await getModelsDevData()
  const provider = getModelsDevProvider(data, resolvedProviderId)
  return provider ? Array.from(new Set(readModelDetailsFromModelsDevProvider(resolvedProviderId, provider).map(model => model.id))) : []
}

export async function getModelsDevModelDetails(providerId: string): Promise<AIModelInfo[]> {
  const resolvedProviderId = normalizeProviderId(providerId)
  if (resolvedProviderId === CUSTOM_PROVIDER_DEFINITION.id || resolvedProviderId === CODEX_SUBSCRIPTION_PROVIDER_ID) return []

  const data = await getModelsDevData()
  const provider = getModelsDevProvider(data, resolvedProviderId)
  return provider ? readModelDetailsFromModelsDevProvider(resolvedProviderId, provider) : []
}
