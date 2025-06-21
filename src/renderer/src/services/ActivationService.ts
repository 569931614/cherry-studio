import { AppDispatch } from '@renderer/store'
import {
  activateSuccess,
  setActivating,
  setActivationStatus,
  setChecking,
  setError,
  setMachineCode
} from '@renderer/store/activation'
import { configService } from './ConfigService'

export interface ActivationResponse {
  success: boolean
  message: string
  challenge?: string
  timestamp?: number
  expires_in?: number
  data?: {
    auth_code: string
    machine_code: string
    status: number
    bind_time?: number
    valid?: boolean
    user_type?: number
    expired_time?: number
    is_bot?: boolean
    wx_auto_x_code?: string
    groups?: string[]
  }
}

export class ActivationService {
  private dispatch: AppDispatch
  private validationTimer: NodeJS.Timeout | null = null
  private validationInterval: number = 60 * 60 * 1000 // 1小时检查一次

  constructor(dispatch: AppDispatch) {
    this.dispatch = dispatch
  }

  /**
   * 获取当前配置的授权服务器地址
   */
  private getBaseUrl(): string {
    return configService.getActivationConfig().baseUrl
  }

  /**
   * 生成机器码
   */
  async generateMachineCode(): Promise<string> {
    try {
      // 获取系统信息
      const deviceType = await window.api.system.getDeviceType()
      const hostname = await window.api.system.getHostname()
      const appInfo = await window.api.getAppInfo()
      
      // 组合机器信息
      const machineInfo = [
        deviceType,
        hostname,
        appInfo.arch,
        navigator.userAgent,
        navigator.platform,
        navigator.language
      ].join('-')

      // 生成哈希
      let hash = 0
      for (let i = 0; i < machineInfo.length; i++) {
        const char = machineInfo.charCodeAt(i)
        hash = ((hash << 5) - hash) + char
        hash = hash & hash // 转换为32位整数
      }

      const machineCode = Math.abs(hash).toString(16).toUpperCase()
      this.dispatch(setMachineCode(machineCode))
      return machineCode
    } catch (error) {
      console.error('生成机器码失败:', error)
      throw new Error('生成机器码失败')
    }
  }

