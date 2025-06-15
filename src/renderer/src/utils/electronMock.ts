/**
 * 浏览器环境下的 Electron API 模拟
 * 用于在开发环境中提供基本的兼容性
 */

// 创建一个简单的事件发射器
class MockEventEmitter {
  private listeners: Map<string, Function[]> = new Map()

  on(channel: string, listener: Function) {
    if (!this.listeners.has(channel)) {
      this.listeners.set(channel, [])
    }
    this.listeners.get(channel)!.push(listener)

    // 返回清理函数
    return () => {
      this.off(channel, listener)
    }
  }

  off(channel: string, listener: Function) {
    const channelListeners = this.listeners.get(channel)
    if (channelListeners) {
      const index = channelListeners.indexOf(listener)
      if (index > -1) {
        channelListeners.splice(index, 1)
      }
    }
  }

  removeAllListeners(channel: string) {
    this.listeners.delete(channel)
  }

  emit(channel: string, ...args: any[]) {
    const channelListeners = this.listeners.get(channel)
    if (channelListeners) {
      channelListeners.forEach(listener => listener(...args))
    }
  }

  async invoke(channel: string, ...args: any[]): Promise<any> {
    console.warn(`[Mock] IPC invoke called: ${channel}`, args)
    // 返回一个默认的响应，避免错误
    return Promise.resolve(null)
  }

  send(channel: string, ...args: any[]) {
    console.warn(`[Mock] IPC send called: ${channel}`, args)
  }
}

// 创建模拟的 electron API
const mockElectronAPI = {
  ipcRenderer: new MockEventEmitter(),
  process: {
    platform: 'win32' // 默认平台
  }
}

