import { execFile } from 'child_process'
import { clipboard, screen } from 'electron'
import { wxKeyService } from './wxKeyService'

/**
 * WeChat main-window tracker for the reply suggestion tile.
 *
 * WeChat image preview / media viewer windows are also top-level windows owned by
 * Weixin.exe, so do not pick the largest WeChat-owned window. Track only the real
 * Chinese-titled main window on Windows. macOS uses CoreGraphics window metadata
 * and falls back to the largest normal WeChat window when the title is not exposed.
 */

export type WeChatWindowState = {
  found: boolean
  minimized: boolean
  /** True only when the foreground window is the real Chinese-titled WeChat main window. */
  foregroundActive: boolean
  /** DIP bounds; null when found is false. */
  bounds: { x: number; y: number; width: number; height: number } | null
}

const NOT_FOUND: WeChatWindowState = { found: false, minimized: false, foregroundActive: false, bounds: null }

const GW_HWNDNEXT = 2
const GW_HWNDPREV = 3
const GWL_EXSTYLE = -20
const WS_EX_TOPMOST = 0x00000008
const DWMWA_EXTENDED_FRAME_BOUNDS = 9
const WINEVENT_OUTOFCONTEXT = 0x0000
const WINEVENT_SKIPOWNPROCESS = 0x0002
const EVENT_SYSTEM_FOREGROUND = 0x0003
const EVENT_SYSTEM_MOVESIZESTART = 0x000A
const EVENT_SYSTEM_MOVESIZEEND = 0x000B
const EVENT_SYSTEM_MINIMIZESTART = 0x0016
const EVENT_SYSTEM_MINIMIZEEND = 0x0017
const EVENT_OBJECT_LOCATIONCHANGE = 0x800B
const OBJID_WINDOW = 0
const CHILDID_SELF = 0
const SWP_NOSIZE = 0x0001
const SWP_NOMOVE = 0x0002
const SWP_NOACTIVATE = 0x0010
const SWP_NOOWNERZORDER = 0x0200
const SW_RESTORE = 9
const KEYEVENTF_KEYUP = 0x0002
const VK_CONTROL = 0x11
const VK_MENU = 0x12
const VK_RETURN = 0x0D
const VK_F = 0x46
const VK_V = 0x56
const MAC_WINDOW_LIST_OPTIONS = 0x0001 | 0x0010
const MAC_NORMAL_WINDOW_LAYER = 0
const K_CF_STRING_ENCODING_UTF8 = 0x08000100
const K_CF_NUMBER_DOUBLE_TYPE = 13
const MAC_WECHAT_BUNDLE_ID = 'com.tencent.xinWeChat'
/** kCGHIDEventTap：注入到 HID 层，等价于真实键盘。 */
const K_CG_HID_EVENT_TAP = 0
/** kCGEventFlagMaskCommand */
const K_CG_FLAG_COMMAND = 0x100000
/** mac 虚拟键码与 Windows VK 完全不同：kVK_ANSI_F / kVK_ANSI_V / kVK_Return */
const K_VK_F = 0x03
const K_VK_V = 0x09
const K_VK_RETURN = 0x24

let loaded = false
let unavailable = false
let koffi: any = null
let GetTopWindow: any, GetWindow: any, GetWindowThreadProcessId: any
let IsWindowVisible: any, IsIconic: any, GetWindowTextLengthW: any, GetWindowTextW: any
let GetWindowRect: any, GetForegroundWindow: any, DwmGetWindowAttribute: any
let SetWindowPos: any, GetWindowLongPtrW: any
let SetWinEventHook: any, UnhookWinEvent: any, WinEventProc: any
let SetForegroundWindow: any, ShowWindow: any, AttachThreadInput: any
let GetCurrentThreadId: any, keybdEvent: any
let pidBuf: any = null
let rectBuf: any = null
let titleBuf: Buffer | null = null

