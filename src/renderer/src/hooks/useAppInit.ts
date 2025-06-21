import { isMac } from '@renderer/config/constant'
import { isLocalAi } from '@renderer/config/env'
import { useTheme } from '@renderer/context/ThemeProvider'
import db from '@renderer/databases'
import i18n from '@renderer/i18n'
import KnowledgeQueue from '@renderer/queue/KnowledgeQueue'
import { configService } from '@renderer/services/ConfigService'
import { useAppDispatch } from '@renderer/store'
import { setAvatar, setFilesPath, setResourcesPath, setUpdateState } from '@renderer/store/runtime'
import { delay, runAsyncFunction } from '@renderer/utils'
import { defaultLanguage } from '@shared/config/constant'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'

import { useDefaultModel } from './useAssistant'
import useFullScreenNotice from './useFullScreenNotice'
import { useRuntime } from './useRuntime'
import { useSettings } from './useSettings'
import useUpdateHandler from './useUpdateHandler'

export function useAppInit() {
  const dispatch = useAppDispatch()
  const { proxyUrl, language, windowStyle, autoCheckUpdate, proxyMode, customCss, enableDataCollection } = useSettings()
  const { minappShow } = useRuntime()
  const { setDefaultModel, setTopicNamingModel, setTranslateModel } = useDefaultModel()
  const avatar = useLiveQuery(() => db.settings.get('image://avatar'))
  const { theme } = useTheme()

  const [configInitialized, setConfigInitialized] = useState(false)

  useEffect(() => {
    document.getElementById('spinner')?.remove()

    // 安全地结束计时器
    try {
      console.timeEnd('init')
    } catch (e) {
      // 忽略计时器不存在的错误
    }

    // 初始化配置服务，等待完成后再进行激活检查
    const initializeConfig = async () => {
      try {
        await configService.initialize()
        setConfigInitialized(true)
      } catch (error) {
        console.error('配置服务初始化失败:', error)
        setConfigInitialized(true) // 即使失败也继续，使用默认配置
      }
    }

    initializeConfig()
  }, [])

  useUpdateHandler()
  useFullScreenNotice()

  // 只有在配置初始化完成后才进行激活检查
  useEffect(() => {
    if (configInitialized) {
      // 延迟一点时间确保配置完全加载
      setTimeout(async () => {
        try {
          // 动态导入 ActivationService 并进行激活检查
          const { default: ActivationService } = await import('@renderer/services/ActivationService')
          const activationService = new ActivationService(dispatch)

          // 检查激活状态
          const result = await activationService.checkActivationStatus()

          if (!result.isValid) {
            // 动态导入激活弹窗
            const { default: ActivationPopup } = await import('@renderer/components/Popups/ActivationPopup')

            // 显示激活弹窗
            await ActivationPopup.show({
              isExpired: result.isExpired,
              expiredMessage: result.message
            })
          }
        } catch (error) {
          console.error('激活检查失败:', error)
        }
      }, 100)
    }
  }, [configInitialized, dispatch])

  useEffect(() => {
    avatar?.value && dispatch(setAvatar(avatar.value))
  }, [avatar, dispatch])

  useEffect(() => {
    runAsyncFunction(async () => {
      const { isPackaged } = await window.api.getAppInfo()
      if (isPackaged && autoCheckUpdate) {
        await delay(2)
        const { updateInfo } = await window.api.checkForUpdate()
        dispatch(setUpdateState({ info: updateInfo }))
      }
    })
  }, [dispatch, autoCheckUpdate])

  useEffect(() => {
    if (proxyMode === 'system') {
      window.api.setProxy('system')
    } else if (proxyMode === 'custom') {
      proxyUrl && window.api.setProxy(proxyUrl)
    } else {
      window.api.setProxy('')
    }
  }, [proxyUrl, proxyMode])

  useEffect(() => {
    i18n.changeLanguage(language || navigator.language || defaultLanguage)
  }, [language])

  useEffect(() => {
    const transparentWindow = windowStyle === 'transparent' && isMac && !minappShow

    if (minappShow) {
      window.root.style.background =
        windowStyle === 'transparent' && isMac ? 'var(--color-background)' : 'var(--navbar-background)'
      return
    }

    window.root.style.background = transparentWindow ? 'var(--navbar-background-mac)' : 'var(--navbar-background)'
  }, [windowStyle, minappShow, theme])

  useEffect(() => {
    if (isLocalAi) {
      const model = JSON.parse(import.meta.env.VITE_RENDERER_INTEGRATED_MODEL)
      setDefaultModel(model)
      setTopicNamingModel(model)
      setTranslateModel(model)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // set files path
    window.api.getAppInfo().then((info) => {
      dispatch(setFilesPath(info.filesPath))
      dispatch(setResourcesPath(info.resourcesPath))
    })
  }, [dispatch])

  useEffect(() => {
    KnowledgeQueue.checkAllBases()
  }, [])

  useEffect(() => {
    let customCssElement = document.getElementById('user-defined-custom-css') as HTMLStyleElement
    if (customCssElement) {
      customCssElement.remove()
    }

    if (customCss) {
      customCssElement = document.createElement('style')
      customCssElement.id = 'user-defined-custom-css'
      customCssElement.textContent = customCss
      document.head.appendChild(customCssElement)
    }
  }, [customCss])

  useEffect(() => {
    // TODO: init data collection
  }, [enableDataCollection])
}
