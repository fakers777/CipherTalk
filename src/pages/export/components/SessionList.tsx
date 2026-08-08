import { Spinner, Avatar, Typography } from '@heroui/react'
import { Check } from '@gravity-ui/icons'
import { List } from 'react-window'
import type { RowComponentProps } from 'react-window'
import type { ChatSession } from '../types'
import { getAvatarLetter } from '../utils'

const ROW_HEIGHT = 60

interface SessionListProps {
  isLoading: boolean
  sessions: ChatSession[]
  selectedSessions: Set<string>
  onSelectionChange: (next: Set<string>) => void
}

interface SessionRowData {
  sessions: ChatSession[]
  selectedSessions: Set<string>
  onToggle: (username: string) => void
}

// 行内不用 HeroUI Checkbox：.checkbox__content 被强制 flex-col，会把整行拧成竖排
function SessionRow({ index, style, sessions, selectedSessions, onToggle }: RowComponentProps<SessionRowData>) {
  const session = sessions[index]
  const isGroup = session.username.includes('@chatroom')
  const isSelected = selectedSessions.has(session.username)

  return (
    <div style={style} className="py-0.5 pr-1">
      <div
        role="option"
        aria-selected={isSelected}
        tabIndex={0}
        onClick={() => onToggle(session.username)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggle(session.username)
          }
        }}
        className={`flex h-full w-full cursor-pointer select-none items-center gap-2 rounded-lg px-2 outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          isSelected ? 'bg-accent-soft text-accent-soft-foreground' : 'hover:bg-surface'
        }`}
      >
        <span
          aria-hidden="true"
          className={`flex size-4 shrink-0 items-center justify-center rounded border ${
            isSelected ? 'border-accent bg-accent text-accent-foreground' : 'border-default'
          }`}
        >
          {isSelected && <Check width={12} height={12} />}
        </span>
        <Avatar size="sm" color={isGroup ? 'accent' : 'default'}>
          {session.avatarUrl && <Avatar.Image alt="" loading="lazy" src={session.avatarUrl} />}
          <Avatar.Fallback>
            {isGroup ? '群' : getAvatarLetter(session.displayName || session.username)}
          </Avatar.Fallback>
        </Avatar>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm">{session.displayName || session.username}</span>
          <span className="truncate text-xs text-muted">{session.summary || '暂无消息'}</span>
        </div>
      </div>
    </div>
  )
}

export default function SessionList({ isLoading, sessions, selectedSessions, onSelectionChange }: SessionListProps) {
  if (isLoading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted">
        <Spinner size="md" />
        <Typography type="body-sm">加载中...</Typography>
      </div>
    )
  }

  if (sessions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <Typography type="body-sm">暂无会话</Typography>
      </div>
    )
  }

  // 只增删单个 username，被搜索/分类隐藏的已选会话不受影响
  const onToggle = (username: string) => {
    const next = new Set(selectedSessions)
    if (next.has(username)) next.delete(username)
    else next.add(username)
    onSelectionChange(next)
  }

  return (
    // @ts-ignore - react-window 类型定义不匹配但不影响运行（与聊天页会话侧栏一致）
    <List
      role="listbox"
      aria-label="会话列表"
      aria-multiselectable
      style={{ height: '100%', width: '100%' }}
      rowCount={sessions.length}
      rowHeight={ROW_HEIGHT}
      rowProps={{ sessions, selectedSessions, onToggle }}
      rowComponent={SessionRow}
    />
  )
}