let macLoaded = false
let macUnavailable = false
let macKoffi: any = null
let CGWindowListCopyWindowInfo: any, CFArrayGetCount: any, CFArrayGetValueAtIndex: any
let CFDictionaryGetValue: any, CFStringCreateWithCString: any, CFStringGetCString: any
let CFNumberGetValue: any, CFBooleanGetValue: any, CFRelease: any
let macKeys: Record<string, any> | null = null
let macNumberBuf: any = null

let macInputLoaded = false
let macInputUnavailable = false
let CGEventCreateKeyboardEvent: any, CGEventPost: any, CGEventSetFlags: any
let AXIsProcessTrusted: any

/**
 * macOS 键盘注入所需的额外符号。CGEvent* 在已加载的 CoreGraphics 里，
 * AXIsProcessTrusted 用来提前判断有没有「辅助功能」授权——没授权时 CGEventPost
 * 会被系统静默丢弃（函数照样返回成功），不先查就只能表现为「消息没发出去」。
 */
function ensureMacInputLoaded(): boolean {
  if (macInputLoaded) return !macInputUnavailable
  macInputLoaded = true
  try {
    if (!ensureMacLoaded()) throw new Error('CoreGraphics unavailable')
    const coreGraphics = macKoffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
    const appServices = macKoffi.load('/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices')
    CGEventCreateKeyboardEvent = coreGraphics.func('void* CGEventCreateKeyboardEvent(void* source, uint16 virtualKey, bool keyDown)')
    CGEventPost = coreGraphics.func('void CGEventPost(uint32 tap, void* event)')
    CGEventSetFlags = coreGraphics.func('void CGEventSetFlags(void* event, uint64 flags)')
    AXIsProcessTrusted = appServices.func('bool AXIsProcessTrusted()')
    return true
  } catch {
    macInputUnavailable = true
    return false
  }
}

/** 按一次键；withCommand 时带 Cmd 修饰。用 flags 而不是单独发 Cmd 键事件，更不易残留修饰状态。 */
function macTap(keyCode: number, withCommand = false): void {
  for (const down of [true, false]) {
    const event = CGEventCreateKeyboardEvent(null, keyCode, down)
    if (!event) continue
    try {
      if (withCommand) CGEventSetFlags(event, BigInt(K_CG_FLAG_COMMAND))
      CGEventPost(K_CG_HID_EVENT_TAP, event)
    } finally {
      try { CFRelease(event) } catch { /* ignore */ }
    }
  }
}

/**
 * 把微信拉到前台。用 osascript 而不是辅助功能 API：activate 不需要额外授权，
 * 失败时再按应用名试一次（bundle id 在不同微信版本上不完全一致）。
 */
function activateWeChatMac(): Promise<boolean> {
  const scripts = [
    `tell application id "${MAC_WECHAT_BUNDLE_ID}" to activate`,
    'tell application "WeChat" to activate',
  ]
  return new Promise((resolve) => {
    const run = (index: number): void => {
      if (index >= scripts.length) return resolve(false)
      execFile('osascript', ['-e', scripts[index]], (error) => {
        if (!error) return resolve(true)
        run(index + 1)
      })
    }
    run(0)
  })
}

function isWeChatForegroundMac(): boolean {
  try {
    return probeMacWeChatWindow().foregroundActive
  } catch {
    return false
  }
}

async function fillWeChatInputMac(text: string, searchName?: string): Promise<WeChatSendResult> {
  if (!ensureMacInputLoaded()) return UNSUPPORTED
  if (!AXIsProcessTrusted()) return { ok: false, reason: 'no-permission' }
  if (!probeMacWeChatWindow().found) return { ok: false, reason: 'no-window' }
  if (!await activateWeChatMac()) return { ok: false, reason: 'focus-failed' }
  await sleep(250)
  if (!isWeChatForegroundMac()) return { ok: false, reason: 'focus-failed' }

  if (searchName) {
    clipboard.writeText(searchName)
    macTap(K_VK_F, true)
    await sleep(220)
    macTap(K_VK_V, true)
    // ponytail: 这两个延迟照搬 Windows 值，未在 mac 真机验证过；跳转不稳先调大它们
    await sleep(650)
    macTap(K_VK_RETURN)
    await sleep(450)
    if (!isWeChatForegroundMac()) return { ok: false, reason: 'focus-failed' }
  }

  clipboard.writeText(text)
  await sleep(80)
  macTap(K_VK_V, true)
  return { ok: true }
}

