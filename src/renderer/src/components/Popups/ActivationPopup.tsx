import { Box } from '@renderer/components/Layout'
import { TopView } from '@renderer/components/TopView'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import ActivationService from '@renderer/services/ActivationService'
import { Alert, Button, Input, Modal, Space, Typography } from 'antd'
import { useState, useEffect } from 'react'
import { KeyOutlined, SafetyCertificateOutlined } from '@ant-design/icons'

const { Title, Text, Paragraph } = Typography

interface ShowParams {
  isExpired?: boolean
  expiredMessage?: string
  onSuccess?: () => void
}

interface Props extends ShowParams {
  resolve: (success: boolean) => void
}

const ActivationPopupContainer: React.FC<Props> = ({ isExpired, expiredMessage, onSuccess, resolve }) => {
  const [open, setOpen] = useState(true)
  const [activationCode, setActivationCode] = useState('')
  const dispatch = useAppDispatch()
  const { isActivating, error, machineCode } = useAppSelector((state) => state.activation)
  const [activationService] = useState(() => new ActivationService(dispatch))

  useEffect(() => {
    // 生成机器码
    activationService.generateMachineCode().catch(console.error)
  }, [activationService])

  const handleActivate = async () => {
    if (!activationCode.trim()) {
      return
    }

    const success = await activationService.activate(activationCode.trim())

    if (success) {
      setOpen(false)
      onSuccess?.()
      // 从 TopView 中移除弹窗
      TopView.hide(TopViewKey)
      resolve(true)
    }
  }

  // 移除取消功能，强制用户必须激活
  const onAfterClose = () => {
    // 不允许关闭弹窗，保持激活状态
  }

  return (
    <Modal
      title={
        <Space>
          <SafetyCertificateOutlined style={{ color: isExpired ? '#ff4d4f' : '#1890ff' }} />
          <span>{isExpired ? '授权码已过期' : '软件激活'}</span>
        </Space>
      }
      open={open}
      onCancel={() => {}} // 禁用取消功能
      afterClose={onAfterClose}
      transitionName="animation-move-down"
      centered
      width={500}
      footer={[
        <Button
          key="activate"
          type="primary"
          loading={isActivating}
          onClick={handleActivate}
          disabled={!activationCode.trim()}
          style={{ width: '100%' }}
        >
          激活
        </Button>
      ]}
      closable={false}
      maskClosable={false}
      keyboard={false} // 禁用ESC键关闭
      zIndex={10000} // 设置更高的 z-index
      mask={false} // 禁用 Modal 自带的遮罩，使用 TopView 的遮罩
      getContainer={false} // 不使用 Portal，直接在当前容器中渲染
      style={{ zIndex: 10000 }}
    >
      <Box mb={16}>
        <Title level={4} style={{ marginBottom: 8 }}>
          {isExpired ? '重新激活 博库AI' : '欢迎使用 博库AI'}
        </Title>
        <Paragraph type="secondary">
          {isExpired
            ? '您的授权码已过期，请输入新的激活码来重新激活软件。'
            : '请输入您的激活码来激活软件。激活后您将能够使用所有功能。'
          }
        </Paragraph>
      </Box>

      {isExpired && expiredMessage && (
        <Box mb={16}>
          <Alert
            message="授权码已过期"
            description={expiredMessage}
            type="warning"
            showIcon
            closable={false}
          />
        </Box>
      )}

      {error && (
        <Box mb={16}>
          <Alert
            message="激活失败"
            description={error}
            type="error"
            showIcon
            closable
          />
        </Box>
      )}

      <Box mb={16}>
        <Text strong>激活码</Text>
        <Input
          size="large"
          placeholder="请输入激活码"
          value={activationCode}
          onChange={(e) => setActivationCode(e.target.value)}
          prefix={<KeyOutlined />}
          onPressEnter={handleActivate}
          disabled={isActivating}
          style={{ marginTop: 8 }}
        />
      </Box>

      {machineCode && (
        <Box mb={16}>
          <Alert
            message="机器码信息"
            description={
              <div>
                <Text>您的机器码：</Text>
                <Text code copyable style={{ marginLeft: 8 }}>
                  {machineCode}
                </Text>
                <br />
                <Text type="secondary" style={{ fontSize: '12px' }}>
                  如需帮助，请联系技术支持并提供此机器码
                </Text>
              </div>
            }
            type="info"
            showIcon
          />
        </Box>
      )}

      <Box>
        <Paragraph type="secondary" style={{ fontSize: '12px', margin: 0 }}>
          • 激活码将与当前设备绑定，请妥善保管<br />
          • 如遇问题请联系技术支持<br />
          • 激活后软件将自动验证授权状态
        </Paragraph>
      </Box>
    </Modal>
  )
}

const TopViewKey = 'ActivationPopup'

export default class ActivationPopup {
  static topviewId = 0
  static hide() {
    // 禁用隐藏功能，强制用户必须激活
  }
  static show(params: ShowParams = {}) {
    return new Promise<boolean>((resolve) => {
      try {
        TopView.show(<ActivationPopupContainer {...params} resolve={resolve} />, TopViewKey)
      } catch (error) {
        console.error('激活弹窗显示失败:', error)
        resolve(false)
      }
    })
  }
}
