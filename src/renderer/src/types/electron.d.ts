interface ObsidianAPI {
  getVaults: () => Promise<Array<{ path: string; name: string }>>
  getFiles: (vaultName: string) => Promise<Array<{ path: string; type: 'folder' | 'markdown'; name: string }>>
  getFolders: (vaultName: string) => Promise<Array<{ path: string; type: 'folder' | 'markdown'; name: string }>>
}

interface WxAutoAPI {
  initialize: () => Promise<any>
  getConnectionStatus: () => Promise<any>
  reconnect: () => Promise<any>
  getContacts: () => Promise<any>
  getGroups: () => Promise<any>
  getSessionList: () => Promise<any>
  sendMessage: (contactName: string, message: string) => Promise<any>
  bulkSend: (contacts: string[], message: string, delayRange?: [number, number]) => Promise<any>
  getMessageHistory: (contactName: string, forceRefresh?: boolean) => Promise<any>
  clearChatMessages: (contactName: string) => Promise<any>
  refreshChatMessages: (contactName: string) => Promise<any>
  getMessagesFromDb: (contactName: string, page?: number, perPage?: number) => Promise<any>
  getMoreMessagesFromDb: (contactName: string, beforeId?: number, limit?: number) => Promise<any>
  saveContactsToDb: (contacts: any[]) => Promise<any>
  getContactsFromDb: () => Promise<any>
  startMonitoring: (contactName: string, autoReply?: boolean) => Promise<any>
  stopMonitoring: (contactName: string) => Promise<any>
  getAutoReplyStatus: () => Promise<any>
  toggleAutoReply: (enabled: boolean) => Promise<any>
  getAiSalesConfig: () => Promise<any>
  updateAiSalesConfig: (config: any) => Promise<any>
}

interface ElectronAPI {
  ipcRenderer?: {
    on: (channel: string, listener: (...args: any[]) => void) => void
    off: (channel: string, listener: (...args: any[]) => void) => void
    invoke: (channel: string, ...args: any[]) => Promise<any>
    send: (channel: string, ...args: any[]) => void
  }
}

interface Window {
  obsidian: ObsidianAPI
  electron?: ElectronAPI
  wxAuto: WxAutoAPI
}