let cachedPid: number | null = null
let lastPidProbe = 0
let cachedMainHwndAddr = 0n

function ensureLoaded(): boolean {
  if (loaded) return !unavailable
  loaded = true
  try {
    koffi = require('koffi')
    const user32 = koffi.load('user32.dll')
    const dwmapi = koffi.load('dwmapi.dll')
    GetTopWindow = user32.func('void* GetTopWindow(void* hwnd)')
    GetWindow = user32.func('void* GetWindow(void* hwnd, uint32 uCmd)')
    GetWindowThreadProcessId = user32.func('uint32 GetWindowThreadProcessId(void* hwnd, void* pid)')
    IsWindowVisible = user32.func('bool IsWindowVisible(void* hwnd)')
    IsIconic = user32.func('bool IsIconic(void* hwnd)')
    GetWindowTextLengthW = user32.func('int32 GetWindowTextLengthW(void* hwnd)')
    GetWindowTextW = user32.func('int32 GetWindowTextW(void* hwnd, void* text, int32 maxCount)')
    GetWindowRect = user32.func('bool GetWindowRect(void* hwnd, void* rect)')
    GetForegroundWindow = user32.func('void* GetForegroundWindow()')
    SetWindowPos = user32.func('bool SetWindowPos(uintptr hWnd, uintptr hWndInsertAfter, int32 X, int32 Y, int32 cx, int32 cy, uint32 uFlags)')
    GetWindowLongPtrW = user32.func('intptr GetWindowLongPtrW(void* hwnd, int32 nIndex)')
    SetWinEventHook = user32.func('void* SetWinEventHook(uint32 eventMin, uint32 eventMax, void* hmodWinEventProc, void* pfnWinEventProc, uint32 idProcess, uint32 idThread, uint32 dwFlags)')
    UnhookWinEvent = user32.func('bool UnhookWinEvent(void* hWinEventHook)')
    WinEventProc = koffi.proto('void __stdcall WinEventProc(void* hWinEventHook, uint32 event, void* hwnd, int32 idObject, int32 idChild, uint32 idEventThread, uint32 dwmsEventTime)')
    DwmGetWindowAttribute = dwmapi.func('int32 DwmGetWindowAttribute(void* hwnd, uint32 attr, void* rect, uint32 cb)')
    SetForegroundWindow = user32.func('bool SetForegroundWindow(void* hwnd)')
    ShowWindow = user32.func('bool ShowWindow(void* hwnd, int32 nCmdShow)')
    AttachThreadInput = user32.func('bool AttachThreadInput(uint32 idAttach, uint32 idAttachTo, bool fAttach)')
    keybdEvent = user32.func('void keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uintptr dwExtraInfo)')
    GetCurrentThreadId = koffi.load('kernel32.dll').func('uint32 GetCurrentThreadId()')
    pidBuf = koffi.alloc('uint32', 1)
    rectBuf = koffi.alloc('int32', 4)
    titleBuf = Buffer.alloc(512 * 2)
    return true
  } catch {
    unavailable = true
    return false
  }
}

