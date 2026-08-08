/**
 * Regression: closed-pipe stdin errors (EPIPE / ERR_STREAM_DESTROYED / Windows EOF)
 * must be handled by the shared guard used in convertHevcToJpg.
 *
 * Run: npx tsx scripts/test-ffmpeg-stdin-epipe.ts
 */
import { spawn } from 'child_process'
import {
  attachClosedPipeStdinGuard,
  isClosedPipeError,
  writeAndEndStdin,
} from '../electron/services/closedPipeStdin'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

// Unit: classifier
assert(isClosedPipeError({ code: 'EPIPE' }), 'EPIPE should be closed-pipe')
assert(isClosedPipeError({ code: 'ERR_STREAM_DESTROYED' }), 'ERR_STREAM_DESTROYED should be closed-pipe')
assert(isClosedPipeError({ code: 'EOF' }), 'Windows EOF should be closed-pipe')
assert(!isClosedPipeError({ code: 'EACCES' }), 'EACCES must not be closed-pipe')

function writeWithGuard(handleStdinError: boolean): Promise<{
  result: 'ok' | 'unhandled'
  unexpected: Error[]
}> {
  return new Promise((resolve) => {
    let settled = false
    const unexpected: Error[] = []
    const finish = (result: 'ok' | 'unhandled') => {
      if (settled) return
      settled = true
      resolve({ result, unexpected })
    }

    const onUnhandled = (err: Error) => {
      const code = (err as NodeJS.ErrnoException).code
      if (isClosedPipeError(err) || code === 'EPIPE' || err.message?.includes('EPIPE')) {
        finish('unhandled')
      }
    }
    process.once('uncaughtException', onUnhandled)

    const proc = spawn(process.execPath, ['-e', 'process.exit(0)'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    if (handleStdinError) {
      attachClosedPipeStdinGuard(proc.stdin, (err) => {
        unexpected.push(err)
      })
    }

    proc.on('error', () => finish('ok'))
    proc.on('close', () => {
      setTimeout(() => {
        process.off('uncaughtException', onUnhandled)
        finish('ok')
      }, 100)
    })

    const payload = Buffer.alloc(256 * 1024, 1)
    const tryWrite = () => {
      writeAndEndStdin(proc.stdin, payload, (err) => {
        unexpected.push(err)
      })
    }

    tryWrite()
    setTimeout(tryWrite, 20)
  })
}

async function main() {
  const withHandler = await writeWithGuard(true)
  assert(withHandler.result === 'ok', 'FAIL: handled stdin still surfaced unhandled closed-pipe error')
  assert(
    withHandler.unexpected.length === 0,
    `FAIL: unexpected stdin errors should fail the test, got: ${withHandler.unexpected.map((e) => (e as NodeJS.ErrnoException).code || e.message).join(', ')}`
  )

  console.log('PASS: stdin closed-pipe guard (EPIPE/EOF) prevents process crash')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
