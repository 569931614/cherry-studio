import React, { useState, useEffect } from 'react'
import {
  Button,
  Input,
  Card,
  List,
  Checkbox,
  Slider,
  Space,
  Typography,
  Row,
  Col,
  Select,
  App,
  Progress,
  Tabs,
  Empty
} from 'antd'
import {
  SendOutlined,
  UserOutlined,
  TeamOutlined,
  SearchOutlined,
  ClockCircleOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

const { TextArea } = Input
const { Title, Text } = Typography
const { Option } = Select
const { TabPane } = Tabs

interface Contact {
  id: string
  name: string
  type: 'friend' | 'group'
  wxid?: string
  member_count?: number
}

const BulkSendPage: React.FC = () => {
  const { t } = useTranslation()
  const { message } = App.useApp()
  
  // 状态管理
  const [bulkMessage, setBulkMessage] = useState('')
  const [selectedBulkContacts, setSelectedBulkContacts] = useState<string[]>([])
  const [contactsFilter, setContactsFilter] = useState<'friends' | 'groups'>('friends')
  const [bulkSearchQuery, setBulkSearchQuery] = useState('')
  const [delayRange, setDelayRange] = useState<[number, number]>([2, 5])
  const [sendingBulk, setSendingBulk] = useState(false)
  const [bulkSendStatus, setBulkSendStatus] = useState('')
  const [sendProgress, setSendProgress] = useState(0)
  
  // 联系人数据
  const [contacts, setContacts] = useState<{
    friends: Contact[]
    groups: Contact[]
  }>({
    friends: [],
    groups: []
  })
  
  // 初始化
  useEffect(() => {
    loadContacts()
    loadGroups()
  }, [])
  
  // 计算属性
  const filteredBulkContacts = React.useMemo(() => {
    const contactList = contactsFilter === 'friends' ? contacts.friends : contacts.groups
    if (!contactList) return []
    
    if (bulkSearchQuery) {
      return contactList.filter(contact => 
        contact.name.toLowerCase().includes(bulkSearchQuery.toLowerCase())
      )
    }
    return contactList
  }, [contactsFilter, contacts, bulkSearchQuery])
  
  const canSendBulk = React.useMemo(() => {
    return bulkMessage.trim() && selectedBulkContacts.length > 0
  }, [bulkMessage, selectedBulkContacts])
  
  // API调用函数
  const loadContacts = async () => {
    try {
      const response = await fetch('/api/contacts/friends')
      const data = await response.json()
      if (data.success && data.data && data.data.contacts) {
        setContacts(prev => ({ ...prev, friends: data.data.contacts }))
      }
    } catch (error) {
      console.error('加载联系人失败:', error)
    }
  }

  const loadGroups = async () => {
    try {
      const response = await fetch('/api/contacts/groups')
      const data = await response.json()
      if (data.success && data.data && data.data.groups) {
        setContacts(prev => ({ ...prev, groups: data.data.groups }))
      }
    } catch (error) {
      console.error('加载群组失败:', error)
    }
  }

  const startBulkSend = async () => {
    if (!canSendBulk) return

    try {
      setSendingBulk(true)
      setBulkSendStatus('正在发送...')
      setSendProgress(0)
      
      const response = await fetch('/api/messages/bulk_send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: bulkMessage,
          contacts: selectedBulkContacts,
          delay_range: delayRange
        })
      })
      const data = await response.json()
      if (data.success) {
        setBulkSendStatus(`成功发送给 ${selectedBulkContacts.length} 个联系人`)
        setSendProgress(100)
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

  const handleSelectAll = () => {
    const allIds = filteredBulkContacts.map(contact => contact.id)
    setSelectedBulkContacts(allIds)
  }

  const handleDeselectAll = () => {
    setSelectedBulkContacts([])
  }

  const handleContactSelect = (contactId: string, checked: boolean) => {
    if (checked) {
      setSelectedBulkContacts(prev => [...prev, contactId])
    } else {
      setSelectedBulkContacts(prev => prev.filter(id => id !== contactId))
    }
  }

  return (
    <div className="bulk-send-page">
      <div className="page-header">
        <Title level={2}>{t('aisales.bulk_send.title')}</Title>
        <Text type="secondary">{t('aisales.bulk_send.description')}</Text>
      </div>
      
      <Row gutter={24}>
        {/* 左侧：消息编辑区 */}
        <Col span={12}>
          <Card title={t('aisales.bulk_send.message_content')}>
            <TextArea
              value={bulkMessage}
              onChange={(e) => setBulkMessage(e.target.value)}
              placeholder={t('aisales.bulk_send.message_placeholder')}
              autoSize={{ minRows: 6, maxRows: 12 }}
              showCount
              maxLength={1000}
            />
            
            <div style={{ marginTop: 16 }}>
              <Text strong>{t('aisales.bulk_send.delay_settings')}</Text>
              <div style={{ marginTop: 8 }}>
                <Slider
                  range
                  min={1}
                  max={10}
                  value={delayRange}
                  onChange={setDelayRange}
                  marks={{
                    1: '1s',
                    5: '5s',
                    10: '10s'
                  }}
                />
                <Text type="secondary" style={{ fontSize: '12px' }}>
                  {t('aisales.bulk_send.delay_tip')}
                </Text>
              </div>
            </div>
          </Card>
        </Col>
        
        {/* 右侧：联系人选择区 */}
        <Col span={12}>
          <Card 
            title={t('aisales.bulk_send.select_recipients')}
            extra={
              <Space>
                <Text type="secondary">
                  {t('aisales.bulk_send.selected_count', { count: selectedBulkContacts.length })}
                </Text>
              </Space>
            }
          >
            <div style={{ marginBottom: 16 }}>
              <Space>
                <Select
                  value={contactsFilter}
                  onChange={setContactsFilter}
                  style={{ width: 120 }}
                >
                  <Option value="friends">{t('aisales.bulk_send.friends')}</Option>
                  <Option value="groups">{t('aisales.bulk_send.groups')}</Option>
                </Select>
                
                <Input
                  placeholder={t('aisales.bulk_send.search')}
                  prefix={<SearchOutlined />}
                  value={bulkSearchQuery}
                  onChange={(e) => setBulkSearchQuery(e.target.value)}
                  style={{ width: 200 }}
                />
              </Space>
            </div>
            
            <div style={{ marginBottom: 16 }}>
              <Space>
                <Button size="small" onClick={handleSelectAll}>
                  {t('aisales.bulk_send.select_all')}
                </Button>
                <Button size="small" onClick={handleDeselectAll}>
                  {t('aisales.bulk_send.deselect_all')}
                </Button>
              </Space>
            </div>
            
            <div style={{ height: 400, overflow: 'auto' }}>
              {filteredBulkContacts.length === 0 ? (
                <Empty description="暂无联系人" />
              ) : (
                <List
                  dataSource={filteredBulkContacts}
                  renderItem={(contact) => (
                    <List.Item>
                      <Checkbox
                        checked={selectedBulkContacts.includes(contact.id)}
                        onChange={(e) => handleContactSelect(contact.id, e.target.checked)}
                      >
                        <Space>
                          {contact.type === 'friend' ? <UserOutlined /> : <TeamOutlined />}
                          <span>{contact.name}</span>
                          {contact.type === 'group' && contact.member_count && (
                            <Text type="secondary">({contact.member_count}人)</Text>
                          )}
                        </Space>
                      </Checkbox>
                    </List.Item>
                  )}
                />
              )}
            </div>
          </Card>
        </Col>
      </Row>
      
      {/* 发送控制区 */}
      <Card style={{ marginTop: 24 }}>
        <Row justify="space-between" align="middle">
          <Col>
            <Space direction="vertical">
              <Text strong>发送状态</Text>
              {sendingBulk && (
                <Progress 
                  percent={sendProgress} 
                  status={sendProgress === 100 ? 'success' : 'active'}
                  size="small"
                />
              )}
              {bulkSendStatus && (
                <Text type={bulkSendStatus.includes('成功') ? 'success' : 'danger'}>
                  {bulkSendStatus}
                </Text>
              )}
            </Space>
          </Col>
          
          <Col>
            <Space>
              <Button 
                icon={<ClockCircleOutlined />}
                disabled={!canSendBulk || sendingBulk}
              >
                {t('aisales.bulk_send.scheduled_send')}
              </Button>
              
              <Button 
                type="primary"
                icon={<SendOutlined />}
                loading={sendingBulk}
                disabled={!canSendBulk}
                onClick={startBulkSend}
              >
                {sendingBulk ? t('aisales.bulk_send.sending') : t('aisales.bulk_send.start_bulk_send')}
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>
    </div>
  )
}

export default BulkSendPage