function ensureMacLoaded(): boolean {
  if (macLoaded) return !macUnavailable
  macLoaded = true

  try {
    macKoffi = require('koffi')
    const coreGraphics = macKoffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
    const coreFoundation = macKoffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
    CGWindowListCopyWindowInfo = coreGraphics.func('void* CGWindowListCopyWindowInfo(uint32 option, uint32 relativeToWindow)')
    CFArrayGetCount = coreFoundation.func('long CFArrayGetCount(void* theArray)')
    CFArrayGetValueAtIndex = coreFoundation.func('void* CFArrayGetValueAtIndex(void* theArray, long idx)')
    CFDictionaryGetValue = coreFoundation.func('void* CFDictionaryGetValue(void* dict, void* key)')
    CFStringCreateWithCString = coreFoundation.func('void* CFStringCreateWithCString(void* alloc, const char* cStr, uint32 encoding)')
    CFStringGetCString = coreFoundation.func('bool CFStringGetCString(void* string, void* buffer, long bufferSize, uint32 encoding)')
    CFNumberGetValue = coreFoundation.func('bool CFNumberGetValue(void* number, int32 theType, void* valuePtr)')
    CFBooleanGetValue = coreFoundation.func('bool CFBooleanGetValue(void* boolean)')
    CFRelease = coreFoundation.func('void CFRelease(void* cf)')
    macNumberBuf = macKoffi.alloc('double', 1)
    macKeys = {
      ownerName: createCFString('kCGWindowOwnerName'),
      name: createCFString('kCGWindowName'),
      ownerPid: createCFString('kCGWindowOwnerPID'),
      layer: createCFString('kCGWindowLayer'),
      bounds: createCFString('kCGWindowBounds'),
      onscreen: createCFString('kCGWindowIsOnscreen'),
      x: createCFString('X'),
      y: createCFString('Y'),
      width: createCFString('Width'),
      height: createCFString('Height'),
    }
    return true
  } catch {
    macUnavailable = true
    return false
  }
}

function createCFString(value: string): any {
  return CFStringCreateWithCString(null, value, K_CF_STRING_ENCODING_UTF8)
}

function readPid(hwnd: any): number {
  GetWindowThreadProcessId(hwnd, pidBuf)
  return koffi.decode(pidBuf, 'uint32', 1)[0]
}

function readRect(hwnd: any): { left: number; top: number; right: number; bottom: number } | null {
  const ok = DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, rectBuf, 16) === 0
    || GetWindowRect(hwnd, rectBuf)
  if (!ok) return null
  const [left, top, right, bottom] = koffi.decode(rectBuf, 'int32', 4)
  if (right <= left || bottom <= top) return null
  return { left, top, right, bottom }
}

function readTitle(hwnd: any): string {
  if (!titleBuf) return ''
  const len = GetWindowTextLengthW(hwnd)
  if (len <= 0) return ''
  titleBuf.fill(0)
  GetWindowTextW(hwnd, titleBuf, 512)
  return titleBuf.toString('ucs2').replace(/\u0000+$/, '').trim()
}

function isWeChatMainTitle(title: string): boolean {
  return title === '\u5fae\u4fe1'
}

function rectsNear(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): boolean {
  return Math.abs(a.x - b.x) <= 2
    && Math.abs(a.y - b.y) <= 2
    && Math.abs(a.width - b.width) <= 2
    && Math.abs(a.height - b.height) <= 2
}

function hwndAddress(hwnd: any): bigint {
  try { return koffi.address(hwnd) as bigint } catch { return 0n }
}

function findMainWindow(pid: number): { hwnd: any; hwndAddr: bigint; rect: { left: number; top: number; right: number; bottom: number } } | null {
  let hwnd = GetTopWindow(null)
  let best: { hwnd: any; hwndAddr: bigint; rect: any; area: number } | null = null
  let guard = 0
  while (hwnd && guard++ < 5000) {
    if (readPid(hwnd) === pid && IsWindowVisible(hwnd) && isWeChatMainTitle(readTitle(hwnd))) {
      const rect = readRect(hwnd)
      if (rect) {
        const area = (rect.right - rect.left) * (rect.bottom - rect.top)
        if (!best || area > best.area) best = { hwnd, hwndAddr: hwndAddress(hwnd), rect, area }
      }
    }
    hwnd = GetWindow(hwnd, GW_HWNDNEXT)
  }
  return best ? { hwnd: best.hwnd, hwndAddr: best.hwndAddr, rect: best.rect } : null
}

