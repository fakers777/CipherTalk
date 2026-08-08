const fs = require('fs')
const path = require('path')

// 发版时把 models.dev 的 provider logo 抓成一份随包快照。models.dev 在国内被墙，不内置的话
// 第三方 provider 在设置页一个图标都显示不出来。合成单文件是为了不往 R2/仓库里堆几百个碎文件。
// 抓取失败不阻断发布：保留仓库里已有的快照即可（跟 fetch-models-dev-snapshot.cjs 一个路子）。
const SOURCE = (process.env.CIPHERTALK_MODELS_URL || 'https://models.dev').replace(/\/+$/, '')
const SNAPSHOT_PATH = path.join(__dirname, '../electron/assets/models-dev.json')
const OUTPUT_PATH = path.join(__dirname, '../src/assets/models-dev-logos.json')
const TIMEOUT_MS = 15000
const CONCURRENCY = 8
const MIN_LOGOS = 50

function readProviderIds() {
  const raw = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf-8'))
  const providers = raw?.providers || raw
  if (!providers || typeof providers !== 'object') throw new Error('models-dev.json 结构异常')
  return Object.keys(providers)
}

async function fetchLogo(providerId) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(`${SOURCE}/logos/${providerId}.svg`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'CipherTalk' }
    })
    if (!response.ok) return ''
    const svg = await response.text()
    if (!svg.trim().startsWith('<svg')) return ''
    return svg.replace(/\s+/g, ' ').trim()
  } catch {
    return ''
  } finally {
    clearTimeout(timeout)
  }
}

async function main() {
  const providerIds = readProviderIds()
  const logos = {}
  const queue = [...providerIds]

  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const providerId = queue.pop()
      const svg = await fetchLogo(providerId)
      if (svg) logos[providerId] = svg
    }
  }))

  const count = Object.keys(logos).length
  if (count < MIN_LOGOS) throw new Error(`只抓到 ${count} 个 logo，疑似源不可达`)

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true })
  // key 排序，避免每次抓取的顺序抖动把 diff 搅乱
  const sorted = Object.fromEntries(Object.keys(logos).sort().map((key) => [key, logos[key]]))
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(sorted), 'utf-8')
  console.log(`models.dev logo 快照：${count}/${providerIds.length} 个，写入 ${OUTPUT_PATH}`)
}

main().catch((error) => {
  console.warn('[models-dev-logos] 拉取失败，沿用已有快照:', error instanceof Error ? error.message : String(error))
  process.exit(0) // 不阻断发布
})
