import React, { useState, useEffect } from 'react'
import {
  Card,
  Form,
  Input,
  Button,
  Switch,
  Select,
  InputNumber,
  Tag,
  Space,
  Typography,
  Row,
  Col,
  Divider,
  App,
  Tabs
} from 'antd'
import {
  PlusOutlined,
  DeleteOutlined,
  TestOutlined,
  SaveOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

const { Title, Text } = Typography
const { Option } = Select
const { TabPane } = Tabs

interface ApiKeys {
  deepseek_api_key: string
  deepseek_base_url: string
  moonshot_api_key: string
  moonshot_base_url: string
}

interface Agent {
  name: string
  model: string
  enabled: boolean
}

interface ReplyStrategy {
  chatType: 'private' | 'group' | 'all'
  groupAtOnly: boolean
  keywords: string[]
}

interface AutomationTasks {
  friendRequest: {
    enabled: boolean
    maxFriendsPerDay: number
    greetingGroupId: string
  }
}

const AISalesSettings: React.FC = () => {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [form] = Form.useForm()
  
  // 状态管理
  const [loading, setLoading] = useState(false)
  const [testingConnection, setTestingConnection] = useState(false)
  
  // API配置
  const [apiKeys, setApiKeys] = useState<ApiKeys>({
    deepseek_api_key: '',
    deepseek_base_url: 'https://api.deepseek.com',
    moonshot_api_key: '',
    moonshot_base_url: 'https://api.moonshot.cn/v1'
  })
  
  // 智能体配置
  const [agents, setAgents] = useState<Agent[]>([
    {
      name: '默认销售助手',
      model: 'deepseek-chat',
      enabled: true
    }
  ])
  
  // 回复策略
  const [replyStrategy, setReplyStrategy] = useState<ReplyStrategy>({
    chatType: 'private',
    groupAtOnly: true,
    keywords: ['帮我', '价格', '优惠']
  })
  
  // 自动化任务
  const [tasks, setTasks] = useState<AutomationTasks>({
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
  
  // 初始化
  useEffect(() => {
    loadApiKeys()
    loadReplyStrategy()
    loadAutomationTasks()
  }, [])
  
  // API调用函数
  const loadApiKeys = async () => {
    try {
      const response = await fetch('/api/settings/api_keys')
      const data = await response.json()
      if (data.success && data.data) {
        setApiKeys(data.data)
        form.setFieldsValue(data.data)
      }
    } catch (error) {
      console.error('加载API密钥失败:', error)
    }
  }
  
  const loadReplyStrategy = async () => {
    try {
      const response = await fetch('/api/settings/reply_strategy')
      const data = await response.json()
      if (data.success && data.data) {
        setReplyStrategy(data.data)
      }
    } catch (error) {
      console.error('加载回复策略失败:', error)
    }
  }
  
  const loadAutomationTasks = async () => {
    try {
      const response = await fetch('/api/settings/automation_tasks')
      const data = await response.json()
      if (data.success && data.data) {
        setTasks(data.data)
      }
    } catch (error) {
      console.error('加载自动化任务失败:', error)
    }
  }
  
  const saveApiConfig = async () => {
    try {
      setLoading(true)
      const values = await form.validateFields()
      
      const response = await fetch('/api/settings/api_keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(values)
      })
      
      const data = await response.json()
      if (data.success) {
        setApiKeys(values)
        message.success('API配置保存成功')
      } else {
        message.error(data.message || '保存失败')
      }
    } catch (error) {
      console.error('保存API配置失败:', error)
      message.error('保存失败')
    } finally {
      setLoading(false)
    }
  }
  
  const testConnection = async () => {
    try {
      setTestingConnection(true)
      const values = await form.validateFields()
      
      const response = await fetch('/api/settings/test_connection', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(values)
      })
      
      const data = await response.json()
      if (data.success) {
        message.success('连接测试成功')
      } else {
        message.error(data.message || '连接测试失败')
      }
    } catch (error) {
      console.error('测试连接失败:', error)
      message.error('测试连接失败')
    } finally {
      setTestingConnection(false)
    }
  }
  
  const saveStrategyConfig = async () => {
    try {
      setLoading(true)
      
      const response = await fetch('/api/settings/reply_strategy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(replyStrategy)
      })
      
      const data = await response.json()
      if (data.success) {
        message.success('策略配置保存成功')
      } else {
        message.error(data.message || '保存失败')
      }
    } catch (error) {
      console.error('保存策略配置失败:', error)
      message.error('保存失败')
    } finally {
      setLoading(false)
    }
  }
  
  const addKeyword = () => {
    if (keywordInputValue && !replyStrategy.keywords.includes(keywordInputValue)) {
      setReplyStrategy(prev => ({
        ...prev,
        keywords: [...prev.keywords, keywordInputValue]
      }))
      setKeywordInputValue('')
      setKeywordInputVisible(false)
    }
  }
  
  const removeKeyword = (keyword: string) => {
    setReplyStrategy(prev => ({
      ...prev,
      keywords: prev.keywords.filter(k => k !== keyword)
    }))
  }

  return (
    <div className="ai-sales-settings">
      <div className="page-header">
        <Title level={2}>{t('aisales.settings.title')}</Title>
        <Text type="secondary">{t('aisales.settings.description')}</Text>
      </div>
      
      <Tabs defaultActiveKey="api" type="card">
        {/* API设置 */}
        <TabPane tab={t('aisales.settings.api_settings')} key="api">
          <Card>
            <Form
              form={form}
              layout="vertical"
              initialValues={apiKeys}
            >
              <Row gutter={24}>
                <Col span={12}>
                  <Form.Item
                    label={t('aisales.settings.deepseek_api')}
                    name="deepseek_api_key"
                    rules={[{ required: true, message: '请输入DeepSeek API密钥' }]}
                  >
                    <Input.Password 
                      placeholder={t('aisales.settings.deepseek_api_placeholder')}
                    />
                  </Form.Item>
                  
                  <Form.Item
                    label={t('aisales.settings.api_base_url')}
                    name="deepseek_base_url"
                  >
                    <Input 
                      placeholder={t('aisales.settings.api_base_url_placeholder')}
                    />
                  </Form.Item>
                </Col>
                
                <Col span={12}>
                  <Form.Item
                    label={t('aisales.settings.moonshot_api')}
                    name="moonshot_api_key"
                  >
                    <Input.Password 
                      placeholder={t('aisales.settings.moonshot_api_placeholder')}
                    />
                  </Form.Item>
                  
                  <Form.Item
                    label={t('aisales.settings.moonshot_url')}
                    name="moonshot_base_url"
                  >
                    <Input 
                      placeholder={t('aisales.settings.moonshot_url_placeholder')}
                    />
                  </Form.Item>
                </Col>
              </Row>
              
              <Divider />
              
              <Space>
                <Button 
                  type="primary" 
                  icon={<SaveOutlined />}
                  loading={loading}
                  onClick={saveApiConfig}
                >
                  {t('aisales.settings.save_api_config')}
                </Button>
                
                <Button 
                  icon={<TestOutlined />}
                  loading={testingConnection}
                  onClick={testConnection}
                >
                  {t('aisales.settings.test_connection')}
                </Button>
              </Space>
            </Form>
          </Card>
        </TabPane>
        
        {/* 回复策略 */}
        <TabPane tab={t('aisales.settings.reply_strategy')} key="strategy">
          <Card>
            <Row gutter={24}>
              <Col span={12}>
                <div style={{ marginBottom: 24 }}>
                  <Text strong>{t('aisales.settings.chat_type')}</Text>
                  <div style={{ marginTop: 8 }}>
                    <Select
                      value={replyStrategy.chatType}
                      onChange={(value) => setReplyStrategy(prev => ({ ...prev, chatType: value }))}
                      style={{ width: '100%' }}
                    >
                      <Option value="private">{t('aisales.settings.private_chat')}</Option>
                      <Option value="group">{t('aisales.settings.group_chat')}</Option>
                      <Option value="all">{t('aisales.settings.all_chat')}</Option>
                    </Select>
                  </div>
                </div>
                
                {replyStrategy.chatType !== 'private' && (
                  <div style={{ marginBottom: 24 }}>
                    <Space>
                      <Switch
                        checked={replyStrategy.groupAtOnly}
                        onChange={(checked) => setReplyStrategy(prev => ({ ...prev, groupAtOnly: checked }))}
                      />
                      <Text>
                        {replyStrategy.groupAtOnly ? 
                          t('aisales.settings.group_at_only') : 
                          t('aisales.settings.all_messages')
                        }
                      </Text>
                    </Space>
                  </div>
                )}
              </Col>
              
              <Col span={12}>
                <div style={{ marginBottom: 24 }}>
                  <Text strong>{t('aisales.settings.keyword_trigger')}</Text>
                  <div style={{ marginTop: 8 }}>
                    <Space wrap>
                      {replyStrategy.keywords.map(keyword => (
                        <Tag
                          key={keyword}
                          closable
                          onClose={() => removeKeyword(keyword)}
                        >
                          {keyword}
                        </Tag>
                      ))}
                      
                      {keywordInputVisible ? (
                        <Input
                          size="small"
                          style={{ width: 100 }}
                          value={keywordInputValue}
                          onChange={(e) => setKeywordInputValue(e.target.value)}
                          onPressEnter={addKeyword}
                          onBlur={addKeyword}
                          autoFocus
                        />
                      ) : (
                        <Tag
                          onClick={() => setKeywordInputVisible(true)}
                          style={{ borderStyle: 'dashed' }}
                        >
                          <PlusOutlined /> {t('aisales.settings.add_keyword')}
                        </Tag>
                      )}
                    </Space>
                  </div>
                </div>
              </Col>
            </Row>
            
            <Divider />
            
            <Button 
              type="primary" 
              icon={<SaveOutlined />}
              loading={loading}
              onClick={saveStrategyConfig}
            >
              {t('aisales.settings.save_strategy_config')}
            </Button>
          </Card>
        </TabPane>
        
        {/* 自动化任务 */}
        <TabPane tab={t('aisales.automation.friend_request')} key="automation">
          <Card>
            <Row gutter={24}>
              <Col span={12}>
                <div style={{ marginBottom: 24 }}>
                  <Space>
                    <Switch
                      checked={tasks.friendRequest.enabled}
                      onChange={(checked) => setTasks(prev => ({
                        ...prev,
                        friendRequest: { ...prev.friendRequest, enabled: checked }
                      }))}
                    />
                    <Text strong>{t('aisales.automation.friend_request')}</Text>
                  </Space>
                </div>
                
                <div style={{ marginBottom: 24 }}>
                  <Text>{t('aisales.automation.daily_limit')}</Text>
                  <div style={{ marginTop: 8 }}>
                    <InputNumber
                      min={1}
                      max={100}
                      value={tasks.friendRequest.maxFriendsPerDay}
                      onChange={(value) => setTasks(prev => ({
                        ...prev,
                        friendRequest: { ...prev.friendRequest, maxFriendsPerDay: value || 20 }
                      }))}
                    />
                    <Text type="secondary" style={{ marginLeft: 8 }}>
                      {t('aisales.automation.daily_limit_help')}
                    </Text>
                  </div>
                </div>
              </Col>
              
              <Col span={12}>
                <div style={{ marginBottom: 24 }}>
                  <Space>
                    <Switch
                      checked={autoLike}
                      onChange={setAutoLike}
                    />
                    <Text strong>{t('aisales.automation.auto_like')}</Text>
                  </Space>
                </div>
                
                <div style={{ marginBottom: 24 }}>
                  <Text>{t('aisales.automation.auto_like_limit')}</Text>
                  <div style={{ marginTop: 8 }}>
                    <InputNumber
                      min={1}
                      max={50}
                      value={autoLikeLimit}
                      onChange={(value) => setAutoLikeLimit(value || 10)}
                    />
                  </div>
                </div>
                
                <div style={{ marginBottom: 24 }}>
                  <Text>{t('aisales.automation.interaction_frequency')}</Text>
                  <div style={{ marginTop: 8 }}>
                    <Select
                      value={autoLikeFrequency}
                      onChange={setAutoLikeFrequency}
                      style={{ width: 120 }}
                    >
                      <Option value="low">{t('aisales.automation.frequency_low')}</Option>
                      <Option value="medium">{t('aisales.automation.frequency_medium')}</Option>
                      <Option value="high">{t('aisales.automation.frequency_high')}</Option>
                    </Select>
                  </div>
                </div>
              </Col>
            </Row>
          </Card>
        </TabPane>
      </Tabs>
    </div>
  )
}

export default AISalesSettings