export function probeWeChatWindow(): WeChatWindowState {
  if (process.platform === 'darwin') return probeMacWeChatWindow()
  if (process.platform !== 'win32' || !ensureLoaded()) return NOT_FOUND

  let pid = cachedPid
  let main = pid ? findMainWindow(pid) : null
  if (!main) {
    const now = Date.now()
    if (now - lastPidProbe > 3000) {
      lastPidProbe = now
      cachedPid = wxKeyService.getWeChatPid()
      pid = cachedPid
      main = pid ? findMainWindow(pid) : null
    }
  }
  if (!pid || !main) return NOT_FOUND

  cachedMainHwndAddr = main.hwndAddr
  const minimized = IsIconic(main.hwnd)
  const foregroundActive = hwndAddress(GetForegroundWindow()) === main.hwndAddr
  const { left, top, right, bottom } = main.rect
  const dip = screen.screenToDipRect(null, { x: left, y: top, width: right - left, height: bottom - top })
  return {
    found: true,
    minimized,
    foregroundActive,
    bounds: { x: dip.x, y: dip.y, width: dip.width, height: dip.height },
  }
}

function probeMacWeChatWindow(): WeChatWindowState {
  if (!ensureMacLoaded() || !macKeys) return NOT_FOUND

  let windowList: any = null
  try {
    windowList = CGWindowListCopyWindowInfo(MAC_WINDOW_LIST_OPTIONS, 0)
    if (!windowList) return NOT_FOUND
    const count = Number(CFArrayGetCount(windowList))
    let main: MacWindowInfo | null = null
    let foreground: MacWindowInfo | null = null

    for (let i = 0; i < count; i++) {
      const dict = CFArrayGetValueAtIndex(windowList, i)
      const info = readMacWindowInfo(dict)
      if (!info) continue
      if (!foreground && info.ownerPid !== process.pid) foreground = info
      if (!isMacWeChatWindow(info)) continue

      const score = info.area + (isWeChatMainTitle(info.title) || info.title === 'WeChat' ? 1_000_000_000 : 0)
      if (!main || score > main.score) main = { ...info, score }
    }

    if (!main) return NOT_FOUND

    const foregroundActive = Boolean(foreground && foreground.ownerPid === main.ownerPid && rectsNear(main.bounds, foreground.bounds))
    return {
      found: true,
      minimized: false,
      foregroundActive,
      bounds: main.bounds,
    }
  } catch {
    return NOT_FOUND
  } finally {
    if (windowList) {
      try { CFRelease(windowList) } catch { /* ignore */ }
    }
  }
}

type MacWindowInfo = {
  ownerPid: number
  ownerName: string
  title: string
  bounds: { x: number; y: number; width: number; height: number }
  area: number
  score: number
}

function readMacWindowInfo(dict: any): MacWindowInfo | null {
  if (!macKeys) return null

  const layer = readCFNumber(CFDictionaryGetValue(dict, macKeys.layer))
  const onscreen = readCFBoolean(CFDictionaryGetValue(dict, macKeys.onscreen))
  const boundsDict = CFDictionaryGetValue(dict, macKeys.bounds)
  const bounds = boundsDict ? readMacBounds(boundsDict) : null
  if (layer !== MAC_NORMAL_WINDOW_LAYER || !onscreen || !bounds || bounds.width <= 0 || bounds.height <= 0) return null

  const ownerPid = Math.round(readCFNumber(CFDictionaryGetValue(dict, macKeys.ownerPid)))
  const ownerName = readCFString(CFDictionaryGetValue(dict, macKeys.ownerName))
  const title = readCFString(CFDictionaryGetValue(dict, macKeys.name))
  return {
    ownerPid,
    ownerName,
    title,
    bounds,
    area: bounds.width * bounds.height,
    score: 0
  }
}

