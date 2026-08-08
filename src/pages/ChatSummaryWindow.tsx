/**
 * AI 摘要独立窗口（/chat-summary?sessionId&displayName&range）
 * 打开即用专用提示词跑一轮摘要，跑完可以就着结果继续追问。
 * 不经 AI 助手页：agent:run 的流式 chunk 回给调用方窗口，本窗口自己发起即可。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useChat } from '@ai-sdk/react'
import { ArrowsRotateLeft, Check, Copy, Volume } from '@gravity-ui/icons'
import { Conversation, ConversationContent, ConversationScrollButton } from '@/components/ai-elements/conversation'
import { Message, MessageAction, MessageActions, MessageContent, MessageResponse } from '@/components/ai-elements/message'
import { Loader } from '@/components/ai-elements/loader'
import { useTtsSpeaker } from '@/lib/ttsPlayer'
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input'
import { IpcChatTransport, type AgentProgressEvent, type AgentScope } from '@/features/aiagent/transport/ipcChatTransport'
import { GlassWindowControls } from '@/components/GlassWindowControls'
import './ChatSummaryWindow.css'

/** 摘要专用提示词，独立于 AI 助手的预设/人格 */
function buildSummaryPrompt(displayName: string, isGroup: boolean, range: string): string {
  const target = isGroup ? `群聊「${displayName}」` : `我和「${displayName}」`
  return `请总结${target}${range}的聊天记录。

要求：
1. 按主题归纳主要讨论内容和关键结论。
2. 标出重要事项、待办、承诺和情绪变化。
3. 引用关键原话或聊天片段作为依据，不要凭空推断。
4. 如果该时间段没有聊天记录，请直接说明。
5. 用 Markdown 小标题分段，不要写开场白和结束语。`
}

function textOf(parts: { type: string; text?: string }[]): string {
  return parts.filter((part) => part.type === 'text').map((part) => part.text || '').join('')
}

