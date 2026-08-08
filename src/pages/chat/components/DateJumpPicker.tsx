import { useEffect, useState } from 'react'
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, CircleDashed } from '@gravity-ui/icons'
import { Button, Calendar, Popover } from '@heroui/react'
import { CalendarDate, getLocalTimeZone, parseDate, today, type DateValue } from '@internationalized/date'

interface DateJumpPickerProps {
  /** 会话ID：用于查询哪些日期有消息（无消息的日期置灰不可选） */
  sessionId?: string | null
  /** 当前选中日期，'YYYY-MM-DD' 或 '' */
  value: string
  /** 更新选中日期 */
  onChange: (date: string) => void
  /** 触发跳转 */
  onJump: (date: string) => void
  disabled?: boolean
  loading?: boolean
}

function toCalendarValue(value: string): DateValue | null {
  if (!value) return null
  try {
    return parseDate(value)
  } catch {
    return null
  }
}

/** 年视图一页 12 年 */
const YEARS_PER_PAGE = 12

/**
 * 日期跳转选择器：HeroUI Popover + Calendar。
 * 点标题逐级上钻（日 → 月 → 年），选中后逐级下钻回来，最终选日即跳转并收起弹层（禁选未来）。
 */
export function DateJumpPicker({ sessionId, value, onChange, onJump, disabled, loading }: DateJumpPickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const maxValue = today(getLocalTimeZone())
  const [view, setView] = useState<'day' | 'month' | 'year'>('day')
  // 当前视野所在的年月（Calendar 受控 focusedValue，月/年视图也读它）
  const [focused, setFocused] = useState<DateValue>(toCalendarValue(value) ?? maxValue)
  // 按月缓存有消息的日期集合，key 'YYYY-MM'；未加载到的月份不置灰（查询失败时兜底可选）
  const [monthDates, setMonthDates] = useState<Record<string, Set<string>>>({})

  // 切会话清缓存
  useEffect(() => { setMonthDates({}) }, [sessionId])

  // 日视图下懒加载当前月份的有消息日期
  const monthKey = `${focused.year}-${String(focused.month).padStart(2, '0')}`
  useEffect(() => {
    if (!isOpen || view !== 'day' || !sessionId || monthDates[monthKey]) return
    let cancelled = false
    void window.electronAPI.chat.getDatesWithMessages(sessionId, focused.year, focused.month).then((res) => {
      if (cancelled || !res.success) return
      setMonthDates((prev) => ({ ...prev, [monthKey]: new Set(res.dates ?? []) }))
    }).catch(() => { /* 查询失败保持全部可选 */ })
    return () => { cancelled = true }
  }, [isOpen, view, sessionId, monthKey, focused.year, focused.month, monthDates])

  const isDateUnavailable = (date: DateValue) => {
    const set = monthDates[`${date.year}-${String(date.month).padStart(2, '0')}`]
    return set ? !set.has(date.toString()) : false
  }

  const handleSelect = (date: DateValue) => {
    const str = date.toString() // CalendarDate → 'YYYY-MM-DD'
    onChange(str)
    onJump(str)
    setIsOpen(false)
  }

  const handleOpenChange = (open: boolean) => {
    if (disabled) return
    // 每次打开都回到日视图，并把视野对齐到当前选中日期
    if (open) {
      setView('day')
      setFocused(toCalendarValue(value) ?? maxValue)
    }
    setIsOpen(open)
  }

  const yearPageStart = Math.floor(focused.year / YEARS_PER_PAGE) * YEARS_PER_PAGE

  return (
    <Popover isOpen={isOpen && !disabled} onOpenChange={handleOpenChange}>
      <Popover.Trigger>
        <Button isIconOnly size="sm" variant="ghost" isDisabled={disabled} aria-label="跳转到日期">
          {loading ? <CircleDashed width={18} height={18} className="animate-spin" /> : <CalendarIcon width={18} height={18} />}
        </Button>
      </Popover.Trigger>
      <Popover.Content placement="bottom right">
        <Popover.Dialog>
          {view === 'day' && (
            <Calendar
              aria-label="跳转到日期"
              value={toCalendarValue(value)}
              onChange={handleSelect}
              focusedValue={focused}
              onFocusChange={setFocused}
              maxValue={maxValue}
              isDateUnavailable={isDateUnavailable}
            >
              <Calendar.Header>
                <Calendar.NavButton slot="previous" />
                {/* Calendar.Header 会给子 Button 注入 previous/next slot 上下文，HeroUI Button 放里面会报 slot 错，用原生 button 绕开 */}
                <button
                  type="button"
                  className="cursor-pointer rounded-md px-2 py-1 text-sm font-medium text-foreground hover:bg-default"
                  onClick={() => setView('month')}
                >
                  {focused.year}年{focused.month}月
                </button>
                <Calendar.NavButton slot="next" />
              </Calendar.Header>
              <Calendar.Grid>
                <Calendar.GridHeader>
                  {(day) => <Calendar.HeaderCell>{day}</Calendar.HeaderCell>}
                </Calendar.GridHeader>
                <Calendar.GridBody>
                  {(date) => <Calendar.Cell date={date} />}
                </Calendar.GridBody>
              </Calendar.Grid>
            </Calendar>
          )}

          {view === 'month' && (
            <div className="w-64">
              <div className="flex items-center justify-between gap-1 px-0.5 pb-3">
                <Button isIconOnly size="sm" variant="ghost" aria-label="上一年" onPress={() => setFocused(focused.subtract({ years: 1 }))}>
                  <ChevronLeft width={16} height={16} />
                </Button>
                <Button size="sm" variant="ghost" onPress={() => setView('year')}>{focused.year}年</Button>
                <Button
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  aria-label="下一年"
                  isDisabled={focused.year >= maxValue.year}
                  onPress={() => setFocused(focused.add({ years: 1 }))}
                >
                  <ChevronRight width={16} height={16} />
                </Button>
              </div>
              <div className="grid grid-cols-4 gap-1">
                {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => {
                  const future = focused.year > maxValue.year || (focused.year === maxValue.year && month > maxValue.month)
                  return (
                    <Button
                      key={month}
                      size="sm"
                      variant={focused.month === month ? 'primary' : 'ghost'}
                      isDisabled={future}
                      onPress={() => {
                        setFocused(new CalendarDate(focused.year, month, 1))
                        setView('day')
                      }}
                    >
                      {month}月
                    </Button>
                  )
                })}
              </div>
            </div>
          )}

          {view === 'year' && (
            <div className="w-64">
              <div className="flex items-center justify-between gap-1 px-0.5 pb-3">
                <Button isIconOnly size="sm" variant="ghost" aria-label="上一页" onPress={() => setFocused(focused.subtract({ years: YEARS_PER_PAGE }))}>
                  <ChevronLeft width={16} height={16} />
                </Button>
                <span className="text-sm font-medium text-foreground">
                  {yearPageStart} - {yearPageStart + YEARS_PER_PAGE - 1}
                </span>
                <Button
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  aria-label="下一页"
                  isDisabled={yearPageStart + YEARS_PER_PAGE > maxValue.year}
                  onPress={() => setFocused(focused.add({ years: YEARS_PER_PAGE }))}
                >
                  <ChevronRight width={16} height={16} />
                </Button>
              </div>
              <div className="grid grid-cols-4 gap-1">
                {Array.from({ length: YEARS_PER_PAGE }, (_, i) => yearPageStart + i).map((year) => (
                  <Button
                    key={year}
                    size="sm"
                    variant={focused.year === year ? 'primary' : 'ghost'}
                    isDisabled={year > maxValue.year}
                    onPress={() => {
                      setFocused(new CalendarDate(year, focused.month, 1))
                      setView('month')
                    }}
                  >
                    {year}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  )
}
