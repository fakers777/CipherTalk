import type {
  RelayOneApiKey,
  RelayOneCheckoutInfo,
  RelayOneCreateKeyInput,
  RelayOneCreateKeyResult,
  RelayOneCreatePaymentOrderInput,
  RelayOneGroup,
  RelayOneGroupRate,
  RelayOneIpcResult,
  RelayOneLoginInput,
  RelayOneLoginResult,
  RelayOnePaymentOrder,
  RelayOnePublicSettings,
  RelayOneRegisterInput,
  RelayOneStatus,
  RelayOneUser
} from '../types/relayOne'

async function unwrap<T>(request: Promise<RelayOneIpcResult<T>>): Promise<T> {
  const result = await request
  if (!result.success) throw new Error(result.error)
  return result.data
}

export const relayOneService = {
  getStatus: (): Promise<RelayOneStatus> => unwrap(window.electronAPI.relayOne.getStatus()),
  getPublicSettings: (): Promise<RelayOnePublicSettings> => unwrap(window.electronAPI.relayOne.getPublicSettings()),
  sendVerificationCode: (email: string): Promise<void> => unwrap(window.electronAPI.relayOne.sendVerificationCode(email)),
  register: (input: RelayOneRegisterInput): Promise<void> => unwrap(window.electronAPI.relayOne.register(input)),
  login: (input: RelayOneLoginInput): Promise<RelayOneLoginResult> => unwrap(window.electronAPI.relayOne.login(input)),
  verifyTwoFactor: (code: string): Promise<RelayOneLoginResult> => unwrap(window.electronAPI.relayOne.verifyTwoFactor(code)),
  logout: (): Promise<void> => unwrap(window.electronAPI.relayOne.logout()),
  getCurrentUser: (): Promise<RelayOneUser> => unwrap(window.electronAPI.relayOne.getCurrentUser()),
  listApiKeys: (): Promise<RelayOneApiKey[]> => unwrap(window.electronAPI.relayOne.listApiKeys()),
  createApiKey: (input: RelayOneCreateKeyInput): Promise<RelayOneCreateKeyResult> => unwrap(window.electronAPI.relayOne.createApiKey(input)),
  applyApiKey: (keyId: string): Promise<void> => unwrap(window.electronAPI.relayOne.applyApiKey(keyId)),
  updateApiKeyGroup: (keyId: string, groupId: string): Promise<RelayOneApiKey> => unwrap(window.electronAPI.relayOne.updateApiKeyGroup(keyId, groupId)),
  deleteApiKey: (keyId: string): Promise<void> => unwrap(window.electronAPI.relayOne.deleteApiKey(keyId)),
  listAvailableGroups: (): Promise<RelayOneGroup[]> => unwrap(window.electronAPI.relayOne.listAvailableGroups()),
  listGroupRates: (): Promise<RelayOneGroupRate[]> => unwrap(window.electronAPI.relayOne.listGroupRates()),
  getCheckoutInfo: (): Promise<RelayOneCheckoutInfo> => unwrap(window.electronAPI.relayOne.getCheckoutInfo()),
  createPaymentOrder: (input: RelayOneCreatePaymentOrderInput): Promise<RelayOnePaymentOrder> => unwrap(window.electronAPI.relayOne.createPaymentOrder(input)),
  getPaymentOrder: (orderId: string): Promise<RelayOnePaymentOrder> => unwrap(window.electronAPI.relayOne.getPaymentOrder(orderId)),
  cancelPaymentOrder: (orderId: string): Promise<RelayOnePaymentOrder> => unwrap(window.electronAPI.relayOne.cancelPaymentOrder(orderId)),
  openPaymentWindow: (url: string): Promise<void> => unwrap(window.electronAPI.relayOne.openPaymentWindow(url)),
  closePaymentWindow: (): Promise<void> => unwrap(window.electronAPI.relayOne.closePaymentWindow()),
  onStatusChanged: (callback: (status: RelayOneStatus) => void): (() => void) => window.electronAPI.relayOne.onStatusChanged(callback),
  onProviderApplied: (callback: () => void): (() => void) => window.electronAPI.relayOne.onProviderApplied(callback)
}