function readMacBounds(boundsDict: any): MacWindowInfo['bounds'] | null {
  if (!macKeys) return null
  const x = readCFNumber(CFDictionaryGetValue(boundsDict, macKeys.x))
  const y = readCFNumber(CFDictionaryGetValue(boundsDict, macKeys.y))
  const width = readCFNumber(CFDictionaryGetValue(boundsDict, macKeys.width))
  const height = readCFNumber(CFDictionaryGetValue(boundsDict, macKeys.height))
  if (![x, y, width, height].every(Number.isFinite)) return null
  return { x, y, width, height }
}

function readCFNumber(value: any): number {
  if (!value || !macNumberBuf) return 0
  try {
    if (!CFNumberGetValue(value, K_CF_NUMBER_DOUBLE_TYPE, macNumberBuf)) return 0
    return Number(macKoffi.decode(macNumberBuf, 'double', 1)[0])
  } catch {
    return 0
  }
}

function readCFBoolean(value: any): boolean {
  if (!value) return false
  try { return Boolean(CFBooleanGetValue(value)) } catch { return false }
}

function readCFString(value: any): string {
  if (!value) return ''
  const buffer = Buffer.alloc(512)
  try {
    if (!CFStringGetCString(value, buffer, buffer.length, K_CF_STRING_ENCODING_UTF8)) return ''
    return buffer.toString('utf8').replace(/\u0000+$/, '').trim()
  } catch {
    return ''
  }
}

function isMacWeChatWindow(info: MacWindowInfo): boolean {
  return info.ownerName === 'WeChat' || info.ownerName === '微信'
}

function getWeChatPidForHook(): number | null {
  if (cachedPid) return cachedPid
  cachedPid = wxKeyService.getWeChatPid()
  return cachedPid
}

function shouldHandleWinEvent(pid: number, event: number, hwnd: any, idObject: number, idChild: number): boolean {
  if (!hwnd) return false
  if (event === EVENT_SYSTEM_FOREGROUND) return true
  if (event === EVENT_OBJECT_LOCATIONCHANGE && (idObject !== OBJID_WINDOW || idChild !== CHILDID_SELF)) return false

  const addr = hwndAddress(hwnd)
  if (cachedMainHwndAddr && addr === cachedMainHwndAddr) return true

  const main = findMainWindow(pid)
  if (!main) return false
  cachedMainHwndAddr = main.hwndAddr
  return addr === main.hwndAddr
}

export function watchWeChatWindowEvents(onChange: () => void, onDrag?: (dragging: boolean) => void): (() => void) | null {
  if (process.platform !== 'win32' || !ensureLoaded()) return null

  const pid = getWeChatPidForHook()
  if (!pid) return null

  const callback = koffi.register((hook: unknown, event: number, hwnd: unknown, idObject: number, idChild: number) => {
    try {
      if (!shouldHandleWinEvent(pid, event, hwnd, idObject, idChild)) return
      // 微信 4.x Qt 窗口拖动中部分机器不发 LOCATIONCHANGE，靠 MOVESIZE 起止事件切高频跟随
      if (event === EVENT_SYSTEM_MOVESIZESTART) onDrag?.(true)
      else if (event === EVENT_SYSTEM_MOVESIZEEND) onDrag?.(false)
      onChange()
    } catch {
      // Keep native callbacks noexcept; the fallback poll will recover state.
    }
  }, koffi.pointer(WinEventProc))

  const flags = WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS
  const hooks = [
    SetWinEventHook(EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_LOCATIONCHANGE, null, callback, pid, 0, flags),
    SetWinEventHook(EVENT_SYSTEM_MOVESIZESTART, EVENT_SYSTEM_MOVESIZEEND, null, callback, pid, 0, flags),
    SetWinEventHook(EVENT_SYSTEM_MINIMIZESTART, EVENT_SYSTEM_MINIMIZEEND, null, callback, pid, 0, flags),
    SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, null, callback, 0, 0, WINEVENT_OUTOFCONTEXT),
  ].filter(Boolean)

  if (hooks.length === 0) {
    koffi.unregister(callback)
    return null
  }

  return () => {
    onDrag?.(false)
    for (const hook of hooks) {
      try { UnhookWinEvent(hook) } catch { /* ignore */ }
    }
    try { koffi.unregister(callback) } catch { /* ignore */ }
  }
}

