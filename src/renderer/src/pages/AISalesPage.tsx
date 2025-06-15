import './AISalesPage.scss'

import {
  CommentOutlined,
  ReloadOutlined,
  RobotOutlined,
  SearchOutlined,
  SendOutlined,
  SettingOutlined,
  SoundFilled,
  SoundOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  UserOutlined,
  WechatOutlined
} from '@ant-design/icons'
import {
  App,
  Button,
  Card,
  Checkbox,
  Col,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Slider,
  Switch,
  Tabs,
  Tag,
  Tooltip,
  Typography
} from 'antd'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import styled from 'styled-components'

import { Navbar, NavbarRight } from '../components/app/Navbar'
import { HStack } from '../components/Layout'
import { wxAutoAPI } from '../config/api'
import type { ContactInfo, MessageInfo } from '../types/wxauto'

const { TextArea } = Input
const { Title, Text } = Typography
const { Option } = Select

// 使用导入的ContactInfo类型
type Contact = ContactInfo & { is_monitoring?: boolean }

// 扩展MessageInfo类型
interface ChatMessage extends MessageInfo {
  message_type: 'friend' | 'self' | 'time' | 'system'
  time?: string
  source?: string
}

const AISalesPage: React.FC = () => {
  const { message } = App.useApp()

  // 状态管理
  const [currentPage, setCurrentPage] = useState('home')
  const [wechatConnected, setWechatConnected] = useState(false)
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [loading, setLoading] = useState(false)

  // 回复建议相关状态
  const [replySuggestions, setReplySuggestions] = useState<Array<any>>([])

  // 导航菜单项
  const navigationItems = [
    {
      key: 'chat',
      label: '智能聊天',
      description: '与客户进行智能对话',
      icon: <WechatOutlined />
    },
    {
      key: 'bulk',
      label: '群发消息',
      description: '批量发送消息',
      icon: <ThunderboltOutlined />
    },
    {
      key: 'moments',
      label: '朋友圈',
      description: '朋友圈管理和互动',
      icon: <CommentOutlined />
    },
    {
      key: 'agents',
      label: '智能体',
      description: '配置AI助手',
      icon: <RobotOutlined />
    },
    {
      key: 'settings',
      label: '系统设置',
      description: '配置系统参数',
      icon: <SettingOutlined />
    }
  ]

  // 用户信息
  const [userInfo, setUserInfo] = useState({
    nickname: '加载中...',
    is_logged_in: false
  })

  // 缓存的用户信息（用于断线时显示）
  const [cachedUserInfo, setCachedUserInfo] = useState({
    nickname: '',
    is_logged_in: false,
    reallyConnected: false // 记录真实连接状态
  })

  // 联系人数据
  const [contacts, setContacts] = useState<{
    friends: Contact[]
    groups: Contact[]
  }>({
    friends: [],
    groups: []
  })

  // 添加联系人缓存状态
  const [contactsLoaded, setContactsLoaded] = useState(false)

  // 聊天相关
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [storedMessages, setStoredMessages] = useState<ChatMessage[]>([])
  const [messageInput, setMessageInput] = useState('')
  const [searchKeyword, setSearchKeyword] = useState('')

  // 群发相关
  const [bulkMessage, setBulkMessage] = useState('')
  const [selectedBulkContacts, setSelectedBulkContacts] = useState<string[]>([])
  const [contactsFilter, setContactsFilter] = useState<'friends' | 'groups'>('friends')
  const [bulkSearchQuery, setBulkSearchQuery] = useState('')
  const [delayRange, setDelayRange] = useState<[number, number]>([2, 5])
  const [sendingBulk, setSendingBulk] = useState(false)
  const [bulkSendStatus, setBulkSendStatus] = useState('')

  // 设置相关
  const [contactsActiveTab, setContactsActiveTab] = useState('friends')
  const [apiKeys, setApiKeys] = useState({
    openai_api_key: '',
    openai_api_url: 'https://api.openai-proxy.com/v1/chat/completions',
    openai_model: 'gpt-3.5-turbo',
    openai_temperature: 0.7,
    openai_max_tokens: 2000,
    openai_system_prompt: '你是一个专业的销售助手，负责回复客户的消息。请根据客户的消息提供有帮助的回复。',
    deepseek_api_key: '',
    deepseek_base_url: 'https://api.deepseek.com',
    moonshot_api_key: '',
    moonshot_base_url: 'https://api.moonshot.cn/v1'
  })

  // 智能体配置
  const [agents, setAgents] = useState([
    {
      name: '默认销售助手',
      model: 'deepseek-chat',
      enabled: true
    }
  ])

  // 回复策略
  const [replyStrategy, setReplyStrategy] = useState({
    chatType: 'private',
    groupAtOnly: true,
    keywords: ['帮我', '价格', '优惠']
  })

  // 自动化任务
  const [tasks, setTasks] = useState({
    friendRequest: {
      enabled: false,
      maxFriendsPerDay: 20,
      greetingGroupId: 'default'
    }
  })

  // 朋友圈点赞
  const [autoLike, setAutoLike] = useState(false)
  const [autoLikeLimit, setAutoLikeLimit] = useState(10)
  const [autoLikeFrequency, setAutoLikeFrequency] = useState('medium')

  // 关键词输入
  const [keywordInputVisible, setKeywordInputVisible] = useState(false)
  const [keywordInputValue, setKeywordInputValue] = useState('')

  const keywordInputRef = useRef<any>(null)

  // 页面首次挂载标记
  const hasFetchedContactsRef = useRef(false)

  // 渲染导航栏
  const renderNavbar = () => (
    <div className="aisales-header">
      <Navbar className="aisales-navbar">
        <NavbarRight
          style={{ justifyContent: 'space-between', flex: 1, position: 'relative' }}
          className="aisales-navbar-right">
          <HStack alignItems="center">
            <div className="navbar-title">
              <span className="title-main">AI销冠</span>
            </div>
          </HStack>

          {/* 居中显示用户名 */}
          <div className="navbar-center">
            <div className="user-info">
              <span className="user-name">{userInfo.nickname || '未连接'}</span>
            </div>
          </div>

          <HStack alignItems="center" gap={8}>
            <div className="connection-status">
              <div className={`status-indicator ${wechatConnected ? 'online' : 'offline'}`} />
              <span className={`status-text ${wechatConnected ? 'online' : 'offline'}`}>
                {wechatConnected ? '在线' : '离线'}
              </span>
            </div>
            <Tooltip title="重新连接" mouseEnterDelay={0.8}>
              <NavbarIcon
                onClick={loading ? undefined : reconnect}
                style={{ opacity: loading ? 0.5 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}>
                <ReloadOutlined size={18} />
              </NavbarIcon>
            </Tooltip>
          </HStack>
        </NavbarRight>
      </Navbar>

      {/* 水平导航菜单 */}
      <div className="horizontal-nav">
        {navigationItems.map((item) => (
          <div
            key={item.key}
            className={`nav-tab ${currentPage === item.key ? 'active' : ''}`}
            onClick={() => setCurrentPage(item.key)}>
            <div className="nav-tab-icon">{item.icon}</div>
            <div className="nav-tab-label">{item.label}</div>
          </div>
        ))}
      </div>
    </div>
  )

  // 从本地存储加载缓存的用户信息
  useEffect(() => {
    const savedUserInfo = localStorage.getItem('aisales_cached_user_info')
    if (savedUserInfo) {
      try {
        const parsed = JSON.parse(savedUserInfo)
        setCachedUserInfo(parsed)

        // 如果有有效的缓存信息，立即显示在UI上
        if (parsed.nickname && parsed.is_logged_in) {
          console.log('📋 使用缓存的用户信息:', parsed.nickname)
          setUserInfo({
            nickname: parsed.nickname,
            is_logged_in: false // 先设为false，等连接检查后再更新
          })
        }
      } catch (error) {
        console.error('解析缓存用户信息失败:', error)
      }
    }
  }, [])

  // 保存用户信息到本地存储
  useEffect(() => {
    if (cachedUserInfo.nickname) {
      localStorage.setItem('aisales_cached_user_info', JSON.stringify(cachedUserInfo))
    }
  }, [cachedUserInfo])

  // 智能初始化WxAuto服务
  const initializeWxAuto = useCallback(async () => {
    try {
      setLoading(true)
      console.log('🚀 开始智能初始化 WxAuto...')

      // 只用后端最新状态判断是否需要初始化
      const connectionStatus = await wxAutoAPI.getConnectionStatus()
      if (
        connectionStatus.success &&
        connectionStatus.data?.connected &&
        connectionStatus.data?.user_info?.nickname &&
        connectionStatus.data.user_info.nickname !== 'Unknown'
      ) {
        console.log('✅ 检测到已有有效连接和用户信息，跳过完整初始化')
        // 使用现有连接状态更新UI
        const data = connectionStatus.data
        const userInfo = data.user_info
        if (userInfo) {
          const userNickname = userInfo.nickname || '微信用户'
          setWechatConnected(true)
          setUserInfo({
            nickname: userNickname,
            is_logged_in: true
          })
          setCachedUserInfo({
            nickname: userNickname,
            is_logged_in: true,
            reallyConnected: true
          })
        }
        // 只在首次挂载且用户名正常、连接正常时获取联系人
        if (!hasFetchedContactsRef.current) {
          await loadContacts()
          hasFetchedContactsRef.current = true
        }
        await Promise.all([getAutoReplyStatus(), loadApiKeys()])
        console.log('✅ 智能初始化完成（使用现有连接）')
        return
      }

      // 如果没有有效连接，进行完整初始化
      console.log('🔄 没有有效连接，进行完整初始化...')
      const result = await wxAutoAPI.initialize()
      if (result.success) {
        console.log('✅ WxAuto 完整初始化成功')
        // 初始化成功后加载数据
        await checkWechatConnection()
        if (!hasFetchedContactsRef.current) {
          await loadContacts()
          hasFetchedContactsRef.current = true
        }
        await loadGroups()
        await getAutoReplyStatus()
        await loadApiKeys()
      } else {
        console.error('❌ WxAuto 初始化失败:', result.message)
        message.error(`WxAuto初始化失败: ${result.message}`)
      }
    } catch (error) {
      console.error('❌ WxAuto 初始化异常:', error)
      message.error('WxAuto初始化失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    initializeWxAuto()
    // 只在页面首次挂载时执行一次，避免依赖项导致多次触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 计算属性
  const filteredBulkContacts = React.useMemo(() => {
    const contactList = contactsFilter === 'friends' ? contacts.friends : contacts.groups
    if (!contactList) return []

    if (bulkSearchQuery) {
      return contactList.filter((contact) => contact.name.toLowerCase().includes(bulkSearchQuery.toLowerCase()))
    }
    return contactList
  }, [contactsFilter, contacts, bulkSearchQuery])

  const canSendBulk = React.useMemo(() => {
    return bulkMessage.trim() && selectedBulkContacts.length > 0
  }, [bulkMessage, selectedBulkContacts])

  // API调用函数
  const checkWechatConnection = useCallback(async () => {
    try {
      console.log('🔍 开始检查微信连接状态...')
      const response = await wxAutoAPI.getConnectionStatus()
      console.log('📱 连接状态检查结果:', response)

      // 处理数据结构：检查是否在 data 对象内部
      const data = response.data || response
      const isConnected = data.connected === true
      const userInfo = data.user_info

      console.log(`🔗 连接状态: ${isConnected ? '已连接' : '未连接'}`)
      console.log(`👤 用户信息:`, userInfo)
      setWechatConnected(isConnected)

      if (isConnected && userInfo) {
        const userNickname = userInfo.nickname || '微信用户'
        console.log(`✅ 设置用户信息: ${userNickname}`)
        setUserInfo({
          nickname: userNickname,
          is_logged_in: true
        })
        // 缓存用户信息
        setCachedUserInfo({
          nickname: userNickname,
          is_logged_in: true,
          reallyConnected: true
        })
        // 保存到本地存储
        localStorage.setItem(
          'aisales_cached_user_info',
          JSON.stringify({
            nickname: userNickname,
            is_logged_in: true
          })
        )
        console.log('✅ 连接状态更新为已连接')
      } else {
        console.log('❌ 连接状态为未连接或缺少用户信息')
        console.log(`isConnected: ${isConnected}`)
        console.log(`userInfo:`, userInfo)
        // 如果有缓存的用户信息，显示缓存的昵称，否则显示"未连接"
        const displayNickname = cachedUserInfo.nickname || '未连接'
        setUserInfo({
          nickname: displayNickname,
          is_logged_in: false
        })
      }
    } catch (error) {
      console.error('检查微信连接状态失败:', error)
      setWechatConnected(false)
      // 如果有缓存的用户信息，显示缓存的昵称，否则显示"连接失败"
      const displayNickname = cachedUserInfo.nickname || '连接失败'
      setUserInfo({
        nickname: displayNickname,
        is_logged_in: false
      })
    }
  }, [cachedUserInfo, message])

  // 重新连接方法，与第一次进入页面的逻辑一致
  const reconnect = async () => {
    try {
      setLoading(true)
      message.loading('正在重新连接微信...', 0)
      console.log('🔄 开始重新连接微信...')

      // 完整初始化微信
      const result = await wxAutoAPI.initialize()

      if (result.success) {
        console.log('✅ 微信重新连接成功')
        // 初始化成功后加载数据
        await checkWechatConnection()

        // 重置联系人加载状态，强制重新加载
        setContactsLoaded(false)

        // 重新加载联系人数据
        try {
          const mergedContactsResult = await wxAutoAPI.getContactsFromDb()
          if (mergedContactsResult.success && mergedContactsResult.data?.contacts) {
            const allContacts = mergedContactsResult.data.contacts.map((contact: any) => ({
              id: contact.id,
              name: contact.name,
              type: contact.type || 'friend',
              remark: contact.remark || '',
              avatar: contact.avatar || '',
              source: contact.source || 'merged',
              is_monitoring: contact.is_monitoring
            }))

            // 分离好友和群组
            const mergedFriends = allContacts.filter((contact) => contact.type === 'friend')
            const groups = allContacts.filter((contact) => contact.type === 'group')

            // 更新状态
            setContacts({
              friends: mergedFriends,
              groups: groups
            })
            setContactsLoaded(true)
          }
        } catch (error) {
          console.error('加载联系人失败:', error)
        }

        // 获取自动回复状态
        try {
          const data = await wxAutoAPI.getAutoReplyStatus()
          if (data.success) {
            setAutoReplyEnabled(data.data.enabled)
          }
        } catch (error) {
          console.error('获取自动回复状态失败:', error)
        }

        message.destroy()
        message.success('微信重新连接成功')
      } else {
        console.error('❌ 微信重新连接失败:', result.message)
        message.destroy()
        message.error(`微信重新连接失败: ${result.message}`)
      }
    } catch (error) {
      console.error('❌ 微信重新连接异常:', error)
      message.destroy()
      message.error('微信重新连接失败')
    } finally {
      setLoading(false)
    }
  }

  // API调用函数实现
  const loadContacts = useCallback(async () => {
    // 如果已经加载过联系人数据，直接返回
    if (contactsLoaded && contacts.friends.length > 0) {
      console.log('📱 使用缓存的联系人数据')
      return
    }

    try {
      setLoading(true)
      message.loading('正在获取联系人...', 0)

      console.log('🔄 开始获取联系人...')

      // 直接使用后端的合并结果（包含wxautox最新数据 + 数据库去重数据）
      console.log('📖 获取合并后的联系人数据...')
      const mergedContactsResult = await wxAutoAPI.getContactsFromDb()
      let allContacts: Contact[] = []
      if (mergedContactsResult.success && mergedContactsResult.data?.contacts) {
        allContacts = mergedContactsResult.data.contacts.map((contact: any) => ({
          id: contact.id,
          name: contact.name,
          type: contact.type || 'friend',
          remark: contact.remark || '',
          avatar: contact.avatar || '',
          source: contact.source || 'merged',
          is_monitoring: contact.is_monitoring
        }))
        console.log(`📊 获取到合并后的 ${allContacts.length} 个联系人`)

        // 显示数据来源统计
        const wxautoxCount = allContacts.filter((c) => c.source === 'wxautox_fresh').length
        const dbCount = allContacts.filter((c) => c.source !== 'wxautox_fresh').length
        console.log(`📊 数据来源: ${wxautoxCount} 个来自wxautox, ${dbCount} 个来自数据库`)
      }

      // 直接使用后端合并的结果，分离好友和群组（保持后端排序，不重新排序）
      const mergedFriends = allContacts.filter((contact) => contact.type === 'friend')
      const groups = allContacts.filter((contact) => contact.type === 'group')

      // 更新状态
      setContacts({
        friends: mergedFriends,
        groups: groups
      })
      setContactsLoaded(true) // 标记联系人已加载

      message.destroy()

      // 显示详细的成功信息
      const totalContacts = mergedFriends.length + groups.length
      message.success(
        `✅ 联系人加载成功！共 ${totalContacts} 个联系人（${mergedFriends.length} 个好友，${groups.length} 个群组）`
      )
      console.log(`🎉 联系人加载成功: ${mergedFriends.length} 个好友, ${groups.length} 个群组`)
    } catch (error) {
      console.error('❌ 加载联系人失败:', error)
      message.destroy()
      message.error('加载联系人失败')
    } finally {
      setLoading(false)
    }
  }, [contactsLoaded, contacts.friends.length, message])

  const loadGroups = useCallback(async () => {
    try {
      const data = await wxAutoAPI.getGroups()
      if (data.success && data.data && data.data.groups) {
        setContacts((prev) => ({ ...prev, groups: data.data.groups }))
        console.log(`成功加载 ${data.data.groups.length} 个群组`)
      } else {
        message.error(data.message || '加载群组失败')
      }
    } catch (error) {
      console.error('加载群组失败:', error)
      message.error('加载群组失败')
    }
  }, [message])

  // 初始化微信
  const initializeWechat = async () => {
    try {
      setLoading(true)
      message.loading('正在初始化微信...', 0)

      console.log('🚀 开始初始化微信...')
      const result = await wxAutoAPI.initialize()

      console.log('📱 初始化结果:', result)

      message.destroy()

      if (result.success) {
        console.log('✅ 微信初始化成功')

        // 初始化成功后，检查连接状态
        await checkWechatConnection()

        // 自动刷新联系人列表
        setTimeout(() => {
          refreshSessionList()
        }, 1000)
      } else {
        message.error(`❌ 微信初始化失败: ${result.message}`)
        console.error('❌ 微信初始化失败:', result.message)
      }
    } catch (error) {
      console.error('❌ 初始化微信异常:', error as Error)
      message.destroy()
      message.error('初始化微信失败')
    } finally {
      setLoading(false)
    }
  }

  // 刷新会话列表
  const refreshSessionList = async () => {
    // 如果已经加载过联系人数据，直接返回
    if (contactsLoaded && contacts.friends.length > 0) {
      console.log('📱 使用缓存的会话列表数据')
      return
    }

    try {
      setLoading(true)
      message.loading('正在获取会话列表...', 0)

      console.log('🔄 开始刷新会话列表...')

      // 使用获取会话列表方法，这样可以获取到更活跃的联系人信息
      const sessionResult = await wxAutoAPI.getSessionList()

      console.log('💬 会话列表获取结果:', sessionResult)

      const friends: Contact[] = []
      const groups: Contact[] = []

      // 处理会话列表结果
      if (sessionResult.success && sessionResult.data) {
        const sessions = sessionResult.data.sessions || []

        // 显示详细的调试信息
        const method = sessionResult.data.method || 'unknown'
        const methodsTried = sessionResult.data.methods_tried || []

        console.log(`💬 会话列表获取详情:`)
        console.log(`  - 使用方法: ${method}`)
        console.log(`  - 尝试的方法: ${methodsTried.join(', ')}`)
        console.log(`  - 获取数量: ${sessions.length}`)

        if (method === 'demo_fallback') {
          console.warn('⚠️ 会话列表使用了演示数据，真实API调用失败')
          message.warning('会话列表数据为演示数据，请检查微信连接状态')
        } else {
          console.log(`✅ 会话列表使用真实API: ${method}`)
        }

        // 从会话列表中分离联系人和群组
        sessions.forEach((session) => {
          if (session.type === 'private' || session.type === 'friend') {
            // 个人会话，转换为联系人格式
            friends.push({
              id: session.id || session.name,
              name: session.name,
              nickname: session.nickname || session.name,
              avatar: session.avatar || '',
              remark: session.remark || '',
              source: 'session_list',
              last_message: session.last_message,
              last_message_time: session.last_message_time,
              unread_count: session.unread_count || 0,
              type: 'friend',
              is_monitoring: session.is_monitoring
            })
          } else if (session.type === 'group') {
            // 群组会话，转换为群组格式
            groups.push({
              id: session.id || session.name,
              name: session.name,
              nickname: session.nickname || session.name,
              avatar: session.avatar || '',
              member_count: session.member_count || 0,
              source: 'session_list',
              last_message: session.last_message,
              last_message_time: session.last_message_time,
              unread_count: session.unread_count || 0,
              type: 'group',
              is_monitoring: session.is_monitoring
            })
          }
        })

        // 更新状态
        setContacts({
          friends: friends,
          groups: groups
        })
        setContactsLoaded(true) // 标记联系人已加载

        message.destroy()

        // 根据数据来源显示不同的消息
        const hasRealData = sessionResult.data?.method !== 'demo_fallback'

        if (hasRealData) {
          message.success(`✅ 成功刷新会话列表：${friends.length} 个联系人，${groups.length} 个群组`)
        } else {
          message.warning(`⚠️ 刷新完成（演示数据）：${friends.length} 个联系人，${groups.length} 个群组`)
        }

        console.log('📊 刷新结果总结:', {
          friends: friends.length,
          groups: groups.length,
          method: sessionResult.data?.method,
          source: 'session_list'
        })
      } else {
        console.error('❌ 会话列表获取失败:', sessionResult.message)
      }
    } catch (error) {
      console.error('❌ 刷新会话列表失败:', error as Error)
      message.destroy()
      message.error('刷新会话列表失败')
    } finally {
      setLoading(false)
    }
  }

  const getAutoReplyStatus = useCallback(async () => {
    try {
      const data = await wxAutoAPI.getAutoReplyStatus()
      if (data.success) {
        setAutoReplyEnabled(data.data.enabled)
      }
    } catch (error) {
      console.error('获取自动回复状态失败:', error)
    }
  }, [])

  const loadApiKeys = useCallback(async () => {
    try {
      // 加载OpenAI配置
      const data = await wxAutoAPI.getAiSalesConfig()
      if (data.success && data.data) {
        const config = data.data
        setApiKeys((prev) => ({
          ...prev,
          openai_api_key: config.api_key === '******' ? '' : config.api_key || '',
          openai_api_url: config.api_url || 'https://api.openai-proxy.com/v1/chat/completions',
          openai_model: config.model_name || 'gpt-3.5-turbo',
          openai_temperature: config.temperature || 0.7,
          openai_max_tokens: config.max_tokens || 2000,
          openai_system_prompt:
            config.system_prompt || '你是一个专业的销售助手，负责回复客户的消息。请根据客户的消息提供有帮助的回复。'
        }))
        console.log('OpenAI配置加载成功')
      } else {
        console.log('未找到OpenAI配置或加载失败')
      }
    } catch (error) {
      console.error('加载API密钥失败:', error)
      message.error('加载配置失败')
    }
  }, [message])

  const saveApiKeys = async () => {
    try {
      // 保存OpenAI配置
      if (apiKeys.openai_api_key) {
        const openaiConfig = {
          api_key: apiKeys.openai_api_key,
          api_url: apiKeys.openai_api_url,
          model_name: apiKeys.openai_model,
          temperature: apiKeys.openai_temperature,
          max_tokens: apiKeys.openai_max_tokens,
          system_prompt: apiKeys.openai_system_prompt
        }

        console.log('正在保存OpenAI配置:', openaiConfig)

        const data = await wxAutoAPI.updateAiSalesConfig(openaiConfig)
        if (data.success) {
          message.success('OpenAI配置保存成功')
        } else {
          message.error(data.message || '保存OpenAI配置失败')
          return
        }
      } else if (apiKeys.deepseek_api_key) {
        // 如果后续需要支持DeepSeek和Moonshot，可以在这里添加代码
        message.info('DeepSeek配置功能暂未实现')
      } else if (apiKeys.moonshot_api_key) {
        message.info('Moonshot配置功能暂未实现')
      } else {
        message.warning('请至少配置一个API密钥')
      }
    } catch (error) {
      console.error('保存API密钥失败:', error)
      message.error('保存失败')
    }
  }

  const toggleListening = async () => {
    try {
      const newListeningState = !isListening

      if (newListeningState) {
        // 启动监听
        const data = await wxAutoAPI.startMonitoring(selectedContact?.name || '', autoReplyEnabled)
        if (data.success) {
          setIsListening(true)
          message.success('开始监听')

          // 同步更新联系人列表中的监听状态
          if (selectedContact) {
            // 更新当前选中联系人的监听状态
            const updatedContact = { ...selectedContact, is_monitoring: true }
            setSelectedContact(updatedContact)

            // 更新联系人列表中的状态
            setContacts((prev) => {
              const updatedFriends = prev.friends.map((contact) =>
                contact.id === selectedContact.id ? { ...contact, is_monitoring: true } : contact
              )
              const updatedGroups = prev.groups.map((contact) =>
                contact.id === selectedContact.id ? { ...contact, is_monitoring: true } : contact
              )
              return {
                friends: updatedFriends,
                groups: updatedGroups
              }
            })
          }
        } else {
          message.error(data.message || '启动监听失败')
        }
      } else {
        // 停止监听
        const data = await wxAutoAPI.stopMonitoring(selectedContact?.name || '')
        if (data.success) {
          setIsListening(false)
          message.success('停止监听')

          // 同步更新联系人列表中的监听状态
          if (selectedContact) {
            // 更新当前选中联系人的监听状态
            const updatedContact = { ...selectedContact, is_monitoring: false }
            setSelectedContact(updatedContact)

            // 更新联系人列表中的状态
            setContacts((prev) => {
              const updatedFriends = prev.friends.map((contact) =>
                contact.id === selectedContact.id ? { ...contact, is_monitoring: false } : contact
              )
              const updatedGroups = prev.groups.map((contact) =>
                contact.id === selectedContact.id ? { ...contact, is_monitoring: false } : contact
              )
              return {
                friends: updatedFriends,
                groups: updatedGroups
              }
            })
          }
        } else {
          message.error(data.message || '停止监听失败')
        }
      }
    } catch (error) {
      console.error('切换监听状态失败:', error)
      message.error('操作失败')
    }
  }

  const selectContact = (contact: Contact) => {
    setSelectedContact(contact)
    setIsListening(!!contact.is_monitoring)
    setChatMessages([])
    setStoredMessages([])
    setShouldScrollToBottom(true)
    loadStoredMessages(contact.name)
  }

  // 滚动到聊天底部
  const scrollToBottom = () => {
    // 使用多次尝试确保滚动到底部
    const attemptScroll = () => {
      const messagesContainer = document.querySelector('.chat-messages')
      if (messagesContainer) {
        // 方法1: 直接设置scrollTop
        messagesContainer.scrollTop = messagesContainer.scrollHeight

        // 方法2: 找到最后一个消息元素并滚动到它
        const lastMessage = messagesContainer.querySelector('.message-item:last-child')
        if (lastMessage) {
          lastMessage.scrollIntoView({ block: 'end' })
        }

        console.log('滚动到底部:', messagesContainer.scrollHeight, '当前位置:', messagesContainer.scrollTop)
      }
    }

    // 立即执行一次
    attemptScroll()

    // 延迟执行多次确保成功
    setTimeout(attemptScroll, 50)
    setTimeout(attemptScroll, 100)
    setTimeout(attemptScroll, 200)
    setTimeout(attemptScroll, 300)
  }

  // 分页状态
  const [messagePage, setMessagePage] = useState(1)
  const [hasMoreMessages, setHasMoreMessages] = useState(false)
  const [loadingMoreMessages, setLoadingMoreMessages] = useState(false)

  // 加载更多历史消息
  const loadMoreMessages = async () => {
    if (!selectedContact || loadingMoreMessages || !hasMoreMessages) {
      return
    }

    setLoadingMoreMessages(true)
    // 加载分页时禁用自动滚动到底部
    setShouldScrollToBottom(false)

    try {
      console.log(`📄 加载更多消息：联系人=${selectedContact.name}, 页码=${messagePage + 1}`)

      const result = await wxAutoAPI.getMessagesFromDb(selectedContact.name, messagePage + 1, 20)

      if (result.success && result.data?.messages) {
        const newMessages = result.data.messages
        console.log(`✅ 加载更多消息成功：获得 ${newMessages.length} 条消息`)

        // 保存当前滚动位置
        const messagesContainer = document.querySelector('.chat-messages')
        const oldScrollHeight = messagesContainer?.scrollHeight || 0

        // 将新消息添加到现有消息的前面
        setStoredMessages((prev) => [...newMessages, ...prev])

        // 更新分页状态
        setMessagePage((prev) => prev + 1)
        setHasMoreMessages(result.data.has_more || false)

        // 恢复滚动位置（保持用户当前查看的位置）
        setTimeout(() => {
          if (messagesContainer) {
            const newScrollHeight = messagesContainer.scrollHeight
            messagesContainer.scrollTop = newScrollHeight - oldScrollHeight
          }
        }, 50)

        // 如果有新的回复建议，添加到现有建议中（不覆盖）
        if (result.data?.suggestions && result.data.suggestions.length > 0) {
          console.log(`✅ 加载更多消息时获取到 ${result.data.suggestions.length} 条回复建议`)
          // 处理回复建议数据，确保message_id是数字类型
          const processedSuggestions = result.data.suggestions.map((suggestion) => ({
            ...suggestion,
            message_id: Number(suggestion.message_id)
          }))

          // 合并建议，避免重复
          setReplySuggestions((prev) => {
            const existingIds = new Set(prev.map((item) => item.id))
            const newSuggestions = processedSuggestions.filter((item) => !existingIds.has(item.id))
            return [...prev, ...newSuggestions]
          })
        }
      } else {
        console.error('❌ 加载更多消息失败:', result.message)
        setHasMoreMessages(false)
      }
    } catch (error) {
      console.error('❌ 加载更多消息异常:', error)
      setHasMoreMessages(false)
    } finally {
      setLoadingMoreMessages(false)
    }
  }

  // 滚动监听处理函数
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement
    const { scrollTop } = target

    // 检查是否滚动到顶部（留一些缓冲区域）
    if (scrollTop <= 50 && hasMoreMessages && !loadingMoreMessages) {
      console.log('📄 检测到滚动到顶部，准备加载更多消息')
      loadMoreMessages()
    }
  }

  // 控制是否应该自动滚动到底部
  const [shouldScrollToBottom, setShouldScrollToBottom] = useState(true)

  // 消息排序函数（公共逻辑）
  const sortMessages = (messages: any[]) => {
    return messages.sort((a: any, b: any) => {
      if (a.id && b.id) {
        return a.id - b.id
      }
      const timeA = a.timestamp || a.time || 0
      const timeB = b.timestamp || b.time || 0
      return timeA - timeB
    })
  }

  // 重置分页状态（公共逻辑）
  const resetPaginationState = () => {
    setMessagePage(1)
    setHasMoreMessages(false)
    setLoadingMoreMessages(false)
  }

  // 当消息更新或选择联系人时有条件地滚动到底部
  useEffect(() => {
    if (shouldScrollToBottom && (storedMessages.length > 0 || chatMessages.length > 0 || selectedContact)) {
      scrollToBottom()
    }
  }, [storedMessages, chatMessages, shouldScrollToBottom, selectedContact])

  // 专门用于刷新消息的方法 - 只从数据库获取数据
  const refreshMessagesFromDatabase = async (contactName: string) => {
    try {
      console.log(`🔄 刷新消息：从数据库获取 ${contactName} 的聊天记录`)

      // 先清空现有数据，确保显示最新状态
      setStoredMessages([])
      // 清空回复建议
      setReplySuggestions([])

      // 重置分页状态
      resetPaginationState()

      // 刷新消息时启用自动滚动到底部
      setShouldScrollToBottom(true)

      // 调用专门的数据库获取方法
      const data = await wxAutoAPI.getMessagesFromDb(contactName, 1, 20)

      if (data.success) {
        const messages = data.data?.messages || []

        // 按ID升序排序（确保消息按正确顺序显示，最早的在上面，最新的在下面）
        sortMessages(messages)

        setStoredMessages(messages)
        // 设置分页状态
        setHasMoreMessages(data.data?.has_more || false)
        console.log(`✅ 刷新完成：从数据库加载了 ${messages.length} 条消息，还有更多：${data.data?.has_more}`)

        // 处理回复建议
        if (data.data?.suggestions && data.data.suggestions.length > 0) {
          console.log(`✅ 获取到 ${data.data.suggestions.length} 条回复建议`)

          // 处理回复建议数据，确保message_id是数字类型
          const processedSuggestions = data.data.suggestions.map((suggestion) => ({
            ...suggestion,
            message_id: Number(suggestion.message_id)
          }))

          console.log('处理后的回复建议:', processedSuggestions)
          setReplySuggestions(processedSuggestions)
        } else {
          console.log('没有获取到回复建议')
          setReplySuggestions([])
        }
      } else {
        console.error('从数据库刷新消息失败:', data.message)
        message.error(data.message || '刷新消息失败')
        setStoredMessages([])
        setReplySuggestions([])
      }
    } catch (error) {
      console.error('刷新消息失败:', error)
      message.error('刷新消息失败')
      setStoredMessages([])
      setReplySuggestions([])
    }
  }

  // 加载历史消息的方法 - 用于选择联系人时
  const loadStoredMessages = async (contactName: string) => {
    try {
      console.log(`📂 加载历史消息：${contactName}`)

      // 重置分页状态
      resetPaginationState()

      // 清空回复建议
      setReplySuggestions([])

      // 从数据库获取历史消息
      const data = await wxAutoAPI.getMessagesFromDb(contactName, 1, 20)

      if (data.success) {
        const messages = data.data?.messages || []

        // 按ID升序排序
        sortMessages(messages)

        setStoredMessages(messages)
        // 设置分页状态
        setHasMoreMessages(data.data?.has_more || false)
        console.log(`✅ 加载完成：从数据库获取了 ${messages.length} 条历史消息，还有更多：${data.data?.has_more}`)

        // 处理回复建议
        if (data.data?.suggestions && data.data.suggestions.length > 0) {
          console.log(`✅ 获取到 ${data.data.suggestions.length} 条回复建议`)

          // 处理回复建议数据，确保message_id是数字类型
          const processedSuggestions = data.data.suggestions.map((suggestion) => ({
            ...suggestion,
            message_id: Number(suggestion.message_id)
          }))

          console.log('处理后的回复建议:', processedSuggestions)
          setReplySuggestions(processedSuggestions)
        } else {
          console.log('没有获取到回复建议')
          setReplySuggestions([])
        }
      } else {
        console.log('数据库中暂无消息记录')
        setStoredMessages([])
        setReplySuggestions([])
      }
    } catch (error) {
      console.error('加载历史消息失败:', error)
      setStoredMessages([])
      setReplySuggestions([])
    }
  }

  const refreshChatMessages = async () => {
    if (!selectedContact) {
      message.warning('请先选择联系人')
      return
    }

    // 检查微信连接状态
    if (!wechatConnected) {
      Modal.confirm({
        title: '微信未连接',
        content: '重新获取聊天记录需要微信连接。是否要先初始化微信连接？',
        okText: '初始化微信',
        cancelText: '取消',
        onOk: () => {
          if (!wechatConnected) {
            initializeWechat()
          } else {
            message.info('当前已连接，无需重复初始化')
          }
        }
      })
      return
    }

    Modal.confirm({
      title: '重新获取聊天记录',
      content: '确定要重新获取当前聊天记录吗？此操作会先清空当前记录',
      okText: '确定',
      cancelText: '取消',
      okType: 'danger',
      onOk: async () => {
        try {
          setLoading(true)
          message.loading('正在重新获取聊天记录...', 0)

          // 先清空界面上的消息显示
          setChatMessages([])
          setStoredMessages([])

          // 重置分页状态
          resetPaginationState()

          // 启用自动滚动到底部
          setShouldScrollToBottom(true)

          // 调用重新获取聊天记录API（后端会：清空数据库 -> 获取新数据 -> 保存到数据库 -> 返回第一页数据）
          const data = await wxAutoAPI.refreshChatMessages(selectedContact.name)

          message.destroy() // 清除loading消息

          if (data.success) {
            message.success(data.message || '重新获取成功')

            // 后端已经返回了第一页数据，直接使用
            if (data.data && data.data.messages) {
              const messages = data.data.messages
              // 按ID升序排序（确保消息按正确顺序显示）
              sortMessages(messages)

              setStoredMessages(messages)
              // 设置分页状态
              setHasMoreMessages(data.data.has_more || false)
              console.log(`✅ 重新获取成功，显示第一页 ${messages.length} 条消息，还有更多：${data.data.has_more}`)
            } else {
              console.log('❌ 后端未返回消息数据')
            }
          } else {
            message.error(data.message || '重新获取失败')

            // 如果是微信连接问题，提示用户
            if (data.message && data.message.includes('WeChat not connected')) {
              setTimeout(() => {
                Modal.confirm({
                  title: '微信连接丢失',
                  content: '检测到微信连接丢失，是否要重新初始化微信？',
                  okText: '重新初始化',
                  cancelText: '取消',
                  onOk: () => {
                    if (!wechatConnected) {
                      initializeWechat()
                    } else {
                      message.info('当前已连接，无需重复初始化')
                    }
                  }
                })
              }, 1000)
            }
          }
        } catch (error) {
          message.destroy() // 清除loading消息
          message.error('重新获取失败：' + (error as Error).message)
        } finally {
          setLoading(false)
        }
      }
    })
  }

  const sendMessage = async () => {
    if (!messageInput.trim() || !selectedContact) {
      return
    }

    try {
      const data = await wxAutoAPI.sendMessage(selectedContact.name, messageInput.trim())
      if (data.success) {
        // 添加到聊天消息
        const newMessage: ChatMessage = {
          id: Date.now().toString(),
          content: messageInput.trim(),
          is_self: true,
          message_type: 'self',
          timestamp: new Date().toISOString(),
          sender: userInfo.nickname
        }
        setChatMessages((prev) => [...prev, newMessage])
        setMessageInput('')
        // 发送新消息时启用自动滚动到底部
        setShouldScrollToBottom(true)
        message.success('消息发送成功')
      } else {
        message.error(data.message || '发送失败')
      }
    } catch (error) {
      console.error('发送消息失败:', error as Error)
      message.error('发送失败')
    }
  }

  const startBulkSend = async () => {
    if (!canSendBulk) return

    try {
      setSendingBulk(true)
      setBulkSendStatus('正在发送...')

      const data = await wxAutoAPI.bulkSend(selectedBulkContacts, bulkMessage, delayRange)
      if (data.success) {
        setBulkSendStatus(`成功发送给 ${selectedBulkContacts.length} 个联系人`)
        message.success('群发完成')
        setBulkMessage('')
        setSelectedBulkContacts([])
      } else {
        setBulkSendStatus('发送失败: ' + (data.message || '未知错误'))
        message.error(data.message || '群发失败')
      }
    } catch (error) {
      console.error('群发消息失败:', error)
      setBulkSendStatus('发送失败: 网络错误')
      message.error('群发失败')
    } finally {
      setSendingBulk(false)
    }
  }

  // 保存自动回复状态到后端
  const saveAutoReplyEnabled = async (enabled: boolean) => {
    try {
      const res = await wxAutoAPI.toggleAutoReply(enabled)
      if (res.success) {
        setAutoReplyEnabled(enabled)
        message.success('自动回复状态已保存')
      } else {
        message.error(res.message || '保存失败')
      }
    } catch (e) {
      message.error('保存失败')
    }
  }

  // 自动回复状态同步：页面初始化时从后端获取
  useEffect(() => {
    const fetchAutoReplyStatus = async () => {
      try {
        const res = await wxAutoAPI.getAutoReplyStatus()
        if (res.success && res.data) {
          setAutoReplyEnabled(!!res.data.enabled)
        }
      } catch (e) {
        // 可选：处理异常
      }
    }
    fetchAutoReplyStatus()
  }, [])

  // 处理回复建议点击
  const handleSuggestionClick = (suggestion: any) => {
    // 设置输入框内容为建议内容
    setMessageInput(suggestion.content)

    // 聚焦输入框
    const inputElement = document.querySelector('.chat-input textarea')
    if (inputElement) {
      ;(inputElement as HTMLTextAreaElement).focus()
    }
  }

  return (
    <MainContainer className="ai-sales-page">
      {renderNavbar()}
      <PageContent>
        {currentPage === 'chat' && renderChatPage()}
        {currentPage === 'bulk' && renderBulkPage()}
        {currentPage === 'moments' && renderMomentsPage()}
        {currentPage === 'agents' && renderAgentsPage()}
        {currentPage === 'settings' && renderSettingsPage()}
        {currentPage === 'home' && renderHomePage()}
      </PageContent>
    </MainContainer>
  )

  // 渲染聊天页面
  function renderChatPage() {
    return (
      <div className="chat-page">
        <div className="chat-layout">
          {/* 联系人列表 */}
          <div className="contact-list">
            <div className="contact-header">
              <div className="contact-header-left">
                <h4>联系人</h4>
                <div className="contact-count">{contacts.friends.length + contacts.groups.length}</div>
              </div>
              <div className="contact-header-right" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  onClick={loadContacts}
                  loading={loading}
                  title="重新获取联系人">
                  刷新
                </Button>
              </div>
            </div>

            <div className="contact-search" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Input
                placeholder="搜索联系人..."
                prefix={<SearchOutlined />}
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                size="small"
                style={{ flex: 1 }}
              />
              {/* 自动回复开关紧跟搜索框右侧 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: 32, padding: '0 4px' }}>
                <RobotOutlined style={{ fontSize: 16, color: autoReplyEnabled ? '#52c41a' : '#8c8c8c' }} />
                <span style={{ fontSize: 14, color: 'var(--color-text-2)', marginRight: 2 }}>自动回复</span>
                <Switch
                  checked={autoReplyEnabled}
                  onChange={saveAutoReplyEnabled}
                  size="small"
                  style={{ verticalAlign: 'middle' }}
                />
              </div>
            </div>

            <div className="contact-content">
              <Tabs
                activeKey={contactsActiveTab}
                onChange={setContactsActiveTab}
                size="small"
                className="contact-tabs"
                items={[
                  {
                    key: 'friends',
                    label: `好友 (${contacts.friends.length})`,
                    children: (
                      <div className="contact-items">
                        {contacts.friends
                          .filter(
                            (contact) =>
                              !searchKeyword || contact.name.toLowerCase().includes(searchKeyword.toLowerCase())
                          )
                          .map((contact) => (
                            <div
                              key={contact.id}
                              className={`contact-item ${selectedContact?.id === contact.id ? 'active' : ''}`}
                              onClick={() => selectContact(contact)}>
                              <div className="contact-avatar">
                                <UserOutlined />
                              </div>
                              <div className="contact-info">
                                <div className="contact-name">{contact.name}</div>
                                <div className="contact-preview">
                                  {(contact as any).lastMessage ? (contact as any).lastMessage : '好友'}
                                </div>
                              </div>
                              {/* 监听状态标记 */}
                              {contact.is_monitoring && (
                                <span style={{ color: '#52c41a', marginLeft: 8, fontSize: 12 }}>
                                  <SoundFilled /> 监听中
                                </span>
                              )}
                              {(contact as any).lastTime && (
                                <div className="contact-time">{(contact as any).lastTime}</div>
                              )}
                            </div>
                          ))}
                      </div>
                    )
                  },
                  {
                    key: 'groups',
                    label: `群组 (${contacts.groups.length})`,
                    children: (
                      <div className="contact-items">
                        {contacts.groups
                          .filter(
                            (contact) =>
                              !searchKeyword || contact.name.toLowerCase().includes(searchKeyword.toLowerCase())
                          )
                          .map((contact) => (
                            <div
                              key={contact.id}
                              className={`contact-item ${selectedContact?.id === contact.id ? 'active' : ''}`}
                              onClick={() => selectContact(contact)}>
                              <div className="contact-avatar">
                                <TeamOutlined />
                              </div>
                              <div className="contact-info">
                                <div className="contact-name">{contact.name}</div>
                                <div className="contact-preview">
                                  {(contact as any).lastMessage ||
                                    ((contact as any).member_count ? `${(contact as any).member_count}人` : '群聊')}
                                </div>
                              </div>
                              {/* 监听状态标记 */}
                              {contact.is_monitoring && (
                                <span style={{ color: '#52c41a', marginLeft: 8, fontSize: 12 }}>
                                  <SoundFilled /> 监听中
                                </span>
                              )}
                              {(contact as any).lastTime && (
                                <div className="contact-time">{(contact as any).lastTime}</div>
                              )}
                            </div>
                          ))}
                      </div>
                    )
                  }
                ]}
              />
            </div>
          </div>

          {/* 聊天区域 */}
          <div className="chat-area">
            {!selectedContact ? (
              <div className="chat-placeholder">
                <CommentOutlined />
                <p>选择一个联系人开始对话</p>
                <p>AI助手将协助您进行智能客服</p>
              </div>
            ) : (
              <div className="chat-content">
                {/* 聊天头部 */}
                <div className="chat-header">
                  <div className="chat-user-info">
                    <div className="chat-avatar">
                      {selectedContact.type === 'friend' ? <UserOutlined /> : <TeamOutlined />}
                    </div>
                    <div className="chat-user-details">
                      <div className="chat-user-name">{selectedContact.name}</div>
                      <div className="chat-user-status">
                        {selectedContact.type === 'friend'
                          ? '好友'
                          : `群聊 ${selectedContact.member_count ? `(${selectedContact.member_count}人)` : ''}`}
                      </div>
                    </div>
                  </div>

                  <div className="chat-actions">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: 32, padding: '0 4px' }}>
                      {isListening ? (
                        <SoundFilled style={{ fontSize: 16, color: '#52c41a' }} />
                      ) : (
                        <SoundOutlined style={{ fontSize: 16, color: '#8c8c8c' }} />
                      )}
                      <span
                        style={{
                          fontSize: 14,
                          color: isListening ? '#52c41a' : 'var(--color-text-2)',
                          marginRight: 2
                        }}>
                        监听{isListening ? '中' : ''}
                      </span>
                      <Switch
                        checked={isListening}
                        onChange={toggleListening}
                        size="small"
                        style={{ verticalAlign: 'middle' }}
                      />
                    </div>

                    <Button
                      size="small"
                      icon={<ReloadOutlined />}
                      onClick={() => refreshMessagesFromDatabase(selectedContact.name)}>
                      刷新消息
                    </Button>

                    <Button
                      size="small"
                      type="primary"
                      danger
                      icon={<ReloadOutlined />}
                      onClick={refreshChatMessages}
                      loading={loading}>
                      重新获取聊天记录
                    </Button>
                  </div>
                </div>

                {/* 聊天消息 */}
                <div className="chat-messages" onScroll={handleScroll}>
                  {chatMessages.length === 0 && storedMessages.length === 0 ? (
                    <div className="no-messages">
                      <Empty description="暂无聊天记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                    </div>
                  ) : (
                    <div className="message-list">
                      {/* 加载更多消息指示器 */}
                      {loadingMoreMessages && (
                        <div className="loading-more-messages">
                          <div className="loading-indicator">
                            <ReloadOutlined spin /> 加载更多消息...
                          </div>
                        </div>
                      )}

                      {/* 历史消息 */}
                      {storedMessages.map((message, index) => {
                        const isSelfMessage = message.is_self === true || (message.is_self as any) === 1
                        const messageType = message.message_type || 'text'

                        // 时间消息
                        if (messageType === 'time') {
                          return (
                            <div key={`time_${index}`} className="message-item message-time">
                              <div className="time-message">{message.content}</div>
                            </div>
                          )
                        }

                        // 系统消息
                        if (messageType === 'system') {
                          return (
                            <div key={`system_${index}`} className="message-item message-system">
                              <div className="system-message">{message.content}</div>
                            </div>
                          )
                        }

                        // 获取当前消息的回复建议
                        const messageSuggestions = replySuggestions.filter(
                          (suggestion) => suggestion.message_id === message.id
                        )
                        const hasSuggestions = messageSuggestions.length > 0
                        const hasMultipleSuggestions = messageSuggestions.length > 1
                        const hasManySuggestions = messageSuggestions.length > 3

                        return (
                          <div
                            key={message.id || `stored_${index}`}
                            className={`message-item ${isSelfMessage ? 'message-self' : ''} 
                                      ${hasSuggestions ? 'has-suggestions' : ''} 
                                      ${hasMultipleSuggestions ? 'has-multiple-suggestions' : ''} 
                                      ${hasManySuggestions ? 'has-many-suggestions' : ''}`}>
                            <div className="message-row">
                              <div className="message-avatar">
                                <UserOutlined />
                              </div>
                              <div className="message-content">
                                {/* 群聊中显示发送者名称 */}
                                {message.sender && !isSelfMessage && message.sender !== selectedContact?.name && (
                                  <div className="sender-name">{message.sender}</div>
                                )}
                                <div className="message-text">{message.content}</div>
                                {message.source === 'wxautox' && (
                                  <div className="message-source">
                                    <span className="real-data-badge">实时</span>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* 回复建议 */}
                            {hasSuggestions && (
                              <div
                                className={`message-suggestions ${hasMultipleSuggestions ? 'multiple-suggestions' : ''}`}>
                                {messageSuggestions.map((suggestion) => (
                                  <div
                                    key={suggestion.id}
                                    className="suggestion-item"
                                    onClick={() => handleSuggestionClick(suggestion)}
                                    title="点击使用此回复建议">
                                    <div className="suggestion-content">{suggestion.content}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}

                      {/* 当前会话消息 */}
                      {chatMessages.map((message, index) => {
                        // 时间消息
                        if (message.message_type === 'time') {
                          return (
                            <div key={`time_${index}`} className="message-item message-time">
                              <div className="time-message">{message.content}</div>
                            </div>
                          )
                        }

                        // 系统消息
                        if (message.message_type === 'system') {
                          return (
                            <div key={`system_${index}`} className="message-item message-system">
                              <div className="system-message">{message.content}</div>
                            </div>
                          )
                        }

                        // 确保正确识别自己发送的消息
                        const isSelfMessage = message.is_self === true || (message.is_self as any) === 1

                        // 获取当前消息的回复建议
                        const messageSuggestions = replySuggestions.filter(
                          (suggestion) => suggestion.message_id === message.id
                        )
                        const hasSuggestions = messageSuggestions.length > 0
                        const hasMultipleSuggestions = messageSuggestions.length > 1
                        const hasManySuggestions = messageSuggestions.length > 3

                        return (
                          <div
                            key={message.id || `msg_${index}`}
                            className={`message-item ${isSelfMessage ? 'message-self' : ''} 
                                      ${hasSuggestions ? 'has-suggestions' : ''} 
                                      ${hasMultipleSuggestions ? 'has-multiple-suggestions' : ''} 
                                      ${hasManySuggestions ? 'has-many-suggestions' : ''}`}>
                            <div className="message-row">
                              <div className="message-avatar">
                                <UserOutlined />
                              </div>
                              <div className="message-content">
                                {/* 群聊中显示发送者名称 */}
                                {message.sender && !isSelfMessage && message.sender !== selectedContact?.name && (
                                  <div className="sender-name">{message.sender}</div>
                                )}
                                <div className="message-text">{message.content}</div>
                                {message.source === 'wxautox' && (
                                  <div className="message-source">
                                    <span className="real-data-badge">实时</span>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* 回复建议 */}
                            {hasSuggestions && (
                              <div
                                className={`message-suggestions ${hasMultipleSuggestions ? 'multiple-suggestions' : ''}`}>
                                {messageSuggestions.map((suggestion) => (
                                  <div
                                    key={suggestion.id}
                                    className="suggestion-item"
                                    onClick={() => handleSuggestionClick(suggestion)}
                                    title="点击使用此回复建议">
                                    <div className="suggestion-content">{suggestion.content}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* 消息输入框 */}
                <div className="chat-input">
                  <div className="input-container">
                    <TextArea
                      value={messageInput}
                      onChange={(e) => setMessageInput(e.target.value)}
                      placeholder="输入消息..."
                      autoSize={{ minRows: 1, maxRows: 4 }}
                      onPressEnter={(e) => {
                        if (!e.shiftKey) {
                          e.preventDefault()
                          sendMessage()
                        }
                      }}
                    />
                    <Button
                      type="primary"
                      icon={<SendOutlined />}
                      onClick={sendMessage}
                      disabled={!messageInput.trim()}>
                      发送
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // 渲染群发页面
  function renderBulkPage() {
    return (
      <div className="bulk-page">
        <div className="page-header">
          <Title level={3}>群发消息</Title>
          <Text type="secondary">批量发送消息给多个联系人</Text>
        </div>

        <div className="bulk-content">
          <Row gutter={24}>
            <Col span={12}>
              <Card title="选择联系人" className="bulk-card">
                <div className="bulk-filter">
                  <Select value={contactsFilter} onChange={setContactsFilter} style={{ width: 120, marginRight: 8 }}>
                    <Option value="friends">好友</Option>
                    <Option value="groups">群组</Option>
                  </Select>
                  <Input
                    placeholder="搜索联系人..."
                    value={bulkSearchQuery}
                    onChange={(e) => setBulkSearchQuery(e.target.value)}
                    prefix={<SearchOutlined />}
                    style={{ flex: 1 }}
                  />
                </div>

                <div className="bulk-contacts">
                  <Checkbox
                    indeterminate={
                      selectedBulkContacts.length > 0 && selectedBulkContacts.length < filteredBulkContacts.length
                    }
                    checked={
                      selectedBulkContacts.length === filteredBulkContacts.length && filteredBulkContacts.length > 0
                    }
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedBulkContacts(filteredBulkContacts.map((c) => c.id))
                      } else {
                        setSelectedBulkContacts([])
                      }
                    }}>
                    全选 ({selectedBulkContacts.length}/{filteredBulkContacts.length})
                  </Checkbox>

                  <div className="contact-list-bulk">
                    {filteredBulkContacts.map((contact) => (
                      <div key={contact.id} className="bulk-contact-item">
                        <Checkbox
                          checked={selectedBulkContacts.includes(contact.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedBulkContacts([...selectedBulkContacts, contact.id])
                            } else {
                              setSelectedBulkContacts(selectedBulkContacts.filter((id) => id !== contact.id))
                            }
                          }}>
                          <div className="contact-info">
                            <div className="contact-name">{contact.name}</div>
                            <div className="contact-type">{contactsFilter === 'friends' ? '好友' : '群组'}</div>
                          </div>
                        </Checkbox>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            </Col>

            <Col span={12}>
              <Card title="消息内容" className="bulk-card">
                <div className="bulk-message">
                  <TextArea
                    value={bulkMessage}
                    onChange={(e) => setBulkMessage(e.target.value)}
                    placeholder="输入要群发的消息内容..."
                    rows={8}
                  />

                  <div className="bulk-settings">
                    <div className="setting-item">
                      <Text>发送间隔 (秒):</Text>
                      <Slider
                        range
                        min={1}
                        max={10}
                        value={delayRange}
                        onChange={(value) => setDelayRange(value as [number, number])}
                        marks={{
                          1: '1s',
                          5: '5s',
                          10: '10s'
                        }}
                      />
                      <Text type="secondary">
                        随机间隔 {delayRange[0]}-{delayRange[1]} 秒
                      </Text>
                    </div>
                  </div>

                  <div className="bulk-actions">
                    <Button
                      type="primary"
                      size="large"
                      icon={<SendOutlined />}
                      onClick={startBulkSend}
                      disabled={!canSendBulk}
                      loading={sendingBulk}
                      block>
                      发送给 {selectedBulkContacts.length} 个联系人
                    </Button>
                  </div>

                  {bulkSendStatus && (
                    <div className="bulk-status">
                      <Text>{bulkSendStatus}</Text>
                    </div>
                  )}
                </div>
              </Card>
            </Col>
          </Row>
        </div>
      </div>
    )
  }

  // 渲染朋友圈页面
  function renderMomentsPage() {
    return (
      <div className="moments-page">
        <div className="page-header">
          <Title level={3}>朋友圈管理</Title>
          <Text type="secondary">管理朋友圈动态，自动点赞和评论</Text>
        </div>

        <div className="moments-content">
          <Row gutter={24}>
            <Col span={12}>
              <Card title="朋友圈设置" className="moments-card">
                <Form layout="vertical">
                  <Form.Item label="自动点赞">
                    <Switch checked={autoLike} onChange={setAutoLike} checkedChildren="开启" unCheckedChildren="关闭" />
                  </Form.Item>

                  <Form.Item label="每日点赞限制">
                    <InputNumber
                      value={autoLikeLimit}
                      onChange={(value) => setAutoLikeLimit(value || 10)}
                      min={1}
                      max={50}
                      disabled={!autoLike}
                      style={{ width: '100%' }}
                    />
                    <Text type="secondary">建议设置在10-30之间，避免被限制</Text>
                  </Form.Item>

                  <Form.Item label="点赞频率">
                    <Select
                      value={autoLikeFrequency}
                      onChange={setAutoLikeFrequency}
                      disabled={!autoLike}
                      style={{ width: '100%' }}>
                      <Option value="low">低频 (1-2小时)</Option>
                      <Option value="medium">中频 (30-60分钟)</Option>
                      <Option value="high">高频 (10-30分钟)</Option>
                    </Select>
                  </Form.Item>
                </Form>
              </Card>
            </Col>

            <Col span={12}>
              <Card title="朋友圈动态" className="moments-card">
                <div className="moments-list">
                  <Empty description="暂无朋友圈数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                </div>
              </Card>
            </Col>
          </Row>

          <Row gutter={24} style={{ marginTop: 24 }}>
            <Col span={24}>
              <Card title="操作记录" className="moments-card">
                <div className="operation-log">
                  <Empty description="暂无操作记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                </div>
              </Card>
            </Col>
          </Row>
        </div>
      </div>
    )
  }

  // 渲染智能体页面
  function renderAgentsPage() {
    return (
      <div className="agents-page">
        <div className="page-header">
          <Title level={3}>智能体配置</Title>
          <Text type="secondary">配置AI助手的行为和回复策略</Text>
        </div>

        <div className="agents-content">
          <Row gutter={24}>
            <Col span={12}>
              <Card title="智能体列表" className="agents-card">
                {agents.map((agent, index) => (
                  <div key={index} className="agent-item">
                    <div className="agent-info">
                      <div className="agent-name">{agent.name}</div>
                      <div className="agent-model">模型: {agent.model}</div>
                    </div>
                    <Switch
                      checked={agent.enabled}
                      onChange={(checked) => {
                        const newAgents = [...agents]
                        newAgents[index].enabled = checked
                        setAgents(newAgents)
                      }}
                    />
                  </div>
                ))}
              </Card>
            </Col>

            <Col span={12}>
              <Card title="回复策略" className="strategy-card">
                <Form layout="vertical">
                  <Form.Item label="聊天类型">
                    <Select
                      value={replyStrategy.chatType}
                      onChange={(value) => setReplyStrategy({ ...replyStrategy, chatType: value })}>
                      <Option value="private">私聊</Option>
                      <Option value="group">群聊</Option>
                      <Option value="all">全部</Option>
                    </Select>
                  </Form.Item>

                  <Form.Item label="群聊设置">
                    <Checkbox
                      checked={replyStrategy.groupAtOnly}
                      onChange={(e) => setReplyStrategy({ ...replyStrategy, groupAtOnly: e.target.checked })}>
                      仅回复@消息
                    </Checkbox>
                  </Form.Item>

                  <Form.Item label="触发关键词">
                    <div className="keywords-container">
                      {replyStrategy.keywords.map((keyword, index) => (
                        <Tag
                          key={index}
                          closable
                          onClose={() => {
                            const newKeywords = replyStrategy.keywords.filter((_, i) => i !== index)
                            setReplyStrategy({ ...replyStrategy, keywords: newKeywords })
                          }}>
                          {keyword}
                        </Tag>
                      ))}
                      {keywordInputVisible ? (
                        <Input
                          ref={keywordInputRef}
                          type="text"
                          size="small"
                          style={{ width: 78 }}
                          value={keywordInputValue}
                          onChange={(e) => setKeywordInputValue(e.target.value)}
                          onBlur={() => {
                            if (keywordInputValue && !replyStrategy.keywords.includes(keywordInputValue)) {
                              setReplyStrategy({
                                ...replyStrategy,
                                keywords: [...replyStrategy.keywords, keywordInputValue]
                              })
                            }
                            setKeywordInputVisible(false)
                            setKeywordInputValue('')
                          }}
                          onPressEnter={() => {
                            if (keywordInputValue && !replyStrategy.keywords.includes(keywordInputValue)) {
                              setReplyStrategy({
                                ...replyStrategy,
                                keywords: [...replyStrategy.keywords, keywordInputValue]
                              })
                            }
                            setKeywordInputVisible(false)
                            setKeywordInputValue('')
                          }}
                        />
                      ) : (
                        <Tag
                          onClick={() => {
                            setKeywordInputVisible(true)
                            setTimeout(() => keywordInputRef.current?.focus(), 0)
                          }}
                          style={{ background: 'var(--color-background)', borderStyle: 'dashed' }}>
                          + 添加关键词
                        </Tag>
                      )}
                    </div>
                  </Form.Item>
                </Form>
              </Card>
            </Col>
          </Row>
        </div>
      </div>
    )
  }

  // 渲染设置页面
  function renderSettingsPage() {
    return (
      <div className="settings-page">
        <div className="page-header">
          <Title level={3}>系统设置</Title>
          <Text type="secondary">配置系统参数和API密钥</Text>
        </div>

        <div className="settings-content">
          <Row gutter={24}>
            <Col span={12}>
              <Card title="API配置" className="settings-card">
                <Tabs defaultActiveKey="openai">
                  <Tabs.TabPane tab="OpenAI" key="openai">
                    <Form layout="vertical">
                      <Form.Item label="OpenAI API Key" required>
                        <Input.Password
                          value={apiKeys.openai_api_key}
                          onChange={(e) => setApiKeys({ ...apiKeys, openai_api_key: e.target.value })}
                          placeholder="输入OpenAI API Key"
                        />
                      </Form.Item>
                      <Form.Item label="API URL">
                        <Input
                          value={apiKeys.openai_api_url}
                          onChange={(e) => setApiKeys({ ...apiKeys, openai_api_url: e.target.value })}
                          placeholder="https://api.openai-proxy.com/v1/chat/completions"
                        />
                        <Text type="secondary">国内用户可使用代理地址</Text>
                      </Form.Item>
                      <Form.Item label="模型">
                        <Select
                          value={apiKeys.openai_model}
                          onChange={(value) => setApiKeys({ ...apiKeys, openai_model: value })}
                          options={[
                            { label: 'GPT-3.5 Turbo', value: 'gpt-3.5-turbo' },
                            { label: 'GPT-4', value: 'gpt-4' },
                            { label: 'GPT-4 Turbo', value: 'gpt-4-turbo-preview' }
                          ]}
                        />
                      </Form.Item>
                      <Form.Item label="温度">
                        <Slider
                          min={0}
                          max={2}
                          step={0.1}
                          value={apiKeys.openai_temperature}
                          onChange={(value) => setApiKeys({ ...apiKeys, openai_temperature: value })}
                          marks={{
                            0: '精确',
                            1: '平衡',
                            2: '创意'
                          }}
                        />
                      </Form.Item>
                      <Form.Item label="最大生成长度">
                        <InputNumber
                          min={100}
                          max={4000}
                          step={100}
                          value={apiKeys.openai_max_tokens}
                          onChange={(value) => setApiKeys({ ...apiKeys, openai_max_tokens: value || 2000 })}
                          style={{ width: '100%' }}
                        />
                      </Form.Item>
                      <Form.Item label="系统提示词">
                        <TextArea
                          value={apiKeys.openai_system_prompt}
                          onChange={(e) => setApiKeys({ ...apiKeys, openai_system_prompt: e.target.value })}
                          placeholder="设置AI助手的角色和行为"
                          rows={4}
                        />
                      </Form.Item>
                    </Form>
                  </Tabs.TabPane>
                  <Tabs.TabPane tab="DeepSeek" key="deepseek">
                    <Form layout="vertical">
                      <Form.Item label="DeepSeek API Key">
                        <Input.Password
                          value={apiKeys.deepseek_api_key}
                          onChange={(e) => setApiKeys({ ...apiKeys, deepseek_api_key: e.target.value })}
                          placeholder="输入DeepSeek API Key"
                        />
                      </Form.Item>
                      <Form.Item label="DeepSeek Base URL">
                        <Input
                          value={apiKeys.deepseek_base_url}
                          onChange={(e) => setApiKeys({ ...apiKeys, deepseek_base_url: e.target.value })}
                          placeholder="https://api.deepseek.com"
                        />
                      </Form.Item>
                    </Form>
                  </Tabs.TabPane>
                  <Tabs.TabPane tab="Moonshot" key="moonshot">
                    <Form layout="vertical">
                      <Form.Item label="Moonshot API Key">
                        <Input.Password
                          value={apiKeys.moonshot_api_key}
                          onChange={(e) => setApiKeys({ ...apiKeys, moonshot_api_key: e.target.value })}
                          placeholder="输入Moonshot API Key"
                        />
                      </Form.Item>
                      <Form.Item label="Moonshot Base URL">
                        <Input
                          value={apiKeys.moonshot_base_url}
                          onChange={(e) => setApiKeys({ ...apiKeys, moonshot_base_url: e.target.value })}
                          placeholder="https://api.moonshot.cn/v1"
                        />
                      </Form.Item>
                    </Form>
                  </Tabs.TabPane>
                </Tabs>
              </Card>
            </Col>

            <Col span={12}>
              <Card title="自动化任务" className="settings-card">
                <Form layout="vertical">
                  <Form.Item label="自动通过好友请求">
                    <Switch
                      checked={tasks.friendRequest.enabled}
                      onChange={(checked) =>
                        setTasks({
                          ...tasks,
                          friendRequest: { ...tasks.friendRequest, enabled: checked }
                        })
                      }
                    />
                  </Form.Item>
                  <Form.Item label="每日最大通过数量">
                    <InputNumber
                      value={tasks.friendRequest.maxFriendsPerDay}
                      onChange={(value) =>
                        setTasks({
                          ...tasks,
                          friendRequest: { ...tasks.friendRequest, maxFriendsPerDay: value || 20 }
                        })
                      }
                      min={1}
                      max={100}
                    />
                  </Form.Item>
                  <Form.Item label="朋友圈自动点赞">
                    <Switch checked={autoLike} onChange={setAutoLike} />
                  </Form.Item>
                  <Form.Item label="每日点赞限制">
                    <InputNumber
                      value={autoLikeLimit}
                      onChange={(value) => setAutoLikeLimit(value || 10)}
                      min={1}
                      max={50}
                      disabled={!autoLike}
                    />
                  </Form.Item>
                  <Form.Item label="点赞频率">
                    <Select value={autoLikeFrequency} onChange={setAutoLikeFrequency} disabled={!autoLike}>
                      <Option value="low">低频 (1-2小时)</Option>
                      <Option value="medium">中频 (30-60分钟)</Option>
                      <Option value="high">高频 (10-30分钟)</Option>
                    </Select>
                  </Form.Item>
                </Form>
              </Card>
            </Col>
          </Row>

          <div className="settings-actions">
            <Button type="primary" onClick={saveApiKeys}>
              保存设置
            </Button>
            <Button onClick={loadApiKeys} style={{ marginLeft: 8 }}>
              重新加载
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // 渲染首页
  function renderHomePage() {
    return (
      <HomePage>
        <div className="welcome-section">
          <div className="welcome-title">欢迎使用 AI销冠机器人</div>
          <div className="welcome-subtitle">您好，销售精英！</div>
        </div>

        <div className="stats-section">
          <div className="stat-card">
            <div className="stat-number">{contacts.friends.length}</div>
            <div className="stat-label">好友数量</div>
          </div>
          <div className="stat-card">
            <div className="stat-number">{contacts.groups.length}</div>
            <div className="stat-label">群组数量</div>
          </div>
          <div className="stat-card">
            <div className="stat-number status-online">{wechatConnected ? '在线' : '离线'}</div>
            <div className="stat-label">连接状态</div>
          </div>
        </div>

        <div className="features-section">
          <div className="section-title">功能介绍</div>
          <div className="feature-cards">
            <div className="feature-card" onClick={() => setCurrentPage('chat')}>
              <div className="feature-icon">
                <WechatOutlined />
              </div>
              <div className="feature-title">AI智能聊天</div>
              <div className="feature-desc">自动化客服对话，提升沟通效率</div>
            </div>
            <div className="feature-card" onClick={() => setCurrentPage('bulk')}>
              <div className="feature-icon">
                <ThunderboltOutlined />
              </div>
              <div className="feature-title">定向群发</div>
              <div className="feature-desc">高效发送消息，精准营销客户</div>
            </div>
            <div className="feature-card" onClick={() => setCurrentPage('moments')}>
              <div className="feature-icon">
                <CommentOutlined />
              </div>
              <div className="feature-title">朋友圈管理</div>
              <div className="feature-desc">自动点赞评论，提升社交活跃度</div>
            </div>
            <div className="feature-card" onClick={() => setCurrentPage('agents')}>
              <div className="feature-icon">
                <RobotOutlined />
              </div>
              <div className="feature-title">实力升级</div>
              <div className="feature-desc">自定义AI助手，提升专业水平</div>
            </div>
          </div>
        </div>
      </HomePage>
    )
  }
}

// 样式组件

const NavbarIcon = styled.div`
  -webkit-app-region: none;
  border-radius: 8px;
  height: 30px;
  padding: 0 7px;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  transition: all 0.2s ease-in-out;
  cursor: pointer;
  color: var(--color-icon);

  &:hover {
    background-color: var(--color-background-mute);
    color: var(--color-icon-white);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`

// 主容器
const MainContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100%;
  background: var(--color-background);
  overflow: hidden;

  .aisales-header {
    display: flex;
    flex-direction: column;
    border-bottom: 1px solid var(--color-border);
  }

  .horizontal-nav {
    display: flex;
    background: var(--color-background);
    border-bottom: 1px solid var(--color-border);
    padding: 0 16px;
  }

  .nav-tab {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    transition: all 0.2s ease;
    color: var(--color-text-secondary);
    font-size: 14px;
    font-weight: 500;
    min-width: 120px;
    justify-content: center;

    &:hover {
      color: var(--color-text);
      background: var(--color-background-soft);
    }

    &.active {
      color: var(--color-primary);
      border-bottom-color: var(--color-primary);
      background: var(--color-background-soft);
    }
  }

  .nav-tab-icon {
    display: flex;
    align-items: center;
    font-size: 16px;
  }

  .nav-tab-label {
    font-weight: 500;
  }
`

// 首页容器
const HomePage = styled.div`
  flex: 1;
  padding: 40px;
  background: var(--color-background);
  overflow-y: auto;
  min-height: 0;
  width: 100%;
  height: 100%;

  .welcome-section {
    text-align: center;
    margin-bottom: 40px;

    .welcome-title {
      font-size: 32px;
      font-weight: 600;
      color: var(--color-text-1);
      margin-bottom: 8px;
    }

    .welcome-subtitle {
      font-size: 16px;
      color: var(--color-text-2);
    }
  }

  .stats-section {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 24px;
    margin-bottom: 60px;
    max-width: 800px;
    margin-left: auto;
    margin-right: auto;

    .stat-card {
      background: var(--color-background);
      padding: 32px 24px;
      border-radius: 16px;
      text-align: center;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
      border: 1px solid var(--color-border);
      width: 100%;
      height: 160px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
      overflow: hidden;

      &::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 3px;
        background: linear-gradient(90deg, var(--color-primary), var(--color-primary-light));
        opacity: 0;
        transition: opacity 0.3s ease;
      }

      &:hover {
        transform: translateY(-6px);
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.12);
        border-color: var(--color-primary-light);
        background: var(--color-hover);

        &::before {
          opacity: 1;
        }
      }

      .stat-number {
        font-size: 48px;
        font-weight: 700;
        background: linear-gradient(135deg, var(--color-primary), var(--color-primary-light));
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        margin-bottom: 16px;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);

        &.status-online {
          background: linear-gradient(135deg, #10b981, #34d399);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
      }

      .stat-label {
        font-size: 16px;
        font-weight: 600;
        color: var(--color-text-3);
        margin-bottom: 8px;
        letter-spacing: 0.5px;
      }
    }
  }

  .features-section {
    max-width: 1000px;
    margin: 0 auto;

    .section-title {
      text-align: center;
      font-size: 28px;
      font-weight: 700;
      background: linear-gradient(135deg, var(--color-text-1), var(--color-text-2));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 48px;
      letter-spacing: 0.5px;
    }

    .feature-cards {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 32px;
      max-width: 800px;
      margin: 0 auto;

      .feature-card {
        background: var(--color-background);
        padding: 40px 28px;
        border-radius: 20px;
        text-align: center;
        cursor: pointer;
        transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.06);
        border: 1px solid var(--color-border);
        width: 100%;
        height: 180px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        position: relative;
        overflow: hidden;

        &::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(135deg, rgba(59, 130, 246, 0.05), rgba(147, 51, 234, 0.05));
          opacity: 0;
          transition: opacity 0.3s ease;
        }

        &:hover {
          transform: translateY(-8px) scale(1.02);
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.12);
          border-color: var(--color-primary-light);

          &::before {
            opacity: 1;
          }

          .feature-icon {
            transform: scale(1.1);
          }
        }

        .feature-icon {
          font-size: 56px;
          background: linear-gradient(135deg, var(--color-primary), var(--color-primary-light));
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          margin-bottom: 20px;
          transition: transform 0.3s ease;
          position: relative;
          z-index: 1;
        }

        .feature-title {
          font-size: 18px;
          font-weight: 700;
          color: var(--color-text-1);
          margin-bottom: 12px;
          position: relative;
          z-index: 1;
        }

        .feature-desc {
          font-size: 14px;
          color: var(--color-text-2);
          line-height: 1.6;
          position: relative;
          z-index: 1;
        }
      }
    }
  }
`

// 页面内容区域
const PageContent = styled.div`
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
  width: 100%;
  height: calc(100vh - 60px);

  .chat-page,
  .bulk-page,
  .moments-page,
  .agents-page {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
    background: var(--color-background);
    width: 100%;
  }

  .settings-page {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
    background: var(--color-background);
    width: 100%;

    .settings-content {
      flex: 1;
      padding: 24px;
      overflow-y: auto;
      max-height: calc(100vh - 150px);
    }

    .settings-card {
      margin-bottom: 24px;
    }

    .settings-actions {
      margin-top: 24px;
      padding-bottom: 24px;
    }
  }

  .page-header {
    padding: 20px 24px;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-background-soft);
  }

  .chat-layout {
    flex: 1;
    display: flex;
    overflow: hidden;
    height: 100%;
    min-height: 0;
  }

  .contact-list {
    width: 300px;
    border-right: 1px solid var(--color-border);
    display: flex;
    flex-direction: column;
    background: var(--color-background-soft);
    min-height: 0;
    overflow: hidden;
    box-shadow: 2px 0 8px rgba(0, 0, 0, 0.04);
  }

  .contact-header {
    padding: 20px 16px;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-background);
    flex-shrink: 0;

    h4 {
      font-size: 16px;
      font-weight: 700;
      color: var(--color-text-1);
      margin: 0;
    }

    .contact-count {
      font-size: 12px;
      color: var(--color-text-3);
      background: var(--color-primary-bg);
      padding: 2px 8px;
      border-radius: 12px;
      font-weight: 500;
    }
  }

  .contact-search {
    margin-bottom: 16px;

    .ant-input-affix-wrapper {
      border-radius: 12px;
      border: 1px solid var(--color-border);
      background: var(--color-background);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);

      &:focus,
      &:focus-within {
        border-color: var(--color-primary);
        box-shadow: 0 0 0 3px var(--color-primary-bg);
      }
    }
  }

  .contact-content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 8px 0;
  }

  .contact-items {
    padding: 0;
  }

  .contact-item {
    padding: 14px 16px;
    cursor: pointer;
    border-bottom: 1px solid var(--color-border);
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 0 8px;
    border-radius: 12px;
    position: relative;

    &:hover {
      background: var(--color-hover);
      transform: translateX(4px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    }

    &.active {
      background: var(--color-primary-bg);
      border-left: 4px solid var(--color-primary);
      box-shadow: 0 4px 16px rgba(59, 130, 246, 0.2);
      transform: translateX(4px);

      .contact-name {
        color: var(--color-primary);
        font-weight: 600;
      }
    }
  }

  .chat-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    background: var(--color-background);
    height: 100%;
    min-height: 0;
  }

  .chat-placeholder {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: var(--color-text-3);
    background: var(--color-background-soft);

    .anticon {
      font-size: 64px;
      margin-bottom: 20px;
      color: var(--color-primary-light);
      opacity: 0.6;
    }

    p {
      font-size: 16px;
      font-weight: 500;
      margin: 4px 0;

      &:first-of-type {
        color: var(--color-text-2);
      }

      &:last-of-type {
        color: var(--color-text-3);
        font-size: 14px;
      }
    }
  }

  .chat-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .chat-header {
    padding: 12px 16px;
    border-bottom: 1px solid var(--color-border);
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: var(--color-background);
    box-shadow: none;

    h3 {
      font-size: 16px;
      font-weight: 500;
      color: var(--color-text-1);
      margin: 0;
    }
  }

  .chat-messages {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 16px 0;
    background: var(--color-background-soft);
  }

  .loading-more-messages {
    padding: 12px 16px;
    text-align: center;
    border-bottom: 1px solid var(--color-border);
  }

  .loading-indicator {
    color: var(--color-text-3);
    font-size: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 0;

    /* 自定义滚动条样式 */
    &::-webkit-scrollbar {
      width: 4px;
    }

    &::-webkit-scrollbar-track {
      background: transparent;
    }

    &::-webkit-scrollbar-thumb {
      background: rgba(0, 0, 0, 0.2);
      border-radius: 2px;

      &:hover {
        background: rgba(0, 0, 0, 0.3);
      }
    }
  }

  .message-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0 8px;
  }

  .message-item {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    margin-bottom: 8px;
    animation: messageSlideIn 0.3s ease-out;

    &.message-self {
      flex-direction: row-reverse;

      .message-avatar {
        display: none;
      }

      .message-content {
        background: #07c160;
        color: white;
        border-radius: 8px 2px 8px 8px;
        margin-right: 8px;
        border: 1px solid #07c160;
        box-shadow: none;
      }
    }

    &.message-time {
      justify-content: center;
      margin: 16px 0 8px 0;

      .time-message {
        background: rgba(255, 255, 255, 0.1);
        color: var(--color-text-2);
        padding: 4px 12px;
        border-radius: 12px;
        font-size: 11px;
        font-weight: 400;
        border: 1px solid rgba(255, 255, 255, 0.1);
        box-shadow: none;
      }
    }

    &.message-system {
      justify-content: center;
      margin: 12px 0;

      .system-message {
        background: var(--color-warning-bg);
        color: var(--color-warning);
        padding: 6px 12px;
        border-radius: 12px;
        font-size: 11px;
        font-weight: 400;
        border: 1px solid var(--color-warning-border);
        box-shadow: none;
      }
    }
  }

  .message-avatar {
    width: 32px;
    height: 32px;
    border-radius: 4px;
    background: var(--color-background-mute);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-3);
    flex-shrink: 0;
    font-size: 14px;
    border: none;
    box-shadow: none;
  }

  .message-content {
    max-width: 60%;
    padding: 8px 12px;
    border-radius: 2px 8px 8px 8px;
    background: var(--color-background-mute);
    color: var(--color-text-1);
    font-size: 14px;
    line-height: 1.4;
    word-wrap: break-word;
    border: 1px solid var(--color-border);
    box-shadow: none;
    position: relative;
  }

  @keyframes messageSlideIn {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .message-text {
    margin: 0;
  }

  .message-time {
    font-size: 11px;
    color: var(--color-text-4);
    margin-top: 4px;
  }

  .chat-input {
    padding: 12px 16px;
    border-top: 1px solid var(--color-border);
    background: var(--color-background);
    box-shadow: none;

    .input-container {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .ant-input {
      flex: 1;
      border-radius: 6px;
      border: 1px solid var(--color-border);
      background: var(--color-background-mute);
      color: var(--color-text-1);
      padding: 8px 12px;
      font-size: 14px;
      box-shadow: none;
      transition: border-color 0.2s ease;

      &:focus {
        border-color: #07c160;
        box-shadow: 0 0 0 2px rgba(7, 193, 96, 0.2);
        background: var(--color-background);
      }

      &::placeholder {
        color: var(--color-text-3);
      }
    }

    .ant-btn {
      border-radius: 6px;
      height: 36px;
      padding: 0 16px;
      font-weight: 400;
      box-shadow: none;
      border: none;

      &.ant-btn-primary {
        background: #07c160;
        color: white;

        &:hover {
          background: #06ad56;
        }

        &:focus {
          background: #07c160;
          box-shadow: 0 0 0 2px rgba(7, 193, 96, 0.2);
        }
      }
    }
  }

  /* 群发页面联系人列表滚动 */
  .bulk-contacts {
    max-height: 400px;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .contact-list-bulk {
    max-height: 350px;
    overflow-y: auto;
    overflow-x: hidden;
    margin-top: 12px;
  }

  .bulk-contact-item {
    padding: 8px 0;
    border-bottom: 1px solid var(--color-border-soft);

    &:last-child {
      border-bottom: none;
    }
  }

  /* 联系人头像和信息样式 */
  .contact-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--color-background-mute);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-3);
    border: 1px solid var(--color-border);
    flex-shrink: 0;
  }

  .contact-info {
    flex: 1;
    min-width: 0;
  }

  .contact-name {
    font-weight: 500;
    margin-bottom: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .contact-preview {
    font-size: 12px;
    color: var(--color-text-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .contact-time {
    font-size: 11px;
    color: var(--color-text-4);
    flex-shrink: 0;
    margin-left: 8px;
  }

  /* 朋友圈页面样式 */
  .moments-page {
    .moments-content {
      flex: 1;
      padding: 24px;
      overflow-y: auto;
    }

    .moments-card {
      .ant-card-body {
        padding: 20px;
      }
    }

    .moments-list {
      min-height: 300px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .operation-log {
      min-height: 200px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
  }
`

export default AISalesPage
