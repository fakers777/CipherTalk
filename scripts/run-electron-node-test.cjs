const { spawnSync } = require('node:child_process')
const electronPath = require('electron')

const testFiles = process.argv.slice(2)
if (testFiles.length === 0) {
  console.error('Usage: node scripts/run-electron-node-test.cjs <test-file>')
  process.exit(2)
}

const result = spawnSync(electronPath, ['--experimental-strip-types', ...testFiles], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
})

if (result.error) throw result.error
process.exit(result.status ?? 1)
