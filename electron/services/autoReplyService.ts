import { chatService } from './chatService'
import { commitWeChatInput, fillWeChatInput } from './wechatWindowTracker'
import { splitSuggestionBursts } from '../../src/pages/chat/replySuggestBurst'
import type { MainProcessContext } from '../main/context'

/**
 * 全自动回复的发送队列（主进程）。
 *
 * 多个人同时来消息时一条一条排队回，不并发——按键注入是全局独占资源，并发只会把两组按键搅在一起。
 *
 * 发送后靠数据库反查做闭环校验：消息发出去必然入库，读库就能确认「发出去了没有」和「发给谁了」。
 * 这是本设计的关键——微信 UIA 树是空的，Ctrl+F 跳转有没有进对会话事前无从判断，
 * 只能事后查库。一旦查出发错了立刻熔断清空队列，把损失锁死在一条消息，不让它连着错下去。
 */

/** 建议出现后留给人工干预的秒数，到点没人管就自己发。 */
const COUNTDOWN_SEC = 5
/** 同一条建议的句与句之间：模仿真人连发的手速。 */
const SEG_GAP_MS: [number, number] = [900, 2600]
/** 回完一个人到下一个人之间。 */
const ITEM_GAP_MS: [number, number] = [2500, 7000]
/** 入库有延迟，轮询等这么久还查不到就当没发出去。 */
const VERIFY_TIMEOUT_MS = 4000
const VERIFY_POLL_MS = 400
/** 时钟/单位边界的容差（秒）。 */
const VERIFY_TS_SLACK = 5
/** 撞上手动填充时的重试次数。 */
const BUSY_RETRY = 2
/** 已见批次 id 的记忆上限，到顶清空——只为防重推，不需要长期精确。 */
const SEEN_BATCH_LIMIT = 200

export type AutoSendStatus =
  | { phase: 'idle' }
  | { phase: 'counting'; sessionId: string; sessionName: string; secondsLeft: number; queued: number }
  | { phase: 'sending'; sessionId: string; sessionName: string; segIndex: number; segTotal: number; queued: number }
  | { phase: 'halted'; sessionId: string; sessionName: string; error: string }

type QueueItem = { sessionId: string; sessionName: string; segments: string[] }

type VerifyResult = { verdict: 'ok' } | { verdict: 'wrong-session'; where: string } | { verdict: 'not-sent' }

/** 可疑会话最多回查这么多个，够覆盖搜索选错人的场景，不至于把库翻一遍。 */
const STRAY_PROBE_LIMIT = 3

const HALT_REASON: Record<string, string> = {
  'wrong-session': '发到了别的会话，已停止后续发送',
  'not-sent': '没能确认消息已发出，已停止后续发送',
  'no-window': '找不到微信窗口',
  'focus-failed': '微信窗口没能激活',
  busy: '输入通道一直被占用',
  'no-permission': '未授予辅助功能权限，去「系统设置 → 隐私与安全性 → 辅助功能」勾选密语',
  unsupported: '当前系统不支持自动发送',
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function randBetween([min, max]: [number, number]): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}

class AutoReplyService {
  private ctx: MainProcessContext | null = null
  private queue: QueueItem[] = []
  /** 已出队、正在倒计时或发送的那条。倒计时阶段可被同会话的新建议顶掉。 */
  private current: { item: QueueItem; cancellable: boolean } | null = null
  private draining = false
  private cancelRequested = false
  private halted = false
  /** 已入队过的建议批次，防渲染端重推导致重复发送。 */
  private seenBatches = new Set<string>()

  setContext(ctx: MainProcessContext): void {
    this.ctx = ctx
  }

  /**
   * 建议就绪时入队。同一会话已在队列里就替换成新建议——
   * 对方又发了新消息，真人也是照最新的回，不会把过期的那条补发出去。
   */
  enqueue(sessionId: string, sessionName: string, suggestion: string, batchId?: string): void {
    const segments = splitSuggestionBursts(suggestion).filter(Boolean)
    if (segments.length === 0) return
    if (this.halted) return
    // 渲染端每次状态变化都会重推 ready，同一批建议只认第一次，否则会重复发送
    if (batchId) {
      if (this.seenBatches.has(batchId)) return
      this.seenBatches.add(batchId)
      if (this.seenBatches.size > SEEN_BATCH_LIMIT) this.seenBatches.clear()
    }

    // 正在倒计时的就是这个人：对方又追了消息，撤掉旧的用新的，
    // 否则会给同一个人连发两条意思重复的回复——那是最扎眼的机器人特征
    if (this.current?.cancellable && this.current.item.sessionId === sessionId) {
      this.cancelRequested = true
    }

    const existing = this.queue.findIndex((item) => item.sessionId === sessionId)
    if (existing >= 0) this.queue[existing] = { sessionId, sessionName, segments }
    else this.queue.push({ sessionId, sessionName, segments })

    this.log('入队自动回复', { sessionId, segments: segments.length, queued: this.queue.length })
    void this.drain()
  }

  /** 撤销当前这条（倒计时中有效）。 */
  cancelCurrent(): void {
    this.cancelRequested = true
  }

  clearQueue(): void {
    this.queue = []
    this.cancelRequested = true
    this.halted = false
    this.emit({ phase: 'idle' })
  }

  /** 熔断后需要人工确认才恢复，避免同一个错误反复发生。 */
  resume(): void {
    this.halted = false
    this.emit({ phase: 'idle' })
  }

