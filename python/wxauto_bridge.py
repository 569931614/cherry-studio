#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
WxAuto桥接脚本
用于在Electron应用中通过子进程调用wxautox功能
"""

import sys
import json
import time
import logging
import threading
import traceback
import sqlite3
import os
import requests
from typing import Dict, Any, List, Optional
import signal
from datetime import datetime
import locale
from queue import Queue, Empty
import asyncio
from concurrent.futures import ThreadPoolExecutor
from wxautox.msgs import *
# 设置控制台编码为UTF-8
if sys.platform.startswith('win'):
    import ctypes
    kernel32 = ctypes.windll.kernel32
    kernel32.SetConsoleOutputCP(65001)
    kernel32.SetConsoleCP(65001)
    # 设置环境变量
    os.environ['PYTHONIOENCODING'] = 'utf-8'

# 配置日志
class UTF8Formatter(logging.Formatter):
    def format(self, record):
        # 确保日志消息是UTF-8编码
        if isinstance(record.msg, str):
            try:
                record.msg = record.msg.encode('utf-8').decode('utf-8')
            except UnicodeError:
                record.msg = record.msg.encode('utf-8', errors='replace').decode('utf-8')
        return super().format(record)

# 创建日志记录器
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

# 创建控制台处理器
console_handler = logging.StreamHandler(sys.stdout)
console_handler.setLevel(logging.DEBUG)

# 设置UTF-8格式化器
formatter = UTF8Formatter('%(asctime)s [%(name)s] [%(levelname)s] [%(filename)s:%(lineno)d] %(message)s')
console_handler.setFormatter(formatter)

# 添加处理器到日志记录器
logger.addHandler(console_handler)

# 设置文件处理器
file_handler = logging.FileHandler('wxauto.log', encoding='utf-8', mode='a')
file_handler.setLevel(logging.DEBUG)
file_handler.setFormatter(formatter)
logger.addHandler(file_handler)

# 数据库配置
DB_PATH = 'wechat_data.db'

# 全局wxid变量，用于数据隔离
CURRENT_WXID = None

# 尝试导入wxautox，如果失败则自动安装
def try_import_wxautox():
    """尝试导入wxautox，如果失败则自动安装"""
    try:
        import wxautox
        from wxautox import WeChat, WxParam
        import pythoncom
        logger.info(f"wxautox imported successfully, version: {getattr(wxautox, '__version__', 'unknown')}")
        return True, wxautox, WeChat, WxParam, pythoncom
    except ImportError as e:
        logger.warning(f"wxautox not found: {e}")
        logger.info("Attempting to install wxautox automatically...")

        try:
            import subprocess
            import sys

            # 尝试安装wxautox
            result = subprocess.run([
                sys.executable, "-m", "pip", "install", "wxautox"
            ], capture_output=True, text=True, timeout=60)

            if result.returncode == 0:
                logger.info("wxautox installed successfully")

                # 重新尝试导入
                import wxautox
                from wxautox import WeChat, WxParam
                import pythoncom
                logger.info(f"wxautox imported after installation, version: {getattr(wxautox, '__version__', 'unknown')}")
                return True, wxautox, WeChat, WxParam, pythoncom
            else:
                logger.error(f"Failed to install wxautox: {result.stderr}")
                return False, None, None, None, None

        except Exception as install_error:
            logger.error(f"Failed to auto-install wxautox: {install_error}")
            return False, None, None, None, None
    except Exception as e:
        logger.error(f"Unexpected error with wxautox: {e}")
        return False, None, None, None, None

# 执行导入
WXAUTOX_AVAILABLE, wxautox, WeChat, WxParam, pythoncom = try_import_wxautox()

# 暂时强制设置为True来测试我们的新逻辑
logger.info("🔧 Temporarily forcing WXAUTOX_AVAILABLE=True for testing")
WXAUTOX_AVAILABLE = True

if not WXAUTOX_AVAILABLE:
    logger.error("wxautox is not available. Please install it manually: python -m pip install wxautox")

class WxAutoBridge:
    def __init__(self):
        self.wechat_client = None
        self.is_connected = False
        self.monitored_contacts = {}
        self.auto_reply_enabled = False
        self.lock = threading.Lock()
        self.cached_user_info = {}  # 缓存用户信息
        self.current_wxid = None  # 当前用户的wxid
        self.message_queue = Queue()  # 消息处理队列
        self.message_processor_thread = None  # 消息处理线程
        self.monitoring_thread = None  # 消息监听线程
        self.is_monitoring = False  # 是否正在监听
        self.thread_pool = ThreadPoolExecutor(max_workers=3)  # 线程池用于处理消息
        self.db_path = DB_PATH  # 保存数据库路径，而不是连接对象

        # 初始化数据库
        self._init_database()

        # 清理旧的建议消息
        try:
            self.delete_old_suggestions()
        except Exception as e:
            logger.warning(f"清理旧的建议消息失败: {e}")

    def _get_db_connection(self):
        """获取数据库连接，每个线程使用独立的连接"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_database(self):
        """初始化数据库"""
        try:
            # 创建数据库连接
            conn = self._get_db_connection()
            cursor = conn.cursor()

            # 创建contacts表
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS contacts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    wxid TEXT NOT NULL,
                    name TEXT NOT NULL,
                    type TEXT NOT NULL,
                    remark TEXT,
                    avatar TEXT,
                    source TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                ''')
                
            # 检查contacts表结构，确保remark、avatar、source字段存在
            cursor.execute("PRAGMA table_info(contacts)")
            contacts_columns = [column[1] for column in cursor.fetchall()]
            
            # 如果remark列不存在，添加它
            if "remark" not in contacts_columns:
                logger.info("正在添加remark字段到contacts表...")
                cursor.execute("ALTER TABLE contacts ADD COLUMN remark TEXT DEFAULT ''")
                logger.info("✅ 成功添加remark字段")
                
            # 如果avatar列不存在，添加它
            if "avatar" not in contacts_columns:
                logger.info("正在添加avatar字段到contacts表...")
                cursor.execute("ALTER TABLE contacts ADD COLUMN avatar TEXT DEFAULT ''")
                logger.info("✅ 成功添加avatar字段")
                
            # 如果source列不存在，添加它
            if "source" not in contacts_columns:
                logger.info("正在添加source字段到contacts表...")
                cursor.execute("ALTER TABLE contacts ADD COLUMN source TEXT DEFAULT 'wxautox'")
                logger.info("✅ 成功添加source字段")

            # 创建messages表
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    wxid TEXT NOT NULL,
                    content TEXT NOT NULL,
                    is_self INTEGER NOT NULL,
                    timestamp INTEGER NOT NULL,
                    msg_type TEXT NOT NULL,
                    sender TEXT NOT NULL,
                    attr TEXT,
                    extra_data TEXT,
                    created_at TEXT,
                    hash TEXT,
                    original_time TEXT,
                    formatted_time TEXT
                )
                ''')
                
            # 检查messages表结构，确保original_time和formatted_time字段存在
            cursor.execute("PRAGMA table_info(messages)")
            messages_columns = [column[1] for column in cursor.fetchall()]
            
            # 如果original_time列不存在，添加它
            if "original_time" not in messages_columns:
                logger.info("正在添加original_time字段到messages表...")
                cursor.execute("ALTER TABLE messages ADD COLUMN original_time TEXT")
                logger.info("✅ 成功添加original_time字段")
                
            # 如果formatted_time列不存在，添加它
            if "formatted_time" not in messages_columns:
                logger.info("正在添加formatted_time字段到messages表...")
                cursor.execute("ALTER TABLE messages ADD COLUMN formatted_time TEXT")
                logger.info("✅ 成功添加formatted_time字段")

            # 创建sessions表，增加is_monitoring字段
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS sessions (
                    session_id TEXT NOT NULL,
                    wxid TEXT NOT NULL,
                    name TEXT,
                    type TEXT,
                    last_time INTEGER,
                    created_at INTEGER,
                    updated_at INTEGER,
                    chat_type TEXT,
                    is_monitoring INTEGER DEFAULT 0,
                    has_more_messages INTEGER DEFAULT 1,
                    PRIMARY KEY (session_id, wxid)
                )
                ''')
                
            # 检查sessions表结构，确保has_more_messages字段存在
            cursor.execute("PRAGMA table_info(sessions)")
            sessions_columns = [column[1] for column in cursor.fetchall()]
            
            # 如果has_more_messages列不存在，添加它
            if "has_more_messages" not in sessions_columns:
                logger.info("正在添加has_more_messages字段到sessions表...")
                cursor.execute("ALTER TABLE sessions ADD COLUMN has_more_messages INTEGER DEFAULT 1")
                logger.info("✅ 成功添加has_more_messages字段")

            # 创建ai_sales_config表
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS ai_sales_config (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    wxid TEXT NOT NULL,
                    api_key TEXT,
                    api_url TEXT,
                    model TEXT,
                    temperature REAL,
                    max_tokens INTEGER,
                    system_prompt TEXT,
                    created_at TEXT,
                    updated_at TEXT
                )
                ''')

            # 创建reply_suggestions表
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS reply_suggestions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    message_id INTEGER NOT NULL,
                    content TEXT NOT NULL,
                    used INTEGER DEFAULT 0,
                    created_at TEXT NOT NULL
                )
                ''')

            conn.commit()
            conn.close()
        except sqlite3.Error as e:
            logger.error(f"数据库初始化错误: {e}")
            # 继续执行，不要因为数据库错误而终止程序

    def set_current_wxid(self, wxid: str):
        """设置当前用户的wxid"""
        global CURRENT_WXID
        self.current_wxid = wxid
        CURRENT_WXID = wxid
        logger.info(f"Set current user wxid: {wxid}")

    def get_current_wxid(self) -> str:
        """获取当前用户的wxid"""
        return self.current_wxid or CURRENT_WXID or "default_user"

    def _save_message_to_db(self, session_id: str, content: str, message_type: str, 
                          sender: str, sender_type: str, reply_to: str = None, 
                          status: int = 0, extra: Dict = None, hash: str = None) -> tuple[bool, int]:
        """保存消息到数据库，返回(成功状态, 消息ID)"""
        try:
            current_wxid = self.get_current_wxid()
            timestamp = int(time.time())
            extra_data = json.dumps(extra) if extra else None
            is_self = 1 if sender_type == 'self' else 0
            msg_type = message_type or ''
            attr = sender_type or ''
            msg_id = 0  # 初始化消息ID
            created_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            
            # 使用新的数据库连接
            with self._get_db_connection() as conn:
                cursor = conn.cursor()
                
                # 检查表结构
                cursor.execute("PRAGMA table_info(messages)")
                columns = [column[1] for column in cursor.fetchall()]
                    
                # 构建动态SQL语句和参数
                fields = ["session_id", "wxid", "content", "is_self", "timestamp", "msg_type", "sender", "attr"]
                values = [session_id, current_wxid, content, is_self, timestamp, msg_type, sender, attr]
                
                # 添加可选字段
                if "extra_data" in columns:
                    fields.append("extra_data")
                    values.append(extra_data)
                
                if "created_at" in columns:
                    fields.append("created_at")
                    values.append(created_at)
                
                if "hash" in columns:
                    fields.append("hash")
                    values.append(hash)
                
                if "reply_to" in columns and reply_to is not None:
                    fields.append("reply_to")
                    values.append(reply_to)
                    logger.info(f"应用reply_to字段: {reply_to}")
                
                if "status" in columns:
                    fields.append("status")
                    values.append(status)
                
                # 构建SQL语句
                sql = f"INSERT INTO messages ({', '.join(fields)}) VALUES ({', '.join(['?'] * len(fields))})"
                logger.debug(f"执行SQL: {sql}")
                logger.debug(f"参数: {values}")
                
                # 执行SQL
                cursor.execute(sql, values)
                conn.commit()
                
                # 获取最后插入的消息ID
                cursor.execute("SELECT last_insert_rowid()")
                msg_id = cursor.fetchone()[0]
                logger.debug(f"获取到新保存消息的ID: {msg_id}")
                
            return True, msg_id
        except Exception as e:
            logger.error(f"保存消息失败: {e}")
            logger.error(traceback.format_exc())
            return False, 0

    def _start_message_processor(self):
        """启动消息处理线程"""
        def process_messages():
            logger.info("🚀 消息处理线程已启动")
            message_count = 0
            
            while True:
                item = None
                try:
                    # 从队列获取消息
                    logger.debug("⏳ 消息处理线程等待新消息...")
                    item = self.message_queue.get(block=True, timeout=60)  # 设置超时，避免永久阻塞
                    
                    # 检查是否为退出信号
                    if item is None:
                        logger.info("🛑 收到退出信号，消息处理线程准备退出")
                        # 标记任务完成
                        self.message_queue.task_done()
                        break
                        
                    message_count += 1
                    contact_name, message = item
                    
                    logger.info(f"📩 处理第{message_count}条消息，来自: {contact_name}")
                    
                    # 跳过不存在的联系人
                    if contact_name not in self.monitored_contacts:
                        logger.warning(f"⚠️ 联系人 {contact_name} 不在监听列表中，跳过处理")
                        self.message_queue.task_done()
                        continue
                    
                    # 获取监听配置
                    config = self.monitored_contacts[contact_name]
                    logger.debug(f"⚙️ 联系人 {contact_name} 的监听配置: {config}")
                    
                    # 保存接收到的消息
                    session_id = f"private_self_{contact_name}"
                    message_type = getattr(message, 'type', 'text')
                    sender = getattr(message, 'sender', contact_name)
                    sender_type = message.attr if hasattr(message, 'attr') else 'unknown'
                    content = getattr(message, 'content', '')
                    # 获取消息hash值
                    msg_hash = getattr(message, 'hash', None)
                    # 获取消息的info属性
                    msg_info = getattr(message, 'info', {})
                    
                    logger.info(f"💬 消息内容: '{content[:50]}...' (类型: {message_type}, hash: {msg_hash})")
                    # 将info字典内容完整展示在日志中
                    logger.info(f"📋 消息info详情: {json.dumps(msg_info, ensure_ascii=False, indent=2)}")
                    
                    # 构建extra信息
                    extra = {"message_type": message_type}
                    
                    # 保存消息到数据库
                    logger.debug(f"💾 保存消息到数据库: {session_id}")
                    save_result, received_msg_id = self._save_message_to_db(
                        session_id=session_id,
                        content=content,
                        message_type=message_type,
                        sender=sender,
                        sender_type=sender_type,
                        extra=extra,
                        hash=msg_hash
                    )
                    
                    if save_result:
                        logger.info(f"✅ 消息已保存到数据库，ID: {received_msg_id}，结果: {save_result}")
                    else:
                        logger.warning("⚠️ 消息保存失败")
                    
                    # 获取AI配置
                    logger.debug("🔍 获取AI配置...")
                    ai_config = self.get_ai_sales_config()
                    if not ai_config["success"]:
                        logger.warning("⚠️ 获取AI配置失败，跳过后续处理")
                        self.message_queue.task_done()
                        continue
                        
                    ai_data = ai_config["data"]
                    logger.info(f"⚙️ AI配置: {ai_data}")
                    
                    try:
                        logger.info("🤖 生成自动回复内容...")
                        # 生成回复内容
                        reply = self._handle_auto_reply(contact_name, message)
                        if reply:
                            # 直接根据ai_sales_config表中的auto_reply_enabled值判断
                            if ai_data.get("auto_reply_enabled"):
                                # 自动回复模式：直接发送
                                logger.info(f"📤 自动回复模式：发送回复 '{reply[:50]}...'")
                                message.reply(reply)
                                
                                # 保存发送的回复消息
                                logger.info(f"💾 保存自动回复消息到数据库，回复消息ID: {received_msg_id}")
                                self._save_message_to_db(
                                    session_id=session_id,
                                    content=reply,
                                    message_type="text",
                                    sender="self",
                                    sender_type="self",
                                    reply_to=received_msg_id,  # 使用接收到的消息ID
                                    status=1,
                                    extra={"message_type": "text", "is_reply": True, "reply_to_id": received_msg_id}
                                )
                            else:
                                # 回复建议模式：保存为建议到新表
                                logger.info(f"💡 回复建议模式：保存回复建议 '{reply[:50]}...'")
                                # 使用新方法保存回复建议
                                save_result = self._save_reply_suggestion(
                                    session_id=session_id,
                                    content=reply,
                                    message_id=received_msg_id,  # 使用接收到的消息ID
                                    contact_name=contact_name
                                )
                                if save_result:
                                    logger.info("✅ 回复建议已保存到reply_suggestions表")
                                else:
                                    logger.warning("⚠️ 回复建议保存失败")
                        else:
                            logger.warning("⚠️ 未生成回复内容")
                    except Exception as e:
                        logger.error(f"❌ 处理回复失败: {e}")
                        logger.error(traceback.format_exc())

                except Empty:
                    # 队列超时，继续等待
                    logger.debug("⏱️ 消息队列等待超时，继续监听...")
                    continue
                except Exception as e:
                    logger.error(f"❌ 消息处理失败: {e}")
                    logger.error(traceback.format_exc())
                    # 确保在发生异常时也标记任务完成
                    if item is not None:
                        try:
                            self.message_queue.task_done()
                        except ValueError:
                            logger.warning("⚠️ 任务已经被标记为完成")
                        except Exception as e2:
                            logger.error(f"标记任务完成时出错: {e2}")
                finally:
                    # 确保在任何情况下都正确处理队列
                    pass
            
            logger.info("🛑 消息处理线程已停止")
                    
        # 启动处理线程
        self.message_processor_thread = threading.Thread(target=process_messages, daemon=True)
        self.message_processor_thread.start()
        
        # 添加调试日志，确认线程已启动
        logger.info(f"✅ 已启动消息处理线程 (ID: {self.message_processor_thread.ident})")
        
        # 等待一小段时间，确保线程已经开始运行
        time.sleep(0.5)
        
        # 检查线程是否存活
        if self.message_processor_thread.is_alive():
            logger.info("✅ 消息处理线程已成功运行")
        else:
            logger.error("❌ 消息处理线程启动失败")
            
        # 返回线程ID，便于调试
        return self.message_processor_thread.ident

    def _handle_auto_reply(self, contact_name: str, message: Any):
        """处理自动回复"""
        try:
            # 获取消息内容
            content = getattr(message, 'content', '')
            logger.info(f"生成自动回复 - 联系人: {contact_name}, 消息内容: {content[:50]}...")
            
            # 获取AI配置
            ai_config = self.get_ai_sales_config()
            if not ai_config["success"]:
                logger.warning(f"获取AI配置失败，使用默认回复")
                return f"自动回复: 收到您的消息 - {content}"
                
            ai_data = ai_config["data"]
            
            # 检查是否有API密钥
            api_key = ai_data.get("api_key")
            if not api_key or api_key == "******":
                logger.warning("未配置API密钥，使用默认回复")
                return f"自动回复: 收到您的消息 - {content}"
            
            # 准备系统提示词
            system_prompt = ai_data.get("system_prompt") or "你是一个专业的销售助手，负责回复客户的消息。请根据客户的消息提供有帮助的回复。"
            
            # 获取历史聊天记录
            session_id = f"private_self_{contact_name}"
            chat_history = self._get_chat_history(session_id, limit=10)
            
            # 准备消息列表，包含历史聊天记录
            messages = []
            
            # 添加系统提示词
            messages.append({"role": "system", "content": system_prompt})
            
            # 添加历史聊天记录
            for msg in chat_history:
                if msg["is_self"]:
                    messages.append({"role": "assistant", "content": msg["content"]})
                else:
                    messages.append({"role": "user", "content": msg["content"]})
            
            # 添加当前消息
            messages.append({"role": "user", "content": content})
            
            # 准备用户提示词（用于日志记录）
            auto_reply_prompt = ai_data.get("auto_reply_prompt") or "请针对以下客户消息生成一个专业、友好的回复："
            user_prompt = f"{auto_reply_prompt}\n\n客户: {content}"
            
            # 调用OpenAI API
            model = ai_data.get("model_name") or "gpt-3.5-turbo"
            temperature = ai_data.get("temperature") or 0.7
            max_tokens = ai_data.get("max_tokens") or 2000
            
            logger.info(f"调用API - 模型: {model}, 温度: {temperature}, 历史消息数: {len(chat_history)}")
            
            response = self.call_openai_api_with_history(
                api_key=api_key,
                model=model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
                api_url=ai_data.get("api_url")
            )
            
            if response:
                logger.info(f"API调用成功，生成回复: {response[:50]}...")
                return response
            else:
                logger.warning("API调用失败，使用默认回复")
                return f"自动回复: 收到您的消息 - {content}"
            
        except Exception as e:
            logger.error(f"自动回复处理失败: {e}")
            logger.error(traceback.format_exc())
            return f"自动回复: 收到您的消息 - {content}"
            
    def _get_chat_history(self, session_id: str, limit: int = 10) -> List[Dict[str, Any]]:
        """获取最近的聊天历史记录
        
        Args:
            session_id: 会话ID
            limit: 获取的消息数量限制
            
        Returns:
            聊天历史记录列表，按时间升序排列
        """
        try:
            current_wxid = self.get_current_wxid()
            with self._get_db_connection() as conn:
                cursor = conn.cursor()
                
                # 获取最近的消息，按时间降序排列
                cursor.execute('''
                    SELECT content, is_self, timestamp 
                    FROM messages 
                    WHERE session_id = ? AND wxid = ? 
                    ORDER BY timestamp DESC 
                    LIMIT ?
                ''', (session_id, current_wxid, limit))
                
                messages = []
                for row in cursor.fetchall():
                    messages.append({
                        "content": row[0],
                        "is_self": bool(row[1]),
                        "timestamp": row[2]
                    })
                
                # 反转列表，使其按时间升序排列
                messages.reverse()
                
                logger.info(f"获取到 {len(messages)} 条历史聊天记录")
                return messages
                
        except Exception as e:
            logger.error(f"获取聊天历史记录失败: {e}")
            logger.error(traceback.format_exc())
            return []
            
    def call_openai_api(self, api_key: str, model: str, system_prompt: str, user_prompt: str, 
                       temperature: float = 0.7, max_tokens: int = 2000, api_url: Optional[str] = None) -> Optional[str]:
        """调用OpenAI API生成回复
        
        Args:
            api_key: API密钥
            model: 模型名称
            system_prompt: 系统提示词
            user_prompt: 用户提示词
            temperature: 温度参数
            max_tokens: 最大生成token数
            api_url: 可选的API URL，如果不提供则使用OpenAI默认地址
            
        Returns:
            生成的回复内容，如果调用失败则返回None
        """
        try:
            # 默认使用OpenAI API地址，如果提供了自定义API地址则使用自定义地址
            if api_url:
                url = api_url
            else:
                # 默认使用国内可访问的代理地址
                url = "https://api.openai-proxy.com/v1/chat/completions"
                # 其他可选的代理地址
                # url = "https://openai.aihey.cc/openai/v1/chat/completions"
                # url = "https://openai.wndbac.cn/v1/chat/completions"
                # url = "https://proxy.geekai.co/v1/chat/completions"
            
            # 准备请求头
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}"
            }
            
            # 准备请求体
            data = {
                "model": model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                "temperature": temperature,
                "max_tokens": max_tokens
            }
            
            logger.info(f"开始调用API: {url}")
            
            # 发送请求
            response = requests.post(url, headers=headers, json=data, timeout=30)
            
            # 检查响应状态
            if response.status_code == 200:
                response_data = response.json()
                
                # 提取生成的文本
                if "choices" in response_data and len(response_data["choices"]) > 0:
                    message = response_data["choices"][0].get("message", {})
                    content = message.get("content", "")
                    
                    if content:
                        logger.info(f"API调用成功，获取到回复内容")
                        return content.strip()
                    else:
                        logger.warning(f"API返回内容为空")
                        return None
                else:
                    logger.warning(f"API响应格式不正确: {response_data}")
                    return None
            else:
                logger.error(f"API调用失败，状态码: {response.status_code}, 响应: {response.text}")
                # 如果当前API调用失败，尝试使用备用API
                if url != "https://api.openai.com/v1/chat/completions":
                    logger.info("尝试使用官方API进行调用")
                    return self._fallback_api_call(api_key, model, system_prompt, user_prompt, temperature, max_tokens)
                return None
                
        except Exception as e:
            logger.error(f"调用OpenAI API失败: {e}")
            logger.error(traceback.format_exc())
            # 如果当前API调用出现异常，尝试使用备用API
            if url != "https://api.openai.com/v1/chat/completions":
                logger.info("尝试使用官方API进行调用")
                return self._fallback_api_call(api_key, model, system_prompt, user_prompt, temperature, max_tokens)
            return None
            
    def _fallback_api_call(self, api_key: str, model: str, system_prompt: str, user_prompt: str, 
                          temperature: float = 0.7, max_tokens: int = 2000) -> Optional[str]:
        """备用API调用方法，当主要API调用失败时使用
        
        Args:
            与call_openai_api相同
            
        Returns:
            生成的回复内容，如果调用失败则返回None
        """
        try:
            # 备用API列表
            backup_apis = [
                "https://api.openai.com/v1/chat/completions",
                "https://openai.wndbac.cn/v1/chat/completions",
                "https://proxy.geekai.co/v1/chat/completions"
            ]
            
            for url in backup_apis:
                try:
                    logger.info(f"尝试使用备用API: {url}")
                    
                    # 准备请求头
                    headers = {
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {api_key}"
                    }
                    
                    # 准备请求体
                    data = {
                        "model": model,
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_prompt}
                        ],
                        "temperature": temperature,
                        "max_tokens": max_tokens
                    }
                    
                    # 发送请求
                    response = requests.post(url, headers=headers, json=data, timeout=30)
                    
                    # 检查响应状态
                    if response.status_code == 200:
                        response_data = response.json()
                        
                        # 提取生成的文本
                        if "choices" in response_data and len(response_data["choices"]) > 0:
                            message = response_data["choices"][0].get("message", {})
                            content = message.get("content", "")
                            
                            if content:
                                logger.info(f"备用API调用成功: {url}")
                                return content.strip()
                except Exception as e:
                    logger.warning(f"备用API {url} 调用失败: {e}")
                    continue
            
            logger.error("所有API调用尝试均失败")
            return None
        except Exception as e:
            logger.error(f"备用API调用失败: {e}")
            logger.error(traceback.format_exc())
            return None

    def init(self) -> Dict[str, Any]:
        """初始化微信客户端（API接口）"""
        return self.init_wechat()

    def init_wechat(self) -> Dict[str, Any]:
        """初始化微信客户端"""
        if not WXAUTOX_AVAILABLE:
            return {"success": False, "message": "wxautox not available"}
        try:
            # 已连接且wechat_client存在
            if self.is_connected and self.wechat_client:
                # nickname无效时，强制刷新用户信息
                need_refresh = (
                    not self.cached_user_info or
                    not self.cached_user_info.get("nickname") or
                    self.cached_user_info.get("nickname") == "Unknown"
                )
                if need_refresh:
                    try:
                        user_info = self.wechat_client.GetMyInfo()
                        logger.info(f"GetMyInfo() 原始返回值: {user_info} 类型: {type(user_info)}")
                        nickname, wxid = "Unknown", ""
                        if isinstance(user_info, dict):
                            nickname = user_info.get("nickname") or user_info.get("name") or user_info.get("username") or user_info.get("display_name") or "Unknown"
                            wxid = user_info.get("wxid") or user_info.get("id") or user_info.get("user_id") or ""
                        elif isinstance(user_info, str):
                            nickname = user_info
                        else:
                            if hasattr(user_info, 'GetNickname'):
                                try:
                                    nickname = user_info.GetNickname()
                                except:
                                    pass
                            if hasattr(user_info, 'GetWxid'):
                                try:
                                    wxid = user_info.GetWxid()
                                except:
                                    pass
                        # 只有nickname有效时才更新缓存
                        if nickname and nickname != "Unknown":
                            self.cached_user_info = {"nickname": nickname, "wxid": wxid}
                            if wxid:
                                self.set_current_wxid(wxid)
                            else:
                                self.set_current_wxid(nickname or "default_user")
                            logger.info(f"刷新用户信息: {self.cached_user_info}")
                        else:
                            logger.warning("GetMyInfo() got invalid nickname, keep old cache.")
                    except Exception as e:
                        logger.warning(f"刷新用户信息失败: {e}, keep old cache.")
                else:
                    logger.info(f"使用缓存用户信息: {self.cached_user_info}")
                
                # 初始化成功后，确保监听线程已启动
                if not self.is_monitoring or not self.monitoring_thread or not self.monitoring_thread.is_alive():
                    # 从数据库恢复监听状态
                    self._restore_monitoring_status()
                    self._start_monitoring_thread()
                    # 启动消息处理线程
                    self._start_message_processor()
                    
                return {
                    "success": True,
                    "connected": True,
                    "message": "WeChat connected",
                    "user_info": {
                        "nickname": self.cached_user_info.get("nickname", "Unknown"),
                        "wxid": self.cached_user_info.get("wxid", ""),
                        "is_logged_in": True
                    }
                }
            # 未连接时，初始化
            pythoncom.CoInitialize()
            self.wechat_client = WeChat()
            self.is_connected = True
            # 立即获取并缓存用户信息
            nickname, wxid = "Unknown", ""
            try:
                user_info = self.wechat_client.GetMyInfo()
                logger.info(f"GetMyInfo() 原始返回值: {user_info} 类型: {type(user_info)}")
                if isinstance(user_info, dict):
                    nickname = user_info.get("nickname") or user_info.get("name") or user_info.get("username") or user_info.get("display_name") or "Unknown"
                    wxid = user_info.get("wxid") or user_info.get("id") or user_info.get("user_id") or ""
                elif isinstance(user_info, str):
                    nickname = user_info
                else:
                    if hasattr(user_info, 'GetNickname'):
                        try:
                            nickname = user_info.GetNickname()
                        except:
                            pass
                    if hasattr(user_info, 'GetWxid'):
                        try:
                            wxid = user_info.GetWxid()
                        except:
                            pass
                # 只有nickname有效时才更新缓存
                if nickname and nickname != "Unknown":
                    self.cached_user_info = {"nickname": nickname, "wxid": wxid}
                    if wxid:
                        self.set_current_wxid(wxid)
                    else:
                        self.set_current_wxid(nickname or "default_user")
                else:
                    logger.warning("GetMyInfo() got invalid nickname, keep old cache.")
            except Exception as e:
                logger.warning(f"GetMyInfo() failed: {e}, keep old cache.")
            logger.info(f"Final user info cached: {self.cached_user_info}")
            
            # 初始化成功后，确保监听线程已启动
            if not self.is_monitoring or not self.monitoring_thread or not self.monitoring_thread.is_alive():
                # 从数据库恢复监听状态
                self._restore_monitoring_status()
                self._start_monitoring_thread()
                # 启动消息处理线程
                self._start_message_processor()
                
                
            result = {
                "success": True,
                "connected": True,
                "message": "WeChat initialized successfully",
                "user_info": {
                    "nickname": self.cached_user_info.get("nickname", "Unknown"),
                    "wxid": self.cached_user_info.get("wxid", ""),
                    "is_logged_in": True
                }
            }
            logger.info(f"✅ Initialization successful, result: {result}")
            return result
        except Exception as e:
            logger.error(f"Failed to initialize WeChat: {e}")
            return {
                "success": False,
                "connected": False,
                "message": str(e)
            }

    def get_connection_status(self) -> Dict[str, Any]:
        """获取连接状态"""
        try:
            if not self.wechat_client:
                return {
                    "success": True,
                    "connected": False,
                    "message": "WeChat not connected"
                }

            # 检查连接状态标志
            if not self.is_connected:
                return {
                    "success": True,
                    "connected": False,
                    "message": "WeChat client not properly initialized"
                }

            # 如果有缓存的用户信息，直接使用缓存
            if self.cached_user_info and self.cached_user_info.get("nickname"):
                return {
                    "success": True,
                    "connected": True,
                    "message": "WeChat connected",
                    "user_info": {
                        "nickname": self.cached_user_info.get("nickname", "Unknown"),
                        "wxid": self.cached_user_info.get("wxid", ""),
                        "is_logged_in": True
                    }
                }

            # 如果没有缓存信息，尝试简单测试微信客户端是否可用
            try:
                # 客户端可用但没有用户信息缓存
                return {
                    "success": True,
                    "connected": True,
                    "message": "WeChat connected",
                    "user_info": {
                        "nickname": "WeChat User",
                        "wxid": "",
                        "is_logged_in": True
                    }
                }
            except Exception as test_error:
                # 重置连接状态
                self.is_connected = False
                return {
                    "success": True,
                    "connected": False,
                    "message": f"WeChat client unavailable: {test_error}"
                }
        except Exception as e:
            logger.error(f"获取连接状态失败: {e}")
            return {
                "success": False,
                "connected": False,
                "message": str(e)
            }
    
    def reconnect(self) -> Dict[str, Any]:
        """重新连接微信"""
        try:
            # 重置连接状态
            self.wechat_client = None
            self.is_connected = False
            self.cached_user_info = {}

            # 重新初始化微信
            result = self.init_wechat()

            # 如果初始化成功，确保返回正确的连接状态格式
            if result.get("success"):
                # 获取最新的连接状态
                status_result = self.get_connection_status()
                return status_result
            else:
                return result
        except Exception as e:
            logger.error(f"Failed to reconnect: {e}")
            return {
                "success": False,
                "connected": False,
                "message": str(e)
            }
    
    def get_contacts(self) -> Dict[str, Any]:
        """获取联系人列表"""
        if not self.wechat_client:
            return {"success": False, "message": "WeChat not connected"}

        try:
            # 尝试不同的方法获取联系人
            contact_list = []
            methods_tried = []

            # 方法1: 尝试GetAllContacts (正确的API方法名)
            try:
                if hasattr(self.wechat_client, 'GetAllContacts'):
                    logger.info("Trying GetAllContacts method...")
                    # 先打开通讯录页面
                    self.wechat_client.ChatWith("通讯录")
                    time.sleep(2)  # 等待页面加载

                    contacts = self.wechat_client.GetAllContacts()
                    methods_tried.append("GetAllContacts")
                    if contacts:
                        logger.info(f"GetAllContacts returned {len(contacts)} contacts")
                        for contact in contacts:
                            if isinstance(contact, dict):
                                name = contact.get("name", "")
                                wxid = contact.get("wxid", "")
                                remark = contact.get("remark", "")
                                contact_type = contact.get("type", "friend")  # 直接使用wxautox返回的类型

                                # 如果wxautox没有提供类型信息，则默认为friend
                                # wxautox应该会在contact字典中提供正确的类型信息
                                if not contact_type:
                                    contact_type = "friend"

                                contact_list.append({
                                    "id": wxid or name,
                                    "name": name,
                                    "wxid": wxid,
                                    "remark": remark,
                                    "type": contact_type,
                                    "source": "GetAllContacts"
                                })
                            elif isinstance(contact, str):
                                contact_list.append({
                                    "id": contact,
                                    "name": contact,
                                    "wxid": contact,
                                    "type": "friend",
                                    "source": "GetAllContacts"
                                })

                        if contact_list:
                            logger.info(f"✅ Successfully got {len(contact_list)} contacts using GetAllContacts")

                            # 保存联系人到数据库
                            save_result = self.save_contacts_to_db(contact_list)
                            if save_result.get("success"):
                                logger.info(f"Contacts saved to database: {save_result.get('message')}")

                            return {
                                "success": True,
                                "data": {
                                    "contacts": contact_list,
                                    "method": "GetAllContacts",
                                    "total": len(contact_list)
                                }
                            }
                else:
                    logger.warning("GetAllContacts method not available")
            except Exception as e1:
                logger.warning(f"GetAllContacts failed: {e1}")

            # 方法2: 尝试GetSession (正确的API方法名)
            try:
                if hasattr(self.wechat_client, 'GetSession'):
                    logger.info("Trying GetSession method...")
                    # self.wechat_client.Show()  # 确保窗口可见

                    sessions = self.wechat_client.GetSession()
                    methods_tried.append("GetSession")
                    if sessions:
                        logger.info(f"GetSession returned {len(sessions)} sessions")

                        # 完整展示GetSession返回的原始数据
                        logger.info("=== GetSession Complete Raw Data ===")
                        for i, session in enumerate(sessions):
                            logger.info(f"Session {i+1}:")
                            logger.info(f"  Session object: {session}")
                            logger.info(f"  Session type: {type(session)}")

                            # 显示session的所有属性
                            if hasattr(session, 'info'):
                                info = session.info
                                logger.info(f"  session.info: {info}")

                            # 显示session对象的所有可访问属性
                            attrs = [attr for attr in dir(session) if not attr.startswith('_')]
                            logger.info(f"  Available attributes: {attrs}")

                            for attr in attrs:
                                try:
                                    value = getattr(session, attr)
                                    if not callable(value):  # 只显示非方法属性
                                        logger.info(f"  {attr}: {value}")
                                except:
                                    pass

                        logger.info("=== End Raw Data ===")

                        for session in sessions:
                            # 获取会话信息
                            info = session.info if hasattr(session, 'info') else {}

                            wxid = info.get("wxid", "")
                            name = info.get("name", "")
                            chat_type = info.get("chat_type", "")

                            # 跳过订阅号和空名称
                            if name == "订阅号" or not name.strip():
                                continue

                            # 直接使用wxautox返回的chat_type，不再根据名称判断
                            contact_type = "group" if chat_type == "group" else "friend"

                            # 添加详细日志，验证类型检测
                            logger.info(f"Processing: {name}, chat_type: '{chat_type}', final_type: {contact_type}, wxid: '{wxid}'")

                            contact_list.append({
                                "id": wxid or name,
                                "name": name,
                                "wxid": wxid,
                                "type": contact_type,
                                "source": "GetSession"
                            })

                        if contact_list:
                            logger.info(f"✅ Successfully got {len(contact_list)} contacts using GetSession")

                            # 保存联系人到数据库
                            save_result = self.save_contacts_to_db(contact_list)
                            if save_result.get("success"):
                                logger.info(f"Contacts saved to database: {save_result.get('message')}")

                            return {
                                "success": True,
                                "data": {
                                    "contacts": contact_list,
                                    "method": "GetSession",
                                    "total": len(contact_list)
                                }
                            }
                else:
                    logger.warning("GetSession method not available")
            except Exception as e2:
                logger.warning(f"GetSession failed: {e2}")

            # 如果所有真实方法都失败了，记录详细信息并返回演示数据
            logger.warning(f"⚠️ All real contact methods failed. Methods tried: {methods_tried}")
            logger.warning("Returning demo data as fallback")

            contact_list = [
                {"id": "demo_friend_1", "name": "演示好友1", "type": "friend", "source": "demo"},
                {"id": "demo_friend_2", "name": "演示好友2", "type": "friend", "source": "demo"},
                {"id": "demo_friend_3", "name": "演示好友3", "type": "friend", "source": "demo"}
            ]

            return {
                "success": True,
                "data": {
                    "contacts": contact_list,
                    "method": "demo_fallback",
                    "total": len(contact_list),
                    "methods_tried": methods_tried
                },
                "message": f"Using demo data. Real methods tried: {', '.join(methods_tried)}"
            }
        except Exception as e:
            logger.error(f"Failed to get contacts: {e}")
            return {"success": False, "message": str(e)}

    def save_contacts_to_db(self, contacts: List[Dict[str, Any]]) -> Dict[str, Any]:
        """保存联系人到数据库"""
        try:
            if not contacts:
                return {"success": False, "message": "没有联系人需要保存"}

            # 使用文本格式的时间戳，确保与数据库TEXT类型兼容
            current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            current_wxid = self.get_current_wxid()
            saved_count = 0

            # 创建新的数据库连接
            with sqlite3.connect(DB_PATH) as conn:
                cursor = conn.cursor()

                for contact in contacts:
                    try:
                        name = contact.get("name", "")
                        if not name:
                            continue
                            
                        contact_type = contact.get("type", "friend")
                        # 对于NOT NULL字段确保有默认值
                        remark = contact.get("remark") or "暂无备注"
                        avatar = contact.get("avatar") or ""
                        source = contact.get("source") or "wxautox"

                        # 查询是否已存在该联系人
                        cursor.execute(
                            "SELECT id FROM contacts WHERE wxid = ? AND name = ?",
                            (current_wxid, name)
                        )
                        row = cursor.fetchone()
                        
                        if row:
                            # 已存在，更新
                            cursor.execute('''
                            UPDATE contacts SET
                                type = ?, remark = ?, avatar = ?, source = ?, updated_at = ?
                            WHERE wxid = ? AND name = ?
                            ''', (contact_type, remark, avatar, source, current_time, current_wxid, name))
                        else:
                            # 不存在，插入新记录
                            cursor.execute('''
                            INSERT INTO contacts
                            (wxid, name, type, remark, avatar, source, created_at, updated_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                            ''', (current_wxid, name, contact_type, remark, avatar, source, current_time, current_time))

                        saved_count += 1

                    except Exception as e:
                        logger.warning(f"Failed to save contact {contact.get('name', 'unknown')}: {e}")
                        continue

                conn.commit()
                logger.info(f"Successfully saved {saved_count} contacts to database")

            return {
                "success": True,
                "message": f"Successfully saved {saved_count} contacts",
                "data": {"saved_count": saved_count}
            }

        except Exception as e:
            logger.error(f"Failed to save contacts to database: {e}")
            return {"success": False, "message": str(e)}

    def get_contacts_from_db(self) -> Dict[str, Any]:
        """获取联系人列表并关联监听状态"""
        logger.info("🔄 获取联系人列表...")
        try:
            # 1. 先获取wxautox的最新联系人（用于排序参考）
            wxautox_contacts = []
            wxautox_order = []  # 记录wxautox返回的顺序

            try:
                if self.wechat_client and hasattr(self.wechat_client, 'GetSession'):
                    sessions = self.wechat_client.GetSession()
                    if sessions:
                        for i, session in enumerate(sessions):
                            try:
                                info = session.info if hasattr(session, 'info') else {}
                                name = info.get("name", "")
                                wxid = info.get("wxid", "")
                                chat_type = info.get("chat_type", "")

                                if name and name != "订阅号":
                                    contact_type = "group" if chat_type == "group" else "friend"
                                    # 格式化时间为字符串，以匹配数据库TEXT字段
                                    current_time_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                                    contact_data = {
                                        "id": wxid or name,
                                        "name": name,
                                        "type": contact_type,
                                        "remark": "暂无备注", # 确保NOT NULL字段有值
                                        "avatar": "", # 空字符串满足NOT NULL约束 
                                        "source": "wxautox_fresh",
                                        "created_at": current_time_str,
                                        "updated_at": current_time_str,
                                        "is_monitoring": False  # 默认为未监听状态
                                    }
                                    wxautox_contacts.append(contact_data)
                                    wxautox_order.append(name)  # 记录顺序
                            except Exception as e:
                                logger.warning(f"处理会话 {i+1} 失败: {e}")
                                continue
            except Exception as e:
                logger.warning(f"获取wxautox联系人失败: {e}")

            # 如果获取到wxautox数据，先保存到数据库
            if wxautox_contacts:
                logger.info(f"从wxautox获取到 {len(wxautox_contacts)} 个联系人，准备保存到数据库")
                save_result = self.save_contacts_to_db(wxautox_contacts)
                if save_result.get("success"):
                    logger.info(f"wxautox联系人保存成功: {save_result.get('message')}")
                else:
                    logger.error(f"wxautox联系人保存失败: {save_result.get('message')}")

            # 2. 从数据库获取联系人数据（关联sessions表获取监听状态）
            current_wxid = self.get_current_wxid()
            logger.info(f"使用当前用户wxid: {current_wxid}")
            db_contacts = []
            with sqlite3.connect(DB_PATH) as conn:
                cursor = conn.cursor()
                try:
                    # 尝试关联查询获取监听状态
                    cursor.execute('''
                    SELECT c.id, c.name, c.type, c.remark, c.avatar, c.source, c.created_at, c.updated_at, 
                           CASE WHEN s.is_monitoring IS NULL THEN 0 ELSE s.is_monitoring END as is_monitoring
                    FROM contacts c
                    LEFT JOIN sessions s ON s.session_id = ('private_self_' || c.name) AND s.wxid = c.wxid
                    WHERE c.wxid = ?
                    ORDER BY c.updated_at DESC
                    ''', (current_wxid,))
                    has_is_monitoring = True
                except Exception as e:
                    logger.error(f"关联查询失败: {e}")
                    # 关联查询失败时回退到基本查询
                    cursor.execute('''
                    SELECT id, name, type, remark, avatar, source, created_at, updated_at
                    FROM contacts
                    WHERE wxid = ?
                    ORDER BY updated_at DESC
                    ''', (current_wxid,))
                    has_is_monitoring = False

                rows = cursor.fetchall()
                for row in rows:
                    contact = {
                        "id": row[0],
                        "name": row[1],
                        "type": row[2],
                        "remark": row[3],
                        "avatar": row[4],
                        "source": row[5],
                        "created_at": row[6],
                        "updated_at": row[7]
                    }
                    
                    # 添加监听状态字段
                    if has_is_monitoring and len(row) > 8:
                        contact["is_monitoring"] = bool(row[8])
                    else:
                        contact["is_monitoring"] = False
                        
                    db_contacts.append(contact)
            
            logger.info(f"从数据库读取了 {len(db_contacts)} 个联系人")

            # 3. 按wxautox顺序对合并结果进行排序
            # 如果有wxautox顺序数据，使用它排序，否则按更新时间排序
            if wxautox_order:
                db_contacts = self._sort_contacts_by_wxautox_order(db_contacts, wxautox_order)
                
            # 分类为好友和群组
            friends = [contact for contact in db_contacts if contact["type"] == "friend"]
            groups = [contact for contact in db_contacts if contact["type"] == "group"]
            
            logger.info(f"处理后: {len(friends)} 个好友, {len(groups)} 个群组")
            
            # 返回最终结果
            return {
                "success": True,
                "data": {
                    "contacts": db_contacts,
                    "friends": friends,
                    "groups": groups,
                    "total": len(db_contacts)
                },
                "message": f"成功获取 {len(db_contacts)} 个联系人 ({len(friends)} 个好友, {len(groups)} 个群组)"
            }
        except Exception as e:
            logger.error(f"获取联系人列表失败: {e}")
            logger.error(traceback.format_exc())
            return {"success": False, "message": str(e)}

    def _sort_contacts_by_wxautox_order(self, contacts: List[Dict[str, Any]], wxautox_order: List[str]) -> List[Dict[str, Any]]:
        """按照wxautox返回的顺序对联系人进行排序，确保老林AI在第一位，wxautox_fresh来源优先"""
        if not contacts:
            return []
            
        # 先按来源分组
        wxautox_fresh_contacts = []  # wxautox_fresh来源的联系人
        other_contacts = []  # 其他来源的联系人
        
        for contact in contacts:
            if contact.get("source") == "wxautox_fresh":
                wxautox_fresh_contacts.append(contact)
            else:
                other_contacts.append(contact)
                
        logger.info(f"排序前: {len(wxautox_fresh_contacts)} 个wxautox_fresh联系人, {len(other_contacts)} 个其他联系人")
        
        if not wxautox_order:
            # 如果没有wxautox顺序，只确保老林AI在第一位，wxautox_fresh在前
            lao_lin_contact = None
            sorted_wxautox_fresh = []
            sorted_other = []

            # 从wxautox_fresh中找出老林AI
            for contact in wxautox_fresh_contacts:
                if contact["name"] == "老林AI":
                    lao_lin_contact = contact
                else:
                    sorted_wxautox_fresh.append(contact)
            
            # 从其他联系人中找出老林AI
            if not lao_lin_contact:
                for contact in other_contacts:
                    if contact["name"] == "老林AI":
                        lao_lin_contact = contact
                    else:
                        sorted_other.append(contact)
            else:
                sorted_other = other_contacts

            # 组合结果：老林AI > wxautox_fresh > 其他
            if lao_lin_contact:
                return [lao_lin_contact] + sorted_wxautox_fresh + sorted_other
            else:
                return sorted_wxautox_fresh + sorted_other
        
        # 创建名称到联系人的映射（分别为wxautox_fresh和其他来源）
        wxautox_fresh_map = {contact["name"]: contact for contact in wxautox_fresh_contacts}
        other_map = {contact["name"]: contact for contact in other_contacts}
        
        # 按wxautox顺序排序
        sorted_contacts = []
        used_names = set()
        
        # 1. 首先按wxautox顺序添加wxautox_fresh来源的联系人
        for name in wxautox_order:
            if name in wxautox_fresh_map:
                sorted_contacts.append(wxautox_fresh_map[name])
                used_names.add(name)
        
        # 2. 然后按wxautox顺序添加其他来源的联系人（如果名称未被使用）
        for name in wxautox_order:
            if name not in used_names and name in other_map:
                sorted_contacts.append(other_map[name])
                used_names.add(name)
                
        # 3. 添加剩余的wxautox_fresh联系人（不在wxautox_order中的）
        for contact in wxautox_fresh_contacts:
            if contact["name"] not in used_names:
                sorted_contacts.append(contact)
                used_names.add(contact["name"])
                
        # 4. 添加剩余的其他联系人
        for contact in other_contacts:
            if contact["name"] not in used_names:
                sorted_contacts.append(contact)
                used_names.add(contact["name"])

        # 确保老林AI在第一位
        lao_lin_contact = None
        other_sorted_contacts = []

        for contact in sorted_contacts:
            if contact["name"] == "老林AI":
                lao_lin_contact = contact
            else:
                other_sorted_contacts.append(contact)

        if lao_lin_contact:
            final_contacts = [lao_lin_contact] + other_sorted_contacts
        else:
            final_contacts = other_sorted_contacts
            
        logger.info(f"排序后: 共 {len(final_contacts)} 个联系人，老林AI是否在首位: {lao_lin_contact is not None}")

        return final_contacts

    def get_groups(self) -> Dict[str, Any]:
        """获取群组列表"""
        if not self.wechat_client:
            return {"success": False, "message": "WeChat not connected"}

        try:
            # 尝试获取群聊列表
            group_list = []
            methods_tried = []

            # 方法1: 尝试GetAllGroups (正确的API方法名)
            try:
                if hasattr(self.wechat_client, 'GetAllGroups'):
                    logger.info("Trying GetAllGroups method...")
                    # 先打开通讯录页面
                    self.wechat_client.ChatWith("通讯录")
                    time.sleep(2)  # 等待页面加载

                    groups = self.wechat_client.GetAllGroups()
                    methods_tried.append("GetAllGroups")
                    if groups:
                        logger.info(f"GetAllGroups returned {len(groups)} groups")
                        for group in groups:
                            if isinstance(group, dict):
                                name = group.get("name", "")
                                wxid = group.get("wxid", "")

                                group_list.append({
                                    "id": wxid or name,
                                    "name": name,
                                    "wxid": wxid,
                                    "type": "group",
                                    "source": "GetAllGroups"
                                })
                            elif isinstance(group, str):
                                group_list.append({
                                    "id": group,
                                    "name": group.replace("@chatroom", ""),
                                    "wxid": group,
                                    "type": "group",
                                    "source": "GetAllGroups"
                                })

                        if group_list:
                            logger.info(f"✅ Successfully got {len(group_list)} groups using GetAllGroups")
                            return {
                                "success": True,
                                "data": {
                                    "groups": group_list,
                                    "method": "GetAllGroups",
                                    "total": len(group_list)
                                }
                            }
                else:
                    logger.warning("GetAllGroups method not available")
            except Exception as e1:
                logger.warning(f"GetAllGroups failed: {e1}")

            # 方法2: 尝试GetSession并过滤群聊 (正确的API方法名)
            try:
                if hasattr(self.wechat_client, 'GetSession'):
                    logger.info("Trying GetSession method for groups...")
                    # self.wechat_client.Show()  # 确保窗口可见

                    sessions = self.wechat_client.GetSession()
                    methods_tried.append("GetSession")
                    if sessions:
                        logger.info(f"GetSession returned {len(sessions)} sessions")
                        for session in sessions:
                            # 获取会话信息
                            info = session.info if hasattr(session, 'info') else {}

                            # 只处理群聊
                            if info.get("chat_type") == "group":
                                wxid = info.get("wxid", "")
                                name = info.get("name", "")
                                member_count = info.get("group_member_count", 0)

                                group_list.append({
                                    "id": wxid or name,
                                    "name": name,
                                    "wxid": wxid,
                                    "type": "group",
                                    "member_count": member_count,
                                    "source": "GetSession"
                                })

                        if group_list:
                            logger.info(f"✅ Successfully got {len(group_list)} groups using GetSession")
                            return {
                                "success": True,
                                "data": {
                                    "groups": group_list,
                                    "method": "GetSession",
                                    "total": len(group_list)
                                }
                            }
                else:
                    logger.warning("GetSession method not available")
            except Exception as e2:
                logger.warning(f"GetSession for groups failed: {e2}")

            # 如果所有真实方法都失败了，记录详细信息并返回演示数据
            logger.warning(f"⚠️ All real group methods failed. Methods tried: {methods_tried}")
            logger.warning("Returning demo data as fallback")

            group_list = [
                {"id": "demo_group_1@chatroom", "name": "演示群聊1", "type": "group", "member_count": 10, "source": "demo"},
                {"id": "demo_group_2@chatroom", "name": "演示群聊2", "type": "group", "member_count": 25, "source": "demo"}
            ]

            return {
                "success": True,
                "data": {
                    "groups": group_list,
                    "method": "demo_fallback",
                    "total": len(group_list),
                    "methods_tried": methods_tried
                },
                "message": f"Using demo data. Real methods tried: {', '.join(methods_tried)}"
            }
        except Exception as e:
            logger.error(f"Failed to get groups: {e}")
            return {"success": False, "message": str(e)}

    def get_session_list(self) -> Dict[str, Any]:
        """获取会话列表（包含联系人和群组）"""
        if not self.wechat_client:
            return {"success": False, "message": "WeChat not connected"}

        try:
            session_list = []
            methods_tried = []

            # 尝试获取真实的会话列表
            try:
                # 方法1: 尝试使用GetSession（正确的API方法名）
                if hasattr(self.wechat_client, 'GetSession'):
                    logger.info("Trying GetSession method for session list...")
                    # self.wechat_client.Show()  # 确保窗口可见

                    sessions = self.wechat_client.GetSession()
                    methods_tried.append("GetSession")
                    if sessions:
                        logger.info(f"GetSession returned {len(sessions)} sessions")
                        for session in sessions:
                            # 获取会话信息
                            info = session.info if hasattr(session, 'info') else {}

                            wxid = info.get("wxid", "")
                            name = info.get("name", "")
                            chat_type = info.get("chat_type", "friend")

                            # 跳过订阅号和空名称
                            if name == "订阅号" or not name.strip():
                                continue

                            session_info = {
                                "id": wxid or name,
                                "name": name,
                                "type": "group" if chat_type == "group" else "friend",
                                "lastMessage": "点击刷新获取最新消息",
                                "lastTime": "刚刚"
                            }

                            if chat_type == "group":
                                session_info["member_count"] = info.get("group_member_count", 0)

                            session_list.append(session_info)

                        if session_list:
                            logger.info(f"✅ Successfully got {len(session_list)} sessions using GetSession")
                            return {
                                "success": True,
                                "data": {
                                    "sessions": session_list,
                                    "method": "GetSession",
                                    "total": len(session_list)
                                }
                            }
                else:
                    logger.warning("GetSession method not available")

                    # 方法2: 分别获取联系人和群组
                    logger.info("Trying to combine contacts and groups...")
                    contacts_result = self.get_contacts()
                    groups_result = self.get_groups()
                    methods_tried.append("combined_contacts_groups")

                    if contacts_result.get("success") and contacts_result.get("data"):
                        for contact in contacts_result["data"].get("contacts", []):
                            if contact.get("source") != "demo":  # 只添加真实数据
                                session_list.append({
                                    "id": contact.get("id", ""),
                                    "name": contact.get("name", ""),
                                    "type": contact.get("type", "friend"),  # 使用联系人的实际类型
                                    "lastMessage": "点击刷新获取最新消息",
                                    "lastTime": "刚刚"
                                })

                    if groups_result.get("success") and groups_result.get("data"):
                        for group in groups_result["data"].get("groups", []):
                            if group.get("source") != "demo":  # 只添加真实数据
                                session_list.append({
                                    "id": group.get("id", ""),
                                    "name": group.get("name", ""),
                                    "type": "group",
                                    "member_count": group.get("member_count", 0),
                                    "lastMessage": "点击刷新获取最新消息",
                                    "lastTime": "刚刚"
                                })

                    if session_list:
                        logger.info(f"✅ Successfully got {len(session_list)} sessions by combining contacts and groups")
                        return {
                            "success": True,
                            "data": {
                                "sessions": session_list,
                                "method": "combined_contacts_groups",
                                "total": len(session_list)
                            }
                        }

            except Exception as e1:
                logger.warning(f"Failed to get real session list: {e1}")
            return {
                "success": True,
                "data": {
                    "sessions": session_list,
                    "method": "demo_fallback",
                    "total": len(session_list),
                    "methods_tried": methods_tried
                },
                "message": f"Using demo data. Real methods tried: {', '.join(methods_tried)}"
            }
        except Exception as e:
            logger.error(f"Failed to get session list: {e}")
            return {"success": False, "message": str(e)}

    def send_message(self, contact_name: str, message: str) -> Dict[str, Any]:
        """发送消息"""
        try:
            logger.info(f"🔄 准备发送消息给 {contact_name}")

            # 发送消息
            result = self.wx.send_message(contact_name, message)
            if not result:
                logger.error(f"❌ 发送消息失败: {contact_name}")
                return {"success": False, "message": "发送消息失败"}
                
            logger.info(f"✅ 消息已发送: {contact_name}")
            
            # 保存发送的消息到数据库
            session_id = f"private_self_{contact_name}"
            self._save_message_to_db(
                session_id=session_id,
                content=message,
                message_type="text",
                sender="self",
                sender_type="self",
                status=1,  # 1表示已发送
                extra={"message_type": "text"}
            )
            
            return {"success": True, "message": "消息已发送"}
        except Exception as e:
            logger.error(f"❌ 发送消息失败: {e}")
            logger.error(traceback.format_exc())
            return {"success": False, "message": str(e)}
    
    def bulk_send(self, contacts: List[str], message: str, delay_range: Optional[List[int]] = None) -> Dict[str, Any]:
        """批量发送消息"""
        if not self.wechat_client:
            return {"success": False, "message": "WeChat not connected"}
            
        try:
            import random
            
            delay_min, delay_max = delay_range or [2, 5]
            success_count = 0
            
            for contact in contacts:
                try:
                    # 发送消息
                    result = self.send_message(contact, message)
                    if result["success"]:
                        success_count += 1
                    
                    # 随机延迟
                    delay = random.uniform(delay_min, delay_max)
                    time.sleep(delay)
                    
                except Exception as e:
                    logger.error(f"Failed to send message to {contact}: {e}")
            
            return {
                "success": True,
                "message": f"Sent to {success_count}/{len(contacts)} contacts"
            }
        except Exception as e:
            logger.error(f"Failed to bulk send: {e}")
            return {"success": False, "message": str(e)}
    
    def get_message_history(self, contact_name: str, force_refresh: bool = False, page: int = 1, per_page: int = 50) -> Dict[str, Any]:
        """获取消息历史"""
        try:
            session_id = f"private_self_{contact_name}"
            current_wxid = self.get_current_wxid()
            # 从数据库获取消息
            with self._get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    SELECT * FROM messages 
                    WHERE session_id = ? AND wxid = ?
                    ORDER BY timestamp DESC
                    LIMIT ? OFFSET ?
                ''', (session_id, current_wxid, per_page, (page - 1) * per_page))
                
                messages = []
                for row in cursor.fetchall():
                    message = dict(row)
                    # 处理extra字段
                    if message.get('extra_data'):
                        try:
                            message['extra'] = json.loads(message['extra_data'])
                        except:
                            message['extra'] = {}
                    messages.append(message)
                
                # 获取总消息数
                cursor.execute('''
                    SELECT COUNT(*) as total FROM messages 
                    WHERE session_id = ? AND wxid = ?
                ''', (session_id, current_wxid))
                
                total = cursor.fetchone()[0]
                
                # 获取相关的回复建议
                cursor.execute('''
                    SELECT rs.id, rs.content, rs.message_id, rs.timestamp, rs.created_at, rs.used
                    FROM reply_suggestions rs
                    JOIN messages m ON rs.message_id = m.id
                    WHERE rs.session_id = ? AND rs.wxid = ?
                    ORDER BY rs.timestamp DESC
                ''', (session_id, current_wxid))
                
                suggestions = []
                for row in cursor.fetchall():
                    suggestion = {
                        "id": row[0],
                        "content": row[1],
                        "message_id": row[2],
                        "timestamp": row[3],
                        "created_at": row[4],
                        "used": bool(row[5]),
                        "formatted_time": datetime.fromtimestamp(row[3]).strftime("%Y-%m-%d %H:%M:%S")
                    }
                    suggestions.append(suggestion)
                
                return {
                    "success": True,
                    "data": {
                        "messages": messages,
                        "total": total,
                        "page": page,
                        "per_page": per_page,
                        "session_id": session_id,
                        "wxid": current_wxid,
                        "suggestions": suggestions
                    }
                }
        except Exception as e:
            logger.error(f"❌ 获取消息历史失败: {e}")
            logger.error(traceback.format_exc())
            return {"success": False, "message": str(e)}

    def _get_messages_from_db(self, session_id: str, limit: int = None) -> List[Dict[str, Any]]:
        """从数据库获取消息 - 优化版本，只返回必要字段

        Args:
            session_id: 会话ID
            limit: 限制返回的消息数量，None表示不限制
        """
        try:
            current_wxid = self.get_current_wxid()
            with sqlite3.connect(DB_PATH) as conn:
                cursor = conn.cursor()

                # 只查询必要的字段，减少数据传输量
                if limit:
                    cursor.execute('''
                    SELECT id, content, is_self, timestamp, msg_type, sender, attr, extra_data
                    FROM messages
                    WHERE session_id = ? AND wxid = ?
                    ORDER BY id DESC
                    LIMIT ?
                    ''', (session_id, current_wxid, limit))
                else:
                    cursor.execute('''
                    SELECT id, content, is_self, timestamp, msg_type, sender, attr, extra_data
                    FROM messages
                    WHERE session_id = ? AND wxid = ?
                    ORDER BY id DESC
                    ''', (session_id, current_wxid))

                rows = cursor.fetchall()
                messages = []

                for row in rows:
                    msg_id, content, is_self, timestamp, msg_type, sender, attr, extra_data = row
                    message = {
                        "id": msg_id,
                        "content": content,
                        "is_self": bool(is_self),
                        "timestamp": timestamp,
                        "time": datetime.fromtimestamp(timestamp).strftime("%Y-%m-%d %H:%M:%S"),
                        "message_type": msg_type or "text",
                        "sender": sender or "",
                        "attr": attr or ""
                    }

                    # 只解析必要的额外数据
                    if extra_data:
                        try:
                            extra = json.loads(extra_data)
                            # 只提取message_type，忽略其他不必要的字段
                            if extra.get('message_type'):
                                message["message_type"] = extra['message_type']
                        except:
                            pass

                    messages.append(message)

                # 将消息重新排序为升序（最新的在底部），因为前端需要这样的顺序
                messages.sort(key=lambda x: x.get('id', 0))
                return messages
        except Exception as e:
            logger.error(f"Failed to get messages from database: {e}")
            return []

    def _get_messages_from_db_with_pagination(self, session_id: str, limit: int = 40, offset: int = 0) -> List[Dict[str, Any]]:
        """从数据库获取消息 - 带分页支持，获取最新的记录

        Args:
            session_id: 会话ID
            limit: 限制返回的消息数量
            offset: 偏移量
        """
        try:
            current_wxid = self.get_current_wxid()
            with sqlite3.connect(DB_PATH) as conn:
                cursor = conn.cursor()
                cursor.execute('''
                SELECT id, content, is_self, timestamp, msg_type, sender, attr, extra_data
                FROM messages
                WHERE session_id = ? AND wxid = ?
                ORDER BY id DESC
                LIMIT ? OFFSET ?
                ''', (session_id, current_wxid, limit, offset))
                rows = cursor.fetchall()
                messages = []

                for row in rows:
                    msg_id, content, is_self, timestamp, msg_type, sender, attr, extra_data = row
                    message = {
                        "id": msg_id,
                        "content": content,
                        "is_self": bool(is_self),
                        "timestamp": timestamp,
                        "time": datetime.fromtimestamp(timestamp).strftime("%Y-%m-%d %H:%M:%S"),
                        "message_type": msg_type or "text",
                        "sender": sender or "",
                        "attr": attr or ""
                    }

                    # 只解析必要的额外数据
                    if extra_data:
                        try:
                            extra = json.loads(extra_data)
                            # 只提取message_type，忽略其他不必要的字段
                            if extra.get('message_type'):
                                message["message_type"] = extra['message_type']
                        except:
                            pass

                    messages.append(message)

                # 将消息按ID升序排列（最早的在上面，最新的在下面）
                messages.sort(key=lambda x: x.get('id', 0))
                return messages
        except Exception as e:
            logger.error(f"Failed to get messages from database with pagination: {e}")
            return []



    def _get_messages_count(self, session_id: str) -> int:
        """获取指定会话的消息总数"""
        try:
            current_wxid = self.get_current_wxid()
            with sqlite3.connect(DB_PATH) as conn:
                cursor = conn.cursor()
                cursor.execute('''
                SELECT COUNT(*) FROM messages
                WHERE session_id = ? AND wxid = ?
                ''', (session_id, current_wxid))

                result = cursor.fetchone()
                return result[0] if result else 0
        except Exception as e:
            logger.error(f"Failed to get messages count: {e}")
            return 0

    def _process_and_save_messages_with_order(self, new_messages: List[Any], session_id: str, existing_messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """处理新消息并与现有消息合并，不进行去重，按照获取到的数据进行排序"""
        try:
            logger.info(f"开始合并消息（不去重）：新消息 {len(new_messages)} 条，现有消息 {len(existing_messages)} 条")

            # 1. 处理新消息（不保存到数据库，只是格式化）
            processed_new_messages = []
            current_time = int(time.time())

            for i, msg in enumerate(new_messages):
                try:
                    # 解析消息内容 - 根据wxautox的消息对象结构
                    content = ""
                    is_self = False
                    timestamp = current_time + i  # 使用递增时间戳确保顺序
                    extra_data = {}
                    sender = ''
                    attr = ''
                    msg_type_from_data = 'text'

                    if hasattr(msg, '__dict__'):
                        # wxautox消息对象
                        content = getattr(msg, 'content', '')
                        sender = getattr(msg, 'sender', '')
                        attr = getattr(msg, 'attr', '')
                        msg_type = getattr(msg, 'type', '')
                        msg_time = getattr(msg, 'time', None)

                        # 判断是否为自己发送的消息
                        is_self = (attr == 'self')

                        # 处理时间
                        if msg_time:
                            try:
                                if isinstance(msg_time, str) and ":" in msg_time:
                                    today = datetime.now().strftime("%Y-%m-%d")
                                    time_str = f"{today} {msg_time}"
                                    dt = datetime.strptime(time_str, "%Y-%m-%d %H:%M")
                                    timestamp = int(dt.timestamp())
                                else:
                                    timestamp = int(float(msg_time))
                            except:
                                timestamp = current_time + i

                        # 保存额外数据 - 只保存必要信息
                        extra_data = {
                            'message_type': 'time' if (sender == 'base' and attr == 'base') else 'text'
                        }

                        msg_type_from_data = msg_type

                    elif isinstance(msg, dict):
                        content = msg.get('content', str(msg))
                        is_self = msg.get('is_self', False)
                        timestamp = msg.get('timestamp', current_time + i)
                        sender = msg.get('sender', '')
                        attr = msg.get('attr', '')
                        msg_type_from_data = msg.get('msg_type', 'text')
                        extra_data = {
                            'message_type': 'time' if (sender == 'base' and attr == 'base') else 'text'
                        }
                    else:
                        content = str(msg)
                        timestamp = current_time + i
                        extra_data = {}

                    # 根据数据确定消息类型
                    message_type = 'text'
                    if sender == 'base' and attr == 'base' and msg_type_from_data == 'other':
                        message_type = 'time'
                        extra_data['message_type'] = 'time'
                    elif extra_data.get('message_type'):
                        message_type = extra_data['message_type']
                    elif msg_type_from_data == 'system':
                        message_type = 'system'
                    else:
                        message_type = msg_type_from_data

                    # 创建处理后的消息 - 只返回必要字段
                    processed_message = {
                        "content": content,
                        "is_self": is_self,
                        "timestamp": timestamp,
                        "time": datetime.fromtimestamp(timestamp).strftime("%Y-%m-%d %H:%M:%S"),
                        "message_type": message_type,
                        "sender": sender,
                        "attr": attr
                    }
                    processed_message.update(extra_data)
                    processed_new_messages.append(processed_message)

                except Exception as e:
                    logger.error(f"Failed to process new message: {e}")
                    continue

            # 2. 合并消息：直接合并所有消息，不进行去重
            final_messages = []

            # 先添加新消息
            for msg in processed_new_messages:
                final_messages.append(msg)

            # 再添加数据库中的消息
            for msg in existing_messages:
                msg['source'] = 'database'  # 标记为数据库数据
                final_messages.append(msg)

            # 3. 按照时间戳排序（新消息在前，因为它们有更新的时间戳）
            final_messages.sort(key=lambda x: x.get('timestamp', 0))

            # 4. 保存新消息到数据库
            if processed_new_messages:
                self._save_new_messages_to_db(processed_new_messages, session_id)

            logger.info(f"消息合并完成（未去重）：最终 {len(final_messages)} 条消息")
            return final_messages

        except Exception as e:
            logger.error(f"Failed to process and merge messages: {e}")
            return existing_messages  # 出错时返回现有消息

    def _save_new_messages_to_db(self, messages: List[Dict[str, Any]], session_id: str):
        """将新消息保存到数据库"""
        try:
            current_wxid = self.get_current_wxid()
            with self._get_db_connection() as conn:
                cursor = conn.cursor()
                
                # 检查表结构
                cursor.execute("PRAGMA table_info(messages)")
                columns = [column[1] for column in cursor.fetchall()]
                has_original_time = 'original_time' in columns
                has_formatted_time = 'formatted_time' in columns
                has_created_at = 'created_at' in columns
                has_hash = 'hash' in columns

                for msg in messages:
                    # 准备基本参数
                    params = [
                        session_id,
                        current_wxid,
                        msg['content'],
                        int(msg['is_self']),
                        msg['timestamp'],
                        json.dumps({k: v for k, v in msg.items() if k not in ['content', 'is_self', 'timestamp', 'message_type', 'sender', 'attr', 'original_time', 'formatted_time']}) or None,
                        msg.get('message_type', 'text'),
                        msg.get('sender', ''),
                        msg.get('attr', '')
                    ]
                    
                    # 构建SQL语句
                    sql = 'INSERT INTO messages (session_id, wxid, content, is_self, timestamp, extra_data, msg_type, sender, attr'
                    
                    # 添加可选字段
                    if has_original_time:
                        sql += ', original_time'
                        params.append(msg.get('original_time', ''))
                    
                    if has_formatted_time:
                        sql += ', formatted_time'
                        params.append(msg.get('formatted_time', ''))
                    
                    if has_created_at:
                        sql += ', created_at'
                        params.append(datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
                    
                    if has_hash:
                        sql += ', hash'
                        params.append(msg.get('hash', None))
                    
                    sql += ') VALUES (' + ', '.join(['?'] * len(params)) + ')'
                    
                    # 执行SQL
                    cursor.execute(sql, params)

                conn.commit()
                logger.info(f"成功保存 {len(messages)} 条新消息到数据库")

        except Exception as e:
            logger.error(f"Failed to save new messages to database: {e}")
            logger.error(traceback.format_exc())

    def _wait_for_window_load(self, max_wait: int = 5) -> bool:
        """等待聊天窗口加载完成

        Args:
            max_wait: 最大等待时间（秒）
        """
        try:
            for i in range(max_wait * 2):  # 每0.5秒检查一次
                time.sleep(0.5)

                # 尝试检查窗口是否已加载
                # 这里可以添加更具体的窗口检查逻辑
                if i >= 2:  # 至少等待1秒
                    # 减少详细日志输出
                    return True

            logger.warning(f"聊天窗口加载超时 (等待 {max_wait} 秒)")
            return True  # 即使超时也继续执行

        except Exception as e:
            logger.error(f"等待窗口加载失败: {e}")
            return True  # 出错时也继续执行

    def _load_more_messages(self, max_attempts: int = 5):
        """加载更多历史消息"""
        try:
            load_count = 0
            has_more_messages = True

            # 循环加载历史消息，直到没有更多消息或达到最大尝试次数
            while has_more_messages and load_count < max_attempts:
                try:
                    # 减少详细日志输出

                    if hasattr(self.wechat_client, 'LoadMoreMessage'):
                        load_more_result = self.wechat_client.LoadMoreMessage()
                        logger.info(f"LoadMoreMessage第{load_count+1}次调用结果: {load_more_result}")

                        # 检查是否成功加载更多消息
                        if isinstance(load_more_result, dict) and load_more_result.get('status') == '失败':
                            # 微信返回失败，可能是因为没有更多消息了
                            if '没有更多消息' in load_more_result.get('message', ''):
                                logger.info("没有更多历史消息可加载")
                                has_more_messages = False
                            else:
                                logger.warning(f"加载更多消息失败: {load_more_result.get('message', '未知错误')}")
                                has_more_messages = False
                        elif not load_more_result:
                            # 空结果，可能意味着没有更多消息
                            logger.info("LoadMoreMessage返回空结果，可能没有更多消息")
                            has_more_messages = False
                        else:
                            # 加载成功，但需要短暂延迟
                            logger.info(f"成功加载第{load_count+1}批历史消息")
                            load_count += 1
                            time.sleep(1)  # 增加延迟，确保消息完全加载
                    else:
                        # 如果没有LoadMoreMessage方法，尝试按键方式
                        logger.info("使用按键方式加载更多消息")
                        if hasattr(self.wechat_client, 'SendKeys'):
                            self.wechat_client.SendKeys(keys='^{HOME}', wait_time=0.5)
                            time.sleep(1)
                            load_count += 1
                        else:
                            logger.warning("无法加载更多消息，没有可用的方法")
                            break

                except Exception as e:
                    logger.warning(f"加载更多历史消息失败: {str(e)}")
                    has_more_messages = False

            logger.info(f"历史消息加载完成，共尝试加载{load_count}次")

        except Exception as e:
            logger.error(f"Failed to load more messages: {e}")

    def _get_all_messages(self) -> List[Any]:
        """获取当前聊天窗口的所有消息"""
        try:
            # 减少详细日志输出，只在调试时启用
            # logger.info("开始获取消息，检查微信客户端状态...")
            # logger.info(f"微信客户端类型: {type(self.wechat_client)}")

            # 检查微信客户端可用方法
            if self.wechat_client:
                available_methods = [method for method in dir(self.wechat_client) if not method.startswith('_')]

            # 使用wxautox获取消息
            if hasattr(self.wechat_client, 'GetAllMessage'):
                # logger.info("✅ 找到GetAllMessage方法，开始调用...")
                try:
                    messages = self.wechat_client.GetAllMessage()
                    # logger.info(f"GetAllMessage调用完成，返回类型: {type(messages)}")

                    if messages:
                        logger.info(f"✅ GetAllMessage返回 {len(messages)} 条消息")
                        # 打印第一条消息的详细信息用于调试
                        if len(messages) > 0:
                            first_msg = messages[0]
                            logger.info(f"第一条消息类型: {type(first_msg)}")
                            logger.info(f"第一条消息属性: {dir(first_msg)}")
                            logger.info(f"第一条消息内容: content={getattr(first_msg, 'content', 'N/A')}")
                            logger.info(f"第一条消息发送者: sender={getattr(first_msg, 'sender', 'N/A')}")
                            logger.info(f"第一条消息属性: attr={getattr(first_msg, 'attr', 'N/A')}")
                            logger.info(f"第一条消息哈希值: hash={getattr(first_msg, 'hash', 'N/A')}")

                        return messages
                    else:
                        # 减少警告日志输出
                        return []

                except Exception as e:
                    logger.error(f"❌ GetAllMessage调用异常: {e}")
                    logger.error(traceback.format_exc())
                    return []
            else:
                # 如果没有GetAllMessage方法，尝试其他方式
                logger.warning("❌ wxautox没有GetAllMessage方法，尝试其他方式获取消息")

                # 尝试使用GetMessage方法
                if hasattr(self.wechat_client, 'GetMessage'):
                    logger.info("🔄 尝试使用GetMessage方法...")
                    try:
                        messages = self.wechat_client.GetMessage()
                        logger.info(f"GetMessage返回: {type(messages)}, 长度: {len(messages) if messages else 0}")
                        return messages if messages else []
                    except Exception as e:
                        logger.error(f"GetMessage调用失败: {e}")
                        return []
                else:
                    logger.error("❌ 没有找到任何可用的消息获取方法")
                    logger.error("可用方法列表:")
                    for method in available_methods:
                        logger.error(f"  - {method}")

                return []

        except Exception as e:
            logger.error(f"❌ _get_all_messages整体失败: {e}")
            logger.error(traceback.format_exc())
            return []

    def _process_and_save_messages(self, messages: List[Any], session_id: str, contact_name: str) -> List[Dict[str, Any]]:
        """处理并保存消息到数据库"""
        try:
            processed_messages = []

            with sqlite3.connect(DB_PATH) as conn:
                cursor = conn.cursor()

                # 先保存或更新会话信息
                current_time = int(time.time())
                current_wxid = self.get_current_wxid()
                cursor.execute('''
                INSERT OR REPLACE INTO sessions
                (session_id, wxid, name, type, last_time, created_at, updated_at, chat_type)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ''', (session_id, current_wxid, contact_name, 'private', current_time, current_time, current_time, 'friend'))

                for i, msg in enumerate(messages):
                    try:
                        logger.info(f"处理第 {i+1}/{len(messages)} 条消息: {type(msg)}")

                        # 解析消息内容 - 根据wxautox的消息对象结构
                        content = ""
                        is_self = False
                        timestamp = current_time
                        extra_data = {}
                        sender = ''
                        attr = ''
                        original_time = ''
                        formatted_time = ''
                        msg_type_from_data = 'text'

                        if hasattr(msg, '__dict__'):
                            # wxautox消息对象
                            content = getattr(msg, 'content', '')
                            sender = getattr(msg, 'sender', '')
                            attr = getattr(msg, 'attr', '')
                            msg_type = getattr(msg, 'type', '')
                            msg_time = getattr(msg, 'time', None)
                            msg_hash = getattr(msg, 'hash', None)  # 获取消息hash值

                            logger.info(f"  消息属性: content='{content[:30]}...', sender='{sender}', attr='{attr}', type='{msg_type}', hash='{msg_hash}'")

                            # 判断是否为自己发送的消息
                            is_self = (attr == 'self')

                            # 处理时间 - 为每条消息生成唯一的时间戳
                            if msg_time:
                                try:
                                    if isinstance(msg_time, str) and ":" in msg_time:
                                        # 格式如 "14:30"
                                        today = datetime.now().strftime("%Y-%m-%d")
                                        time_str = f"{today} {msg_time}"
                                        dt = datetime.strptime(time_str, "%Y-%m-%d %H:%M")
                                        timestamp = int(dt.timestamp())
                                    else:
                                        timestamp = int(float(msg_time))
                                except:
                                    # 如果时间解析失败，使用当前时间加上消息索引来避免重复
                                    timestamp = current_time + len(processed_messages)
                            else:
                                # 没有时间信息，使用当前时间加上消息索引来避免重复
                                timestamp = current_time + len(processed_messages)

                            # 保存额外数据 - 只保存必要信息
                            extra_data = {
                                'message_type': 'time' if (sender == 'base' and attr == 'base') else 'text'
                            }

                            # 设置其他字段
                            original_time = str(msg_time) if msg_time else ''
                            formatted_time = datetime.fromtimestamp(timestamp).strftime("%Y-%m-%d %H:%M:%S")
                            msg_type_from_data = msg_type

                        elif isinstance(msg, dict):
                            content = msg.get('content', str(msg))
                            is_self = msg.get('is_self', False)
                            timestamp = msg.get('timestamp', current_time)

                            # 提取wxautox消息的所有属性
                            sender = msg.get('sender', '')
                            attr = msg.get('attr', '')
                            original_time = msg.get('original_time', '')
                            formatted_time = msg.get('time', '')
                            msg_type_from_data = msg.get('msg_type', 'text')

                            # 保留其他属性到extra_data
                            extra_data = {k: v for k, v in msg.items() if k not in [
                                'content', 'is_self', 'timestamp', 'sender', 'attr', 'original_time', 'time', 'msg_type'
                            ]}
                        elif isinstance(msg, str):
                            content = msg
                            sender = ''
                            attr = ''
                            original_time = ''
                            formatted_time = ''
                            msg_type_from_data = 'text'
                            extra_data = {}
                        else:
                            content = str(msg)
                            sender = ''
                            attr = ''
                            original_time = ''
                            formatted_time = ''
                            msg_type_from_data = 'text'
                            extra_data = {}

                        # 根据数据确定消息类型
                        message_type = 'text'  # 默认为普通文本消息

                        # 检查是否为时间消息 - 根据sender和attr判断
                        if sender == 'base' and attr == 'base' and msg_type_from_data == 'other':
                            # 这很可能是时间分隔符消息
                            message_type = 'time'
                            extra_data['message_type'] = 'time'
                        elif extra_data.get('message_type'):
                            message_type = extra_data['message_type']
                        elif msg_type_from_data == 'system':
                            message_type = 'system'
                        else:
                            message_type = msg_type_from_data

                        # 直接保存所有消息，不进行去重
                        logger.info(f"  保存消息: type='{message_type}', content='{content[:30]}...', sender='{sender}', attr='{attr}'")

                        # 保存到数据库
                        cursor.execute('''
                        INSERT INTO messages (session_id, wxid, content, is_self, timestamp, extra_data, msg_type, sender, attr, original_time, formatted_time, hash)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ''', (
                            session_id,
                            current_wxid,
                            content,
                            int(is_self),
                            timestamp,
                            json.dumps(extra_data) if extra_data else None,
                            message_type,
                            sender,
                            attr,
                            original_time,
                            formatted_time,
                            msg_hash if 'msg_hash' in locals() else None
                        ))

                        # 添加到处理后的消息列表
                        processed_message = {
                            "content": content,
                            "is_self": is_self,
                            "timestamp": timestamp,
                            "time": datetime.fromtimestamp(timestamp).strftime("%Y-%m-%d %H:%M:%S")
                        }
                        processed_message.update(extra_data)
                        processed_messages.append(processed_message)

                    except Exception as e:
                        logger.error(f"Failed to process message: {e}")
                        continue

                conn.commit()
                logger.info(f"成功保存 {len(processed_messages)} 条消息到数据库")

            return processed_messages

        except Exception as e:
            logger.error(f"Failed to process and save messages: {e}")
            return []

    def load_more_message_history(self, contact_name: str, before_timestamp: int = None, limit: int = 40) -> Dict[str, Any]:
        """加载更多聊天记录"""
        if not self.wechat_client:
            return {"success": False, "message": "WeChat not connected"}

        try:
            session_id = f"private_self_{contact_name}"

            # 从数据库获取更多消息
            with sqlite3.connect(DB_PATH) as conn:
                cursor = conn.cursor()

                current_wxid = self.get_current_wxid()
                if before_timestamp:
                    cursor.execute('''
                    SELECT content, is_self, timestamp, extra_data, msg_type, sender, attr
                    FROM messages
                    WHERE session_id = ? AND wxid = ? AND timestamp < ?
                    ORDER BY timestamp DESC
                    LIMIT ?
                    ''', (session_id, current_wxid, before_timestamp, limit))
                else:
                    cursor.execute('''
                    SELECT content, is_self, timestamp, extra_data, msg_type, sender, attr
                    FROM messages
                    WHERE session_id = ? AND wxid = ?
                    ORDER BY timestamp DESC
                    LIMIT ?
                    ''', (session_id, current_wxid, limit))

                rows = cursor.fetchall()
                messages = []

                for row in rows:
                    content, is_self, timestamp, extra_data, msg_type, sender, attr = row
                    message = {
                        "content": content,
                        "is_self": bool(is_self),
                        "timestamp": timestamp,
                        "time": datetime.fromtimestamp(timestamp).strftime("%Y-%m-%d %H:%M:%S"),
                        "message_type": msg_type or "text",
                        "sender": sender or "",
                        "attr": attr or ""
                    }

                    # 只解析必要的额外数据
                    if extra_data:
                        try:
                            extra = json.loads(extra_data)
                            # 只提取message_type，忽略其他不必要的字段
                            if extra.get('message_type'):
                                message["message_type"] = extra['message_type']
                        except:
                            pass

                    messages.append(message)

                # 按时间正序排列
                messages.reverse()

                return {
                    "success": True,
                    "data": {
                        "messages": messages,
                        "has_more": len(messages) == limit
                    }
                }

        except Exception as e:
            logger.error(f"Failed to load more message history: {e}")
            return {"success": False, "message": str(e)}

    def get_session_messages(self, session_id: str, page: int = 1, limit: int = 40) -> Dict[str, Any]:
        """获取指定会话的消息列表（与前端API一致）"""
        try:
            # 解析session_id获取联系人名称
            contact_name = None
            if session_id.startswith('private_self_'):
                contact_name = session_id[13:]  # 移除 'private_self_' 前缀
            elif session_id.startswith('group_'):
                contact_name = session_id[6:]   # 移除 'group_' 前缀

            if not contact_name:
                return {"success": False, "message": "无效的会话ID"}

            # 计算偏移量
            offset = (page - 1) * limit

            # 从数据库获取消息
            with sqlite3.connect(DB_PATH) as conn:
                cursor = conn.cursor()

                current_wxid = self.get_current_wxid()
                # 获取总数
                cursor.execute('''
                SELECT COUNT(*) FROM messages WHERE session_id = ? AND wxid = ?
                ''', (session_id, current_wxid))
                total = cursor.fetchone()[0]

                # 获取分页消息，只查询必要字段
                cursor.execute('''
                SELECT id, content, is_self, timestamp, msg_type, sender, attr, extra_data
                FROM messages
                WHERE session_id = ? AND wxid = ?
                ORDER BY timestamp DESC
                LIMIT ? OFFSET ?
                ''', (session_id, current_wxid, limit, offset))

                rows = cursor.fetchall()
                messages = []

                for row in rows:
                    msg_id, content, is_self, timestamp, msg_type, sender, attr, extra_data = row
                    message = {
                        "id": msg_id,
                        "content": content,
                        "is_self": bool(is_self),
                        "time": datetime.fromtimestamp(timestamp).strftime("%Y-%m-%d %H:%M:%S"),
                        "timestamp": timestamp,
                        "message_type": msg_type or "text",
                        "sender": sender or "",
                        "attr": attr or ""
                    }

                    # 只解析必要的额外数据
                    if extra_data:
                        try:
                            extra = json.loads(extra_data)
                            # 只提取message_type，忽略其他不必要的字段
                            if extra.get('message_type'):
                                message["message_type"] = extra['message_type']
                        except:
                            pass

                    messages.append(message)

                # 按时间正序排列（前端需要）
                messages.reverse()
                
                # 获取相关的回复建议
                logger.info(f"获取回复建议 - 会话ID: {session_id}, wxid: {current_wxid}")
                suggestions = []
                
                # 检查表是否存在
                cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='reply_suggestions'")
                if not cursor.fetchone():
                    logger.warning("reply_suggestions表不存在，无法获取回复建议")
                else:
                    try:
                        cursor.execute('''
                            SELECT rs.id, rs.content, rs.message_id, rs.timestamp, rs.created_at, rs.used
                            FROM reply_suggestions rs
                            JOIN messages m ON rs.message_id = m.id
                            WHERE rs.session_id = ? AND rs.wxid = ?
                            ORDER BY rs.timestamp DESC
                        ''', (session_id, current_wxid))
                        
                        rows = cursor.fetchall()
                        logger.info(f"查询到 {len(rows)} 条回复建议")
                        
                        for row in rows:
                            suggestion = {
                                "id": row[0],
                                "content": row[1],
                                "message_id": row[2],
                                "timestamp": row[3],
                                "created_at": row[4],
                                "used": bool(row[5]),
                                "formatted_time": datetime.fromtimestamp(row[3]).strftime("%Y-%m-%d %H:%M:%S")
                            }
                            suggestions.append(suggestion)
                    except Exception as e:
                        logger.error(f"查询回复建议失败: {e}")
                        logger.error(traceback.format_exc())

                return {
                    "success": True,
                    "messages": messages,
                    "total": total,
                    "page": page,
                    "limit": limit,
                    "has_more": total > page * limit,
                    "suggestions": suggestions
                }

        except Exception as e:
            logger.error(f"Failed to get session messages: {e}")
            return {"success": False, "message": str(e)}

    def get_messages_from_db(self, contact_name: str, page: int = 1, per_page: int = 40) -> Dict[str, Any]:
        """专门用于刷新消息的方法 - 仅从数据库获取数据，绝不调用wxautox"""
        try:
            logger.info(f"🔄 [刷新消息] 开始执行：{contact_name}")
            logger.info(f"🔄 [刷新消息] 此方法专门用于刷新消息，只从数据库获取数据")
            logger.info(f"🔄 [刷新消息] 绝对不会调用任何wxautox相关方法")
            logger.info(f"📊 分页参数：page={page}, per_page={per_page}")

            session_id = f"private_self_{contact_name}"
            current_wxid = self.get_current_wxid()

            if not current_wxid:
                logger.warning("⚠️ 未获取到当前用户wxid")
                return {
                    "success": False,
                    "message": "用户未登录",
                    "data": {"messages": [], "total": 0, "has_more": False, "source": "database", "new_count": 0}
                }

            # 直接从数据库获取消息，绝不调用wxautox，限制数量防止数据过大
            logger.info(f"📊 从数据库查询消息：session_id={session_id}, wxid={current_wxid}")
            # 计算分页偏移量，获取最新的记录
            offset = (page - 1) * per_page
            logger.info(f"🔧 准备调用 _get_messages_from_db_with_pagination，参数：session_id={session_id}, limit={per_page}, offset={offset}")
            existing_messages = self._get_messages_from_db_with_pagination(session_id, limit=per_page, offset=offset)
            logger.info(f"📊 数据库查询结果：{len(existing_messages)} 条消息（已按正确顺序排列）")
            logger.info(f"🔍 返回的消息ID范围：{existing_messages[0]['id'] if existing_messages else 'N/A'} - {existing_messages[-1]['id'] if existing_messages else 'N/A'}")

            # 获取总数用于分页信息
            total = self._get_messages_count(session_id)
            paginated_messages = existing_messages

            logger.info(f"📄 分页处理完成：第{page}页，每页{per_page}条，返回{len(paginated_messages)}条")
            logger.info(f"🔄 [刷新消息] 执行完成，成功从数据库获取了{len(paginated_messages)}条消息")
            logger.info(f"🔄 [刷新消息] 确认：未调用任何wxautox方法")

            # 获取相关的回复建议
            logger.info(f"获取回复建议 - 会话ID: {session_id}, wxid: {current_wxid}")
            suggestions = []
            
            try:
                with self._get_db_connection() as conn:
                    cursor = conn.cursor()
                    
                    # 检查表是否存在
                    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='reply_suggestions'")
                    if not cursor.fetchone():
                        logger.warning("reply_suggestions表不存在，无法获取回复建议")
                    else:
                        # 查询回复建议
                        try:
                            cursor.execute('''
                                SELECT rs.id, rs.content, rs.message_id, rs.timestamp, rs.created_at, rs.used
                                FROM reply_suggestions rs
                                JOIN messages m ON rs.message_id = m.id
                                WHERE rs.session_id = ? AND rs.wxid = ?
                                ORDER BY rs.timestamp DESC
                            ''', (session_id, current_wxid))
                            
                            rows = cursor.fetchall()
                            logger.info(f"查询到 {len(rows)} 条回复建议")
                            
                            for row in rows:
                                suggestion = {
                                    "id": row[0],
                                    "content": row[1],
                                    "message_id": row[2],
                                    "timestamp": row[3],
                                    "created_at": row[4],
                                    "used": bool(row[5]),
                                    "formatted_time": datetime.fromtimestamp(row[3]).strftime("%Y-%m-%d %H:%M:%S")
                                }
                                suggestions.append(suggestion)
                        except Exception as e:
                            logger.error(f"查询回复建议失败: {e}")
                            logger.error(traceback.format_exc())
            except Exception as e:
                logger.error(f"获取回复建议时出错: {e}")
                logger.error(traceback.format_exc())

            return {
                "success": True,
                "data": {
                    "messages": paginated_messages,
                    "total": total,
                    "has_more": total > page * per_page,
                    "source": "database_only",
                    "new_count": 0,
                    "suggestions": suggestions
                }
            }

        except Exception as e:
            logger.error(f"Failed to get messages from database: {e}")
            return {"success": False, "message": str(e)}

    def clear_chat_messages(self, contact_name: str) -> Dict[str, Any]:
        """清空指定联系人的聊天记录（参考index.html的clearChat逻辑）"""
        try:
            # 创建会话ID
            session_id = f"private_self_{contact_name}"
            current_wxid = self.get_current_wxid()
            logger.info(f"开始清空会话 {session_id} (wxid: {current_wxid}) 的聊天记录")

            with sqlite3.connect(DB_PATH) as conn:
                cursor = conn.cursor()

                # 查询该会话有多少条消息
                cursor.execute("SELECT COUNT(*) FROM messages WHERE session_id = ? AND wxid = ?", (session_id, current_wxid))
                count = cursor.fetchone()[0]
                logger.info(f"会话 {session_id} (wxid: {current_wxid}) 有 {count} 条消息将被删除")

                # 删除指定会话的所有消息
                cursor.execute("DELETE FROM messages WHERE session_id = ? AND wxid = ?", (session_id, current_wxid))
                deleted_count = cursor.rowcount
                logger.info(f"已从数据库删除 {deleted_count} 条消息")

                # 重置has_more_messages状态为1（表示有更多消息）
                cursor.execute("""
                UPDATE sessions
                SET has_more_messages = 1, updated_at = ?
                WHERE session_id = ? AND wxid = ?
                """, (int(time.time()), session_id, current_wxid))

                sessions_updated = cursor.rowcount
                logger.info(f"已重置会话 {session_id} 的has_more_messages状态，影响行数: {sessions_updated}")

                conn.commit()

            logger.info(f"✅ 成功清空会话 {session_id} 的聊天记录")
            return {"success": True, "message": "聊天记录已清空"}

        except Exception as e:
            error_msg = f"清空聊天记录失败: {str(e)}"
            logger.error(error_msg)
            return {"success": False, "message": error_msg}

    def refresh_chat_messages(self, contact_name: str) -> Dict[str, Any]:
        """重新获取聊天记录（简化逻辑：清空数据库 -> 获取新数据 -> 保存到数据库 -> 调用刷新方法）"""
        try:
            logger.info(f"🔄 [重新获取聊天记录] 开始执行：{contact_name}")

            # 检查wxautox可用性
            if not WXAUTOX_AVAILABLE:
                return {"success": False, "message": "wxautox不可用，请先安装: python -m pip install wxautox"}

            if not self.wechat_client:
                return {"success": False, "message": "微信客户端未连接，请先初始化微信"}

            # 步骤1: 清空数据库中该联系人的聊天记录
            logger.info("🗑️ 步骤1: 清空数据库中的旧聊天记录...")
            clear_result = self.clear_chat_messages(contact_name)
            if not clear_result.get("success"):
                logger.error(f"❌ 清空聊天记录失败: {clear_result.get('message')}")
                return clear_result

            # 步骤2: 调用wxautox方法获取新的聊天记录
            logger.info("📱 步骤2: 从微信获取新的聊天记录...")
            real_messages_result = self._get_real_chat_messages(contact_name)

            if not real_messages_result.get("success"):
                logger.error(f"❌ 从微信获取聊天记录失败: {real_messages_result.get('message')}")
                return {
                    "success": False,
                    "message": f"从微信获取聊天记录失败: {real_messages_result.get('message', '未知错误')}"
                }

            messages = real_messages_result.get("messages", [])
            logger.info(f"✅ 从微信获取到 {len(messages)} 条消息")

            # 步骤3: 保存新消息到数据库
            logger.info("💾 步骤3: 保存新消息到数据库...")
            save_result = self._save_real_messages_to_db(messages, contact_name)
            if not save_result.get("success"):
                logger.error(f"❌ 保存消息到数据库失败: {save_result.get('message')}")
                return {
                    "success": False,
                    "message": f"保存消息到数据库失败: {save_result.get('message', '未知错误')}"
                }

            logger.info(f"✅ 成功保存 {save_result.get('saved_count', 0)} 条消息到数据库")

            # 步骤4: 调用刷新消息方法从数据库加载第一页数据（支持分页）
            logger.info("📄 步骤4: 从数据库加载第一页消息（支持分页）...")
            refresh_result = self.get_messages_from_db(contact_name, page=1, per_page=20)

            if refresh_result.get("success"):
                logger.info(f"✅ 重新获取聊天记录完成，返回第一页 {len(refresh_result.get('data', {}).get('messages', []))} 条消息")
                return {
                    "success": True,
                    "message": f"重新获取成功，获得 {len(messages)} 条消息，返回第一页数据",
                    "data": refresh_result.get("data", {})
                }
            else:
                logger.error(f"❌ 从数据库加载消息失败: {refresh_result.get('message')}")
                return {
                    "success": False,
                    "message": f"从数据库加载消息失败: {refresh_result.get('message', '未知错误')}"
                }

        except Exception as e:
            error_msg = f"重新获取聊天记录失败: {str(e)}"
            logger.error(error_msg)
            return {"success": False, "message": error_msg}

    def _get_real_chat_messages(self, contact_name: str) -> Dict[str, Any]:
        """获取真实的聊天消息（基于测试成功的逻辑）"""
        try:
            logger.info(f"🔍 开始获取与 {contact_name} 的真实聊天记录...")

            if not WXAUTOX_AVAILABLE:
                return {"success": False, "message": "wxautox不可用"}

            if not self.wechat_client:
                return {"success": False, "message": "微信客户端未连接"}

            # 1. 打开聊天窗口
            logger.info("1️⃣ 打开聊天窗口...")
            try:
                chat_result = self.wechat_client.ChatWith(who=contact_name)
                logger.info(f"   ChatWith结果: {chat_result}")

                if chat_result is False:
                    return {"success": False, "message": f"无法打开与 {contact_name} 的聊天窗口"}
            except Exception as e:
                return {"success": False, "message": f"打开聊天窗口失败: {str(e)}"}

            # 2. 等待窗口加载
            logger.info("2️⃣ 等待聊天窗口加载...")
            time.sleep(3)

            # 3. 尝试加载更多历史消息
            logger.info("3️⃣ 尝试加载历史消息...")
            if hasattr(self.wechat_client, 'LoadMoreMessage'):
                for i in range(2):  # 加载2次
                    try:
                        load_result = self.wechat_client.LoadMoreMessage()
                        logger.info(f"   第{i+1}次加载: {load_result}")
                        time.sleep(1)
                    except Exception as e:
                        logger.warning(f"   第{i+1}次加载失败: {e}")

            # 4. 获取所有消息
            logger.info("4️⃣ 获取所有消息...")
            if hasattr(self.wechat_client, 'GetAllMessage'):
                try:
                    messages = self.wechat_client.GetAllMessage()
                    if messages:
                        logger.info(f"✅ 获取到 {len(messages)} 条真实消息")

                        # 记录获取到的消息详情用于调试
                        logger.info(f"📊 GetAllMessage返回的消息样本（前3条）:")
                        for i, msg in enumerate(messages[:3]):
                            content = getattr(msg, 'content', '')
                            sender = getattr(msg, 'sender', '')
                            attr = getattr(msg, 'attr', '')
                            msg_time = getattr(msg, 'time', '')
                            logger.info(f"  [{i+1}] content='{content[:40]}...', sender='{sender}', attr='{attr}', time='{msg_time}'")

                        return {"success": True, "messages": messages}
                    else:
                        return {"success": False, "message": "未获取到任何消息"}
                except Exception as e:
                    return {"success": False, "message": f"获取消息失败: {str(e)}"}
            else:
                return {"success": False, "message": "GetAllMessage方法不可用"}

        except Exception as e:
            logger.error(f"获取真实聊天记录失败: {e}")
            return {"success": False, "message": f"获取真实聊天记录失败: {str(e)}"}

    def _save_real_messages_to_db(self, messages, contact_name: str) -> Dict[str, Any]:
        """将真实消息保存到数据库"""
        try:
            logger.info(f"💾 保存真实消息到数据库...")
            logger.info(f"📊 准备保存 {len(messages)} 条消息，不进行去重")

            if not messages:
                return {"success": False, "message": "没有消息需要保存"}

            session_id = f"private_self_{contact_name}"
            current_time = int(time.time())
            current_wxid = self.get_current_wxid()

            with sqlite3.connect(DB_PATH) as conn:
                cursor = conn.cursor()

                # 创建会话记录（如果不存在）
                cursor.execute('''
                INSERT OR REPLACE INTO sessions (session_id, wxid, name, type, last_time, created_at, updated_at, chat_type)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ''', (session_id, current_wxid, contact_name, 'private', current_time, current_time, current_time, 'friend'))

                # 保存消息
                saved_count = 0
                for i, msg in enumerate(messages):
                    try:
                        content = getattr(msg, 'content', '')
                        sender = getattr(msg, 'sender', '')
                        attr = getattr(msg, 'attr', '')
                        msg_type = getattr(msg, 'type', 'text')
                        msg_time = getattr(msg, 'time', None)
                        msg_hash = getattr(msg, 'hash', None)  # 获取消息hash值

                        # 详细日志记录每条消息的保存过程
                        logger.info(f"  保存第{i+1}条消息: content='{content[:30]}...', sender='{sender}', attr='{attr}', type='{msg_type}', time='{msg_time}', hash='{msg_hash}'")

                        # 判断是否为自己发送的消息
                        is_self = (attr == 'self')

                        # 处理时间戳 - 确保每条消息都有唯一的时间戳
                        timestamp = current_time + i  # 使用递增时间戳确保唯一性
                        if msg_time and isinstance(msg_time, str) and ":" in msg_time:
                            try:
                                today = datetime.now().strftime("%Y-%m-%d")
                                time_str = f"{today} {msg_time}"
                                dt = datetime.strptime(time_str, "%Y-%m-%d %H:%M")
                                timestamp = int(dt.timestamp()) + i  # 即使解析成功也要加上索引确保唯一性
                            except:
                                timestamp = current_time + i  # 解析失败时使用递增时间戳

                        # 保存额外数据 - 只保存必要信息
                        extra_data = {
                            'message_type': 'time' if (sender == 'base' and attr == 'base') else 'text'
                        }

                        # 根据实时消息的信息确定消息类型
                        message_type = 'text'  # 默认为普通文本消息

                        # 检查是否为时间消息 - 根据sender和attr判断
                        if sender == 'base' and attr == 'base' and msg_type == 'other':
                            # 这很可能是时间分隔符消息
                            message_type = 'time'
                            extra_data['message_type'] = 'time'
                        elif msg_type == 'system':
                            message_type = 'system'
                        else:
                            message_type = msg_type

                        cursor.execute('''
                        INSERT INTO messages (session_id, wxid, content, is_self, timestamp, extra_data, msg_type, sender, attr, original_time, formatted_time, hash)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ''', (
                            session_id,
                            current_wxid,
                            content,
                            int(is_self),
                            timestamp,
                            json.dumps(extra_data),
                            message_type,
                            sender,
                            attr,
                            str(msg_time),
                            datetime.fromtimestamp(timestamp).strftime("%Y-%m-%d %H:%M:%S"),
                            msg_hash
                        ))

                        saved_count += 1

                    except Exception as e:
                        logger.warning(f"保存单条消息失败: {e}")
                        continue

                conn.commit()
                logger.info(f"✅ 成功保存 {saved_count} 条真实消息")
                return {"success": True, "saved_count": saved_count}

        except Exception as e:
            logger.error(f"保存真实消息失败: {e}")
            return {"success": False, "message": f"保存失败: {str(e)}"}



    def start_monitoring(self, contact_name: str, auto_reply: bool = True) -> Dict[str, Any]:
        """启动监听
        
        Args:
            contact_name: 联系人名称
            auto_reply: 是否启用自动回复
        """
        try:
            current_wxid = self.get_current_wxid()
            logger.info(f"开始监听 - 联系人: {contact_name}, 启用自动回复: {auto_reply}")
            with self.lock:
                # 更新内存中的监听状态
                self.monitored_contacts[contact_name] = {
                    "auto_reply": auto_reply,  # 使用布尔值
                    "active": True
                }
                
                # 更新数据库中的监听状态
                current_time = int(time.time())
                try:
                    # 使用新的数据库连接
                    with self._get_db_connection() as conn:
                        cursor = conn.cursor()
                        # 写入/更新 sessions 表，is_monitoring=1
                        session_id = f"private_self_{contact_name}"
                        cursor.execute('''
                            INSERT OR REPLACE INTO sessions (session_id, wxid, name, type, last_time, created_at, updated_at, chat_type, is_monitoring)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ''', (
                            session_id,
                            current_wxid,
                            contact_name,
                            'private',
                            current_time,
                            current_time,
                            current_time,
                            'friend',
                            1
                        ))
                        conn.commit()
                except Exception as e:
                    logger.error(f"更新数据库监听状态失败: {e}")
                    logger.error(traceback.format_exc())
                
                # 确保监听线程已启动
                if not self.is_monitoring or not self.monitoring_thread or not self.monitoring_thread.is_alive():
                    logger.info("监听线程未启动，正在启动...")
                    self._start_monitoring_thread()
                
            return {
                "success": True,
                "message": f"Started monitoring {contact_name}"
            }
        except Exception as e:
            logger.error(f"启动监听失败: {e}")
            logger.error(traceback.format_exc())
            return {"success": False, "message": str(e)}
    
    def stop_monitoring(self, contact_name: str) -> Dict[str, Any]:
        """停止监听"""
        try:
            current_wxid = self.get_current_wxid()
            logger.info(f"停止监听 - 联系人: {contact_name}")
            with self.lock:
                # 更新内存中的监听状态
                if contact_name in self.monitored_contacts:
                    del self.monitored_contacts[contact_name]
                    # 更新数据库中的监听状态
                    current_time = int(time.time())
                    try:
                        # 使用新的数据库连接
                        with self._get_db_connection() as conn:
                            cursor = conn.cursor()
                            # 更新 sessions 表，is_monitoring=0
                            session_id = f"private_self_{contact_name}"
                            cursor.execute('''
                                UPDATE sessions SET is_monitoring = 0, updated_at = ?, last_time = ? 
                                WHERE session_id = ? AND wxid = ?
                            ''', (current_time, current_time, session_id, current_wxid))
                            conn.commit()
                    except Exception as e:
                        logger.error(f"更新数据库监听状态失败: {e}")
                        logger.error(traceback.format_exc())
                    
                    # 如果没有监听的联系人了，停止监听线程
                    if not self.monitored_contacts and self.monitoring_thread:
                        self.is_monitoring = False
                        self.monitoring_thread.join(timeout=1)
                        self.monitoring_thread = None
                        logger.info("所有监听已停止")
            
            return {
                "success": True,
                "message": f"Stopped monitoring {contact_name}"
            }
        except Exception as e:
            logger.error(f"停止监听失败: {e}")
            logger.error(traceback.format_exc())
            return {"success": False, "message": str(e)}
    
    def get_auto_reply_status(self) -> Dict[str, Any]:
        """获取自动回复状态（从ai_sales_config表读取）"""
        try:
            current_wxid = self.get_current_wxid()
            
            # 使用新的数据库连接
            with self._get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('SELECT auto_reply_enabled FROM ai_sales_config WHERE wxid = ?', (current_wxid,))
                row = cursor.fetchone()
                if row is not None and row['auto_reply_enabled'] is not None:
                    enabled = bool(row['auto_reply_enabled'])
                else:
                    enabled = False
                    
            return {
                "success": True,
                "data": {
                    "enabled": enabled,
                    "monitored_contacts": self.monitored_contacts
                }
            }
        except Exception as e:
            logger.error(f"❌ 获取自动回复状态失败: {e}")
            logger.error(traceback.format_exc())
            return {"success": False, "message": str(e)}
    
    def toggle_auto_reply(self, enabled: bool) -> Dict[str, Any]:
        """切换自动回复，并写入数据库和缓存"""
        try:
            self.auto_reply_enabled = enabled
            current_wxid = self.get_current_wxid()
            current_time = int(time.time())
            
            # 使用新的数据库连接
            with self._get_db_connection() as conn:
                cursor = conn.cursor()
                # 查询是否已有配置
                cursor.execute('SELECT id FROM ai_sales_config WHERE wxid = ?', (current_wxid,))
                row = cursor.fetchone()
                if row:
                    # 已有配置，更新
                    cursor.execute('''
                        UPDATE ai_sales_config SET auto_reply_enabled = ?, updated_at = ? WHERE wxid = ?
                    ''', (int(enabled), current_time, current_wxid))
                else:
                    # 没有配置，插入
                    cursor.execute('''
                        INSERT INTO ai_sales_config (wxid, auto_reply_enabled, created_at, updated_at)
                        VALUES (?, ?, ?, ?)
                    ''', (current_wxid, int(enabled), current_time, current_time))
                conn.commit()
                
            return {
                "success": True,
                "message": f"Auto reply {'enabled' if enabled else 'disabled'} and saved to db"
            }
        except Exception as e:
            logger.error(f"Failed to toggle auto reply: {e}")
            logger.error(traceback.format_exc())
            return {"success": False, "message": str(e)}

    def __del__(self):
        """清理资源"""
        try:
            # 停止消息处理
            if self.message_processor_thread and self.message_processor_thread.is_alive():
                try:
                    # 清空队列，避免task_done错误
                    while not self.message_queue.empty():
                        try:
                            self.message_queue.get_nowait()
                            self.message_queue.task_done()
                        except:
                            pass
                    
                    # 发送退出信号
                    self.message_queue.put(None)
                    self.message_processor_thread.join(timeout=1)
                except Exception as e:
                    logger.error(f"停止消息处理线程时出错: {e}")
            
            # 停止监听
            self.is_monitoring = False
            if self.monitoring_thread and self.monitoring_thread.is_alive():
                try:
                    self.monitoring_thread.join(timeout=1)
                except Exception as e:
                    logger.error(f"停止监听线程时出错: {e}")
            
            # 关闭线程池
            try:
                self.thread_pool.shutdown(wait=False)
            except Exception as e:
                logger.error(f"关闭线程池时出错: {e}")
        except Exception as e:
            logger.error(f"清理资源时发生错误: {e}")
            logger.error(traceback.format_exc())

    def get_ai_sales_config(self) -> Dict[str, Any]:
        """获取AI销冠配置"""
        try:
            current_wxid = self.get_current_wxid()
            logger.info(f"🔄 获取用户 {current_wxid} 的AI销冠配置")
            
            # 使用新的数据库连接
            with self._get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    SELECT * FROM ai_sales_config WHERE wxid = ?
                ''', (current_wxid,))
                
                row = cursor.fetchone()
                if row:
                    config = dict(row)
                    # 移除敏感信息
                    if 'api_key' in config:
                        config['api_key'] = '******' if config['api_key'] else None
                    return {
                        "success": True,
                        "data": config
                    }
                else:
                    # 如果没有配置，返回默认配置
                    return {
                        "success": True,
                        "data": {
                            "wxid": current_wxid,
                            "api_key": None,
                            "api_url": None,
                            "model_name": "gpt-3.5-turbo",
                            "temperature": 0.7,
                            "max_tokens": 2000,
                            "system_prompt": None,
                            "auto_reply_prompt": None,
                            "reply_suggest_prompt": None,
                            "auto_reply_enabled": False,
                            "reply_suggest_enabled": False,
                            "created_at": int(time.time()),
                            "updated_at": int(time.time())
                        }
                    }
        except Exception as e:
            logger.error(f"❌ 获取AI销冠配置失败: {e}")
            logger.error(traceback.format_exc())
            return {"success": False, "message": str(e)}

    def update_ai_sales_config(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """更新AI销冠配置"""
        try:
            current_wxid = self.get_current_wxid()
            logger.info(f"🔄 更新用户 {current_wxid} 的AI销冠配置")
            
            # 获取当前配置
            current_config = self.get_ai_sales_config()
            if not current_config["success"]:
                return current_config
            
            # 合并配置
            current_data = current_config["data"]
            current_data.update(config)
            
            # 更新时间
            current_time = int(time.time())
            current_data["updated_at"] = current_time
            
            # 如果是新配置，设置创建时间
            if not current_data.get("created_at"):
                current_data["created_at"] = current_time
            
            # 更新数据库
            try:
                # 使用新的数据库连接
                with self._get_db_connection() as conn:
                    cursor = conn.cursor()
                    cursor.execute('''
                        INSERT OR REPLACE INTO ai_sales_config 
                        (wxid, api_key, api_url, model_name, temperature, max_tokens, 
                         system_prompt, auto_reply_prompt, reply_suggest_prompt, 
                         auto_reply_enabled, reply_suggest_enabled,
                         created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ''', (
                        current_wxid,
                        current_data.get("api_key"),
                        current_data.get("api_url"),
                        current_data.get("model_name", "gpt-3.5-turbo"),
                        current_data.get("temperature", 0.7),
                        current_data.get("max_tokens", 2000),
                        current_data.get("system_prompt"),
                        current_data.get("auto_reply_prompt"),
                        current_data.get("reply_suggest_prompt"),
                        current_data.get("auto_reply_enabled", False),
                        current_data.get("reply_suggest_enabled", False),
                        current_data.get("created_at"),
                        current_data.get("updated_at")
                    ))
                    conn.commit()
                    logger.info("✅ AI销冠配置已更新")
                
                # 返回更新后的配置（隐藏敏感信息）
                current_data["api_key"] = "******" if current_data.get("api_key") else None
                return {
                    "success": True,
                    "data": current_data
                }
            except Exception as e:
                logger.error(f"❌ 更新数据库失败: {e}")
                logger.error(traceback.format_exc())
                return {"success": False, "message": str(e)}
                
        except Exception as e:
            logger.error(f"❌ 更新AI销冠配置失败: {e}")
            logger.error(traceback.format_exc())
            return {"success": False, "message": str(e)}

    def delete_ai_sales_config(self) -> Dict[str, Any]:
        """删除AI销冠配置"""
        try:
            current_wxid = self.get_current_wxid()
            logger.info(f"🔄 删除用户 {current_wxid} 的AI销冠配置")
            
            # 使用新的数据库连接
            with self._get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    DELETE FROM ai_sales_config WHERE wxid = ?
                ''', (current_wxid,))
                conn.commit()
            
            logger.info("✅ AI销冠配置已删除")
            return {
                "success": True,
                "message": "AI销冠配置已删除"
            }
        except Exception as e:
            logger.error(f"❌ 删除AI销冠配置失败: {e}")
            logger.error(traceback.format_exc())
            return {"success": False, "message": str(e)}

    def get_session_monitoring_status(self, contact_name: str) -> Dict[str, Any]:
        """获取指定联系人的监听状态（is_monitoring）"""
        try:
            session_id = f"private_self_{contact_name}"
            current_wxid = self.get_current_wxid()
            
            # 使用新的数据库连接
            with self._get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('SELECT is_monitoring FROM sessions WHERE session_id = ? AND wxid = ?', (session_id, current_wxid))
                row = cursor.fetchone()
                is_monitoring = bool(row['is_monitoring']) if row and row['is_monitoring'] is not None else False
            return {"success": True, "is_monitoring": is_monitoring}
        except Exception as e:
            logger.error(f"❌ 获取监听状态失败: {e}")
            logger.error(traceback.format_exc())
            return {"success": False, "message": str(e)}

    def _start_monitoring_thread(self):
        """启动消息监听线程"""
        def monitor_messages():
            logger.info("🚀 消息监听线程已启动 - 开始监听微信消息")
            logger.info(f"💡 当前监听的联系人: {list(self.monitored_contacts.keys())}")
            
            # 消息ID缓存，用于避免重复处理消息
            message_id_cache = {}
            loop_count = 0
            
            # 添加调试日志，确认线程进入while循环
            logger.info("⚙️ 监听线程准备进入循环...")
            
            try:
                logger.info("🔄 监听线程第一次循环开始")
                
                while True:
                    try:
                        # 添加调试日志，确认循环正在执行
                        if loop_count == 0 or loop_count % 20 == 0:
                            logger.info(f"🔄 监听线程循环执行中 - 第{loop_count+1}次")
                        
                        loop_count += 1
                                                
                        # 检查是否有联系人需要监听
                        if not self.monitored_contacts:
                            if loop_count % 300 == 0:  # 每300次循环记录一次
                                logger.info("⏸️ 没有联系人需要监听，监听线程等待中...")
                            time.sleep(1)
                            continue
                        
                        # 检查微信客户端是否可用
                        if not self.wechat_client or not self.is_connected:
                            logger.info("⚠️ 微信客户端未连接，暂停监听")
                            time.sleep(3)
                            continue
                        
                        # 直接获取新消息，不需要切换聊天窗口
                        try:
                            try:
                                # 尝试调用GetNextNewMessage方法
                                try:
                                    messagesObject = self.wechat_client.GetNextNewMessage(filter_mute=True)
                                    if not messagesObject:
                                        continue
                                    
                                    messages = messagesObject.get("msg")
                                    chat_name = messagesObject.get("chat_name")
                                    chat_type = messagesObject.get("chat_type")
                                    logger.info(f"从字典获取消息: chat_name={chat_name}, chat_type={chat_type}, messages={messages}")
                                        
                                    logger.info(f"📥 GetNextNewMessage返回结果: {chat_name} {chat_type} {messages}")
                                except Exception as e:
                                    logger.info(f"❌ GetNextNewMessage调用异常: {e}")
                                    logger.info(traceback.format_exc())
                                    
                                    # 尝试获取可用的方法
                                    if self.wechat_client:
                                        methods = [m for m in dir(self.wechat_client) if not m.startswith('_') and callable(getattr(self.wechat_client, m))]
                                        logger.info(f"可用的微信客户端方法: {methods}")
                                    
                                    time.sleep(2)
                                    continue
                            except Exception as e:
                                logger.info(f"❌ GetNextNewMessage调用异常: {e}")
                                logger.info(traceback.format_exc())
                                time.sleep(2)
                                continue
                            
                            # 处理消息
                            if messages:
                                logger.info(f"📝 收到{len(messages)}条新消息")
                                # 确保messages是列表
                                if not isinstance(messages, list):
                                    messages = [messages]
                                    logger.info(f"📝 收到单条消息，转换为列表: {type(messages)}")
                                else:
                                    logger.info(f"📝 收到{len(messages)}条新消息")
                                
                                # 处理消息...
                                # 这部分代码保持不变
                                for message in messages:
                                    try:
                                        # 获取消息发送者
                                        sender_name = None
                                        if hasattr(message, 'sender'):
                                            sender_name = message.sender
                                            logger.info(f"👤 消息发送者: {sender_name}")
                                        
                                        # 检查发送者是否在监听列表中
                                        if sender_name in self.monitored_contacts:
                                            logger.info(f"✅ 发现监听联系人 {sender_name} 的消息")
                                            
                                            # 生成消息唯一ID
                                            content = getattr(message, 'content', '')
                                            msg_time = getattr(message, 'time', '')
                                            attr = getattr(message, 'attr', '')
                                            msg_id = f"{sender_name}:{content[:20]}:{msg_time}"
                                            
                                            logger.info(f"📋 消息详情 - 内容: '{content[:30]}...', 时间: {msg_time}, 属性: {attr}")
                                            
                                            # 初始化联系人的消息缓存
                                            if sender_name not in message_id_cache:
                                                message_id_cache[sender_name] = set()
                                                logger.info(f"🆕 为联系人 {sender_name} 创建消息缓存")
                                            
                                            # 检查是否是新消息（非自己发送的且未处理过）
                                            if (hasattr(message, 'attr') and message.attr != 'self' and 
                                                msg_id not in message_id_cache[sender_name]):
                                                
                                                # 将消息放入队列处理
                                                self.message_queue.put((sender_name, message))
                                                logger.info(f"📨 收到来自 {sender_name} 的新消息: {content[:30]}...")
                                                
                                                # 添加到缓存，避免重复处理
                                                message_id_cache[sender_name].add(msg_id)
                                                logger.info(f"📌 消息ID已添加到缓存，当前缓存大小: {len(message_id_cache[sender_name])}")
                                                
                                                # 限制缓存大小
                                                if len(message_id_cache[sender_name]) > 100:
                                                    old_size = len(message_id_cache[sender_name])
                                                    # 保留最新的50条
                                                    message_id_cache[sender_name] = set(list(message_id_cache[sender_name])[-50:])
                                                    logger.info(f"🧹 清理消息缓存: {old_size} -> {len(message_id_cache[sender_name])}")
                                            else:
                                                if message.attr == 'self':
                                                    logger.info(f"🚫 跳过自己发送的消息")
                                                elif msg_id in message_id_cache[sender_name]:
                                                    logger.info(f"🔄 跳过重复消息: {content[:20]}...")
                                                else:
                                                    logger.info(f"⏭️ 跳过不符合条件的消息")
                                        else:
                                            if sender_name:
                                                logger.debug(f"❌ 发送者 {sender_name} 不在监听列表中，跳过")
                                    except Exception as msg_error:
                                        logger.error(f"❗ 处理单条消息失败: {msg_error}")
                                        logger.error(traceback.format_exc())
                            else:
                                if loop_count % 300 == 0:  # 每300次循环记录一次
                                    logger.debug("🔄 没有新消息")
                        except Exception as inner_e:
                            logger.error(f"❌ 获取消息过程中发生异常: {inner_e}")
                            logger.error(traceback.format_exc())
                            time.sleep(2)  # 出错后暂停一段时间
                            continue
                        
                        # 监听间隔
                        time.sleep(1)
                        
                    except Exception as e:
                        logger.error(f"❌ 消息监听线程循环内异常: {e}")
                        logger.error(traceback.format_exc())
                        time.sleep(5)  # 出错后暂停一段时间
                
            except Exception as outer_e:
                logger.error(f"❌❌❌ 监听线程主循环异常: {outer_e}")
                logger.error(traceback.format_exc())
            
            logger.info("🛑 消息监听线程已停止")
        
        # 启动监听线程
        self.is_monitoring = True
        # 确保线程为daemon线程，这样主程序退出时线程会自动终止
        self.monitoring_thread = threading.Thread(target=monitor_messages, daemon=True)
        self.monitoring_thread.start()
        
        # 添加调试日志，确认线程已启动
        logger.info(f"✅ 已启动消息监听线程 (ID: {self.monitoring_thread.ident})")
        
        # 等待一小段时间，确保线程已经开始运行
        time.sleep(0.5)
        
        # 检查线程是否存活
        if self.monitoring_thread.is_alive():
            logger.info("✅ 监听线程已成功运行")
        else:
            logger.error("❌ 监听线程启动失败")
            
        # 返回线程ID，便于调试
        return self.monitoring_thread.ident

    def _restore_monitoring_status(self):
        """从数据库中恢复监听状态"""
        try:
            logger.info("正在从数据库恢复监听状态...")
            current_wxid = self.get_current_wxid()
            
            # 查询所有is_monitoring=1的会话
            with self._get_db_connection() as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                cursor.execute('''
                    SELECT session_id, name FROM sessions 
                    WHERE wxid = ? AND is_monitoring = 1
                ''', (current_wxid,))
                
                rows = cursor.fetchall()
                restored_count = 0
                
                for row in rows:
                    try:
                        session_id = row['session_id']
                        name = row['name']
                        
                        # 从session_id中提取联系人名称
                        if session_id.startswith('private_self_'):
                            contact_name = session_id[13:]  # 移除 'private_self_' 前缀
                        else:
                            contact_name = name
                        
                        if contact_name:
                            # 更新内存中的监听状态
                            self.monitored_contacts[contact_name] = {
                                "auto_reply": True,  # 默认启用自动回复
                                "active": True
                            }
                            restored_count += 1
                            logger.info(f"已恢复监听状态: {contact_name}")
                    except Exception as e:
                        logger.error(f"恢复单个联系人监听状态失败: {e}")
                        logger.error(traceback.format_exc())
                
                logger.info(f"共恢复了 {restored_count} 个联系人的监听状态")
                
                # 获取自动回复状态
                try:
                    cursor = conn.cursor()
                    cursor.execute('SELECT auto_reply_enabled FROM ai_sales_config WHERE wxid = ?', (current_wxid,))
                    row = cursor.fetchone()
                    if row and row['auto_reply_enabled'] is not None:
                        self.auto_reply_enabled = bool(row['auto_reply_enabled'])
                        logger.info(f"已恢复自动回复状态: {self.auto_reply_enabled}")
                except Exception as e:
                    logger.error(f"恢复自动回复状态失败: {e}")
                    logger.error(traceback.format_exc())
        
        except Exception as e:
            logger.error(f"恢复监听状态失败: {e}")
            logger.error(traceback.format_exc())

    def _save_reply_suggestion(self, session_id: str, content: str, message_id: int, contact_name: str = None) -> bool:
        """保存回复建议到reply_suggestions表
        
        Args:
            session_id: 会话ID
            content: 回复建议内容
            message_id: 对应的原始消息ID
            contact_name: 联系人名称，如果为None则从session_id中提取
            
        Returns:
            bool: 是否保存成功
        """
        try:
            current_wxid = self.get_current_wxid()
            timestamp = int(time.time())
            created_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            
            # 如果没有提供contact_name，则从session_id中提取
            if not contact_name and session_id.startswith("private_self_"):
                contact_name = session_id[13:]  # 移除 'private_self_' 前缀
            elif not contact_name:
                contact_name = session_id  # 如果无法提取，则使用session_id作为chat_name
            
            logger.info(f"保存回复建议 - 会话ID: {session_id}, 消息ID: {message_id}, 联系人: {contact_name}")
            
            # 使用新的数据库连接
            with self._get_db_connection() as conn:
                cursor = conn.cursor()
                
                # 检查表是否存在
                cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='reply_suggestions'")
                if not cursor.fetchone():
                    logger.error("reply_suggestions表不存在，尝试创建")
                    cursor.execute('''
                        CREATE TABLE IF NOT EXISTS reply_suggestions (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            session_id TEXT NOT NULL,
                            wxid TEXT NOT NULL,
                            content TEXT NOT NULL,
                            message_id INTEGER NOT NULL,
                            timestamp INTEGER NOT NULL,
                            created_at TEXT,
                            used INTEGER DEFAULT 0,
                            chat_name TEXT NOT NULL,
                            FOREIGN KEY (message_id) REFERENCES messages (id)
                        )
                    ''')
                    conn.commit()
                    logger.info("✅ 成功创建reply_suggestions表")
                
                # 检查消息是否存在
                cursor.execute("SELECT id FROM messages WHERE id = ?", (message_id,))
                if not cursor.fetchone():
                    logger.warning(f"消息ID {message_id} 不存在，无法保存回复建议")
                    return False
                
                try:
                    # 插入回复建议
                    cursor.execute('''
                        INSERT INTO reply_suggestions 
                        (session_id, wxid, content, message_id, timestamp, created_at, used, chat_name)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ''', (
                        session_id,
                        current_wxid,
                        content,
                        message_id,
                        timestamp,
                        created_at,
                        0,
                        contact_name
                    ))
                    
                    conn.commit()
                    
                    # 获取插入的ID
                    cursor.execute("SELECT last_insert_rowid()")
                    suggestion_id = cursor.fetchone()[0]
                    logger.info(f"✅ 回复建议已保存，ID: {suggestion_id}")
                    
                    # 检查是否成功保存
                    cursor.execute("SELECT id FROM reply_suggestions WHERE id = ?", (suggestion_id,))
                    if cursor.fetchone():
                        logger.info(f"✅ 验证成功：回复建议ID {suggestion_id} 已存在于数据库中")
                    else:
                        logger.warning(f"⚠️ 验证失败：回复建议ID {suggestion_id} 未找到")
                    
                    return True
                except Exception as insert_error:
                    logger.error(f"插入回复建议失败: {insert_error}")
                    logger.error(traceback.format_exc())
                    
                    # 检查表结构
                    cursor.execute("PRAGMA table_info(reply_suggestions)")
                    columns = [column[1] for column in cursor.fetchall()]
                    logger.info(f"reply_suggestions表结构: {columns}")
                    
                    return False
        except Exception as e:
            logger.error(f"保存回复建议失败: {e}")
            logger.error(traceback.format_exc())
            return False

    def get_reply_suggestions(self, session_id: str, limit: int = 10) -> Dict[str, Any]:
        """获取指定会话的回复建议
        
        Args:
            session_id: 会话ID
            limit: 返回的最大条数
            
        Returns:
            Dict: 包含回复建议的字典
        """
        try:
            current_wxid = self.get_current_wxid()
            logger.info(f"获取回复建议 - 会话ID: {session_id}, wxid: {current_wxid}")
            
            # 使用新的数据库连接
            with self._get_db_connection() as conn:
                cursor = conn.cursor()
                
                # 检查表是否存在
                cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='reply_suggestions'")
                if not cursor.fetchone():
                    logger.warning("reply_suggestions表不存在")
                    return {"success": False, "message": "reply_suggestions表不存在"}
                
                # 检查表结构
                cursor.execute("PRAGMA table_info(reply_suggestions)")
                columns = [column[1] for column in cursor.fetchall()]
                logger.info(f"reply_suggestions表结构: {columns}")
                
                # 查询回复建议，并关联原始消息
                try:
                    cursor.execute('''
                        SELECT rs.id, rs.content, rs.message_id, rs.timestamp, rs.created_at, rs.used,
                               m.content as original_content, m.timestamp as original_timestamp
                        FROM reply_suggestions rs
                        JOIN messages m ON rs.message_id = m.id
                        WHERE rs.session_id = ? AND rs.wxid = ?
                        ORDER BY rs.timestamp DESC
                        LIMIT ?
                    ''', (session_id, current_wxid, limit))
                    
                    rows = cursor.fetchall()
                    logger.info(f"查询到 {len(rows)} 条回复建议")
                except Exception as e:
                    logger.error(f"查询回复建议失败: {e}")
                    logger.error(traceback.format_exc())
                    return {"success": False, "message": f"查询回复建议失败: {str(e)}"}
                
                suggestions = []
                
                for row in rows:
                    suggestion = {
                        "id": row[0],
                        "content": row[1],
                        "message_id": row[2],
                        "timestamp": row[3],
                        "created_at": row[4],
                        "used": bool(row[5]),
                        "original_content": row[6],
                        "original_timestamp": row[7],
                        "formatted_time": datetime.fromtimestamp(row[3]).strftime("%Y-%m-%d %H:%M:%S")
                    }
                    suggestions.append(suggestion)
                
                logger.info(f"成功获取 {len(suggestions)} 条回复建议")
                return {
                    "success": True,
                    "data": {
                        "suggestions": suggestions,
                        "total": len(suggestions)
                    }
                }
        except Exception as e:
            logger.error(f"获取回复建议失败: {e}")
            logger.error(traceback.format_exc())
            return {"success": False, "message": str(e)}

    def mark_suggestion_as_used(self, suggestion_id: int) -> Dict[str, Any]:
        """标记回复建议为已使用
        
        Args:
            suggestion_id: 回复建议ID
            
        Returns:
            Dict: 操作结果
        """
        try:
            # 使用新的数据库连接
            with self._get_db_connection() as conn:
                cursor = conn.cursor()
                
                # 更新回复建议状态
                cursor.execute('''
                    UPDATE reply_suggestions
                    SET used = 1
                    WHERE id = ?
                ''', (suggestion_id,))
                
                conn.commit()
                
                affected_rows = cursor.rowcount
                if affected_rows > 0:
                    logger.info(f"✅ 回复建议 {suggestion_id} 已标记为已使用")
                    return {"success": True, "message": "已标记为已使用"}
                else:
                    logger.warning(f"⚠️ 回复建议 {suggestion_id} 不存在")
                    return {"success": False, "message": "回复建议不存在"}
                
        except Exception as e:
            logger.error(f"标记回复建议失败: {e}")
            logger.error(traceback.format_exc())
            return {"success": False, "message": str(e)}

    def delete_old_suggestions(self) -> Dict[str, Any]:
        """删除messages表中的suggestion类型消息，因为现在使用reply_suggestions表存储
        
        Returns:
            Dict: 操作结果
        """
        try:
            logger.info("开始删除messages表中的suggestion类型消息...")
            current_wxid = self.get_current_wxid()
            
            # 使用新的数据库连接
            with self._get_db_connection() as conn:
                cursor = conn.cursor()
                
                # 查询suggestion类型的消息数量
                cursor.execute('''
                    SELECT COUNT(*) FROM messages 
                    WHERE msg_type = 'suggestion' AND wxid = ?
                ''', (current_wxid,))
                
                count = cursor.fetchone()[0]
                logger.info(f"找到 {count} 条suggestion类型消息")
                
                if count > 0:
                    # 删除suggestion类型的消息
                    cursor.execute('''
                        DELETE FROM messages 
                        WHERE msg_type = 'suggestion' AND wxid = ?
                    ''', (current_wxid,))
                    
                    conn.commit()
                    deleted_count = cursor.rowcount
                    logger.info(f"✅ 成功删除 {deleted_count} 条suggestion类型消息")
                    
                    return {
                        "success": True,
                        "message": f"已删除 {deleted_count} 条suggestion类型消息",
                        "count": deleted_count
                    }
                else:
                    return {
                        "success": True,
                        "message": "没有找到suggestion类型消息",
                        "count": 0
                    }
                
        except Exception as e:
            logger.error(f"删除suggestion类型消息失败: {e}")
            logger.error(traceback.format_exc())
            return {"success": False, "message": str(e)}

    def call_openai_api_with_history(self, api_key: str, model: str, messages: List[Dict[str, str]], 
                          temperature: float = 0.7, max_tokens: int = 2000, api_url: Optional[str] = None) -> Optional[str]:
        """调用OpenAI API生成回复，支持传入完整的消息历史
        
        Args:
            api_key: API密钥
            model: 模型名称
            messages: 消息列表，包含角色和内容
            temperature: 温度参数
            max_tokens: 最大生成token数
            api_url: 可选的API URL，如果不提供则使用OpenAI默认地址
            
        Returns:
            生成的回复内容，如果调用失败则返回None
        """
        try:
            # 默认使用OpenAI API地址，如果提供了自定义API地址则使用自定义地址
            if api_url:
                url = api_url
            else:
                # 默认使用国内可访问的代理地址
                url = "https://api.openai-proxy.com/v1/chat/completions"
                # 其他可选的代理地址
                # url = "https://openai.aihey.cc/openai/v1/chat/completions"
                # url = "https://openai.wndbac.cn/v1/chat/completions"
                # url = "https://proxy.geekai.co/v1/chat/completions"
            
            # 准备请求头
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}"
            }
            
            # 准备请求体
            data = {
                "model": model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens
            }
            
            logger.info(f"开始调用API: {url}")
            logger.info(f"消息数量: {len(messages)}")
            
            # 发送请求
            response = requests.post(url, headers=headers, json=data, timeout=30)
            
            # 检查响应状态
            if response.status_code == 200:
                response_data = response.json()
                
                # 提取生成的文本
                if "choices" in response_data and len(response_data["choices"]) > 0:
                    message = response_data["choices"][0].get("message", {})
                    content = message.get("content", "")
                    
                    if content:
                        logger.info(f"API调用成功，获取到回复内容")
                        return content.strip()
                    else:
                        logger.warning(f"API返回内容为空")
                        return None
                else:
                    logger.warning(f"API响应格式不正确: {response_data}")
                    return None
            else:
                logger.error(f"API调用失败，状态码: {response.status_code}, 响应: {response.text}")
                # 如果当前API调用失败，尝试使用备用API
                if url != "https://api.openai.com/v1/chat/completions":
                    logger.info("尝试使用官方API进行调用")
                    return self._fallback_api_call_with_history(api_key, model, messages, temperature, max_tokens)
                return None
                
        except Exception as e:
            logger.error(f"调用OpenAI API失败: {e}")
            logger.error(traceback.format_exc())
            # 如果当前API调用出现异常，尝试使用备用API
            if url != "https://api.openai.com/v1/chat/completions":
                logger.info("尝试使用官方API进行调用")
                return self._fallback_api_call_with_history(api_key, model, messages, temperature, max_tokens)
            return None
            
    def _fallback_api_call_with_history(self, api_key: str, model: str, messages: List[Dict[str, str]], 
                                      temperature: float = 0.7, max_tokens: int = 2000) -> Optional[str]:
        """备用API调用方法，当主要API调用失败时使用，支持传入完整的消息历史
        
        Args:
            与call_openai_api_with_history相同
            
        Returns:
            生成的回复内容，如果调用失败则返回None
        """
        try:
            # 备用API列表
            backup_apis = [
                "https://api.openai.com/v1/chat/completions",
                "https://openai.wndbac.cn/v1/chat/completions",
                "https://proxy.geekai.co/v1/chat/completions"
            ]
            
            for url in backup_apis:
                try:
                    logger.info(f"尝试使用备用API: {url}")
                    
                    # 准备请求头
                    headers = {
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {api_key}"
                    }
                    
                    # 准备请求体
                    data = {
                        "model": model,
                        "messages": messages,
                        "temperature": temperature,
                        "max_tokens": max_tokens
                    }
                    
                    # 发送请求
                    response = requests.post(url, headers=headers, json=data, timeout=30)
                    
                    # 检查响应状态
                    if response.status_code == 200:
                        response_data = response.json()
                        
                        # 提取生成的文本
                        if "choices" in response_data and len(response_data["choices"]) > 0:
                            message = response_data["choices"][0].get("message", {})
                            content = message.get("content", "")
                            
                            if content:
                                logger.info(f"备用API调用成功: {url}")
                                return content.strip()
                except Exception as e:
                    logger.warning(f"备用API {url} 调用失败: {e}")
                    continue
            
            logger.error("所有API调用尝试均失败")
            return None
        except Exception as e:
            logger.error(f"备用API调用失败: {e}")
            logger.error(traceback.format_exc())
            return None