  /**
   * 绑定机器码
   */
  async bindMachineCode(authCode: string, machineCode: string): Promise<ActivationResponse> {
    try {
      console.log('调用绑定接口，授权码:', authCode, '机器码:', machineCode)
      const response = await fetch(`${this.getBaseUrl()}/api/auth/bind`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          auth_code: authCode,
          machine_code: machineCode
        })
      })

      const result = await response.json()
      console.log('绑定接口响应:', result)
      return result
    } catch (error) {
      console.error('绑定机器码失败:', error)
      throw new Error('绑定机器码失败')
    }
  }

  /**
   * 计算SHA256哈希
   */
  private async sha256(message: string): Promise<string> {
    const msgBuffer = new TextEncoder().encode(message)
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
    return hashHex
  }

  /**
   * 验证授权码（支持挑战-响应机制）
   */
  async validateAuthCode(authCode: string, machineCode: string): Promise<ActivationResponse> {
    try {
      console.log('调用验证接口，授权码:', authCode, '机器码:', machineCode)

      // 第一步：获取挑战
      let response = await fetch(`${this.getBaseUrl()}/api/auth/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          auth_code: authCode,
          machine_code: machineCode
        })
      })

      let result = await response.json()
      console.log('验证接口第一步响应:', result)

      // 如果返回了挑战，需要计算响应
      if (result.challenge && result.timestamp) {
        console.log('收到挑战，计算响应...')
        const challengeResponse = await this.sha256(result.challenge)
        console.log('挑战响应计算完成:', challengeResponse)

        // 第二步：提交挑战响应
        response = await fetch(`${this.getBaseUrl()}/api/auth/validate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            auth_code: authCode,
            machine_code: machineCode,
            challenge: result.challenge,
            response: challengeResponse
          })
        })

        result = await response.json()
        console.log('验证接口第二步响应:', result)
      }

      return result
    } catch (error) {
      console.error('验证授权码失败:', error)
      throw new Error('验证授权码失败')
    }
  }

  /**
   * 执行激活流程
   */
  async activate(authCode: string): Promise<boolean> {
    this.dispatch(setActivating(true))
    this.dispatch(setError(null))

    try {
      // 生成机器码
      const machineCode = await this.generateMachineCode()

      // 首先尝试绑定机器码
      console.log('步骤1: 尝试绑定机器码')
      let result = await this.bindMachineCode(authCode, machineCode)

      if (result.success) {
        console.log('步骤2: 绑定成功，进行验证')
        // 绑定成功后进行验证
        const validateResult = await this.validateAuthCode(authCode, machineCode)
        console.log('验证结果:', validateResult)

        if (validateResult.success && validateResult.data) {
          console.log('验证成功，使用验证结果的数据')
          // 使用验证结果的数据，因为它包含完整的用户信息
          result = validateResult
        } else if (validateResult.success) {
          console.log('验证成功但没有data，使用验证结果')
          result = validateResult
        } else {
          console.log('验证失败，但绑定已成功，使用绑定结果')
          // 如果验证失败但绑定成功，我们仍然可以保存基本信息
          // 保持原来的绑定结果
        }
      } else {
        console.log('步骤2: 绑定失败，错误信息:', result.message)
      }

      console.log('最终激活结果:', result)

      if (result.success) {
        console.log('激活成功，准备保存数据')

        // 激活成功
        const userInfo = result.data ? {
          user_type: result.data.user_type,
          expired_time: result.data.expired_time,
          groups: result.data.groups
        } : {}

        this.dispatch(activateSuccess({
          activationCode: authCode,
          userInfo
        }))

        // 保存到配置文件 - 即使没有完整的data也要保存基本信息
        await configService.saveActivationData(authCode, machineCode, result.data || { auth_code: authCode, machine_code: machineCode })

        console.log('激活数据已保存到本地存储')

        // 启动定期验证
        this.startPeriodicValidation()

        return true
      } else {
        console.log('激活失败，错误信息:', result.message)
        const errorMsg = result.message || '激活失败'
        this.dispatch(setError(errorMsg))
        return false
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '激活过程中发生错误'
      this.dispatch(setError(errorMsg))
      return false
    } finally {
      this.dispatch(setActivating(false))
    }
  }

  /**
   * 检查激活状态
   */
  async checkActivationStatus(): Promise<{ isValid: boolean; isExpired: boolean; message?: string }> {
    this.dispatch(setChecking(true))
    this.dispatch(setError(null))

    try {
      const savedData = configService.getActivationData()
      console.log('读取到的激活数据:', savedData)

      if (!savedData.authCode || !savedData.machineCode) {
        console.log('未找到本地激活数据 - authCode:', savedData.authCode, 'machineCode:', savedData.machineCode)
        return { isValid: false, isExpired: false, message: '未激活' }
      }

      console.log('检查本地激活数据有效性...')
      const result = await this.validateAuthCode(savedData.authCode, savedData.machineCode)

      if (result.success && result.data) {
        console.log('激活状态有效')
        this.dispatch(activateSuccess({
          activationCode: savedData.authCode,
          userInfo: {
            user_type: result.data.user_type,
            expired_time: result.data.expired_time,
            groups: result.data.groups
          }
        }))

        // 启动定期验证
        this.startPeriodicValidation()

        return { isValid: true, isExpired: false }
      } else {
        console.log('激活状态无效:', result.message)

        // 判断是否是过期
        const isExpired = result.message && (
          result.message.includes('过期') ||
          result.message.includes('expired') ||
          result.message.includes('授权码已失效') ||
          result.message.includes('无效或已过期') ||
          result.message.includes('invalid') ||
          result.message.includes('Invalid')
        )

        // 过期时保留数据，下次启动时会重新校验
        // 只有在非过期的无效情况下才清除数据
        if (!isExpired) {
          console.log('非过期的无效授权码，清除激活数据')
          await configService.clearActivationData()
        } else {
          console.log('授权码已过期，保留数据供下次启动校验')
        }

        return {
          isValid: false,
          isExpired: isExpired,
          message: isExpired ? '授权码已过期' : result.message || '激活验证失败'
        }
      }
    } catch (error) {
      console.error('检查激活状态失败:', error)
      return { isValid: false, isExpired: false, message: '检查激活状态时发生错误' }
    } finally {
      this.dispatch(setChecking(false))
    }
  }









  /**
   * 启动定期验证
   */
  startPeriodicValidation() {
    // 清除现有的定时器
    this.stopPeriodicValidation()

    // 立即执行一次验证
    this.performPeriodicValidation()

    // 设置定期验证
    this.validationTimer = setInterval(() => {
      this.performPeriodicValidation()
    }, this.validationInterval)

    console.log('激活状态定期验证已启动，间隔:', this.validationInterval / 1000 / 60, '分钟')
  }

  /**
   * 停止定期验证
   */
  stopPeriodicValidation() {
    if (this.validationTimer) {
      clearInterval(this.validationTimer)
      this.validationTimer = null
      console.log('激活状态定期验证已停止')
    }
  }

  /**
   * 执行定期验证
   */
  private async performPeriodicValidation() {
    try {
      const savedData = configService.getActivationData()
      if (!savedData.authCode || !savedData.machineCode) {
        console.log('未找到保存的激活数据，跳过定期验证')
        return
      }

      console.log('执行定期激活验证...')
      const result = await this.validateAuthCode(savedData.authCode, savedData.machineCode)

      if (result.success && result.data) {
        // 验证成功，更新状态
        this.dispatch(activateSuccess({
          activationCode: savedData.authCode,
          userInfo: {
            user_type: result.data.user_type,
            expired_time: result.data.expired_time,
            groups: result.data.groups
          }
        }))
        console.log('定期验证成功')
      } else {
        // 验证失败，可能是过期或其他问题
        console.warn('定期验证失败:', result.message)

        // 检查是否是过期相关的错误
        const isExpiredError = result.message && (
          result.message.includes('过期') ||
          result.message.includes('expired') ||
          result.message.includes('授权码已失效') ||
          result.message.includes('无效或已过期') ||
          result.message.includes('invalid') ||
          result.message.includes('Invalid')
        )

        if (isExpiredError) {
          this.handleActivationExpired()
        } else {
          console.log('非过期错误，继续定期验证')
        }
      }
    } catch (error) {
      console.error('定期验证过程中发生错误:', error)
      // 连续网络错误可能也需要处理
      console.log('网络错误，将在下次验证时重试')
    }
  }

  /**
   * 处理激活过期
   */
  private async handleActivationExpired() {
    console.log('🚨 激活已过期，开始处理过期逻辑...')

    // 不删除过期的激活文件，保留用于下次启动时校验
    console.log('📝 保留过期的激活文件，下次启动时会重新校验')

    // 重置激活状态
    this.dispatch(setActivationStatus(false))
    this.dispatch(setError('授权码已过期，请重新激活'))

    // 停止定期验证
    this.stopPeriodicValidation()

    console.log('🔄 准备显示激活弹窗...')

    // 使用多种方式尝试显示弹窗
    this.showActivationPopupWithRetry()
  }

  /**
   * 带重试机制的弹窗显示
   */
  private async showActivationPopupWithRetry(retryCount: number = 0) {
    const maxRetries = 3

    try {
      console.log(`🎯 尝试显示激活弹窗 (第${retryCount + 1}次)...`)

      // 动态导入激活弹窗以避免循环依赖
      const { default: ActivationPopup } = await import('@renderer/components/Popups/ActivationPopup')

      console.log('✅ 激活弹窗组件已导入')

      // 确保在主线程中执行
      await new Promise(resolve => setTimeout(resolve, 200))

      console.log('🚀 正在调用 ActivationPopup.show()...')

      const success = await ActivationPopup.show({
        isExpired: true,
        expiredMessage: '授权码已过期，请重新激活'
      })

      console.log('📊 激活弹窗显示结果:', success)

      if (success) {
        console.log('✅ 重新激活成功，重新启动定期验证')
        this.startPeriodicValidation()
      } else {
        console.log('❌ 激活失败，但弹窗已显示')
      }
    } catch (error) {
      console.error(`❌ 显示激活弹窗失败 (第${retryCount + 1}次):`, error)

      if (retryCount < maxRetries) {
        console.log(`🔄 将在2秒后重试 (${retryCount + 1}/${maxRetries})...`)
        setTimeout(() => {
          this.showActivationPopupWithRetry(retryCount + 1)
        }, 2000)
      } else {
        console.error('💥 所有重试都失败了，强制刷新页面')
        // 如果所有重试都失败，显示一个简单的确认框
        if (window.confirm('激活已过期，需要重新激活。点击确定刷新页面。')) {
          window.location.reload()
        } else {
          // 用户拒绝刷新，继续尝试
          setTimeout(() => {
            this.showActivationPopupWithRetry(0)
          }, 5000)
        }
      }
    }
  }

  /**
   * 设置验证间隔（分钟）
   */
  setValidationInterval(minutes: number) {
    this.validationInterval = minutes * 60 * 1000
    console.log('验证间隔已设置为:', minutes, '分钟')

    // 如果定期验证正在运行，重新启动以应用新间隔
    if (this.validationTimer) {
      this.startPeriodicValidation()
    }
  }

  /**
   * 获取当前验证间隔（分钟）
   */
  getValidationInterval(): number {
    return this.validationInterval / 1000 / 60
  }


}

export default ActivationService
