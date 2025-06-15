#!/usr/bin/env node

/**
 * Python 版本检测脚本
 * 检查系统中可用的 Python 版本，确保 wxautox 兼容性
 */

const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

console.log('========================================')
console.log('Python Version Check for wxautox')
console.log('========================================')
console.log()

/**
 * 检查指定 Python 命令的版本
 */
function checkPythonVersion(command) {
  return new Promise((resolve) => {
    const process = spawn(command, ['--version'], { stdio: 'pipe' })
    
    let output = ''
    let error = ''
    
    process.stdout.on('data', (data) => {
      output += data.toString()
    })
    
    process.stderr.on('data', (data) => {
      error += data.toString()
    })
    
    process.on('close', (code) => {
      if (code === 0) {
        const version = (output || error).trim()
        resolve({ command, version, available: true })
      } else {
        resolve({ command, version: null, available: false })
      }
    })
    
    process.on('error', () => {
      resolve({ command, version: null, available: false })
    })
  })
}

/**
 * 检查 wxautox 是否已安装
 */
function checkWxautoxInstallation(pythonCommand) {
  return new Promise((resolve) => {
    const process = spawn(pythonCommand, ['-c', 'import wxautox; print(wxautox.__version__)'], { stdio: 'pipe' })
    
    let output = ''
    let error = ''
    
    process.stdout.on('data', (data) => {
      output += data.toString()
    })
    
    process.stderr.on('data', (data) => {
      error += data.toString()
    })
    
    process.on('close', (code) => {
      if (code === 0) {
        resolve({ installed: true, version: output.trim() })
      } else {
        resolve({ installed: false, error: error.trim() })
      }
    })
    
    process.on('error', () => {
      resolve({ installed: false, error: 'Failed to execute python command' })
    })
  })
}

/**
 * 解析版本号
 */
function parseVersion(versionString) {
  const match = versionString.match(/Python (\d+)\.(\d+)\.(\d+)/)
  if (match) {
    return {
      major: parseInt(match[1]),
      minor: parseInt(match[2]),
      patch: parseInt(match[3]),
      string: `${match[1]}.${match[2]}.${match[3]}`
    }
  }
  return null
}

/**
 * 检查版本是否兼容 wxautox
 */
function isCompatibleWithWxautox(version) {
  if (!version) return false
  
  // wxautox 需要 Python 3.8+ (建议 3.12+)
  if (version.major < 3) return false
  if (version.major === 3 && version.minor < 8) return false
  
  return true
}

/**
 * 获取推荐程度
 */
function getRecommendationLevel(version) {
  if (!version) return 'not-supported'
  
  if (version.major === 3 && version.minor >= 12) return 'highly-recommended'
  if (version.major === 3 && version.minor >= 10) return 'recommended'
  if (version.major === 3 && version.minor >= 8) return 'supported'
  
  return 'not-supported'
}

/**
 * 更新 WxAutoService 配置
 */
