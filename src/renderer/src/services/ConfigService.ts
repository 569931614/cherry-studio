/**
 * 配置服务 - 管理应用配置
 */

export interface AppConfig {
  activation: {
    baseUrl: string // 授权服务器地址
    timeout: number // 请求超时时间（毫秒）
    retryCount: number // 重试次数
    // 授权码数据
    authCode?: string
    machineCode?: string
    userInfo?: any
    timestamp?: number
    version?: string
  }
  general: {
    language: string
    theme: string
  }
}

export const DEFAULT_CONFIG: AppConfig = {
  activation: {
    baseUrl: 'http://localhost:3000',
    timeout: 10000,
    retryCount: 3
  },
  general: {
    language: 'zh-CN',
    theme: 'auto'
  }
}

export class ConfigService {
  private static instance: ConfigService
  private config: AppConfig = DEFAULT_CONFIG
  private readonly configFileName = 'boku_ai_config.json'

  private constructor() {}

  static getInstance(): ConfigService {
    if (!ConfigService.instance) {
      ConfigService.instance = new ConfigService()
    }
    return ConfigService.instance
  }

  /**
   * 初始化配置服务
   */
  async initialize(): Promise<void> {
    try {
      await this.loadConfig()
      console.log('配置服务初始化完成，激活数据:', this.getActivationData())
    } catch (error) {
      console.warn('配置加载失败，使用默认配置:', error)
      this.config = { ...DEFAULT_CONFIG }
      await this.saveConfig()
    }
  }

  /**
   * 获取完整配置
   */
  getConfig(): AppConfig {
    return { ...this.config }
  }

  /**
   * 获取激活配置
   */
  getActivationConfig() {
    return { ...this.config.activation }
  }

  /**
   * 更新激活配置
   */
  async updateActivationConfig(activationConfig: Partial<AppConfig['activation']>): Promise<void> {
    this.config.activation = {
      ...this.config.activation,
      ...activationConfig
    }
    await this.saveConfig()
  }

  /**
   * 获取通用配置
   */
  getGeneralConfig() {
    return { ...this.config.general }
  }

  /**
   * 更新通用配置
   */
  async updateGeneralConfig(generalConfig: Partial<AppConfig['general']>): Promise<void> {
    this.config.general = {
      ...this.config.general,
      ...generalConfig
    }
    await this.saveConfig()
  }

  /**
   * 保存授权码数据
   */
  async saveActivationData(authCode: string, machineCode: string, userInfo: any): Promise<void> {
    this.config.activation = {
      ...this.config.activation,
      authCode,
      machineCode,
      userInfo,
      timestamp: Date.now(),
      version: '1.0'
    }
    await this.saveConfig()
  }

  /**
   * 获取授权码数据
   */
  getActivationData(): { authCode: string | null; machineCode: string | null; userInfo?: any } {
    return {
      authCode: this.config.activation.authCode || null,
      machineCode: this.config.activation.machineCode || null,
      userInfo: this.config.activation.userInfo
    }
  }

  /**
   * 清除授权码数据
   */
  async clearActivationData(): Promise<void> {
    this.config.activation = {
      ...this.config.activation,
      authCode: undefined,
      machineCode: undefined,
      userInfo: undefined,
      timestamp: undefined,
      version: undefined
    }
    await this.saveConfig()
  }

  /**
   * 重置配置为默认值
   */
  async resetConfig(): Promise<void> {
    this.config = { ...DEFAULT_CONFIG }
    await this.saveConfig()
  }

  /**
   * 从文件加载配置
   */
  private async loadConfig(): Promise<void> {
    try {
      const content = await window.api.projectFile.read(this.configFileName)
      if (content) {
        const loadedConfig = JSON.parse(content)
        // 合并配置，确保新增的配置项有默认值
        this.config = this.mergeConfig(DEFAULT_CONFIG, loadedConfig)
      } else {
        this.config = { ...DEFAULT_CONFIG }
      }
    } catch (error) {
      this.config = { ...DEFAULT_CONFIG }
    }
  }

  /**
   * 保存配置到文件
   */
  private async saveConfig(): Promise<void> {
    try {
      const content = JSON.stringify(this.config, null, 2)
      await window.api.projectFile.write(this.configFileName, content)
    } catch (error) {
      console.error('保存配置失败:', error)
      throw new Error('保存配置失败')
    }
  }

  /**
   * 深度合并配置对象
   */
  private mergeConfig(defaultConfig: AppConfig, userConfig: any): AppConfig {
    const result = { ...defaultConfig }
    
    for (const key in userConfig) {
      if (userConfig.hasOwnProperty(key)) {
        if (typeof userConfig[key] === 'object' && userConfig[key] !== null && !Array.isArray(userConfig[key])) {
          result[key] = {
            ...result[key],
            ...userConfig[key]
          }
        } else {
          result[key] = userConfig[key]
        }
      }
    }
    
    return result
  }

  /**
   * 验证配置有效性
   */
  validateConfig(config: Partial<AppConfig>): { isValid: boolean; errors: string[] } {
    const errors: string[] = []

    if (config.activation?.baseUrl) {
      try {
        new URL(config.activation.baseUrl)
      } catch {
        errors.push('授权服务器地址格式无效')
      }
    }

    if (config.activation?.timeout && (config.activation.timeout < 1000 || config.activation.timeout > 60000)) {
      errors.push('请求超时时间应在1-60秒之间')
    }

    if (config.activation?.retryCount && (config.activation.retryCount < 0 || config.activation.retryCount > 10)) {
      errors.push('重试次数应在0-10次之间')
    }

    return {
      isValid: errors.length === 0,
      errors
    }
  }
}

// 导出单例实例
export const configService = ConfigService.getInstance()
