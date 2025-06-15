import './assets/styles/index.scss'
import '@ant-design/v5-patch-for-react-19'

import { createRoot } from 'react-dom/client'

import App from './App'
import { initBrowserMocks } from './utils/electronMock'
import { setupMockAPI } from './utils/mockWeChatAPI'

// 在浏览器环境中初始化模拟的 Electron API
initBrowserMocks()

// 初始化微信API模拟 - 已禁用，使用真实后端
// const enableMockAPI = import.meta.env.VITE_ENABLE_MOCK_API !== 'false'
// if (enableMockAPI) {
//   console.log('[Mock API] Mock API enabled')
//   setupMockAPI()
// } else {
  console.log('[Mock API] Mock API disabled - using real backend')
// }

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(<App />)
