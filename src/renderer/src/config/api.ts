// API配置文件
// 用于配置WxAuto集成API

// WxAuto API类型定义
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
}

export interface MessageInfo {
  id: string
  content: string
  sender: string
  timestamp: string
  is_self: boolean
  message_type: string
}

// 浏览器环境模拟数据
const mockData = {
  userInfo: {
    nickname: '演示用户',
    is_logged_in: true
  },
  contacts: [
    { id: 'demo_friend_1', name: '张三', type: 'friend' as const, source: 'demo' },
    { id: 'demo_friend_2', name: '李四', type: 'friend' as const, source: 'demo' },
    { id: 'demo_friend_3', name: '王五', type: 'friend' as const, source: 'demo' },
    { id: 'demo_friend_4', name: '赵六', type: 'friend' as const, source: 'demo' },
    { id: 'demo_friend_5', name: '钱七', type: 'friend' as const, source: 'demo' }
  ],
  groups: [
    { id: 'demo_group_1@chatroom', name: '产品讨论群', type: 'group' as const, member_count: 25, source: 'demo' },
    { id: 'demo_group_2@chatroom', name: '技术交流群', type: 'group' as const, member_count: 48, source: 'demo' },
    { id: 'demo_group_3@chatroom', name: '项目协作群', type: 'group' as const, member_count: 15, source: 'demo' }
  ],
  sessions: [
    {
      id: 'demo_friend_1',
      name: '张三',
      nickname: '张三',
      type: 'private' as const,
      avatar: '',
      remark: '重要客户',
      last_message: '你好，最近怎么样？',
      last_message_time: new Date(Date.now() - 3600000).toISOString(),
      unread_count: 2
    },
    {
      id: 'demo_friend_2',
      name: '李四',
      nickname: '李四',
      type: 'friend' as const,
      avatar: '',
      remark: '老朋友',
      last_message: '明天的会议准备好了吗？',
      last_message_time: new Date(Date.now() - 7200000).toISOString(),
      unread_count: 0
    },
    {
      id: 'demo_group_1@chatroom',
      name: '产品讨论群',
      nickname: '产品讨论群',
      type: 'group' as const,
      avatar: '',
      member_count: 25,
      last_message: '新功能已经上线了',
      last_message_time: new Date(Date.now() - 1800000).toISOString(),
      unread_count: 5
    },
    {
      id: 'demo_friend_3',
      name: '王五',
      nickname: '王五',
      type: 'private' as const,
      avatar: '',
      remark: '潜在客户',
      last_message: '我想了解一下你们的产品',
      last_message_time: new Date(Date.now() - 900000).toISOString(),
      unread_count: 1
    },
    {
      id: 'demo_group_2@chatroom',
      name: '技术交流群',
      nickname: '技术交流群',
      type: 'group' as const,
      avatar: '',
      member_count: 48,
      last_message: '这个bug已经修复',
      last_message_time: new Date(Date.now() - 600000).toISOString(),
      unread_count: 3
    }
  ]
}

// 检查是否在 Electron 环境中
const isElectronEnvironment = () => {
  const hasWindow = typeof window !== 'undefined'
  const hasWxAuto = hasWindow && window.wxAuto
  const hasElectron = hasWindow && window.electron

  console.log('[Environment Check]', {
    hasWindow,
    hasWxAuto,
    hasElectron,
    userAgent: hasWindow ? navigator.userAgent : 'N/A',
    isElectron: hasWindow && navigator.userAgent.includes('Electron')
  })

  return hasWxAuto
}

// 浏览器环境模拟 WxAuto API
const createMockWxAutoAPI = () => {
  return {
    initWechat: async () => {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      return { success: true, message: 'WeChat initialized (demo mode)', data: { user_info: mockData.userInfo } }
    },
    getConnectionStatus: async () => {
      await new Promise((resolve) => setTimeout(resolve, 500))
      return { success: true, connected: true, user_info: mockData.userInfo }
    },
    getContacts: async () => {
      await new Promise((resolve) => setTimeout(resolve, 800))
      return { success: true, data: { contacts: mockData.contacts, total: mockData.contacts.length } }
    },
    getGroups: async () => {
      await new Promise((resolve) => setTimeout(resolve, 800))
      return { success: true, data: { groups: mockData.groups, total: mockData.groups.length } }
    },
    getSessionList: async () => {
      await new Promise((resolve) => setTimeout(resolve, 800))
      return {
        success: true,
        data: {
          sessions: mockData.sessions,
          total: mockData.sessions.length,
          method: 'demo_api',
          methods_tried: ['demo_api']
        }
      }
    },
    sendMessage: async (contactName: string, message: string) => {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      return { success: true, message: `Message sent to ${contactName} (demo mode): ${message}` }
    }
  }
}

