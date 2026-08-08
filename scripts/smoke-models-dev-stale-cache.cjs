/**
 * models.dev 目录冒烟：
 *   用例 1（主进程）缓存过期 + 网络不通时，getProviderDefinitions() 必须立刻用本地数据返回，
 *          联网刷新只能在后台跑。以前这里是阻塞 fetch（10s 超时），"AI 接入"等页面一打开就得干等。
 *   用例 2（子进程）主源连不上时要自动回落到镜像源，并把镜像内容写进磁盘缓存。
 *          models.dev 在国内被 DNS 污染 + SNI 阻断，没代理的用户全靠这条兜底。
 * 运行：node scripts/smoke-models-dev-stale-cache.cjs
 */
const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const esbuild = require('esbuild')

const CACHE_FIXTURE = {
  fakeprov: {
    name: 'Fake Provider',
    npm: '@ai-sdk/openai-compatible',
    api: 'https://fake.local/v1',
    models: { 'fake-model': { id: 'fake-model', name: 'Fake Model' } },
  },
}
const MIRROR_FIXTURE = {
  mirrorprov: {
    name: 'Mirror Provider',
    npm: '@ai-sdk/openai-compatible',
    api: 'https://mirror.local/v1',
    models: { 'mirror-model': { id: 'mirror-model', name: 'Mirror Model' } },
  },
}

function buildCatalog(outdir) {
  esbuild.buildSync({
    entryPoints: [path.join(__dirname, '../electron/services/ai/providers/catalog.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outdir,
    external: ['electron'],
    logLevel: 'error',
  })
  return path.join(outdir, 'catalog.js')
}

function writeStaleCache(cachePath, data) {
  fs.writeFileSync(cachePath, JSON.stringify(data), 'utf-8')
  // mtime 推到一天前：缓存过期，走"过期不阻塞"分支
  const staleAt = new Date(Date.now() - 24 * 60 * 60 * 1000)
  fs.utimesSync(cachePath, staleAt, staleAt)
}

// ========== 用例 2：跑在子进程里，因为源地址是模块加载时读的 env ==========
async function runMirrorFallbackCase() {
  const cachePath = process.env.CIPHERTALK_MODELS_PATH

  // 镜像服务器起在本进程：父进程 spawnSync 期间事件循环是停的，服务端必须跟请求同进程
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(MIRROR_FIXTURE))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  // 端口是 listen 后才知道的，所以必须先起服务再 require（源地址在模块加载时求值）
  process.env.CIPHERTALK_MODELS_MIRROR_BASE = `http://127.0.0.1:${server.address().port}`

  const { getProviderDefinitions } = require(process.env.SMOKE_CATALOG_PATH)

  const providers = await getProviderDefinitions()
  assert.ok(providers.some((provider) => provider.id === 'fakeprov'), '首次仍然先返回本地过期缓存')

  // 后台刷新：主源 ECONNREFUSED → 回落镜像 → 写盘
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf-8'))
    if (cached.mirrorprov) {
      console.log('镜像回落生效：磁盘缓存已被镜像内容覆盖')
      process.exit(0)
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('主源不可达时没有回落到镜像源')
}

// ========== 用例 1：过期缓存不阻塞 ==========
async function runStaleCacheCase() {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-models-smoke-'))
  const cachePath = path.join(workDir, 'models-dev.json')
  writeStaleCache(cachePath, CACHE_FIXTURE)

  process.env.CIPHERTALK_MODELS_PATH = cachePath
  // 不可路由地址：TCP 连接一直挂着，模拟 models.dev 连不上
  process.env.CIPHERTALK_MODELS_URL = 'http://10.255.255.1:81'
  process.env.CIPHERTALK_MODELS_MIRROR_BASE = ''

  const catalogPath = buildCatalog(workDir)
  const { getProviderDefinitions } = require(catalogPath)

  const startedAt = Date.now()
  const providers = await getProviderDefinitions()
  const elapsedMs = Date.now() - startedAt

  assert.ok(elapsedMs < 2000, `过期缓存必须立刻返回，实际耗时 ${elapsedMs}ms`)
  assert.ok(providers.some((provider) => provider.id === 'fakeprov'), '应当返回磁盘缓存里的提供商')
  assert.ok(providers.some((provider) => provider.id === 'custom'), '内置的自定义提供商始终在列表里')
  console.log(`过期缓存不阻塞：${elapsedMs}ms 返回 ${providers.length} 个提供商`)

  return { workDir, catalogPath }
}

function runMirrorFallbackInChild({ workDir, catalogPath }) {
  const childCachePath = path.join(workDir, 'models-dev-child.json')
  writeStaleCache(childCachePath, CACHE_FIXTURE)

  const result = spawnSync(process.execPath, [__filename, 'mirror-case'], {
    env: {
      ...process.env,
      CIPHERTALK_MODELS_PATH: childCachePath,
      // 127.0.0.1:1 立刻 ECONNREFUSED，不用等 10s 超时就会换下一个源
      CIPHERTALK_MODELS_URL: 'http://127.0.0.1:1',
      CIPHERTALK_MODELS_MIRROR_BASE: '',
      SMOKE_CATALOG_PATH: catalogPath,
    },
    encoding: 'utf-8',
  })

  const output = `${result.stdout || ''}${result.stderr || ''}`
  assert.equal(result.status, 0, `镜像回落用例失败：\n${output}`)
  console.log(output.trim().split('\n').filter((line) => line.includes('镜像回落生效')).join('\n'))
}

async function main() {
  if (process.argv[2] === 'mirror-case') {
    await runMirrorFallbackCase()
    return
  }
  const built = await runStaleCacheCase()
  runMirrorFallbackInChild(built)
  console.log('models.dev 目录冒烟通过')
  process.exit(0) // 用例 1 的后台刷新还挂在不可达地址上，不等它
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