  isHalted(): boolean {
    return this.halted
  }

  private async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      while (this.queue.length > 0 && !this.halted) {
        // 先出队再处理：留在队列头会被 enqueue 的同会话替换逻辑覆盖，替换进来的新建议
        // 又会被这一轮结束时的 shift 顺手删掉，等于新建议凭空消失
        const item = this.queue.shift()!
        this.current = { item, cancellable: true }
        try {
          if (await this.countdown(item)) continue
          this.current.cancellable = false
          if (!await this.sendItem(item)) break
        } finally {
          this.current = null
        }
        if (this.queue.length > 0) await sleep(randBetween(ITEM_GAP_MS))
      }
      if (!this.halted) this.emit({ phase: 'idle' })
    } finally {
      this.draining = false
    }
  }

  /** 返回 true 表示这条被撤销了。 */
  private async countdown(item: QueueItem): Promise<boolean> {
    this.cancelRequested = false
    for (let left = COUNTDOWN_SEC; left > 0; left -= 1) {
      this.emit({
        phase: 'counting',
        sessionId: item.sessionId,
        sessionName: item.sessionName,
        secondsLeft: left,
        queued: this.queue.length,
      })
      await sleep(1000)
      if (this.cancelRequested) {
        this.cancelRequested = false
        this.log('自动回复被撤销', { sessionId: item.sessionId })
        return true
      }
    }
    return false
  }

  /** 逐句发送 + 每句发完查库确认。返回 false 表示已熔断。 */
  private async sendItem(item: QueueItem): Promise<boolean> {
    for (let i = 0; i < item.segments.length; i += 1) {
      const seg = item.segments[i]
      this.emit({
        phase: 'sending',
        sessionId: item.sessionId,
        sessionName: item.sessionName,
        segIndex: i,
        segTotal: item.segments.length,
        queued: this.queue.length,
      })

      // 只有第一句需要 Ctrl+F 跳转，后面几句已经在这个会话里了
      const fill = await this.fillWithBusyRetry(seg, i === 0 ? item.sessionName : undefined)
      if (!fill.ok) return this.halt(item, fill.reason || 'not-sent')

      const sentAt = Math.floor(Date.now() / 1000)
      const commit = commitWeChatInput()
      if (!commit.ok) return this.halt(item, commit.reason || 'not-sent')

      const result = await this.verify(item.sessionId, seg, sentAt)
      if (result.verdict !== 'ok') {
        return this.halt(item, result.verdict, result.verdict === 'wrong-session' ? result.where : undefined)
      }

      if (i < item.segments.length - 1) await sleep(randBetween(SEG_GAP_MS))
    }
    this.log('自动回复发送完成', { sessionId: item.sessionId, segments: item.segments.length })
    return true
  }

  private async fillWithBusyRetry(text: string, searchName?: string) {
    for (let attempt = 0; ; attempt += 1) {
      const result = await fillWeChatInput(text, searchName)
      if (result.ok || result.reason !== 'busy' || attempt >= BUSY_RETRY) return result
      await sleep(1200)
    }
  }

  /** 某会话最近的消息里有没有「我刚发出去的这一句」。 */
  private async hasMine(sessionId: string, expected: string, sentAt: number): Promise<boolean> {
    const res = await chatService.getMessages(sessionId, 0, 10)
    return Boolean(res.messages?.some((m) => (
      m.isSend === 1
      && m.createTime >= sentAt - VERIFY_TS_SLACK
      && m.parsedContent?.trim() === expected
    )))
  }

  /**
   * 查库确认这一句真的发进了目标会话。
   *
   * 判「发错人」必须回查那个会话里确实有我发的同内容消息，不能只看会话时间戳变没变——
   * 自动回复期间对方本来就在给我发消息，别人的会话时间戳照样会动，那样判会一直误熔断。
   */
  private async verify(sessionId: string, text: string, sentAt: number): Promise<VerifyResult> {
    const expected = text.trim()
    const deadline = Date.now() + VERIFY_TIMEOUT_MS
    while (Date.now() < deadline) {
      await sleep(VERIFY_POLL_MS)
      if (await this.hasMine(sessionId, expected, sentAt)) return { verdict: 'ok' }
    }

    const res = await chatService.getSessions(0, 30)
    const suspects = (res.sessions || [])
      .filter((s) => s.username !== sessionId && s.lastTimestamp >= sentAt - VERIFY_TS_SLACK)
      .slice(0, STRAY_PROBE_LIMIT)
    for (const s of suspects) {
      if (await this.hasMine(s.username, expected, sentAt)) {
        return { verdict: 'wrong-session', where: s.username }
      }
    }
    return { verdict: 'not-sent' }
  }

  private halt(item: QueueItem, reason: string, where?: string): boolean {
    this.halted = true
    this.queue = []
    const base = HALT_REASON[reason] || reason
    const error = where ? `发到了「${where}」，已停止后续发送` : base
    this.log('自动回复熔断', { sessionId: item.sessionId, reason, where })
    this.emit({ phase: 'halted', sessionId: item.sessionId, sessionName: item.sessionName, error })
    return false
  }

  private emit(status: AutoSendStatus): void {
    this.ctx?.broadcastToWindows('reply-tile:auto-status', status)
  }

  private log(message: string, meta?: Record<string, unknown>): void {
    this.ctx?.getLogService()?.warn('AutoReply', message, meta)
  }
}

export const autoReplyService = new AutoReplyService()