function nativeWindowHandleToBigInt(handle: Buffer): bigint {
  if (handle.length >= 8) return handle.readBigUInt64LE(0)
  if (handle.length >= 4) return BigInt(handle.readUInt32LE(0))
  return 0n
}

/**
 * 把回复建议送进微信输入框（Windows）。走剪贴板 + Ctrl+V，不逐字模拟——SendKeys 逐字会丢字。
 *
 * 微信 4.1 主窗口是 Qt 外壳 + 自绘内容（MMUIRenderSubWindowHW），UIA 树里没有会话名，
 * 程序读不出当前停在谁的聊天上。所以 Ctrl+F 跳转后无法验证是否进对了人，发送必须拆成两步：
 * fill 只填充不回车，commit 才发送，中间留给用户肉眼核对。
 */
export type WeChatSendResult = {
  ok: boolean
  reason?: 'unsupported' | 'no-window' | 'focus-failed' | 'busy' | 'no-permission'
}

const UNSUPPORTED: WeChatSendResult = { ok: false, reason: 'unsupported' }

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function tap(vk: number, withCtrl = false): void {
  if (withCtrl) keybdEvent(VK_CONTROL, 0, 0, 0)
  keybdEvent(vk, 0, 0, 0)
  keybdEvent(vk, 0, KEYEVENTF_KEYUP, 0)
  if (withCtrl) keybdEvent(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0)
}

function isForeground(hwndAddr: bigint): boolean {
  return Boolean(hwndAddr) && hwndAddress(GetForegroundWindow()) === hwndAddr
}

/**
 * SetForegroundWindow 受前台锁定限制，直接调用常被系统静默忽略：
 * 只有「本身是前台进程」或「刚收到过输入事件」的进程才有资格设置前台窗口。
 * 自动发送时我们通常两条都不满足（用户正在用别的软件），所以要逐级兜底。
 */
function forceForeground(hwnd: any, hwndAddr: bigint): boolean {
  if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE)
  SetForegroundWindow(hwnd)
  if (isForeground(hwndAddr)) return true

  // 自己制造一次输入事件来换取设置前台的资格。单独敲 ALT 在有菜单栏的程序里会激活菜单，
  // 但微信是 Qt 自绘、没有传统菜单栏，按下即释放不会有副作用。
  tap(VK_MENU)
  SetForegroundWindow(hwnd)
  if (isForeground(hwndAddr)) return true

  const targetThread = GetWindowThreadProcessId(hwnd, null)
  const ourThread = GetCurrentThreadId()
  if (!targetThread || targetThread === ourThread) return false
  AttachThreadInput(ourThread, targetThread, true)
  try {
    SetForegroundWindow(hwnd)
  } finally {
    AttachThreadInput(ourThread, targetThread, false)
  }
  return isForeground(hwndAddr)
}

function resolveMainWindow(): { hwnd: any; hwndAddr: bigint } | null {
  const pid = cachedPid || wxKeyService.getWeChatPid()
  if (!pid) return null
  cachedPid = pid
  const main = findMainWindow(pid)
  if (!main) return null
  cachedMainHwndAddr = main.hwndAddr
  return { hwnd: main.hwnd, hwndAddr: main.hwndAddr }
}