// 创建模拟的 api 对象
const mockAPI = {
  getAppInfo: () => Promise.resolve({ version: '1.0.0', name: 'Cherry Studio' }),
  reload: () => Promise.resolve(),
  setProxy: () => Promise.resolve(),
  checkForUpdate: () => Promise.resolve(),
  showUpdateDialog: () => Promise.resolve(),
  setLanguage: () => Promise.resolve(),
  setLaunchOnBoot: () => Promise.resolve(),
  setLaunchToTray: () => Promise.resolve(),
  setTray: () => Promise.resolve(),
  setTrayOnClose: () => Promise.resolve(),
  setFeedUrl: () => Promise.resolve(),
  setTheme: () => Promise.resolve(),
  handleZoomFactor: () => Promise.resolve(),
  setAutoUpdate: () => Promise.resolve(),
  openWebsite: (url: string) => {
    window.open(url, '_blank')
    return Promise.resolve()
  },
  getCacheSize: () => Promise.resolve(0),
  clearCache: () => Promise.resolve(),
  notification: {
    send: () => Promise.resolve()
  },
  system: {
    getDeviceType: () => Promise.resolve('desktop'),
    getHostname: () => Promise.resolve('localhost')
  },
  devTools: {
    toggle: () => Promise.resolve()
  },
  zip: {
    compress: (text: string) => Promise.resolve(text),
    decompress: (text: Buffer) => Promise.resolve(text.toString())
  },
  backup: {
    backup: () => Promise.resolve(),
    restore: () => Promise.resolve(),
    backupToWebdav: () => Promise.resolve(),
    restoreFromWebdav: () => Promise.resolve(),
    listWebdavFiles: () => Promise.resolve([]),
    checkConnection: () => Promise.resolve(true),
    createDirectory: () => Promise.resolve(),
    deleteWebdavFile: () => Promise.resolve()
  },
  file: {
    select: () => Promise.resolve([]),
    upload: () => Promise.resolve(),
    delete: () => Promise.resolve(),
    read: () => Promise.resolve(''),
    clear: () => Promise.resolve(),
    get: () => Promise.resolve(''),
    create: () => Promise.resolve(''),
    write: () => Promise.resolve(),
    writeWithId: () => Promise.resolve(),
    open: () => Promise.resolve([]),
    openPath: () => Promise.resolve(),
    save: () => Promise.resolve(),
    selectFolder: () => Promise.resolve(''),
    saveImage: () => Promise.resolve(''),
    base64Image: () => Promise.resolve(''),
    saveBase64Image: () => Promise.resolve(''),
    download: () => Promise.resolve(''),
    copy: () => Promise.resolve(),
    binaryImage: () => Promise.resolve(new ArrayBuffer(0)),
    base64File: () => Promise.resolve(''),
    getPathForFile: (file: File) => file.name
  },
  fs: {
    read: () => Promise.resolve('')
  },
  export: {
    toWord: () => Promise.resolve()
  },
  openPath: () => Promise.resolve(),
  shortcuts: {
    update: () => Promise.resolve()
  },
  knowledgeBase: {
    create: () => Promise.resolve(),
    reset: () => Promise.resolve(),
    delete: () => Promise.resolve(),
    add: () => Promise.resolve(),
    remove: () => Promise.resolve(),
    search: () => Promise.resolve([]),
    rerank: () => Promise.resolve([])
  },
  window: {
    setMinimumSize: () => Promise.resolve(),
    resetMinimumSize: () => Promise.resolve()
  },
  gemini: {
    uploadFile: () => Promise.resolve(),
    base64File: () => Promise.resolve(''),
    retrieveFile: () => Promise.resolve(),
    listFiles: () => Promise.resolve([]),
    deleteFile: () => Promise.resolve()
  },
  config: {
    set: () => Promise.resolve(),
    get: () => Promise.resolve(null)
  },
  miniWindow: {
    show: () => Promise.resolve(),
    hide: () => Promise.resolve(),
    close: () => Promise.resolve(),
    toggle: () => Promise.resolve(),
    setPin: () => Promise.resolve()
  },
  aes: {
    encrypt: () => Promise.resolve(''),
    decrypt: () => Promise.resolve('')
  },
  mcp: {
    removeServer: () => Promise.resolve(),
    restartServer: () => Promise.resolve(),
    stopServer: () => Promise.resolve(),
    listTools: () => Promise.resolve([]),
    callTool: () => Promise.resolve(),
    listPrompts: () => Promise.resolve([]),
    getPrompt: () => Promise.resolve(),
    listResources: () => Promise.resolve([]),
    getResource: () => Promise.resolve(),
    getInstallInfo: () => Promise.resolve(),
    checkMcpConnectivity: () => Promise.resolve(false)
  },
  shell: {
    openExternal: (url: string) => {
      window.open(url, '_blank')
      return Promise.resolve()
    }
  },
  copilot: {
    getAuthMessage: () => Promise.resolve(),
    getCopilotToken: () => Promise.resolve(),
    saveCopilotToken: () => Promise.resolve(),
    getToken: () => Promise.resolve(),
    logout: () => Promise.resolve(),
    getUser: () => Promise.resolve()
  },
  isBinaryExist: () => Promise.resolve(false),
  getBinaryPath: () => Promise.resolve(''),
  installUVBinary: () => Promise.resolve(),
  installBunBinary: () => Promise.resolve(),
  protocol: {
    onReceiveData: () => () => {}
  },
  nutstore: {
    getSSOUrl: () => Promise.resolve(''),
    decryptToken: () => Promise.resolve(''),
    getDirectoryContents: () => Promise.resolve([])
  },
  searchService: {
    openSearchWindow: () => Promise.resolve(),
    closeSearchWindow: () => Promise.resolve(),
    openUrlInSearchWindow: () => Promise.resolve()
  },
  webview: {
    setOpenLinkExternal: () => Promise.resolve()
  },
  storeSync: {
    subscribe: () => Promise.resolve(),
    unsubscribe: () => Promise.resolve(),
    onUpdate: () => Promise.resolve()
  },
  selection: {
    hideToolbar: () => Promise.resolve(),
    writeToClipboard: () => Promise.resolve(),
    determineToolbarSize: () => Promise.resolve(),
    setEnabled: () => Promise.resolve(),
    setTriggerMode: () => Promise.resolve(),
    setFollowToolbar: () => Promise.resolve(),
    setRemeberWinSize: () => Promise.resolve(),
    setFilterMode: () => Promise.resolve(),
    setFilterList: () => Promise.resolve(),
    processAction: () => Promise.resolve(),
    closeActionWindow: () => Promise.resolve(),
    minimizeActionWindow: () => Promise.resolve(),
    pinActionWindow: () => Promise.resolve()
  },
  quoteToMainWindow: () => Promise.resolve()
}

// 初始化浏览器环境的模拟 API
export function initBrowserMocks() {
  if (typeof window !== 'undefined' && !window.electron) {
    // @ts-ignore
    window.electron = mockElectronAPI
    // @ts-ignore
    window.api = mockAPI
    // @ts-ignore
    window.obsidian = {
      getVaults: () => Promise.resolve([]),
      getFiles: () => Promise.resolve([]),
      getFolders: () => Promise.resolve([])
    }

    // 添加一些常用的全局对象
    // @ts-ignore
    window.message = {
      success: (content: string) => console.log('[Mock Message] Success:', content),
      error: (content: string) => console.error('[Mock Message] Error:', content),
      warning: (content: string) => console.warn('[Mock Message] Warning:', content),
      info: (content: string) => console.info('[Mock Message] Info:', content)
    }

    // @ts-ignore
    window.modal = {
      info: (options: any) => console.log('[Mock Modal] Info:', options),
      confirm: (options: any) => console.log('[Mock Modal] Confirm:', options),
      warning: (options: any) => console.warn('[Mock Modal] Warning:', options),
      error: (options: any) => console.error('[Mock Modal] Error:', options)
    }

    console.log('[Browser Mock] Electron APIs initialized for browser environment')
  }
}