def main():
    """主函数"""
    logger.info("🚀 WxAuto bridge 正在启动...")
    
    # 创建桥接实例
    bridge = WxAutoBridge()
    logger.info("✅ WxAutoBridge 实例已创建")
    
    # 信号处理
    def signal_handler(signum, _):
        logger.info(f"📢 收到信号 {signum}，正在退出...")
        sys.exit(0)
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    logger.info("✅ 信号处理器已注册")
    
    # 尝试初始化微信客户端
    try:
        logger.info("🔄 正在初始化微信客户端...")
        init_result = bridge.init_wechat()
        if init_result.get("success"):
            logger.info(f"✅ 微信客户端初始化成功: {init_result.get('message')}")
            if init_result.get("user_info"):
                logger.info(f"👤 当前用户: {init_result['user_info'].get('nickname')}")
        else:
            logger.warning(f"⚠️ 微信客户端初始化失败: {init_result.get('message')}")
    except Exception as e:
        logger.error(f"❌ 微信客户端初始化异常: {e}")
        logger.error(traceback.format_exc())
    
    logger.info("✅ WxAuto bridge 启动完成，等待命令...")
    
    try:
        while True:
            try:
                # 读取命令
                logger.debug("⏳ 等待命令输入...")
                line = sys.stdin.readline()
                if not line:
                    logger.info("📢 检测到标准输入已关闭，退出程序")
                    break
                
                line = line.strip()
                if not line:
                    continue
                
                # 解析命令
                try:
                    command_data = json.loads(line)
                    command_id = command_data.get("id")
                    command = command_data.get("command")
                    params = command_data.get("params", {})
                    
                    # 执行命令
                    logger.info(f"📥 收到命令: {command}, 参数: {params}")

                    # 特殊处理get_connection_status命令
                    if command == "get_connection_status":
                        logger.info(f"🔍 连接状态检查 - wechat_client: {bridge.wechat_client is not None}, is_connected: {bridge.is_connected}")
                        logger.info(f"🔍 用户信息缓存: {bridge.cached_user_info}")
                        logger.info(f"🔍 监听状态: is_monitoring={bridge.is_monitoring}, 监听联系人数量={len(bridge.monitored_contacts)}")
                        if bridge.monitoring_thread:
                            logger.info(f"🔍 监听线程状态: alive={bridge.monitoring_thread.is_alive()}, ident={bridge.monitoring_thread.ident}")
                        else:
                            logger.info("🔍 监听线程未创建")
                        if bridge.message_processor_thread:
                            logger.info(f"🔍 消息处理线程状态: alive={bridge.message_processor_thread.is_alive()}, ident={bridge.message_processor_thread.ident}")
                        else:
                            logger.info("🔍 消息处理线程未创建")

                    if hasattr(bridge, command):
                        method = getattr(bridge, command)
                        if callable(method):
                            logger.info(f"🔧 执行方法: {command}")
                            result = method(**params)
                            logger.info(f"📤 命令执行结果: {result}")
                        else:
                            result = {"success": False, "message": f"'{command}' 不是可调用方法"}
                            logger.error(f"❌ 方法不可调用: {command}")
                    else:
                        result = {"success": False, "message": f"未知命令: {command}"}
                        logger.error(f"❌ 未知命令: {command}")

                        # 列出可用的方法
                        available_methods = [attr for attr in dir(bridge) if not attr.startswith('_') and callable(getattr(bridge, attr))]
                        logger.info(f"ℹ️ 可用方法: {available_methods}")
                    
                    # 返回结果
                    response = {"id": command_id, **result}
                    print(f"RESPONSE:{json.dumps(response)}")
                    sys.stdout.flush()
                    
                except json.JSONDecodeError as e:
                    logger.error(f"❌ 命令解析失败: {e}")
                except Exception as e:
                    logger.error(f"❌ 命令执行失败: {e}")
                    logger.error(traceback.format_exc())
                    response = {
                        "id": command_data.get("id") if 'command_data' in locals() else "unknown",
                        "success": False,
                        "message": str(e)
                    }
                    print(f"RESPONSE:{json.dumps(response)}")
                    sys.stdout.flush()
                    
            except KeyboardInterrupt:
                logger.info("📢 检测到键盘中断，退出程序")
                break
            except Exception as e:
                logger.error(f"❌ 意外错误: {e}")
                logger.error(traceback.format_exc())
                break
                
    except Exception as e:
        logger.error(f"❌ 致命错误: {e}")
        logger.error(traceback.format_exc())
    finally:
        logger.info("🛑 WxAuto bridge 已停止")

if __name__ == "__main__":
    main()
