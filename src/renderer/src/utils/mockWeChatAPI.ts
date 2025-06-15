// 模拟微信机器人API响应
export class MockWeChatAPI {
  private static instance: MockWeChatAPI
  private connected = false
  private userInfo = {
    nickname: '测试用户',
    is_logged_in: false
  }
  
  private mockFriends = [
    { id: 'friend_1', name: '张三', type: 'friend' as const, wxid: 'zhangsan001' },
    { id: 'friend_2', name: '李四', type: 'friend' as const, wxid: 'lisi002' },
    { id: 'friend_3', name: '王五', type: 'friend' as const, wxid: 'wangwu003' },
    { id: 'friend_4', name: '赵六', type: 'friend' as const, wxid: 'zhaoliu004' },
    { id: 'friend_5', name: '钱七', type: 'friend' as const, wxid: 'qianqi005' }
  ]
  
  private mockGroups = [
    { id: 'group_1', name: '产品讨论群', type: 'group' as const, member_count: 25 },
    { id: 'group_2', name: '技术交流群', type: 'group' as const, member_count: 48 },
    { id: 'group_3', name: '销售团队群', type: 'group' as const, member_count: 12 }
  ]

  private mockSessions = [
    {
      id: 'session_1',
      name: '张三',
      nickname: '张三',
      type: 'private' as const,
      avatar: '',
      remark: '重要客户',
      last_message: '你好，请问有什么可以帮助您的吗？',
      last_message_time: new Date(Date.now() - 3600000).toISOString(),
      unread_count: 2
    },
    {
      id: 'session_2',
      name: '李四',
      nickname: '李四',
      type: 'friend' as const,
      avatar: '',
      remark: '老朋友',
      last_message: '最近怎么样？',
      last_message_time: new Date(Date.now() - 7200000).toISOString(),
      unread_count: 0
    },
    {
      id: 'session_3',
      name: '产品讨论群',
      nickname: '产品讨论群',
      type: 'group' as const,
      avatar: '',
      member_count: 25,
      last_message: '大家对新功能有什么建议吗？',
      last_message_time: new Date(Date.now() - 1800000).toISOString(),
      unread_count: 5
    },
    {
      id: 'session_4',
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
      id: 'session_5',
      name: '技术交流群',
      nickname: '技术交流群',
      type: 'group' as const,
      avatar: '',
      member_count: 48,
      last_message: '这个问题有人遇到过吗？',
      last_message_time: new Date(Date.now() - 600000).toISOString(),
      unread_count: 3
    }
  ]
  
  private mockMessages = [
    {
      id: 'msg_1',
      content: '你好，请问有什么可以帮助您的吗？',
      is_self: false,
      message_type: 'friend' as const,
      timestamp: new Date(Date.now() - 3600000).toISOString(),
      sender: '张三'
    },
    {
      id: 'msg_2',
      content: '我想了解一下你们的产品',
      is_self: true,
      message_type: 'self' as const,
      timestamp: new Date(Date.now() - 3000000).toISOString(),
      sender: '测试用户'
    }
  ]
  
  public static getInstance(): MockWeChatAPI {
    if (!MockWeChatAPI.instance) {
      MockWeChatAPI.instance = new MockWeChatAPI()
    }
    return MockWeChatAPI.instance
  }
  
