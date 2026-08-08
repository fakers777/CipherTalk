import type { Writable } from 'stream'

/** 子进程提前退出后，向已关闭的 stdin 写入时的常见错误码（含 Windows EOF）。 */
export const CLOSED_PIPE_ERROR_CODES = new Set([
  'EPIPE',
  'ERR_STREAM_DESTROYED',
  'EOF',
])

export function isClosedPipeError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code
  return typeof code === 'string' && CLOSED_PIPE_ERROR_CODES.has(code)
}

/**
 * 监听 stdin error：closed-pipe 类错误静默忽略，其余交给 onUnexpected。
 * 未挂此监听时，Node 会把 stdin 'error' 当成未处理异常拖垮进程。
 */
export function attachClosedPipeStdinGuard(
  stdin: Writable,
  onUnexpected?: (err: NodeJS.ErrnoException) => void
): void {
  stdin.on('error', (err: NodeJS.ErrnoException) => {
    if (isClosedPipeError(err)) return
    onUnexpected?.(err)
  })
}

/**
 * 向 stdin 写入完整 buffer，在 write 回调里 end。
 * closed-pipe 错误吞掉；其它写入错误回调 onUnexpected。
 */
export function writeAndEndStdin(
  stdin: Writable,
  data: Buffer,
  onUnexpected?: (err: Error) => void
): void {
  try {
    stdin.write(data, (writeErr: Error | null | undefined) => {
      if (writeErr) {
        if (!isClosedPipeError(writeErr)) onUnexpected?.(writeErr)
        return
      }
      try {
        stdin.end()
      } catch {
        /* ignore */
      }
    })
  } catch (e) {
    if (!isClosedPipeError(e)) onUnexpected?.(e as Error)
  }
}