// WxAuto集成API类
export class WxAutoAPI {
  private static instance: WxAutoAPI
  private isInitialized = false
  private mockAPI = createMockWxAutoAPI()

  static getInstance(): WxAutoAPI {
    if (!WxAutoAPI.instance) {
      WxAutoAPI.instance = new WxAutoAPI()
    }
    return WxAutoAPI.instance
  }

  /**
   * 初始化WxAuto服务
   */
  async initialize(): Promise<WxAutoResponse> {
    try {
      if (isElectronEnvironment()) {
        console.log('[WxAuto] Initializing wxautox service via Electron IPC...')
        const result = await window.wxAuto.initialize()
        this.isInitialized = result.success

        if (result.success) {
          console.log('[WxAuto] ✅ wxautox service initialized successfully via IPC')
        } else {
          console.error('[WxAuto] ❌ wxautox service initialization failed:', result.message)
        }

        return result
      } else {
        console.log('[WxAuto] 🌐 Running in browser mode, using mock data...')
        const result = await this.mockAPI.initWechat()
        this.isInitialized = result.success
        return result
      }
    } catch (error) {
      console.error('Failed to initialize WxAuto:', error)
      return { success: false, message: `Initialization failed: ${error}` }
    }
  }

  /**
   * 检查连接状态
   */
  async getConnectionStatus(): Promise<WxAutoResponse> {
    try {
      if (isElectronEnvironment()) {
        const result = await window.wxAuto.getConnectionStatus()
        return result
      } else {
        return await this.mockAPI.getConnectionStatus()
      }
    } catch (error) {
      console.error('Failed to get connection status:', error)
      return { success: false, message: `Failed to get status: ${error}` }
    }
  }

  /**
   * 重新连接
   */
  async reconnect(): Promise<WxAutoResponse> {
    try {
      if (isElectronEnvironment()) {
        return await window.wxAuto.reconnect()
      } else {
        console.log('[WxAuto] 🌐 Reconnecting (browser mode)...')
        return await this.mockAPI.getConnectionStatus()
      }
    } catch (error) {
      console.error('Failed to reconnect:', error)
      return { success: false, message: `Reconnect failed: ${error}` }
    }
  }

  /**
   * 获取联系人列表
   */
  async getContacts(): Promise<WxAutoResponse> {
    try {
      if (isElectronEnvironment()) {
        console.log('[WxAuto] Getting contacts via Electron IPC...')
        const result = await window.wxAuto.getContacts()
        console.log('[WxAuto] getContacts result:', result)
        return result
      } else {
        console.log('[WxAuto] 🌐 Getting contacts (browser mode)...')
        return await this.mockAPI.getContacts()
      }
    } catch (error) {
      console.error('Failed to get contacts:', error)
      return { success: false, message: `Failed to get contacts: ${error}` }
    }
  }

  /**
   * 获取群组列表
   */
  async getGroups(): Promise<WxAutoResponse> {
    try {
      if (isElectronEnvironment()) {
        console.log('[WxAuto] Getting groups via Electron IPC...')
        const result = await window.wxAuto.getGroups()
        console.log('[WxAuto] getGroups result:', result)
        return result
      } else {
        console.log('[WxAuto] 🌐 Getting groups (browser mode)...')
        return await this.mockAPI.getGroups()
      }
    } catch (error) {
      console.error('Failed to get groups:', error)
      return { success: false, message: `Failed to get groups: ${error}` }
    }
  }

  /**
   * 获取会话列表（包含联系人和群组）
   */
  async getSessionList(): Promise<WxAutoResponse> {
    try {
      if (isElectronEnvironment()) {
        console.log('[WxAuto] Getting session list via Electron IPC...')
        const result = await window.wxAuto.getSessionList()
        console.log('[WxAuto] getSessionList result:', result)
        return result
      } else {
        console.log('[WxAuto] 🌐 Getting session list (browser mode)...')
        return await this.mockAPI.getSessionList()
      }
    } catch (error) {
      console.error('Failed to get session list:', error)
      return { success: false, message: `Failed to get session list: ${error}` }
    }
  }

  /**
   * 发送消息
   */
  async sendMessage(contactName: string, message: string): Promise<WxAutoResponse> {
    try {
      if (isElectronEnvironment()) {
        console.log(`[WxAuto] Sending message to ${contactName} via Electron IPC...`)
        const result = await window.wxAuto.sendMessage(contactName, message)
        return result
      } else {
        console.log(`[WxAuto] 🌐 Sending message to ${contactName} (browser mode)...`)
        return await this.mockAPI.sendMessage(contactName, message)
      }
    } catch (error) {
      console.error('Failed to send message:', error)
      return { success: false, message: `Failed to send message: ${error}` }
    }
  }

