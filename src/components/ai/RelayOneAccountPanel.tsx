import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Alert,
  Button,
  Card,
  Chip,
  CloseButton,
  Description,
  InputGroup,
  Label,
  ListBox,
  Modal,
  Select,
  Spinner,
  Tabs,
  TextField,
  Typography,
  useOverlayState,
  type Key
} from '@heroui/react'
import { ArrowUpRight, ArrowsRotateLeft, CircleCheck, PersonNutHex, Plus, QrCode, TrashBin, Wallet } from '@gravity-ui/icons'
import { relayOneService } from '../../services/relayOne'
import type {
  RelayOneApiKey,
  RelayOneCheckoutInfo,
  RelayOneGroup,
  RelayOneGroupRate,
  RelayOnePaymentOrder,
  RelayOnePublicSettings,
  RelayOneStatus,
  RelayOneUser
} from '../../types/relayOne'

interface RelayOneAccountPanelProps {
  onProviderApplied: () => void | Promise<void>
  showMessage: (text: string, success: boolean) => void
  hasConfiguredApiKey: boolean
  /** 账户/余额状态条挂载到接入参数卡片内的这个容器 */
  statusHost: HTMLElement | null
}

type AuthTab = 'login' | 'register'
const DEFAULT_GROUP_KEY = '__default__'
const PRESET_AMOUNTS = [10, 20, 30, 40, 50]

