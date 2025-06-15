import { spawn, ChildProcess, execFile } from 'child_process'
import { join } from 'path'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { app } from 'electron'
import log from 'electron-log'

export interface WxAutoResponse {
  success: boolean
  message?: string
  data?: any
}

export interface ContactInfo {
  id: string
  name: string
  type: 'friend' | 'group'
  member_count?: number
}

export interface MessageInfo {
  id: string
  content: string
  sender: string
  timestamp: string
  is_self: boolean
  message_type: string
}

export class WxAutoService {
  private pythonProcess: ChildProcess | null = null
  private isInitialized = false
  private messageHandlers: Map<string, (response: any) => void> = new Map()
  private messageId = 0
  private pythonCommand: string = 'python'
  private messageBuffer: string = '' // 添加消息缓冲区

  constructor() {
    this.setupProcessHandlers()
  }

  private setupProcessHandlers() {
    // 处理应用退出时清理Python进程
    app.on('before-quit', () => {
      this.cleanup()
    })

    process.on('exit', () => {
      this.cleanup()
    })
  }

  /**
   * 从配置文件读取 Python 路径
   */
  private loadPythonPathFromConfig(): string | null {
    try {
      const configPath = join(process.cwd(), 'python-path.json')
      if (existsSync(configPath)) {
        const config = JSON.parse(readFileSync(configPath, 'utf-8'))
        if (config.pythonCommand) {
          log.info(`Using Python from config: ${config.pythonCommand}`)
          return config.pythonCommand
        }
      }
    } catch (error) {
      log.debug('Failed to load Python path from config:', error)
    }
    return null
  }



  /**
   * 获取Python可执行文件的完整路径
   */
  private async getPythonExecutablePath(command: string): Promise<string | null> {
    return new Promise((resolve) => {
      // 使用where命令查找Python可执行文件的完整路径
      const whereCommand = process.platform === 'win32' ? 'where' : 'which'

      const child = spawn(whereCommand, [command.split(' ')[0]], {
        stdio: 'pipe',
        shell: true,
        windowsHide: true
      })

      let output = ''

      child.stdout?.on('data', (data) => {
        output += data.toString()
      })

      child.on('close', (code) => {
        if (code === 0 && output.trim()) {
          const paths = output.trim().split('\n')
          const pythonPath = paths[0].trim()
          log.info(`Found Python executable at: ${pythonPath}`)
          resolve(pythonPath)
        } else {
          resolve(null)
        }
      })

      child.on('error', () => {
        resolve(null)
      })

      setTimeout(() => {
        child.kill()
        resolve(null)
      }, 5000)
    })
  }

  /**
   * 检测最佳的 Python 版本
   */
  private async detectBestPythonVersion(): Promise<string> {
    // 强制使用系统Python 3.12（临时解决方案）
    const systemPython312 = 'C:\\Users\\56993\\AppData\\Local\\Programs\\Python\\Python312\\python.exe'
    if (existsSync(systemPython312)) {
      try {
        const version = await this.checkPythonVersion(systemPython312)
        if (version && this.isVersionCompatible(version)) {
          log.info(`Using system Python 3.12: ${systemPython312} (${version})`)
          return systemPython312
        }
      } catch (error) {
        log.warn(`System Python 3.12 failed: ${error}`)
      }
    }

    // 首先检查配置文件中的Python路径
    const configPython = this.loadPythonPathFromConfig()
    if (configPython) {
      log.info(`Found Python in config file: ${configPython}`)

      // 验证配置文件中的Python是否可用
      try {
        const version = await this.checkPythonVersion(configPython)
        if (version && this.isVersionCompatible(version)) {
          log.info(`Using Python from config: ${configPython} (${version})`)
          return configPython
        } else {
          log.warn(`Python from config is not compatible: ${configPython} (${version})`)
        }
      } catch (error) {
        log.warn(`Python from config failed: ${configPython} - ${error}`)
      }
    }

    // 如果配置文件中的Python不可用，则使用默认检测逻辑
    const pythonCommands = [
      'py -3.12',  // 首选Python 3.12
      'py -3.11',  // 备选Python 3.11
      'py -3.10',  // 备选Python 3.10
      'py',        // 默认Python版本
      'python',    // 系统Python
      'python3'    // Unix风格命令
    ]

    log.info('Testing Python commands in order of preference...')

    for (const command of pythonCommands) {
      try {
        log.info(`Testing Python command: ${command}`)
        const version = await this.checkPythonVersion(command)
        if (version && this.isVersionCompatible(version)) {
          log.info(`Found compatible Python: ${command} (${version})`)

          // 尝试获取完整的可执行文件路径
          const executablePath = await this.getPythonExecutablePath(command)
          if (executablePath && existsSync(executablePath)) {
            log.info(`Using Python executable path: ${executablePath}`)
            return executablePath
          } else {
            log.info(`Using Python command as-is: ${command}`)
            return command
          }
        } else if (version) {
          log.warn(`Python version not compatible: ${command} (${version})`)
        }
      } catch (error) {
        log.debug(`Python command failed: ${command} - ${error}`)
        continue
      }
    }

    // 如果所有命令都失败，返回最基本的py命令
    log.warn('No compatible Python version found, using fallback: py')
    return 'py'
  }