  /**
   * 批量发送消息
   */
  async bulkSend(contacts: string[], message: string, delayRange?: [number, number]): Promise<WxAutoResponse> {
    try {
      if (typeof window !== 'undefined' && window.wxAuto) {
        return await window.wxAuto.bulkSend(contacts, message, delayRange)
      }
      return { success: false, message: 'WxAuto not available' }
    } catch (error) {
      console.error('Failed to bulk send:', error)
      return { success: false, message: `Failed to bulk send: ${error}` }
    }
  }

  /**
   * 获取聊天记录
   */
  async getMessageHistory(contactName: string, forceRefresh = false): Promise<WxAutoResponse> {
    try {
      if (typeof window !== 'undefined' && window.wxAuto) {
        return await window.wxAuto.getMessageHistory(contactName, forceRefresh)
      }
      return { success: false, message: 'WxAuto not available' }
    } catch (error) {
      console.error('Failed to get message history:', error)
      return { success: false, message: `Failed to get history: ${error}` }
    }
  }

  /**
   * 清空聊天记录
   */
  async clearChatMessages(contactName: string): Promise<WxAutoResponse> {
    try {
      if (typeof window !== 'undefined' && window.wxAuto) {
        return await window.wxAuto.clearChatMessages(contactName)
      }
      return { success: false, message: 'WxAuto not available' }
    } catch (error) {
      console.error('Failed to clear chat messages:', error)
      return { success: false, message: `Failed to clear messages: ${error}` }
    }
  }

  /**
   * 重新获取聊天记录（清空后重新获取）
   */
  async refreshChatMessages(contactName: string): Promise<WxAutoResponse> {
    try {
      if (typeof window !== 'undefined' && window.wxAuto) {
        return await window.wxAuto.refreshChatMessages(contactName)
      }
      return { success: false, message: 'WxAuto not available' }
    } catch (error) {
      console.error('Failed to refresh chat messages:', error)
      return { success: false, message: `Failed to refresh messages: ${error}` }
    }
  }

  /**
   * 从数据库获取消息记录
   */
  async getMessagesFromDb(contactName: string, page: number = 1, perPage: number = 20): Promise<WxAutoResponse> {
    try {
      if (typeof window !== 'undefined' && window.wxAuto) {
        return await window.wxAuto.getMessagesFromDb(contactName, page, perPage)
      }
      return { success: false, message: 'WxAuto not available' }
    } catch (error) {
      console.error('Failed to get messages from DB:', error)
      return { success: false, message: `Failed to get messages from DB: ${error}` }
    }
  }

  /**
   * 获取更多历史消息（向前分页）
   */
  async getMoreMessagesFromDb(contactName: string, beforeId?: number, limit: number = 20): Promise<WxAutoResponse> {
    try {
      if (typeof window !== 'undefined' && window.wxAuto) {
        return await window.wxAuto.getMoreMessagesFromDb(contactName, beforeId, limit)
      }
      return { success: false, message: 'WxAuto not available' }
    } catch (error) {
      console.error('Failed to get more messages from DB:', error)
      return { success: false, message: `Failed to get more messages from DB: ${error}` }
    }
  }

  /**
   * 保存联系人到数据库
   */
  async saveContactsToDb(contacts: ContactInfo[]): Promise<WxAutoResponse> {
    try {
      if (isElectronEnvironment()) {
        console.log('[WxAuto] Saving contacts to DB via Electron IPC...')
        const result = await window.wxAuto.saveContactsToDb(contacts)
        console.log('[WxAuto] saveContactsToDb result:', result)
        return result
      } else {
        console.log('[WxAuto] 🌐 Saving contacts to DB (browser mode)...')
        return { success: true, message: 'Contacts saved (demo mode)', data: { saved_count: contacts.length } }
      }
    } catch (error) {
      console.error('Failed to save contacts to DB:', error)
      return { success: false, message: `Failed to save contacts to DB: ${error}` }
    }
  }

  /**
   * 从数据库获取联系人列表
   */
  async getContactsFromDb(): Promise<WxAutoResponse> {
    try {
      if (isElectronEnvironment()) {
        console.log('[WxAuto] Getting contacts from DB via Electron IPC...')
        const result = await window.wxAuto.getContactsFromDb()
        console.log('[WxAuto] getContactsFromDb result:', result)
        return result
      } else {
        console.log('[WxAuto] 🌐 Getting contacts from DB (browser mode)...')
        return {
          success: true,
          data: {
            contacts: mockData.contacts.map((c) => ({ ...c, source: 'database' })),
            total: mockData.contacts.length
          }
        }
      }
    } catch (error) {
      console.error('Failed to get contacts from DB:', error)
      return { success: false, message: `Failed to get contacts from DB: ${error}` }
    }
  }