export default function ChatSummaryWindow() {
  const [searchParams] = useSearchParams()
  const sessionId = searchParams.get('sessionId') || ''
  const displayName = searchParams.get('displayName') || sessionId
  const range = searchParams.get('range') || '今天'
  const isGroup = sessionId.endsWith('@chatroom')

  const [progressText, setProgressText] = useState('')
  // 标题栏头像：加载失败或没有头像时退回首字母
  const [avatarUrl, setAvatarUrl] = useState('')
  const [avatarFailed, setAvatarFailed] = useState(false)
  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    void window.electronAPI.chat.getSessionDetail(sessionId).then((res) => {
      if (!cancelled && res.success && res.detail?.avatarUrl) setAvatarUrl(res.detail.avatarUrl)
    }).catch(() => { /* 取不到头像用首字母兜底 */ })
    return () => { cancelled = true }
  }, [sessionId])
  const scope = useMemo<AgentScope>(() => ({ kind: 'session', sessionId, displayName }), [sessionId, displayName])
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const transport = useMemo(
    () => new IpcChatTransport(
      () => scopeRef.current,
      () => null, // 模型走设置里当前选中的 provider/model
      () => null, // 摘要不落 Agent 对话记录
      (progress: AgentProgressEvent) => setProgressText(progress.visible === false ? '' : progress.title || ''),
    ),
    []
  )
  const { messages, sendMessage, setMessages, status, stop, error } = useChat({ transport, experimental_throttle: 50 })
  const busy = status === 'submitted' || status === 'streaming'

  // 消息操作条：复制/朗读/重新生成，悬停消息时显示（与 Agent 页一致）
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const { speakingKey, speak: speakMessage, stop: stopSpeaking } = useTtsSpeaker()
  useEffect(() => () => { stopSpeaking() }, [stopSpeaking])
  const handleCopy = async (id: string, text: string) => {
    if (!text || !navigator.clipboard?.writeText) return
    await navigator.clipboard.writeText(text)
    setCopiedId(id)
    window.setTimeout(() => setCopiedId((current) => current === id ? null : current), 1600)
  }

  const startSummary = () => {
    setMessages([])
    setProgressText('')
    setCachedAt(0)
    void sendMessage({ parts: [{ type: 'text', text: buildSummaryPrompt(displayName, isGroup, range) }] })
  }

  // 摘要缓存：命中就直接展示旧结果，不再烧一轮 token；生成时间显示在结果下方
  const [cachedAt, setCachedAt] = useState(0)

  // 挂载先查缓存，没有才跑；StrictMode 下 effect 会跑两次，用 ref 挡住
  const startedRef = useRef(false)
  useEffect(() => {
    if (startedRef.current || !sessionId) return
    startedRef.current = true
    void window.electronAPI.agent.getChatSummary({ sessionId, range })
      .then((res) => {
        const cached = res.success ? res.summary : null
        if (!cached?.content) {
          startSummary()
          return
        }
        // 还原成一轮完整对话，首条提示词照旧隐藏，后续追问能接着上下文
        setMessages([
          { id: 'cached-prompt', role: 'user', parts: [{ type: 'text', text: buildSummaryPrompt(displayName, isGroup, range) }] },
          { id: 'cached-summary', role: 'assistant', parts: [{ type: 'text', text: cached.content }] },
        ])
        setCachedAt(cached.updatedAt)
      })
      .catch(() => startSummary())
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在挂载时跑一次
  }, [sessionId])

  // 首轮摘要生成完就落盘（追问产生的后续消息不覆盖摘要）
  useEffect(() => {
    if (busy || cachedAt) return
    const first = messages.find((message) => message.role === 'assistant')
    const text = first ? textOf(first.parts as { type: string; text?: string }[]) : ''
    if (!text) return
    void window.electronAPI.agent.saveChatSummary({ sessionId, range, displayName, content: text })
      .then(() => setCachedAt(Date.now()))
      .catch(() => { /* 存不下不影响本次查看 */ })
  }, [busy, cachedAt, messages, sessionId, range, displayName])

  const handleSubmit = (message: PromptInputMessage) => {
    const text = message.text?.trim()
    if (!text || busy) return
    void sendMessage({ parts: [{ type: 'text', text }] })
  }

  if (!sessionId) {
    return <div className="chat-summary-empty">缺少会话参数</div>
  }

  return (
    <div className="chat-summary-window">
      <div className="chat-summary-titlebar">
        <div className="chat-summary-title">
          {avatarUrl && !avatarFailed
            ? <img className="chat-summary-avatar" src={avatarUrl} alt={displayName} onError={() => setAvatarFailed(true)} />
            : <span className="chat-summary-avatar chat-summary-avatar--fallback">{displayName.trim().slice(0, 1)}</span>}
          <strong>{displayName}</strong>
          <span className="chat-summary-range">{range}的聊天摘要</span>
        </div>
        <GlassWindowControls />
      </div>

      <Conversation className="chat-summary-body">
        <ConversationContent className="chat-summary-messages">
          {messages.map((message) => {
            // 首条 user 消息是内置提示词，不展示给用户
            const isFirstPrompt = message.role === 'user' && message.id === messages[0]?.id
            if (isFirstPrompt) return null
            const text = textOf(message.parts as { type: string; text?: string }[])
            if (!text) return null
            const speaking = speakingKey === message.id
            return (
              <Message key={message.id} from={message.role}>
                <MessageContent>
                  {message.role === 'assistant'
                    ? <MessageResponse isStreaming={busy}>{text}</MessageResponse>
                    : text}
                  {message.role === 'assistant' && !busy && (
                    <div className="mt-2 transition-opacity pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
                      <MessageActions className="shrink-0">
                        <MessageAction
                          label="复制"
                          onClick={() => void handleCopy(message.id, text)}
                          tooltip={copiedId === message.id ? '已复制' : '复制'}
                        >
                          {copiedId === message.id ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                        </MessageAction>
                        <MessageAction
                          label={speaking ? '停止播放' : '播放'}
                          onClick={() => { if (speaking) stopSpeaking(); else void speakMessage(message.id, text) }}
                          tooltip={speaking ? '停止播放' : '播放'}
                        >
                          <Volume className={`size-3.5 ${speaking ? 'text-accent-foreground' : ''}`} />
                        </MessageAction>
                        <MessageAction label="重新生成" onClick={startSummary} tooltip="重新生成">
                          <ArrowsRotateLeft className="size-3.5" />
                        </MessageAction>
                      </MessageActions>
                      {cachedAt > 0 && message.id === 'cached-summary' && (
                        <span className="chat-summary-cached-at">
                          生成于 {new Date(cachedAt).toLocaleString('zh-CN', { hour12: false })}
                        </span>
                      )}
                    </div>
                  )}
                </MessageContent>
              </Message>
            )
          })}
          {busy && (
            <div className="chat-summary-progress">
              <Loader size={14} />
              <span>{progressText || '正在读取聊天记录…'}</span>
            </div>
          )}
          {error && <div className="chat-summary-error">{error.message}</div>}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="chat-summary-footer">
        <PromptInput
          className="chat-summary-input w-full **:data-[slot=input-group]:border-border **:data-[slot=input-group]:bg-surface/55 **:data-[slot=input-group]:shadow-lg"
          onSubmit={handleSubmit}
        >
          <PromptInputBody>
            <PromptInputTextarea className="min-h-10 max-h-40 py-2 text-sm leading-5" placeholder="就这份摘要继续追问…" />
          </PromptInputBody>
          <PromptInputFooter className="items-center px-2.5 pt-1 pb-2">
            <span />
            <PromptInputSubmit status={status} onClick={busy ? () => void stop() : undefined} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  )
}