  // 模拟API响应
  async handleRequest(url: string, options?: RequestInit): Promise<Response> {
    const path = url.replace('/api', '')
    
    // 添加延迟模拟网络请求
    await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300))
    
    switch (path) {
      case '/connection/status':
        return this.mockResponse({
          connected: this.connected,
          user_info: this.connected ? this.userInfo : null
        })
        
      case '/connection/reconnect':
        if (options?.method === 'POST') {
          this.connected = true
          this.userInfo.is_logged_in = true
          return this.mockResponse({
            connected: true,
            user_info: this.userInfo,
            message: '连接成功'
          })
        }
        break
        
      case '/contacts/friends':
        return this.mockResponse({
          success: true,
          data: {
            contacts: this.mockFriends
          }
        })

      case '/contacts/groups':
        return this.mockResponse({
          success: true,
          data: {
            groups: this.mockGroups
          }
        })

      case '/contacts/sessions':
        return this.mockResponse({
          success: true,
          data: {
            sessions: this.mockSessions,
            total: this.mockSessions.length,
            method: 'mock_api',
            methods_tried: ['mock_api']
          }
        })
        
      case '/auto_reply/status':
        return this.mockResponse({
          success: true,
          data: {
            enabled: false
          }
        })
        
      case '/auto_reply/toggle':
        if (options?.method === 'POST') {
          const body = JSON.parse(options.body as string)
          return this.mockResponse({
            success: true,
            data: {
              enabled: body.enabled
            }
          })
        }
        return this.mockResponse({
          success: false,
          message: 'Method not allowed'
        }, 405)
        
      case '/monitoring/toggle':
        if (options?.method === 'POST') {
          const body = JSON.parse(options.body as string)
          return this.mockResponse({
            success: true,
            data: {
              enabled: body.enabled
            }
          })
        }
        return this.mockResponse({
          success: false,
          message: 'Method not allowed'
        }, 405)
        
      case '/messages/send':
        if (options?.method === 'POST') {
          const body = JSON.parse(options.body as string)
          return this.mockResponse({
            success: true,
            data: {
              message_id: 'msg_' + Date.now(),
              contact: body.contact,
              message: body.message
            }
          })
        }
        return this.mockResponse({
          success: false,
          message: 'Method not allowed'
        }, 405)
        
      case '/messages/bulk_send':
        if (options?.method === 'POST') {
          const body = JSON.parse(options.body as string)
          return this.mockResponse({
            success: true,
            data: {
              sent_count: body.contacts.length,
              failed_count: 0
            }
          })
        }
        return this.mockResponse({
          success: false,
          message: 'Method not allowed'
        }, 405)
        
      case '/settings/api_keys':
        if (options?.method === 'POST') {
          return this.mockResponse({
            success: true,
            message: 'API配置保存成功'
          })
        } else {
          return this.mockResponse({
            success: true,
            data: {
              deepseek_api_key: '',
              deepseek_base_url: 'https://api.deepseek.com',
              moonshot_api_key: '',
              moonshot_base_url: 'https://api.moonshot.cn/v1'
            }
          })
        }
        
      case '/settings/test_connection':
        if (options?.method === 'POST') {
          return this.mockResponse({
            success: true,
            message: '连接测试成功'
          })
        }
        return this.mockResponse({
          success: false,
          message: 'Method not allowed'
        }, 405)
        
      case '/settings/reply_strategy':
        if (options?.method === 'POST') {
          return this.mockResponse({
            success: true,
            message: '策略配置保存成功'
          })
        } else {
          return this.mockResponse({
            success: true,
            data: {
              chatType: 'private',
              groupAtOnly: true,
              keywords: ['帮我', '价格', '优惠']
            }
          })
        }
        
      case '/settings/automation_tasks':
        return this.mockResponse({
          success: true,
          data: {
            friendRequest: {
              enabled: false,
              maxFriendsPerDay: 20,
              greetingGroupId: 'default'
            }
          }
        })
        
      default:
        if (path.startsWith('/messages/history')) {
          const urlParams = new URLSearchParams(path.split('?')[1])
          const contact = urlParams.get('contact')
          return this.mockResponse({
            success: true,
            data: {
              messages: contact ? this.mockMessages : []
            }
          })
        }
        
        return this.mockResponse({
          success: false,
          message: 'API endpoint not found'
        }, 404)
    }
  }
  
  private mockResponse(data: any, status = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        'Content-Type': 'application/json'
      }
    })
  }
}

// 拦截fetch请求并使用模拟API
export function setupMockAPI() {
  if (typeof window !== 'undefined') {
    const originalFetch = window.fetch
    const mockAPI = MockWeChatAPI.getInstance()
    
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString()
      
      // 只拦截以/api开头的请求
      if (url.startsWith('/api')) {
        console.log('[Mock API] Intercepting:', url, init)
        return mockAPI.handleRequest(url, init)
      }
      
      // 其他请求使用原始fetch
      return originalFetch(input, init)
    }
    
    console.log('[Mock API] WeChat API mock initialized')
  }
}
