import { useEffect, useState } from 'react'
import { Copy, Minus, Square, Xmark } from '@gravity-ui/icons'
import { usePlatformInfo } from '../hooks/usePlatformInfo'
import { LiquidGlassBubble } from '../features/home/LiquidGlassBubble'
import type { GlassBubbleOptions } from '../utils/liquidGlass'
import './GlassWindowControls.css'

// 胶囊形（圆角 = 半高 17），折射铺满全表面、无内部波纹
const CONTROLS_GLASS: GlassBubbleOptions = {
  radii: { topLeft: 17, topRight: 17, bottomRight: 17, bottomLeft: 17 },
  edgeSize: 24,
  edgeStrength: 7,
  surface: 0,
  strength: 6,
}

/** 液态玻璃窗口按钮（最小化 / 最大化 / 关闭）。
 *  用于 titleBarStyle:'hidden' 且不配 titleBarOverlay 的窗口——原生 overlay 的 hover
 *  高亮色不可定制，所以自绘。mac 摆左上角（顺序 关闭/最小化/最大化），
 *  主进程那边要 hideMacWindowControls(win) 藏掉原生红绿灯，否则会重叠。
 *  放在标题栏（定位容器）内即可，自身绝对定位到角上。 */
export function GlassWindowControls({ className }: { className?: string }) {
  const { isMac } = usePlatformInfo()

  // ponytail: 没有最大化状态的 IPC，按窗口外框是否铺满工作区判定；
  // 够覆盖双击标题栏/Win+↑，要更精确得新开一条 window:maximized 事件
  const [isMaximized, setIsMaximized] = useState(false)
  useEffect(() => {
    const sync = () => setIsMaximized(
      Math.abs(window.outerWidth - window.screen.availWidth) <= 2 &&
      Math.abs(window.outerHeight - window.screen.availHeight) <= 2
    )
    sync()
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [])

  return (
    <LiquidGlassBubble
      as="div"
      className={['glass-window-controls', isMac ? 'is-mac' : 'is-win', className].filter(Boolean).join(' ')}
      glass={CONTROLS_GLASS}
    >
      <button onClick={() => window.electronAPI.window.minimize()} aria-label="最小化">
        <Minus width={16} height={16} />
      </button>
      <button onClick={() => window.electronAPI.window.maximize()} aria-label={isMaximized ? '还原' : '最大化'}>
        {isMaximized ? <Copy width={16} height={16} /> : <Square width={16} height={16} />}
      </button>
      <button className="close-btn" onClick={() => window.electronAPI.window.close()} aria-label="关闭">
        <Xmark width={16} height={16} />
      </button>
    </LiquidGlassBubble>
  )
}
