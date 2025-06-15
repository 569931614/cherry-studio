#!/bin/bash

echo "========================================"
echo "Cherry Studio WxAuto Setup Script"
echo "========================================"
echo

# 检查Python是否安装
if ! command -v python3 &> /dev/null; then
    if ! command -v python &> /dev/null; then
        echo "[ERROR] Python not found! Please install Python 3.7+ first."
        exit 1
    else
        PYTHON_CMD="python"
    fi
else
    PYTHON_CMD="python3"
fi

echo "[INFO] Python found:"
$PYTHON_CMD --version

# 检查pip是否可用
if ! command -v pip3 &> /dev/null; then
    if ! command -v pip &> /dev/null; then
        echo "[ERROR] pip not found! Please ensure pip is installed."
        exit 1
    else
        PIP_CMD="pip"
    fi
else
    PIP_CMD="pip3"
fi

echo "[INFO] pip found:"
$PIP_CMD --version
echo

# 切换到项目根目录
cd "$(dirname "$0")/.."

# 创建Python虚拟环境（可选）
echo "[INFO] Creating virtual environment..."
$PYTHON_CMD -m venv venv
if [ $? -ne 0 ]; then
    echo "[WARNING] Failed to create virtual environment, using global Python"
else
    echo "[INFO] Virtual environment created successfully"
    source venv/bin/activate
    echo "[INFO] Virtual environment activated"
fi

echo
echo "[INFO] Installing Python dependencies..."

# 安装依赖
$PIP_CMD install -r python/requirements.txt
if [ $? -ne 0 ]; then
    echo "[ERROR] Failed to install dependencies"
    exit 1
fi

echo
echo "[INFO] Testing wxautox installation..."

# 测试wxautox是否正确安装
$PYTHON_CMD -c "import wxautox; print('wxautox version:', wxautox.__version__)" 2>/dev/null
if [ $? -ne 0 ]; then
    echo "[WARNING] wxautox import test failed"
    echo "[NOTE] wxautox is primarily designed for Windows"
    echo "[NOTE] On Linux/macOS, you may need alternative solutions"
else
    echo "[INFO] wxautox imported successfully"
fi

echo
echo "[INFO] Testing Python bridge script..."

# 测试Python桥接脚本
$PYTHON_CMD python/wxauto_bridge.py --help >/dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "[WARNING] Bridge script test failed, but may still work"
else
    echo "[INFO] Bridge script is accessible"
fi

echo
echo "========================================"
echo "Setup completed!"
echo "========================================"
echo
echo "Next steps:"
echo "1. Make sure WeChat is installed and logged in"
echo "2. Start Cherry Studio"
echo "3. Navigate to AI Sales page"
echo "4. Click \"Connect WeChat\" to initialize"
echo
echo "Note: wxautox is primarily designed for Windows."
echo "On Linux/macOS, you may need to use alternative solutions"
echo "or run this in a Windows VM/container."
echo

# 使脚本可执行
chmod +x "$0"