  /**
   * 检查指定 Python 命令的版本
   */
  private checkPythonVersion(command: string): Promise<string | null> {
    return new Promise((resolve) => {
      try {
        // 如果是绝对路径，先检查文件是否存在
        if (command.includes('\\') || command.includes('/')) {
          if (!existsSync(command)) {
            log.debug(`Python executable not found: ${command}`)
            resolve(null)
            return
          }
        }

        // 设置环境变量，确保能找到 Python
        const env = { ...process.env }
        if (process.platform === 'win32') {
          // Windows 下添加常见的 Python 路径
          const pythonPaths = [
            'C:\\Users\\56993\\AppData\\Local\\Programs\\Python\\Python312',
            'C:\\Users\\56993\\AppData\\Local\\Programs\\Python\\Python311',
            'C:\\Users\\56993\\AppData\\Local\\Microsoft\\WindowsApps',
            'C:\\Python312',
            'C:\\Python311',
            'C:\\Python310',
            'C:\\Python39',
            'C:\\Python38',
            'C:\\Windows\\System32'
          ]
          env.PATH = pythonPaths.join(';') + ';' + (env.PATH || '')
        }

        // 强制使用shell模式以确保最大兼容性
        const childProcess = spawn(command, ['--version'], {
          stdio: 'pipe',
          env: env,
          shell: true,
          windowsHide: true
        })

        let output = ''
        let error = ''

        childProcess.stdout?.on('data', (data) => {
          output += data.toString()
        })

        childProcess.stderr?.on('data', (data) => {
          error += data.toString()
        })

        childProcess.on('close', (code) => {
          if (code === 0) {
            const version = (output || error).trim()
            resolve(version)
          } else {
            resolve(null)
          }
        })

        childProcess.on('error', (err) => {
          log.debug(`Failed to check Python version for ${command}:`, err.message)
          resolve(null)
        })

        // 设置超时
        setTimeout(() => {
          childProcess.kill()
          resolve(null)
        }, 5000)

      } catch (error) {
        log.debug(`Exception checking Python version for ${command}:`, error)
        resolve(null)
      }
    })
  }

  /**
   * 尝试回退Python命令
   */
  private async tryFallbackPython(scriptPath: string, resourcesPath: string): Promise<void> {
    // 简化的回退命令列表，专注于最可靠的选项
    const fallbackCommands = [
      'py -3.12',
      'py -3.11',
      'py',
      'python'
    ]

    for (const command of fallbackCommands) {
      if (command === this.pythonCommand) continue // 跳过已经尝试过的命令

      try {
        log.info(`Trying fallback Python command: ${command}`)

        const version = await this.checkPythonVersion(command)

        if (version && this.isVersionCompatible(version)) {
          log.info(`Fallback Python works: ${command} (${version})`)

          // 设置环境变量
          const env = {
            ...process.env,
            PYTHONUNBUFFERED: '1',
            PYTHONIOENCODING: 'utf-8',
            PATH: [
              process.env.PATH,
              'C:\\Windows\\System32',
              'C:\\Windows',
              'C:\\Windows\\System32\\WindowsPowerShell\\v1.0'
            ].filter(Boolean).join(';')
          }

          log.info(`Starting fallback Python with shell=true`)

          this.pythonProcess = spawn(command, [scriptPath], {
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: resourcesPath,
            shell: true, // 强制使用shell
            env: env,
            windowsHide: true
          })

          // 重新设置事件处理器
          this.setupPythonProcessHandlers()

          log.info(`Successfully started Python with fallback command: ${command}`)
          return
        }
      } catch (error) {
        log.debug(`Fallback command ${command} failed:`, error)
        continue
      }
    }

    log.error('All fallback Python commands failed')
  }

