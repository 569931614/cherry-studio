/**
 * Z-Index 层级常量
 * 统一管理应用中所有组件的 z-index 值，避免层级冲突
 */

export const Z_INDEX = {
  // 基础层级
  BASE: 1,
  
  // 普通内容层
  CONTENT: 10,
  
  // 悬浮元素
  DROPDOWN: 1000,
  TOOLTIP: 1001,
  POPOVER: 1002,
  
  // 弹窗层级
  MODAL_BASE: 10000,
  MODAL_POPUP: 10001,
  MODAL_ASSISTANT: 10002,
  
  // TopView 层级
  TOPVIEW_CONTAINER: 9998,
  TOPVIEW_MASK: 9999,
  TOPVIEW_CONTENT: 10003,
  
  // 特殊弹窗
  ACTIVATION_POPUP: 10000,
  NOTIFICATION: 10004,
  
  // 最高层级
  LOADING: 10005,
  DEBUG: 10006
} as const

/**
 * 弹窗类型对应的 z-index 值
 */
export const POPUP_Z_INDEX = {
  // 通用弹窗
  SEARCH: Z_INDEX.MODAL_POPUP,
  PROMPT: Z_INDEX.MODAL_POPUP,
  USER: Z_INDEX.MODAL_POPUP,
  TEMPLATE: Z_INDEX.MODAL_POPUP,
  
  // 智能体相关
  ADD_ASSISTANT: Z_INDEX.MODAL_ASSISTANT,
  SELECT_MODEL: Z_INDEX.MODAL_ASSISTANT,
  
  // 知识库相关
  KNOWLEDGE_SEARCH: Z_INDEX.MODAL_POPUP,
  
  // 设置相关
  EDIT_MODELS: Z_INDEX.MODAL_POPUP,
  
  // 特殊弹窗
  ACTIVATION: Z_INDEX.ACTIVATION_POPUP
} as const

/**
 * 获取弹窗的通用配置
 * @param popupType 弹窗类型
 * @returns Modal 组件的通用配置
 */
export function getPopupConfig(popupType: keyof typeof POPUP_Z_INDEX) {
  return {
    zIndex: POPUP_Z_INDEX[popupType],
    getContainer: false, // 不使用 Portal，直接在当前容器中渲染
    mask: false // 禁用 Modal 自带的遮罩，使用 TopView 的遮罩
  }
}

/**
 * 弹窗类型枚举
 */
export enum PopupType {
  SEARCH = 'SEARCH',
  PROMPT = 'PROMPT',
  USER = 'USER',
  TEMPLATE = 'TEMPLATE',
  ADD_ASSISTANT = 'ADD_ASSISTANT',
  SELECT_MODEL = 'SELECT_MODEL',
  KNOWLEDGE_SEARCH = 'KNOWLEDGE_SEARCH',
  EDIT_MODELS = 'EDIT_MODELS',
  ACTIVATION = 'ACTIVATION'
}

/**
 * 检查 z-index 是否冲突
 * @param zIndex1 第一个 z-index 值
 * @param zIndex2 第二个 z-index 值
 * @returns 是否存在冲突
 */
export function hasZIndexConflict(zIndex1: number, zIndex2: number): boolean {
  return zIndex1 === zIndex2
}

/**
 * 获取下一个可用的 z-index 值
 * @param baseZIndex 基础 z-index 值
 * @param usedZIndexes 已使用的 z-index 值数组
 * @returns 下一个可用的 z-index 值
 */
export function getNextAvailableZIndex(baseZIndex: number, usedZIndexes: number[]): number {
  let nextZIndex = baseZIndex
  while (usedZIndexes.includes(nextZIndex)) {
    nextZIndex++
  }
  return nextZIndex
}

/**
 * 验证 z-index 配置是否正确
 * @returns 验证结果
 */
export function validateZIndexConfig(): { isValid: boolean; conflicts: string[] } {
  const conflicts: string[] = []
  const usedValues: { [key: number]: string[] } = {}
  
  // 检查 POPUP_Z_INDEX 中的冲突
  Object.entries(POPUP_Z_INDEX).forEach(([key, value]) => {
    if (!usedValues[value]) {
      usedValues[value] = []
    }
    usedValues[value].push(`POPUP_Z_INDEX.${key}`)
  })
  
  // 检查 Z_INDEX 中的冲突
  Object.entries(Z_INDEX).forEach(([key, value]) => {
    if (!usedValues[value]) {
      usedValues[value] = []
    }
    usedValues[value].push(`Z_INDEX.${key}`)
  })
  
  // 找出冲突
  Object.entries(usedValues).forEach(([zIndex, keys]) => {
    if (keys.length > 1) {
      conflicts.push(`z-index ${zIndex} 被多个常量使用: ${keys.join(', ')}`)
    }
  })
  
  return {
    isValid: conflicts.length === 0,
    conflicts
  }
}

// 开发模式下验证配置
if (process.env.NODE_ENV === 'development') {
  const validation = validateZIndexConfig()
  if (!validation.isValid) {
    console.warn('⚠️ Z-Index 配置存在冲突:')
    validation.conflicts.forEach(conflict => console.warn(`  - ${conflict}`))
  } else {
    console.log('✅ Z-Index 配置验证通过')
  }
}