  /**
   * 启动监听
   */
  async startMonitoring(contactName: string, autoReply: boolean = false): Promise<WxAutoResponse> {
    try {
      if (typeof window !== 'undefined' && window.wxAuto) {
        return await window.wxAuto.startMonitoring(contactName, autoReply)
      }
      return { success: false, message: 'WxAuto not available' }
    } catch (error) {
      console.error('Failed to start monitoring:', error)
      return { success: false, message: `Failed to start monitoring: ${error}` }
    }
  }

  /**
   * 停止监听
   */
  async stopMonitoring(contactName: string): Promise<WxAutoResponse> {
    try {
      if (typeof window !== 'undefined' && window.wxAuto) {
        return await window.wxAuto.stopMonitoring(contactName)
      }
      return { success: false, message: 'WxAuto not available' }
    } catch (error) {
      console.error('Failed to stop monitoring:', error)
      return { success: false, message: `Failed to stop monitoring: ${error}` }
    }
  }

  /**
   * 获取自动回复状态
   */
  async getAutoReplyStatus(): Promise<WxAutoResponse> {
    try {
      if (isElectronEnvironment()) {
        console.log('[WxAuto] Getting auto reply status via Electron IPC...')
        const result = await window.wxAuto.getAutoReplyStatus()
        return result
      } else {
        console.log('[WxAuto] 🌐 Getting auto reply status (browser mode)...')
        return { success: true, data: { enabled: false }, message: 'Auto reply status (demo mode)' }
      }
    } catch (error) {
      console.error('Failed to get auto reply status:', error)
      return { success: false, message: `Failed to get auto reply status: ${error}` }
    }
  }

  /**
   * 切换自动回复
   */
  async toggleAutoReply(enabled: boolean): Promise<WxAutoResponse> {
    try {
      if (typeof window !== 'undefined' && window.wxAuto) {
        console.log(`[WxAuto] Toggling auto reply (${enabled}) via Electron IPC...`)
        const result = await window.wxAuto.toggleAutoReply(enabled)
        return result
      }
      return { success: false, message: 'WxAuto not available' }
    } catch (error) {
      console.error('Failed to toggle auto reply:', error)
      return { success: false, message: `Failed to toggle auto reply: ${error}` }
    }
  }

  /**
   * 检查服务是否可用
   */
  async isAvailable(): Promise<boolean> {
    try {
      if (isElectronEnvironment()) {
        console.log('[WxAuto] Checking availability via Electron IPC...')
        const result = await window.wxAuto.isAvailable()
        return result
      } else {
        console.log('[WxAuto] 🌐 Checking availability (browser mode)...')
        return true // 浏览器模式下总是可用
      }
    } catch (error) {
      console.error('Failed to check availability:', error)
      return false
    }
  }

  /**
   * 获取AI销冠配置
   */
  async getAiSalesConfig(): Promise<WxAutoResponse> {
    try {
      if (isElectronEnvironment()) {
        console.log('[WxAuto] Getting AI sales config via Electron IPC...')
        const result = await window.wxAuto.getAiSalesConfig()
        console.log('[WxAuto] getAiSalesConfig result:', result)
        return result
      } else {
        // 浏览器环境返回模拟数据
        return {
          success: true,
          data: {
            api_key: '******',
            api_url: 'https://api.openai-proxy.com/v1/chat/completions',
            model_name: 'gpt-3.5-turbo',
            temperature: 0.7,
            max_tokens: 2000,
            system_prompt: '你是一个专业的销售助手，负责回复客户的消息。请根据客户的消息提供有帮助的回复。',
            auto_reply_enabled: false
          }
        }
      }
    } catch (error) {
      console.error('Failed to get AI sales config:', error)
      return { success: false, message: `Failed to get AI sales config: ${error}` }
    }
  }

  /**
   * 更新AI销冠配置
   */
  async updateAiSalesConfig(config: any): Promise<WxAutoResponse> {
    try {
      if (isElectronEnvironment()) {
        console.log('[WxAuto] Updating AI sales config via Electron IPC...')
        const result = await window.wxAuto.updateAiSalesConfig(config)
        console.log('[WxAuto] updateAiSalesConfig result:', result)
        return result
      } else {
        // 浏览器环境模拟成功
        console.log('[WxAuto] 🌐 Updating AI sales config (browser mode)...', config)
        return {
          success: true,
          message: 'AI sales config updated successfully (browser mode)'
        }
      }
    } catch (error) {
      console.error('Failed to update AI sales config:', error)
      return { success: false, message: `Failed to update AI sales config: ${error}` }
    }
  }
}

// 创建WxAuto API实例
export const wxAutoAPI = WxAutoAPI.getInstance()

// 导出类型和API实例
export default {
  wxAutoAPI,
  WxAutoAPI
}