const EMPTY_STATUS: RelayOneStatus = {
  authenticated: false,
  hasRefreshToken: false,
  encryptionAvailable: true,
  sessionPersistent: true
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatMoney(value: number | undefined, currency = 'CNY'): string {
  if (value === undefined) return '--'
  try {
    return new Intl.NumberFormat('zh-CN', { style: 'currency', currency }).format(value)
  } catch {
    return `${value.toFixed(2)} ${currency}`
  }
}

function statusLabel(status: RelayOnePaymentOrder['status']): string {
  const labels: Record<RelayOnePaymentOrder['status'], string> = {
    pending: '待支付',
    paid: '已支付',
    failed: '支付失败',
    cancelled: '已取消',
    expired: '已过期',
    unknown: '状态未知'
  }
  return labels[status]
}

function groupLabel(groupId: string | undefined, groups: RelayOneGroup[]): string {
  if (!groupId) return '默认分组'
  return groups.find((group) => group.id === groupId)?.name || groupId
}

function groupRate(groupId: string | undefined, groupName: string, rates: RelayOneGroupRate[]): number | undefined {
  if (groupId) {
    return rates.find((rate) => rate.groupId === groupId || rate.groupName === groupName)?.rate
  }
  return rates.find((rate) => {
    const normalizedId = rate.groupId.trim().toLowerCase()
    const normalizedName = rate.groupName.trim().toLowerCase()
    return !normalizedId || normalizedId === 'default' || normalizedId === DEFAULT_GROUP_KEY || normalizedName === '默认分组' || normalizedName === 'default'
  })?.rate
}

function GroupRateChip({ rate }: { rate: number | undefined }) {
  if (rate === undefined) return null
  return <Chip size="sm" variant="soft" color="accent" className="shrink-0"><Chip.Label>{rate}x</Chip.Label></Chip>
}

export default function RelayOneAccountPanel({ onProviderApplied, showMessage, hasConfiguredApiKey, statusHost }: RelayOneAccountPanelProps) {
  const [status, setStatus] = useState<RelayOneStatus>(EMPTY_STATUS)
  const [publicSettings, setPublicSettings] = useState<RelayOnePublicSettings | null>(null)
  const [user, setUser] = useState<RelayOneUser | null>(null)
  const [apiKeys, setApiKeys] = useState<RelayOneApiKey[]>([])
  const [groups, setGroups] = useState<RelayOneGroup[]>([])
  const [rates, setRates] = useState<RelayOneGroupRate[]>([])
  const [checkoutInfo, setCheckoutInfo] = useState<RelayOneCheckoutInfo | null>(null)
  const [order, setOrder] = useState<RelayOnePaymentOrder | null>(null)
  const [authTab, setAuthTab] = useState<AuthTab>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [verificationCountdown, setVerificationCountdown] = useState(0)
  const [promoCode, setPromoCode] = useState('')
  const [invitationCode, setInvitationCode] = useState('')
  const [twoFactorCode, setTwoFactorCode] = useState('')
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false)
  const [newKeyName, setNewKeyName] = useState('CipherTalk')
  const [newKeyGroupId, setNewKeyGroupId] = useState('')
  const [rechargeAmount, setRechargeAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('')
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState('')
  const [error, setError] = useState('')
  const [accountModalOpen, setAccountModalOpen] = useState(false)
  const accountModalState = useOverlayState({
    isOpen: accountModalOpen,
    onOpenChange: setAccountModalOpen
  })

  const activeGroups = useMemo(() => groups.filter((group) => group.enabled), [groups])
  const activePaymentMethods = useMemo(
    () => checkoutInfo?.paymentMethods.filter((method) => method.enabled) || [],
    [checkoutInfo]
  )

  const loadAccountData = useCallback(async () => {
    const results = await Promise.allSettled([
      relayOneService.getCurrentUser(),
      relayOneService.listApiKeys(),
      relayOneService.listAvailableGroups(),
      relayOneService.listGroupRates(),
      relayOneService.getCheckoutInfo()
    ])

    if (results[0].status === 'fulfilled') setUser(results[0].value)
    if (results[1].status === 'fulfilled') setApiKeys(results[1].value)
    const nextGroups = results[2].status === 'fulfilled' ? results[2].value : []
    if (results[2].status === 'fulfilled') setGroups(nextGroups)
    if (results[3].status === 'fulfilled') {
      const userRates = results[3].value
      setRates(nextGroups.length > 0 ? nextGroups.map((group) => ({
        groupId: group.id,
        groupName: group.name,
        rate: userRates.find((rate) => rate.groupId === group.id)?.rate ?? group.rateMultiplier
      })) : userRates)
    }
    if (results[4].status === 'fulfilled') {
      const checkout = results[4].value
      setCheckoutInfo(checkout)
      setRechargeAmount((current) => current || '20')
      setPaymentMethod((current) => current || checkout.paymentMethods.find((method) => method.enabled)?.id || '')
    }

    const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (rejected) setError(errorMessage(rejected.reason))
  }, [])

  const initialize = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [nextStatus, settings] = await Promise.all([
        relayOneService.getStatus(),
        relayOneService.getPublicSettings().catch(() => null)
      ])
      setStatus(nextStatus)
      if (settings) setPublicSettings(settings)
      if (nextStatus.authenticated) await loadAccountData()
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setLoading(false)
    }
  }, [loadAccountData])

  useEffect(() => {
    void initialize()
    return relayOneService.onStatusChanged((nextStatus) => {
      setStatus(nextStatus)
      setUser(nextStatus.user || null)
    })
  }, [initialize])

  useEffect(() => {
    if (!order || order.status !== 'pending') return
    const timer = window.setInterval(() => {
      void relayOneService.getPaymentOrder(order.id)
        .then((nextOrder) => {
          setOrder(nextOrder)
          if (nextOrder.status !== 'pending') void relayOneService.closePaymentWindow()
          if (nextOrder.status === 'paid') {
            showMessage('充值已到账', true)
            void loadAccountData()
          }
        })
        .catch((nextError) => setError(errorMessage(nextError)))
    }, 3000)
    return () => window.clearInterval(timer)
  }, [loadAccountData, order, showMessage])

  useEffect(() => {
    if (verificationCountdown <= 0) return
    const timer = window.setTimeout(() => {
      setVerificationCountdown((current) => Math.max(0, current - 1))
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [verificationCountdown])

  const runAction = async (name: string, operation: () => Promise<void>) => {
    setAction(name)
    setError('')
    try {
      await operation()
    } catch (nextError) {
      const message = errorMessage(nextError)
      setError(message)
      showMessage(message, false)
    } finally {
      setAction('')
    }
  }

  const handleLogin = () => runAction('login', async () => {
    const result = await relayOneService.login({ email, password })
    if (result.requiresTwoFactor) {
      setRequiresTwoFactor(true)
      setPassword('')
      return
    }
    setStatus(result.status || await relayOneService.getStatus())
    setPassword('')
    await loadAccountData()
    showMessage('RelayOne 登录成功', true)
  })

  const handleVerifyTwoFactor = () => runAction('2fa', async () => {
    const result = await relayOneService.verifyTwoFactor(twoFactorCode)
    setStatus(result.status || await relayOneService.getStatus())
    setRequiresTwoFactor(false)
    setTwoFactorCode('')
    await loadAccountData()
    showMessage('两步验证成功', true)
  })

  const handleRegister = () => runAction('register', async () => {
    if (!confirmPassword) throw new Error('请再次输入密码')
    if (password !== confirmPassword) throw new Error('两次输入的密码不一致')
    await relayOneService.register({
      email,
      password,
      verificationCode: verificationCode || undefined,
      promoCode: promoCode || undefined,
      invitationCode: invitationCode || undefined
    })
    setAuthTab('login')
    setConfirmPassword('')
    setVerificationCode('')
    showMessage('注册成功，请登录', true)
  })

  const handleSendCode = () => runAction('send-code', async () => {
    await relayOneService.sendVerificationCode(email)
    setVerificationCountdown(60)
    showMessage('验证码已发送', true)
  })

  const handleLogout = () => runAction('logout', async () => {
    await relayOneService.logout()
    setStatus(await relayOneService.getStatus())
    setUser(null)
    setApiKeys([])
    setOrder(null)
    showMessage('已退出 RelayOne 账户', true)
  })

  const handleCreateKey = () => runAction('create-key', async () => {
    await relayOneService.createApiKey({ name: newKeyName, groupId: newKeyGroupId || undefined })
    setApiKeys(await relayOneService.listApiKeys())
    await onProviderApplied()
    setAccountModalOpen(false)
    showMessage('API Key 已创建并应用到当前 AI 配置', true)
  })

  const handleApplyKey = (keyId: string) => runAction(`apply-${keyId}`, async () => {
    await relayOneService.applyApiKey(keyId)
    await onProviderApplied()
    setAccountModalOpen(false)
    showMessage('API Key 已应用到当前 AI 配置', true)
  })

  const handleUpdateKeyGroup = (keyId: string, groupId: string) => runAction(`group-${keyId}`, async () => {
    await relayOneService.updateApiKeyGroup(keyId, groupId)
    setApiKeys(await relayOneService.listApiKeys())
    showMessage('Key 分组已更新', true)
  })

  const handleDeleteKey = (keyId: string) => {
    if (!window.confirm('确认删除这个 RelayOne API Key？已写入 CipherTalk 的本地 Key 不会自动清除。')) return
    void runAction(`delete-${keyId}`, async () => {
      await relayOneService.deleteApiKey(keyId)
      setApiKeys((current) => current.filter((item) => item.id !== keyId))
      showMessage('API Key 已删除', true)
    })
  }

  const handleCreateOrder = () => runAction('create-order', async () => {
    const nextOrder = await relayOneService.createPaymentOrder({
      amount: Number(rechargeAmount),
      paymentType: paymentMethod
    })
    setOrder(nextOrder)
    if (nextOrder.paymentUrl) {
      await relayOneService.openPaymentWindow(nextOrder.paymentUrl)
    } else {
      showMessage('订单已创建，但服务端未返回支付页面', false)
    }
  })

  const handleCancelOrder = () => {
    if (!order || order.status !== 'pending') return
    if (!window.confirm('确认取消这个待支付订单？')) return
    void runAction('cancel-order', async () => {
      setOrder(await relayOneService.cancelPaymentOrder(order.id))
      await relayOneService.closePaymentWindow()
      showMessage('订单已取消', true)
    })
  }

  if (loading) {
    const loadingBar = <div className="flex min-h-12 items-center gap-2 border-y border-divider px-1 text-sm text-muted-foreground"><Spinner size="sm" />正在读取 RelayOne 账户...</div>
    return statusHost ? createPortal(loadingBar, statusHost) : null
  }

  const rechargeSection = (
    <div className="space-y-3">
      <div className="flex items-center gap-2"><Wallet width={16} height={16} /><Typography.Heading level={4} className="text-sm">账户充值</Typography.Heading></div>
      <TextField fullWidth value={rechargeAmount} onChange={setRechargeAmount}>
        <Label>充值金额</Label>
        <InputGroup variant="secondary" fullWidth><InputGroup.Prefix>{checkoutInfo?.currency || 'CNY'}</InputGroup.Prefix><InputGroup.Input type="number" min={checkoutInfo?.minimumAmount || 0.01} max={checkoutInfo?.maximumAmount} step="0.01" /></InputGroup>
      </TextField>
      <div className="grid grid-cols-5 gap-1.5">
        {PRESET_AMOUNTS.map((amount) => (
          <Button key={amount} type="button" variant={Number(rechargeAmount) === amount ? 'primary' : 'outline'} size="sm" className="w-full min-w-0 px-1" onPress={() => setRechargeAmount(String(amount))}>
            ¥{amount}
          </Button>
        ))}
      </div>
      {activePaymentMethods.length > 0 && (
        <Select selectedKey={paymentMethod || null} onSelectionChange={(key: Key | null) => setPaymentMethod(key == null ? '' : String(key))} placeholder="支付方式" variant="secondary" fullWidth>
          <Label>支付方式</Label>
          <Select.Trigger><Select.Value>{({ defaultChildren }) => activePaymentMethods.find((method) => method.id === paymentMethod)?.name || defaultChildren}</Select.Value><Select.Indicator /></Select.Trigger>
          <Select.Popover><ListBox>{activePaymentMethods.map((method) => <ListBox.Item key={method.id} id={method.id} textValue={method.name}>{method.name}<ListBox.ItemIndicator /></ListBox.Item>)}</ListBox></Select.Popover>
        </Select>
      )}
      {order && (
        <Alert status={order.status === 'paid' ? 'success' : order.status === 'pending' ? 'warning' : 'default'}>
          <Alert.Indicator>{order.status === 'paid' ? <CircleCheck width={18} height={18} /> : <Wallet width={18} height={18} />}</Alert.Indicator>
          <Alert.Content><Alert.Title>订单 {statusLabel(order.status)}</Alert.Title><Alert.Description>{formatMoney(order.amount, order.currency)}{order.status === 'pending' ? '，正在每 3 秒查询状态' : ''}</Alert.Description></Alert.Content>
          {order.paymentUrl && order.status === 'pending' && <Button type="button" variant="outline" size="sm" onPress={() => void relayOneService.openPaymentWindow(order.paymentUrl!)}><ArrowUpRight width={16} height={16} />打开支付页</Button>}
          {order.status === 'pending' && <Button type="button" variant="danger-soft" size="sm" onPress={handleCancelOrder} isDisabled={Boolean(action)}>{action === 'cancel-order' && <Spinner size="sm" />}取消订单</Button>}
        </Alert>
      )}
    </div>
  )

  const accountContent = (
    <div className="space-y-5">
      {!status.encryptionAvailable && (
        <Alert status="warning">
          <Alert.Content>
            <Alert.Title>系统凭据加密不可用</Alert.Title>
            <Alert.Description>本次登录令牌只保存在内存中，退出 CipherTalk 后需要重新登录。</Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      {error && (
        <Alert status="danger">
          <Alert.Content>
            <Alert.Title>RelayOne 操作失败</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      {!status.authenticated ? (
        <div className="mx-auto w-full max-w-md py-2">
          {requiresTwoFactor ? (
            <div className="space-y-4">
              <TextField fullWidth value={twoFactorCode} onChange={setTwoFactorCode}>
                <Label>两步验证码</Label>
                <InputGroup variant="secondary" fullWidth><InputGroup.Input inputMode="numeric" autoComplete="one-time-code" placeholder="请输入验证码" /></InputGroup>
              </TextField>
              <Button type="button" variant="primary" className="w-full" onPress={handleVerifyTwoFactor} isDisabled={Boolean(action)}>
                {action === '2fa' && <Spinner size="sm" />}验证并登录
              </Button>
              <Button type="button" variant="tertiary" className="w-full" onPress={() => { setRequiresTwoFactor(false); setTwoFactorCode('') }}>返回登录</Button>
            </div>
          ) : (
            <Tabs selectedKey={authTab} onSelectionChange={(key) => setAuthTab(String(key) as AuthTab)} className="w-full">
              <Tabs.ListContainer>
                <Tabs.List aria-label="RelayOne 账户操作" className="w-full *:flex-1">
                  <Tabs.Tab id="login">登录<Tabs.Indicator /></Tabs.Tab>
                  {publicSettings?.registrationEnabled !== false && <Tabs.Tab id="register">注册<Tabs.Indicator /></Tabs.Tab>}
                </Tabs.List>
              </Tabs.ListContainer>
              <Tabs.Panel id="login" className="pt-5">
                <div className="space-y-4">
                  <TextField fullWidth value={email} onChange={setEmail}>
                    <Label>邮箱</Label>
                    <InputGroup variant="secondary" fullWidth><InputGroup.Input type="email" autoComplete="email" placeholder="name@example.com" /></InputGroup>
                  </TextField>
                  <TextField fullWidth value={password} onChange={setPassword}>
                    <Label>密码</Label>
                    <InputGroup variant="secondary" fullWidth><InputGroup.Input type="password" autoComplete="current-password" placeholder="请输入密码" /></InputGroup>
                  </TextField>
                  <Button type="button" variant="primary" className="w-full" onPress={handleLogin} isDisabled={Boolean(action)}>
                    {action === 'login' && <Spinner size="sm" />}登录 RelayOne
                  </Button>
                </div>
              </Tabs.Panel>
              <Tabs.Panel id="register" className="pt-5">
                <div className="space-y-4">
                  <TextField fullWidth value={email} onChange={setEmail}>
                    <Label>邮箱</Label>
                    <InputGroup variant="secondary" fullWidth><InputGroup.Input type="email" autoComplete="email" placeholder="name@example.com" /></InputGroup>
                  </TextField>
                  <TextField fullWidth value={password} onChange={setPassword}>
                    <Label>密码</Label>
                    <InputGroup variant="secondary" fullWidth><InputGroup.Input type="password" autoComplete="new-password" placeholder="设置登录密码" /></InputGroup>
                  </TextField>
                  <TextField fullWidth value={confirmPassword} onChange={setConfirmPassword}>
                    <Label>确认密码</Label>
                    <InputGroup variant="secondary" fullWidth><InputGroup.Input type="password" autoComplete="new-password" placeholder="再次输入密码" /></InputGroup>
                  </TextField>
                  {publicSettings?.emailVerificationEnabled && (
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
                      <TextField fullWidth value={verificationCode} onChange={setVerificationCode}>
                        <Label>邮箱验证码</Label>
                        <InputGroup variant="secondary" fullWidth><InputGroup.Input autoComplete="one-time-code" placeholder="验证码" /></InputGroup>
                      </TextField>
                      <Button type="button" variant="outline" className="min-w-28" onPress={handleSendCode} isDisabled={Boolean(action) || verificationCountdown > 0 || !email.trim()}>
                        {action === 'send-code' ? <Spinner size="sm" /> : verificationCountdown > 0 ? `${verificationCountdown} 秒` : '发送验证码'}
                      </Button>
                    </div>
                  )}
                  {publicSettings?.promoCodeEnabled && (
                    <TextField fullWidth value={promoCode} onChange={setPromoCode}>
                      <Label>优惠码</Label>
                      <InputGroup variant="secondary" fullWidth><InputGroup.Input placeholder="选填" /></InputGroup>
                    </TextField>
                  )}
                  {publicSettings?.invitationCodeEnabled && (
                    <TextField fullWidth value={invitationCode} onChange={setInvitationCode}>
                      <Label>邀请码</Label>
                      <InputGroup variant="secondary" fullWidth><InputGroup.Input placeholder="请输入邀请码" /></InputGroup>
                    </TextField>
                  )}
                  <Button type="button" variant="primary" className="w-full" onPress={handleRegister} isDisabled={Boolean(action)}>
                    {action === 'register' && <Spinner size="sm" />}创建账户
                  </Button>
                  {(publicSettings?.agreementUrl || publicSettings?.privacyUrl) && (
                    <div className="flex justify-center gap-4 text-xs">
                      {publicSettings.agreementUrl && <button type="button" className="text-accent hover:underline" onClick={() => void window.electronAPI.shell.openExternal(publicSettings.agreementUrl!)}>用户协议</button>}
                      {publicSettings.privacyUrl && <button type="button" className="text-accent hover:underline" onClick={() => void window.electronAPI.shell.openExternal(publicSettings.privacyUrl!)}>隐私政策</button>}
                    </div>
                  )}
                </div>
              </Tabs.Panel>
            </Tabs>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          <section className="grid gap-3 border-y border-divider py-4 sm:grid-cols-3">
            <div><div className="text-xs text-muted-foreground">账户</div><div className="mt-1 truncate text-sm font-medium">{user?.name || user?.email || status.user?.email || 'RelayOne 用户'}</div></div>
            <div><div className="text-xs text-muted-foreground">邮箱</div><div className="mt-1 truncate text-sm font-medium">{user?.email || status.user?.email || '--'}</div></div>
            <div><div className="text-xs text-muted-foreground">余额</div><div className="mt-1 text-sm font-semibold text-success">{formatMoney(user?.balance, checkoutInfo?.currency || 'CNY')}</div></div>
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><Typography.Heading level={4} className="text-sm">API Key</Typography.Heading><Description>新建 Key 会直接应用到 CipherTalk 的 RelayOne 模型配置。</Description></div>
              <Chip size="sm" variant="soft" color="accent"><Chip.Label>{apiKeys.length} 个</Chip.Label></Chip>
            </div>
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto]">
              <TextField fullWidth value={newKeyName} onChange={setNewKeyName}>
                <Label>Key 名称</Label>
                <InputGroup variant="secondary" fullWidth><InputGroup.Input placeholder="CipherTalk" /></InputGroup>
              </TextField>
              <Select selectedKey={newKeyGroupId || DEFAULT_GROUP_KEY} onSelectionChange={(key: Key | null) => setNewKeyGroupId(key == null || String(key) === DEFAULT_GROUP_KEY ? '' : String(key))} placeholder="默认分组" variant="secondary" fullWidth>
                <Label>分组</Label>
                <Select.Trigger>
                  <Select.Value>{({ defaultChildren }) => (
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate">{groupLabel(newKeyGroupId, activeGroups) || defaultChildren}</span>
                      <GroupRateChip rate={groupRate(newKeyGroupId, groupLabel(newKeyGroupId, activeGroups), rates)} />
                    </span>
                  )}</Select.Value>
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item id={DEFAULT_GROUP_KEY} textValue="默认分组">
                      <span className="flex min-w-0 flex-1 items-center gap-2"><span>默认分组</span><GroupRateChip rate={groupRate(undefined, '默认分组', rates)} /></span>
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                    {activeGroups.map((group) => (
                      <ListBox.Item key={group.id} id={group.id} textValue={group.name}>
                        <span className="flex min-w-0 flex-1 items-center gap-2"><span className="truncate">{group.name}</span><GroupRateChip rate={groupRate(group.id, group.name, rates)} /></span>
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
              <Button type="button" variant="primary" size="sm" className="self-end" onPress={handleCreateKey} isDisabled={Boolean(action)}>
                {action === 'create-key' ? <Spinner size="sm" /> : <Plus width={16} height={16} />}创建并应用
              </Button>
            </div>
            <div className="h-52 divide-y divide-divider overflow-y-auto overscroll-contain border-t border-divider scrollbar">
              {apiKeys.length === 0 ? <div className="py-5 text-sm text-muted-foreground">暂无 API Key</div> : apiKeys.map((item) => (
                <div key={item.id} className="grid items-center gap-3 py-3 md:grid-cols-[minmax(0,1fr)_240px_auto]">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="truncate text-sm font-medium">{item.name}</div>
                      {item.isApplied && <Chip size="sm" variant="soft" color="success"><Chip.Label>使用中</Chip.Label></Chip>}
                    </div>
                    <div className="truncate font-mono text-xs text-muted-foreground">{item.keyPreview || '密钥仅在创建时可见'}</div>
                  </div>
                  <Select selectedKey={item.groupId || DEFAULT_GROUP_KEY} onSelectionChange={(key: Key | null) => void handleUpdateKeyGroup(item.id, key == null || String(key) === DEFAULT_GROUP_KEY ? '' : String(key))} placeholder="默认分组" variant="secondary" fullWidth isDisabled={Boolean(action)}>
                    <Select.Trigger>
                      <Select.Value>{({ defaultChildren }) => (
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate">{groupLabel(item.groupId, activeGroups) || defaultChildren}</span>
                          <GroupRateChip rate={groupRate(item.groupId, groupLabel(item.groupId, activeGroups), rates)} />
                        </span>
                      )}</Select.Value>
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        <ListBox.Item id={DEFAULT_GROUP_KEY} textValue="默认分组">
                          <span className="flex min-w-0 flex-1 items-center gap-2"><span>默认分组</span><GroupRateChip rate={groupRate(undefined, '默认分组', rates)} /></span>
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                        {activeGroups.map((group) => (
                          <ListBox.Item key={group.id} id={group.id} textValue={group.name}>
                            <span className="flex min-w-0 flex-1 items-center gap-2"><span className="truncate">{group.name}</span><GroupRateChip rate={groupRate(group.id, group.name, rates)} /></span>
                            <ListBox.ItemIndicator />
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    </Select.Popover>
                  </Select>
                  <div className="flex items-center gap-2">
                    <Button type="button" variant={item.isApplied ? 'outline' : 'primary'} size="sm" onPress={() => void handleApplyKey(item.id)} isDisabled={Boolean(action) || item.isApplied}>
                      {action === `apply-${item.id}` && <Spinner size="sm" />}{item.isApplied ? '使用中' : '使用'}
                    </Button>
                    <Button type="button" variant="danger-soft" size="sm" isIconOnly aria-label={`删除 ${item.name}`} onPress={() => handleDeleteKey(item.id)} isDisabled={Boolean(action)}>
                      {action === `delete-${item.id}` ? <Spinner size="sm" /> : <TrashBin width={16} height={16} />}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </section>

        </div>
      )}
    </div>
  )

  const accountModal = (
    <Modal state={accountModalState}>
      <Modal.Backdrop variant="blur" className="z-2000">
        <Modal.Container
          size="lg"
          scroll="inside"
          placement="center"
          className={`w-full! max-h-[calc(100vh-32px)]! p-4! ${status.authenticated ? 'max-w-220!' : 'max-w-156!'}`}
        >
          <Modal.Dialog aria-label="RelayOne 账户管理" className="max-w-none!">
            <Modal.Header className="gap-2 border-b border-divider pb-3">
              <div className="flex justify-end">
                <CloseButton aria-label="关闭 RelayOne 账户管理" onPress={() => setAccountModalOpen(false)} />
              </div>
              <div className="flex items-center gap-2">
                <Modal.Heading className="min-w-0 text-base font-semibold text-foreground">RelayOne 账户管理</Modal.Heading>
                {status.authenticated && (
                  <Button type="button" variant="outline" size="sm" isIconOnly aria-label="刷新 RelayOne 账户" onPress={() => void initialize()} isDisabled={Boolean(action)}>
                    <ArrowsRotateLeft width={16} height={16} />
                  </Button>
                )}
              </div>
            </Modal.Header>
            <Modal.Body className="mt-0! px-5 pb-5 pt-0">
              {accountContent}
            </Modal.Body>
            {status.authenticated && (
              <Modal.Footer className="justify-end border-t border-divider pt-4">
                <Button type="button" variant="danger" size="sm" onPress={handleLogout} isDisabled={Boolean(action)}>
                  {action === 'logout' && <Spinner size="sm" />}退出
                </Button>
              </Modal.Footer>
            )}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )

  const statusBar = (
    <div className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 border-y border-divider py-2.5">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent-soft-foreground">
        <Wallet width={17} height={17} />
      </div>
      <div className="min-w-32 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-sm font-medium text-foreground">RelayOne 账户</span>
          <Chip size="sm" variant="soft" color={status.authenticated ? 'success' : 'default'}>
            <Chip.Label>{status.authenticated ? '已登录' : '未登录'}</Chip.Label>
          </Chip>
        </div>
        <div className={`mt-0.5 truncate text-xs ${error ? 'text-danger' : 'text-muted-foreground'}`}>
          {error || (status.authenticated ? (user?.email || status.user?.email || 'RelayOne 用户') : '尚未登录')}
        </div>
      </div>
      {status.authenticated && (
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-sm font-semibold text-success">{formatMoney(user?.balance, checkoutInfo?.currency || 'CNY')}</span>
          <Chip size="sm" variant="soft" color={hasConfiguredApiKey ? 'accent' : 'warning'}>
            <Chip.Label>{hasConfiguredApiKey ? 'Key 已应用' : '未应用 Key'}</Chip.Label>
          </Chip>
        </div>
      )}
      {!status.encryptionAvailable && <span className="shrink-0 text-xs text-warning">仅本次会话</span>}
    </div>
  )

  return (
    <>
      {statusHost && createPortal(statusBar, statusHost)}
      <Card>
        <Card.Content>
          {status.authenticated ? rechargeSection : (
            <div className="text-sm text-muted-foreground">登录 RelayOne 账户后可直接充值并创建 API Key。</div>
          )}
        </Card.Content>

        <Card.Footer className="gap-2 *:min-w-0 *:flex-1">
          <Button
            type="button"
            variant="primary"
            size="sm"
            className="bg-amber-700! text-white! hover:bg-amber-800!"
            onPress={() => setAccountModalOpen(true)}
          >
            <PersonNutHex width={16} height={16} />
            {status.authenticated ? (hasConfiguredApiKey ? '账户管理' : '创建 Key') : '登录 / 注册'}
          </Button>
          {status.authenticated && (
            <Button type="button" variant="primary" size="sm" onPress={handleCreateOrder} isDisabled={Boolean(action) || !paymentMethod}>
              {action === 'create-order' ? <Spinner size="sm" /> : <QrCode width={16} height={16} />}充值
            </Button>
          )}
        </Card.Footer>
      </Card>
      {createPortal(accountModal, document.body)}
    </>
  )
}