/**
 * 聚焦微信 →（可选）Ctrl+F 搜索名字进会话 → 粘贴正文。不按回车。
 *
 * 按键注入是全局共享资源：带跳转的一次填充要 1.4 秒，期间若再进来一次，
 * 两组 Ctrl+F/Ctrl+V/Enter 会交错打进微信（正文粘进搜索框之类）。串行化是必须的，不是优化。
 */
let filling = false

export async function fillWeChatInput(text: string, searchName?: string): Promise<WeChatSendResult> {
  if (filling) return { ok: false, reason: 'busy' }
  filling = true
  try {
    if (process.platform === 'darwin') return await fillWeChatInputMac(text, searchName)
    if (process.platform !== 'win32' || !ensureLoaded()) return UNSUPPORTED

    const main = resolveMainWindow()
    if (!main) return { ok: false, reason: 'no-window' }
    if (!forceForeground(main.hwnd, main.hwndAddr)) return { ok: false, reason: 'focus-failed' }
    await sleep(120)

    if (searchName) {
      clipboard.writeText(searchName)
      tap(VK_F, true)
      await sleep(180)
      tap(VK_V, true)
      // ponytail: 固定延迟等搜索结果，微信不给完成信号；慢机器上跳转不稳就调大这两个值
      await sleep(650)
      tap(VK_RETURN)
      await sleep(450)
      if (!isForeground(main.hwndAddr)) return { ok: false, reason: 'focus-failed' }
    }

    clipboard.writeText(text)
    await sleep(60)
    tap(VK_V, true)
    return { ok: true }
  } finally {
    filling = false
  }
}

/** 只按一个回车。前台已经不是微信就放弃，避免回车落到别的窗口上。 */
export function commitWeChatInput(): WeChatSendResult {
  if (process.platform === 'darwin') {
    if (!ensureMacInputLoaded()) return UNSUPPORTED
    if (!AXIsProcessTrusted()) return { ok: false, reason: 'no-permission' }
    if (!isWeChatForegroundMac()) return { ok: false, reason: 'focus-failed' }
    macTap(K_VK_RETURN)
    return { ok: true }
  }
  if (process.platform !== 'win32' || !ensureLoaded()) return UNSUPPORTED
  if (!isForeground(cachedMainHwndAddr)) return { ok: false, reason: 'focus-failed' }
  tap(VK_RETURN)
  return { ok: true }
}

/**
 * 把磁贴锚定在微信主窗口正上方一层（同图层，#314）：微信升到前台磁贴跟着升，
 * 微信被别的窗口挡住时磁贴一起被挡住。已在正上方时直接返回，避免 z 序抖动。
 */
export function anchorNativeWindowAboveWeChat(nativeWindowHandle: Buffer): boolean {
  if (process.platform !== 'win32' || !ensureLoaded()) return false
  const tile = nativeWindowHandleToBigInt(nativeWindowHandle)
  if (!tile) return false
  const pid = cachedPid || wxKeyService.getWeChatPid()
  if (!pid) return false
  cachedPid = pid
  const main = findMainWindow(pid)
  if (!main) return false
  cachedMainHwndAddr = main.hwndAddr
  const prev = GetWindow(main.hwnd, GW_HWNDPREV)
  const prevAddr = prev ? hwndAddress(prev) : 0n
  if (prevAddr === tile) return true
  // 紧邻上方是置顶窗时不能排它后面（会连带变成置顶），退到普通层顶部，仍在微信正上方
  const prevTopmost = prevAddr !== 0n && Boolean(Number(GetWindowLongPtrW(prev, GWL_EXSTYLE) || 0) & WS_EX_TOPMOST)
  const insertAfter = prevTopmost ? 0n : prevAddr // 0 = HWND_TOP
  const flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER
  try {
    return Boolean(SetWindowPos(tile, insertAfter, 0, 0, 0, 0, flags))
  } catch {
    return false
  }
}