  /**
   * 设置Python进程事件处理器
   */
  private setupPythonProcessHandlers(): void {
    if (!this.pythonProcess) return

    this.pythonProcess.stdout?.on('data', (data) => {
      this.handlePythonMessage(data.toString())
    })

    this.pythonProcess.stderr?.on('data', (data) => {
      log.error('WxAuto Python error:', data.toString())
    })

    this.pythonProcess.on('close', (code) => {
      log.info('WxAuto Python process closed with code:', code)
      this.isInitialized = false
      this.pythonProcess = null
    })

    this.pythonProcess.on('error', (error) => {
      log.error('WxAuto Python process error:', error)
      this.isInitialized = false
      this.pythonProcess = null
    })
  }

  /**
   * 使用批处理文件启动Python进程（最可靠的方法）
   */
  private async startPythonWithBatch(scriptPath: string, resourcesPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const batchPath = join(resourcesPath, 'start_python.bat')

      // 检查批处理文件是否存在
      if (!existsSync(batchPath)) {
        reject(new Error(`Batch file not found: ${batchPath}`))
        return
      }

      log.info(`Starting Python with batch file: ${batchPath}`)
      log.info(`Python command: ${this.pythonCommand}`)
      log.info(`Script path: ${scriptPath}`)

      const env = {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8'
      }

      try {
        // 使用批处理文件启动Python
        this.pythonProcess = spawn(batchPath, [this.pythonCommand, scriptPath], {
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: resourcesPath,
          shell: false, // 不需要shell，直接运行批处理文件
          env: env,
          windowsHide: true
        })

        if (this.pythonProcess.pid) {
          log.info(`Python process started via batch with PID: ${this.pythonProcess.pid}`)
          this.setupPythonProcessHandlers()
          resolve()
        } else {
          reject(new Error('Failed to start Python process via batch - no PID'))
        }
      } catch (spawnError) {
        log.error(`Batch spawn error: ${spawnError}`)
        reject(spawnError)
      }
    })
  }

  /**
   * 直接启动Python进程（不使用shell）
   */
  private async startPythonDirect(scriptPath: string, resourcesPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // 解析Python命令
      const parts = this.pythonCommand.split(' ')
      const command = parts[0]
      const args = [...parts.slice(1), scriptPath]

      log.info(`Starting Python directly: ${command} ${args.join(' ')}`)

      // 检查Python可执行文件是否存在
      if (!existsSync(command)) {
        log.error(`Python executable not found: ${command}`)
        reject(new Error(`Python executable not found: ${command}`))
        return
      }

      log.info(`Python executable exists: ${command}`)

      const env = {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8'
      }

      try {
        this.pythonProcess = spawn(command, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: resourcesPath,
          shell: false,
          env: env,
          windowsHide: true
        })

        if (this.pythonProcess.pid) {
          log.info(`Python process started directly with PID: ${this.pythonProcess.pid}`)
          this.setupPythonProcessHandlers()
          resolve()
        } else {
          reject(new Error('Failed to start Python process directly - no PID'))
        }
      } catch (spawnError) {
        log.error(`Spawn error: ${spawnError}`)
        reject(spawnError)
      }
    })
  }

  /**
   * 使用execFile启动Python进程
   */
  private async startPythonWithExecFile(scriptPath: string, resourcesPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // 解析Python命令
      const parts = this.pythonCommand.split(' ')
      const command = parts[0]
      const args = [...parts.slice(1), scriptPath]

      log.info(`Starting Python with execFile: ${command} ${args.join(' ')}`)

      const env = {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8'
      }

      // 使用execFile来启动Python
      const child = execFile(command, args, {
        cwd: resourcesPath,
        env: env,
        windowsHide: true
      }, (error, stdout, stderr) => {
        if (error) {
          log.error(`execFile error: ${error}`)
        }
        if (stdout) {
          log.info(`Python stdout: ${stdout}`)
        }
        if (stderr) {
          log.error(`Python stderr: ${stderr}`)
        }
      })

      // 将execFile的child转换为我们需要的格式
      this.pythonProcess = child as ChildProcess

      if (this.pythonProcess.pid) {
        log.info(`Python process started with execFile, PID: ${this.pythonProcess.pid}`)
        this.setupPythonProcessHandlers()
        resolve()
      } else {
        reject(new Error('Failed to start Python process with execFile'))
      }
    })
  }

  /**
   * 检查版本是否兼容 wxautox
   */
  private isVersionCompatible(versionString: string): boolean {
    const match = versionString.match(/Python (\d+)\.(\d+)\.(\d+)/)
    if (!match) return false

    const major = parseInt(match[1])
    const minor = parseInt(match[2])

    // wxautox 主要支持 Python 3.12，优先使用
    if (major === 3 && minor === 12) {
      return true
    }

    // 其他版本作为备选
    if (major < 3) return false
    if (major === 3 && minor < 8) return false
    if (major === 3 && minor >= 13) {
      log.warn(`Python ${major}.${minor} is not compatible with wxautox, skipping`)
      return false
    }
    if (major > 3) {
      log.warn(`Python ${major}.${minor} is not compatible with wxautox, skipping`)
      return false
    }

    // 对于非 3.12 版本给出警告但仍然尝试
    if (major === 3 && minor !== 12) {
      log.warn(`Python ${major}.${minor} may have compatibility issues with wxautox, Python 3.12 is recommended`)
    }

    return true
  }

  /**
   * 初始化wxautox服务
   */
  async initialize(): Promise<WxAutoResponse> {
    if (this.isInitialized && this.pythonProcess) {
      return { success: true, message: 'WxAuto service already initialized' }
    }

    try {
      // 检测最佳的 Python 版本
      this.pythonCommand = await this.detectBestPythonVersion()
      log.info(`Using Python command: ${this.pythonCommand}`)

      // 获取Python脚本路径
      const resourcesPath = app.isPackaged
        ? join(process.resourcesPath, 'python')
        : join(process.cwd(), 'python') // 使用当前工作目录而不是__dirname

      const scriptPath = join(resourcesPath, 'wxauto_bridge.py')

      log.info('Starting WxAuto Python bridge:', scriptPath)

      // 启动Python子进程
      log.info(`Attempting to start Python process with command: ${this.pythonCommand}`)
      log.info(`Script path: ${scriptPath}`)
      log.info(`Working directory: ${resourcesPath}`)

      try {
        // 尝试使用批处理文件启动Python（最可靠的方法）
        await this.startPythonWithBatch(scriptPath, resourcesPath)
      } catch (batchError) {
        log.warn(`Batch Python start failed: ${batchError}`)

        try {
          // 尝试直接启动Python，不使用shell
          await this.startPythonDirect(scriptPath, resourcesPath)
        } catch (directError) {
          log.warn(`Direct Python start failed: ${directError}`)

          // 如果直接启动失败，尝试使用execFile
          try {
            await this.startPythonWithExecFile(scriptPath, resourcesPath)
          } catch (execError) {
            log.error(`All Python startup methods failed: ${execError}`)
            throw execError
          }
        }
      }

      // 设置进程事件处理
      this.setupPythonProcessHandlers()

      // 特殊处理启动时的错误，支持回退
      this.pythonProcess.on('error', async (error) => {
        log.error('WxAuto Python process startup error:', error)

        // 如果是ENOENT错误（文件未找到），尝试回退到其他Python命令
        if (error.message.includes('ENOENT')) {
          log.warn('Python executable not found, trying fallback options...')
          await this.tryFallbackPython(scriptPath, resourcesPath)
        }
      })

      // 等待初始化完成
      const initResult = await this.sendCommand('init', {})
      
      if (initResult.success) {
        this.isInitialized = true
        log.info('WxAuto service initialized successfully')
      }

      return initResult
    } catch (error) {
      log.error('Failed to initialize WxAuto service:', error)
      return {
        success: false,
        message: `Failed to initialize: ${error instanceof Error ? error.message : String(error)}`
      }
    }
  }

  /**
   * 处理Python进程返回的消息 - 支持分块数据处理
   */
  private handlePythonMessage(data: string) {
    try {
      // 将新数据添加到缓冲区
      this.messageBuffer += data

      // 尝试处理完整的行
      const lines = this.messageBuffer.split('\n')

      // 保留最后一行（可能不完整）在缓冲区中
      this.messageBuffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.trim()) continue

        if (line.startsWith('RESPONSE:')) {
          try {
            const responseData = JSON.parse(line.substring(9))
            const { id, ...response } = responseData

            const handler = this.messageHandlers.get(id)
            if (handler) {
              handler(response)
              this.messageHandlers.delete(id)
            }
          } catch (parseError) {
            log.error('Failed to parse RESPONSE JSON:', parseError, 'Line:', line.substring(0, 200) + '...')
          }
        } else if (line.startsWith('EVENT:')) {
          try {
            // 处理事件消息（如新消息通知）
            const eventData = JSON.parse(line.substring(6))
            this.handleEvent(eventData)
          } catch (parseError) {
            log.error('Failed to parse EVENT JSON:', parseError, 'Line:', line.substring(0, 200) + '...')
          }
        } else {
          // 过滤和优化日志输出
          this.filterAndLogPythonMessage(line)
        }
      }
    } catch (error) {
      log.error('Failed to handle Python message:', error, 'Data length:', data.length)
      // 清空缓冲区以避免持续错误
      this.messageBuffer = ''
    }
  }

  /**
   * 过滤和优化Python日志输出
   */
  private filterAndLogPythonMessage(line: string) {
    // 跳过过于详细的调试信息
    const skipPatterns = [
      '聊天窗口加载完成',
      '尝试加载更多消息',
      '开始获取消息，检查微信客户端状态',
      '微信客户端类型:',
      '可用的消息相关方法:',
      '找到GetAllMessage方法',
      'GetAllMessage调用完成',
      '_get_all_messages返回结果:'
    ]

    // 检查是否应该跳过这条日志
    const shouldSkip = skipPatterns.some(pattern => line.includes(pattern))

    if (!shouldSkip) {
      // 只记录重要的日志信息
      if (line.includes('[ERROR]') || line.includes('[CRITICAL]')) {
        log.error('WxAuto Python:', line)
      } else if (line.includes('[WARNING]')) {
        // 只记录重要的警告，跳过一些预期的警告
        if (!line.includes('未获取到任何消息') &&
            !line.includes('加载更多历史消息失败') &&
            !line.includes('GetAllMessage返回空结果')) {
          log.warn('WxAuto Python:', line)
        }
      } else if (line.includes('✅') || line.includes('📥') || line.includes('📤')) {
        // 只记录重要的成功信息
        if (line.includes('初始化成功') ||
            line.includes('收到命令') ||
            line.includes('命令结果')) {
          log.info('WxAuto Python:', line)
        }
      }
    }
  }

  /**
   * 处理事件消息
   */
  private handleEvent(eventData: any) {
    // 这里可以发送事件到渲染进程
    log.info('WxAuto event:', eventData)
  }

  /**
   * 发送命令到Python进程
   */
  private async sendCommand(command: string, params: any): Promise<WxAutoResponse> {
    if (!this.pythonProcess || !this.pythonProcess.stdin) {
      return { success: false, message: 'Python process not available' }
    }

    return new Promise((resolve, reject) => {
      const id = (++this.messageId).toString()
      const message = JSON.stringify({ id, command, params })

      // 设置超时
      const timeout = setTimeout(() => {
        this.messageHandlers.delete(id)
        reject(new Error('Command timeout'))
      }, 60000) // 60秒超时，处理大量数据时需要更长时间

      // 设置响应处理器
      this.messageHandlers.set(id, (response) => {
        clearTimeout(timeout)
        resolve(response)
      })

      // 发送命令
      this.pythonProcess!.stdin!.write(message + '\n')
    })
  }

  /**
   * 获取微信连接状态
   */
  async getConnectionStatus(): Promise<WxAutoResponse> {
    return this.sendCommand('get_connection_status', {})
  }

  /**
   * 重新连接微信
   */
  async reconnect(): Promise<WxAutoResponse> {
    return this.sendCommand('reconnect', {})
  }

  /**
   * 获取联系人列表
   */
  async getContacts(): Promise<WxAutoResponse> {
    return this.sendCommand('get_contacts', {})
  }

  /**
   * 保存联系人到数据库
   */
  async saveContactsToDb(contacts: ContactInfo[]): Promise<WxAutoResponse> {
    return this.sendCommand('save_contacts_to_db', { contacts })
  }

  /**
   * 从数据库获取联系人列表
   */
  async getContactsFromDb(): Promise<WxAutoResponse> {
    return this.sendCommand('get_contacts_from_db', {})
  }

  /**
   * 获取群组列表
   */
  async getGroups(): Promise<WxAutoResponse> {
    return this.sendCommand('get_groups', {})
  }

  /**
   * 获取会话列表（包含联系人和群组）
   */
  async getSessionList(): Promise<WxAutoResponse> {
    return this.sendCommand('get_session_list', {})
  }

  /**
   * 发送消息
   */
  async sendMessage(contactName: string, message: string): Promise<WxAutoResponse> {
    return this.sendCommand('send_message', { contact_name: contactName, message })
  }

  /**
   * 批量发送消息
   */
  async bulkSend(contacts: string[], message: string, delayRange?: [number, number]): Promise<WxAutoResponse> {
    return this.sendCommand('bulk_send', { contacts, message, delay_range: delayRange })
  }

  /**
   * 获取聊天记录
   */
  async getMessageHistory(contactName: string, forceRefresh = false): Promise<WxAutoResponse> {
    return this.sendCommand('get_message_history', {
      contact_name: contactName,
      force_refresh: forceRefresh
    })
  }

  /**
   * 清空聊天记录
   */
  async clearChatMessages(contactName: string): Promise<WxAutoResponse> {
    return this.sendCommand('clear_chat_messages', { contact_name: contactName })
  }

  /**
   * 重新获取聊天记录（清空后重新获取）
   */
  async refreshChatMessages(contactName: string): Promise<WxAutoResponse> {
    return this.sendCommand('refresh_chat_messages', { contact_name: contactName })
  }

  /**
   * 从数据库获取消息记录
   */
  async getMessagesFromDb(contactName: string, page: number = 1, perPage: number = 20): Promise<WxAutoResponse> {
    return this.sendCommand('get_messages_from_db', { contact_name: contactName, page, per_page: perPage })
  }

  /**
   * 获取更多历史消息（向前分页）
   */
  async getMoreMessagesFromDb(contactName: string, beforeId?: number, limit: number = 20): Promise<WxAutoResponse> {
    return this.sendCommand('get_more_messages_from_db', { contact_name: contactName, before_id: beforeId, limit })
  }

  /**
   * 启动监听
   */
  async startMonitoring(contactName: string, autoReply: boolean = false): Promise<WxAutoResponse> {
    return this.sendCommand('start_monitoring', { contact_name: contactName, auto_reply: autoReply })
  }

  /**
   * 停止监听
   */
  async stopMonitoring(contactName: string): Promise<WxAutoResponse> {
    return this.sendCommand('stop_monitoring', { contact_name: contactName })
  }

  /**
   * 获取自动回复状态
   */
  async getAutoReplyStatus(): Promise<WxAutoResponse> {
    return this.sendCommand('get_auto_reply_status', {})
  }

  /**
   * 切换自动回复
   */
  async toggleAutoReply(enabled: boolean): Promise<WxAutoResponse> {
    return this.sendCommand('toggle_auto_reply', { enabled })
  }

  /**
   * 清理资源
   */
  cleanup() {
    if (this.pythonProcess) {
      log.info('Cleaning up WxAuto Python process')
      this.pythonProcess.kill()
      this.pythonProcess = null
    }
    this.isInitialized = false
    this.messageHandlers.clear()
  }

  /**
   * 检查服务是否可用
   */
  isAvailable(): boolean {
    return this.isInitialized && this.pythonProcess !== null
  }
}

// 单例实例
export const wxAutoService = new WxAutoService()
