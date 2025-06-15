// WxAuto类型定义文件

export interface WxAutoResponse {
  success: boolean
  message?: string
  data?: any
  connected?: boolean
  user_info?: {
    nickname: string
    is_logged_in: boolean
  }
}

export interface ContactInfo {
  id: string
  name: string
  type: 'friend' | 'group'
  member_count?: number
  wxid?: string
  remark?: string
  avatar?: string
  source?: string
  nickname?: string
  last_message?: string
  last_message_time?: string
  unread_count?: number
}

export interface MessageInfo {
  id: string
  content: string
  sender: string
  timestamp: string
  is_self: boolean
  message_type: string
}

export interface WxAutoAPI {
  initialize(): Promise<WxAutoResponse>
  getConnectionStatus(): Promise<WxAutoResponse>
  reconnect(): Promise<WxAutoResponse>
  getContacts(): Promise<WxAutoResponse>
  getGroups(): Promise<WxAutoResponse>
  sendMessage(contactName: string, message: string): Promise<WxAutoResponse>
  bulkSend(contacts: string[], message: string, delayRange?: [number, number]): Promise<WxAutoResponse>
  getMessageHistory(contactName: string, forceRefresh?: boolean): Promise<WxAutoResponse>
  clearChatMessages(contactName: string): Promise<WxAutoResponse>
  refreshChatMessages(contactName: string): Promise<WxAutoResponse>
  getMessagesFromDb(contactName: string, page: number, perPage: number): Promise<WxAutoResponse>
  getMoreMessagesFromDb(contactName: string, beforeId?: number, limit?: number): Promise<WxAutoResponse>
  startMonitoring(contactName: string, autoReply?: boolean): Promise<WxAutoResponse>
  stopMonitoring(contactName: string): Promise<WxAutoResponse>
  getAutoReplyStatus(): Promise<WxAutoResponse>
  toggleAutoReply(enabled: boolean): Promise<WxAutoResponse>
  isAvailable(): Promise<boolean>
  saveContactsToDb(contacts: ContactInfo[]): Promise<WxAutoResponse>
  getContactsFromDb(): Promise<WxAutoResponse>
}

// 扩展全局Window接口
declare global {
  interface Window {
    wxAuto: WxAutoAPI
  }
}

export {}