function updateWxAutoServiceConfig(bestPythonCommand) {
  const servicePath = path.join(__dirname, '../src/main/services/WxAutoService.ts')
  
  if (!fs.existsSync(servicePath)) {
    console.log('[WARNING] WxAutoService.ts not found, cannot update configuration')
    return false
  }
  
  try {
    let content = fs.readFileSync(servicePath, 'utf8')
    
    // 查找并替换 Python 命令
    const oldPattern = /spawn\('python',/g
    const newPattern = `spawn('${bestPythonCommand}',`
    
    if (content.includes("spawn('python',")) {
      content = content.replace(oldPattern, newPattern)
      fs.writeFileSync(servicePath, content, 'utf8')
      console.log(`[SUCCESS] Updated WxAutoService to use '${bestPythonCommand}'`)
      return true
    } else {
      console.log('[INFO] WxAutoService already configured or pattern not found')
      return false
    }
  } catch (error) {
    console.log('[ERROR] Failed to update WxAutoService:', error.message)
    return false
  }
}

/**
 * 主检测函数
 */
async function main() {
  console.log('Checking available Python versions...')
  console.log()
  
  // 要检查的 Python 命令列表
  const pythonCommands = [
    'python3.12',
    'python3.11',
    'python3.10',
    'python3.9',
    'python3.8',
    'python3',
    'python'
  ]
  
  const results = []
  
  // 检查每个 Python 命令
  for (const command of pythonCommands) {
    console.log(`Checking ${command}...`)
    const result = await checkPythonVersion(command)
    
    if (result.available) {
      const version = parseVersion(result.version)
      const compatible = isCompatibleWithWxautox(version)
      const recommendation = getRecommendationLevel(version)
      
      // 检查 wxautox 安装状态
      const wxautoxStatus = await checkWxautoxInstallation(command)
      
      results.push({
        ...result,
        parsedVersion: version,
        compatible,
        recommendation,
        wxautox: wxautoxStatus
      })
      
      console.log(`  ✓ ${result.version} - ${compatible ? 'Compatible' : 'Not Compatible'}`)
      if (wxautoxStatus.installed) {
        console.log(`    wxautox: v${wxautoxStatus.version} installed`)
      } else {
        console.log(`    wxautox: not installed`)
      }
    } else {
      console.log(`  ✗ Not available`)
    }
  }
  
  console.log()
  console.log('========================================')
  console.log('Python Version Analysis')
  console.log('========================================')
  
  // 过滤兼容的版本
  const compatibleVersions = results.filter(r => r.compatible)
  
  if (compatibleVersions.length === 0) {
    console.log('❌ No compatible Python versions found!')
    console.log()
    console.log('wxautox requires Python 3.8 or higher (Python 3.12 recommended)')
    console.log('Please install Python 3.12 from: https://www.python.org/downloads/')
    process.exit(1)
  }
  
  // 按推荐程度排序
  const sortedVersions = compatibleVersions.sort((a, b) => {
    const order = ['highly-recommended', 'recommended', 'supported']
    return order.indexOf(a.recommendation) - order.indexOf(b.recommendation)
  })
  
  console.log('Compatible Python versions found:')
  console.log()
  
  sortedVersions.forEach((result, index) => {
    const status = index === 0 ? '🎯 BEST' : '✅ OK'
    const recommendation = {
      'highly-recommended': '(Highly Recommended)',
      'recommended': '(Recommended)',
      'supported': '(Supported)'
    }[result.recommendation]
    
    console.log(`${status} ${result.command}: ${result.version} ${recommendation}`)
    if (result.wxautox.installed) {
      console.log(`     wxautox v${result.wxautox.version} installed`)
    } else {
      console.log(`     wxautox not installed - run: ${result.command} -m pip install wxautox`)
    }
    console.log()
  })
  
  // 选择最佳版本
  const bestVersion = sortedVersions[0]
  console.log(`Recommended Python command: ${bestVersion.command}`)
  
  // 询问是否更新配置
  console.log()
  console.log('========================================')
  console.log('Configuration Update')
  console.log('========================================')
  
  const updated = updateWxAutoServiceConfig(bestVersion.command)
  
  if (updated) {
    console.log()
    console.log('✅ Configuration updated successfully!')
    console.log('The WxAutoService will now use the optimal Python version.')
  }
  
  // 安装建议
  if (!bestVersion.wxautox.installed) {
    console.log()
    console.log('========================================')
    console.log('Installation Required')
    console.log('========================================')
    console.log()
    console.log('wxautox is not installed. Please run:')
    console.log(`${bestVersion.command} -m pip install wxautox`)
    console.log()
    console.log('Or if you prefer using pip directly:')
    console.log(`pip install wxautox`)
  }
  
  // 最终建议
  console.log()
  console.log('========================================')
  console.log('Summary')
  console.log('========================================')
  console.log()
  console.log(`✅ Best Python version: ${bestVersion.command} (${bestVersion.version})`)
  console.log(`✅ wxautox compatibility: ${bestVersion.compatible ? 'Yes' : 'No'}`)
  console.log(`✅ wxautox installed: ${bestVersion.wxautox.installed ? 'Yes' : 'No'}`)
  console.log(`✅ Configuration updated: ${updated ? 'Yes' : 'No'}`)
  
  if (bestVersion.wxautox.installed && bestVersion.compatible) {
    console.log()
    console.log('🎉 Everything is ready! You can now use wxautox with Cherry Studio.')
  } else {
    console.log()
    console.log('⚠️  Additional setup required. Please install wxautox as shown above.')
  }
}

// 运行检测
if (require.main === module) {
  main().catch(console.error)
}

module.exports = { main }
