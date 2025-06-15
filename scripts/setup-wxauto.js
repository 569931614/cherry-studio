#!/usr/bin/env node

/**
 * Cherry Studio WxAuto Setup Script
 * 跨平台Python环境和依赖安装脚本
 */

const { spawn, exec } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

const isWindows = os.platform() === 'win32'
const projectRoot = path.join(__dirname, '..')

console.log('========================================')
console.log('Cherry Studio WxAuto Setup Script')
console.log('========================================')
console.log()

/**
 * 执行命令并返回Promise
 */
function execCommand(command, options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`[INFO] Executing: ${command}`)
    
    const child = exec(command, {
      cwd: projectRoot,
      ...options
    }, (error, stdout, stderr) => {
      if (error) {
        console.error(`[ERROR] Command failed: ${command}`)
        console.error(stderr)
        reject(error)
      } else {
        resolve(stdout.trim())
      }
    })
    
    child.stdout?.on('data', (data) => {
      process.stdout.write(data)
    })
    
    child.stderr?.on('data', (data) => {
      process.stderr.write(data)
    })
  })
}

/**
 * 检查命令是否存在
 */
async function commandExists(command) {
  try {
    const checkCmd = isWindows ? `where ${command}` : `which ${command}`
    await execCommand(checkCmd)
    return true
  } catch {
    return false
  }
}

/**
 * 检查Python安装
 */
async function checkPython() {
  console.log('[INFO] Checking Python installation...')
  
  const pythonCommands = ['python3', 'python']
  let pythonCmd = null
  
  for (const cmd of pythonCommands) {
    if (await commandExists(cmd)) {
      try {
        const version = await execCommand(`${cmd} --version`)
        console.log(`[INFO] Found Python: ${version}`)
        pythonCmd = cmd
        break
      } catch {
        continue
      }
    }
  }
  
  if (!pythonCmd) {
    throw new Error('Python not found! Please install Python 3.7+ first.')
  }
  
  return pythonCmd
}

/**
 * 检查pip安装
 */
async function checkPip() {
  console.log('[INFO] Checking pip installation...')
  
  const pipCommands = ['pip3', 'pip']
  let pipCmd = null
  
  for (const cmd of pipCommands) {
    if (await commandExists(cmd)) {
      try {
        const version = await execCommand(`${cmd} --version`)
        console.log(`[INFO] Found pip: ${version}`)
        pipCmd = cmd
        break
      } catch {
        continue
      }
    }
  }
  
  if (!pipCmd) {
    throw new Error('pip not found! Please ensure pip is installed.')
  }
  
  return pipCmd
}

/**
 * 创建虚拟环境
 */
async function createVirtualEnv(pythonCmd) {
  console.log('[INFO] Creating virtual environment...')
  
  const venvPath = path.join(projectRoot, 'venv')
  
  if (fs.existsSync(venvPath)) {
    console.log('[INFO] Virtual environment already exists')
    return venvPath
  }
  
  try {
    await execCommand(`${pythonCmd} -m venv venv`)
    console.log('[INFO] Virtual environment created successfully')
    return venvPath
  } catch (error) {
    console.warn('[WARNING] Failed to create virtual environment, using global Python')
    return null
  }
}

/**
 * 激活虚拟环境并获取Python/pip命令
 */
function getVenvCommands(venvPath) {
  if (!venvPath) {
    return { python: 'python', pip: 'pip' }
  }
  
  if (isWindows) {
    return {
      python: path.join(venvPath, 'Scripts', 'python.exe'),
      pip: path.join(venvPath, 'Scripts', 'pip.exe')
    }
  } else {
    return {
      python: path.join(venvPath, 'bin', 'python'),
      pip: path.join(venvPath, 'bin', 'pip')
    }
  }
}

/**
 * 安装Python依赖
 */
async function installDependencies(pipCmd) {
  console.log('[INFO] Installing Python dependencies...')
  
  const requirementsPath = path.join(projectRoot, 'python', 'requirements.txt')
  
  if (!fs.existsSync(requirementsPath)) {
    throw new Error('requirements.txt not found!')
  }
  
  await execCommand(`${pipCmd} install -r python/requirements.txt`)
  console.log('[INFO] Dependencies installed successfully')
}

/**
 * 测试wxautox安装
 */
async function testWxautox(pythonCmd) {
  console.log('[INFO] Testing wxautox installation...')
  
  try {
    await execCommand(`${pythonCmd} -c "import wxautox; print('wxautox version:', wxautox.__version__)"`)
    console.log('[INFO] wxautox imported successfully')
    return true
  } catch {
    console.warn('[WARNING] wxautox import test failed')
    if (!isWindows) {
      console.warn('[NOTE] wxautox is primarily designed for Windows')
      console.warn('[NOTE] On Linux/macOS, you may need alternative solutions')
    }
    return false
  }
}

/**
 * 测试桥接脚本
 */
async function testBridge(pythonCmd) {
  console.log('[INFO] Testing Python bridge script...')
  
  const bridgePath = path.join(projectRoot, 'python', 'wxauto_bridge.py')
  
  if (!fs.existsSync(bridgePath)) {
    throw new Error('Bridge script not found!')
  }
  
  try {
    // 简单的语法检查
    await execCommand(`${pythonCmd} -m py_compile python/wxauto_bridge.py`)
    console.log('[INFO] Bridge script syntax is valid')
    return true
  } catch {
    console.warn('[WARNING] Bridge script test failed')
    return false
  }
}

/**
 * 主安装流程
 */
async function main() {
  try {
    // 检查Python
    const pythonCmd = await checkPython()
    
    // 检查pip
    const pipCmd = await checkPip()
    
    // 创建虚拟环境
    const venvPath = await createVirtualEnv(pythonCmd)
    
    // 获取虚拟环境命令
    const venvCommands = getVenvCommands(venvPath)
    
    // 安装依赖
    await installDependencies(venvCommands.pip)
    
    // 测试安装
    await testWxautox(venvCommands.python)
    await testBridge(venvCommands.python)
    
    console.log()
    console.log('========================================')
    console.log('Setup completed successfully!')
    console.log('========================================')
    console.log()
    console.log('Next steps:')
    console.log('1. Make sure WeChat is installed and logged in')
    console.log('2. Start Cherry Studio')
    console.log('3. Navigate to AI Sales page')
    console.log('4. Click "Connect WeChat" to initialize')
    console.log()
    
    if (isWindows) {
      console.log('Note: You may need to run Cherry Studio as administrator')
      console.log('for wxautox to access WeChat properly.')
    } else {
      console.log('Note: wxautox is primarily designed for Windows.')
      console.log('On Linux/macOS, you may need alternative solutions.')
    }
    
    console.log()
    
  } catch (error) {
    console.error()
    console.error('========================================')
    console.error('Setup failed!')
    console.error('========================================')
    console.error(`[ERROR] ${error.message}`)
    console.error()
    
    if (error.message.includes('Python not found')) {
      console.error('Please install Python 3.7+ from: https://www.python.org/downloads/')
    } else if (error.message.includes('pip not found')) {
      console.error('Please ensure pip is installed with Python')
    }
    
    process.exit(1)
  }
}

// 运行主函数
if (require.main === module) {
  main()
}

module.exports = {
  main,
  checkPython,
  checkPip,
  createVirtualEnv,
  installDependencies,
  testWxautox,
  testBridge
}
