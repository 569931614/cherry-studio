import { useEffect, useState } from 'react'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import ActivationService from '@renderer/services/ActivationService'
import ActivationPopup from '@renderer/components/Popups/ActivationPopup'
import { useSettings } from './useSettings'

// 全局标志，防止重复初始化
let isInitialized = false

export function useActivation() {
  const dispatch = useAppDispatch()
  const { isActivated, isChecking } = useAppSelector((state) => state.activation)
  const { activationValidationInterval } = useSettings()
  const [activationService] = useState(() => new ActivationService(dispatch))
  const [hasCheckedOnStartup, setHasCheckedOnStartup] = useState(false)

  // 应用启动时检查激活状态
  useEffect(() => {
    if (!hasCheckedOnStartup) {
      setHasCheckedOnStartup(true)
      checkActivationOnStartup()
    }
  }, [hasCheckedOnStartup])

  // 监听验证间隔变化
  useEffect(() => {
    const interval = activationValidationInterval || 2 // 默认2分钟
    activationService.setValidationInterval(interval)
  }, [activationValidationInterval, activationService])

  // 组件卸载时停止定期验证
  useEffect(() => {
    return () => {
      activationService.stopPeriodicValidation()
    }
  }, [activationService])

  const checkActivationOnStartup = async () => {
    try {
      const result = await activationService.checkActivationStatus()

      if (!result.isValid) {
        // 未激活或已过期，显示激活弹窗
        showActivationPopup(result.isExpired, result.message)
      }
    } catch (error) {
      console.error('检查激活状态失败:', error)
      // 检查失败也显示激活弹窗
      showActivationPopup(false, '检查激活状态时发生错误')
    }
  }

  const showActivationPopup = async (isExpired: boolean = false, message?: string) => {
    try {
      const success = await ActivationPopup.show({
        isExpired,
        expiredMessage: message,
        onSuccess: () => {
          // 激活成功回调
        }
      })

      if (!success) {
        // 激活失败时重新显示弹窗，不允许跳过
        setTimeout(() => showActivationPopup(isExpired, message), 1000)
      }
    } catch (error) {
      console.error('显示激活弹窗失败:', error)
      // 出错时也重新显示弹窗
      setTimeout(() => showActivationPopup(isExpired, message), 2000)
    }
  }

  const manualActivate = async (activationCode: string) => {
    return await activationService.activate(activationCode)
  }

  const recheckActivation = async () => {
    const result = await activationService.checkActivationStatus()
    return result.isValid
  }

  return {
    isActivated,
    isChecking,
    showActivationPopup,
    manualActivate,
    recheckActivation
  }
}
