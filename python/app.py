#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
微信自动化 Flask API 服务器
用于测试联系人获取修复
"""

import sys
import json
import logging
import datetime
from flask import Flask, jsonify, request
from flask_cors import CORS
from wxauto_bridge import WxAutoBridge

# 设置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# 创建 Flask 应用
app = Flask(__name__)
CORS(app, origins=['http://localhost:5174'])

# 创建桥接实例
bridge = WxAutoBridge()

@app.route('/api/initialize', methods=['POST'])
def initialize():
    """初始化微信"""
    try:
        result = bridge.init_wechat()
        return jsonify(result)
    except Exception as e:
        logger.error(f"Initialize error: {e}")
        return jsonify({"success": False, "message": str(e)}), 500

@app.route('/api/status', methods=['GET'])
def get_status():
    """获取连接状态"""
    try:
        result = bridge.get_connection_status()
        return jsonify(result)
    except Exception as e:
        logger.error(f"Status error: {e}")
        return jsonify({"success": False, "message": str(e)}), 500

@app.route('/api/contacts', methods=['GET'])
def get_contacts():
    """获取联系人列表"""
    try:
        result = bridge.get_contacts()
        logger.info(f"Contacts API called, result: {result}")
        return jsonify(result)
    except Exception as e:
        logger.error(f"Contacts error: {e}")
        return jsonify({"success": False, "message": str(e)}), 500

@app.route('/api/groups', methods=['GET'])
def get_groups():
    """获取群组列表"""
    try:
        result = bridge.get_groups()
        logger.info(f"Groups API called, result: {result}")
        return jsonify(result)
    except Exception as e:
        logger.error(f"Groups error: {e}")
        return jsonify({"success": False, "message": str(e)}), 500

@app.route('/api/sessions', methods=['GET'])
def get_sessions():
    """获取会话列表"""
    try:
        # 获取联系人和群组
        contacts_result = bridge.get_contacts()
        groups_result = bridge.get_groups()
        
        sessions = []
        
        # 添加联系人
        if contacts_result.get("success") and contacts_result.get("data"):
            for contact in contacts_result["data"].get("contacts", []):
                sessions.append({
                    "id": contact["id"],
                    "name": contact["name"],
                    "type": "friend",
                    "source": contact.get("source", "unknown")
                })
        
        # 添加群组
        if groups_result.get("success") and groups_result.get("data"):
            for group in groups_result["data"].get("groups", []):
                sessions.append({
                    "id": group["id"],
                    "name": group["name"],
                    "type": "group",
                    "member_count": group.get("member_count", 0),
                    "source": group.get("source", "unknown")
                })
        
        result = {
            "success": True,
            "data": {
                "sessions": sessions,
                "contacts_method": contacts_result.get("data", {}).get("method", "unknown"),
                "groups_method": groups_result.get("data", {}).get("method", "unknown")
            }
        }
        
        logger.info(f"Sessions API called, result: {len(sessions)} sessions")
        return jsonify(result)
    except Exception as e:
        logger.error(f"Sessions error: {e}")
        return jsonify({"success": False, "message": str(e)}), 500

@app.route('/api/send_message', methods=['POST'])
def send_message():
    """发送消息"""
    try:
        data = request.get_json()
        target = data.get('target')
        message = data.get('message')
        
        result = bridge.send_message(target, message)
        return jsonify(result)
    except Exception as e:
        logger.error(f"Send message error: {e}")
        return jsonify({"success": False, "message": str(e)}), 500

@app.route('/api/auto_reply/status', methods=['GET'])
def get_auto_reply_status():
    """获取自动回复状态"""
    try:
        result = bridge.get_auto_reply_status()
        return jsonify(result)
    except Exception as e:
        logger.error(f"Auto reply status error: {e}")
        return jsonify({"success": False, "message": str(e)}), 500

@app.route('/api/auto_reply/toggle', methods=['POST'])
def toggle_auto_reply():
    """切换自动回复"""
    try:
        data = request.get_json()
        enabled = data.get('enabled', False)
        
        result = bridge.toggle_auto_reply(enabled)
        return jsonify(result)
    except Exception as e:
        logger.error(f"Toggle auto reply error: {e}")
        return jsonify({"success": False, "message": str(e)}), 500

@app.route('/api/test', methods=['GET'])
def test_api():
    """测试API"""
    return jsonify({
        "success": True,
        "message": "API is working",
        "timestamp": datetime.datetime.now().isoformat()
    })

@app.route('/api/chat/monitor/status', methods=['GET'])
def get_monitor_status():
    """获取监听状态"""
    try:
        # 返回监听状态
        return jsonify({
            "success": True,
            "data": {
                "monitoring": False,
                "auto_reply": False
            }
        })
    except Exception as e:
        logger.error(f"Monitor status error: {e}")
        return jsonify({"success": False, "message": str(e)}), 500

@app.route('/api/db/messages/<contact_name>', methods=['GET'])
def get_messages_from_db(contact_name):
    """从数据库获取指定联系人的聊天记录"""
    try:
        # 获取分页参数
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 20, type=int)

        result = bridge.get_messages_from_db(contact_name, page, per_page)
        return jsonify(result)
    except Exception as e:
        logger.error(f"Get messages from DB error: {e}")
        return jsonify({"success": False, "message": str(e)}), 500

@app.route('/api/chat/refresh_messages', methods=['POST'])
def refresh_chat_messages():
    """重新获取聊天记录"""
    try:
        data = request.get_json()
        contact_name = data.get('contact_name')

        if not contact_name:
            return jsonify({"success": False, "message": "contact_name is required"}), 400

        result = bridge.refresh_chat_messages(contact_name)
        return jsonify(result)
    except Exception as e:
        logger.error(f"Refresh chat messages error: {e}")
        return jsonify({"success": False, "message": str(e)}), 500

@app.route('/api/chat/clear_messages', methods=['POST'])
def clear_chat_messages():
    """清空聊天记录"""
    try:
        data = request.get_json()
        contact_name = data.get('contact_name')

        if not contact_name:
            return jsonify({"success": False, "message": "contact_name is required"}), 400

        result = bridge.clear_chat_messages(contact_name)
        return jsonify(result)
    except Exception as e:
        logger.error(f"Clear chat messages error: {e}")
        return jsonify({"success": False, "message": str(e)}), 500

@app.route('/api/chat/get_message_history', methods=['POST'])
def get_message_history():
    """获取聊天记录"""
    try:
        data = request.get_json()
        contact_name = data.get('contact_name')
        force_refresh = data.get('force_refresh', False)

        if not contact_name:
            return jsonify({"success": False, "message": "contact_name is required"}), 400

        result = bridge.get_message_history(contact_name, force_refresh)
        return jsonify(result)
    except Exception as e:
        logger.error(f"Get message history error: {e}")
        return jsonify({"success": False, "message": str(e)}), 500

@app.route('/health', methods=['GET'])
def health_check():
    """健康检查"""
    return jsonify({
        "status": "healthy",
        "service": "WeChat Automation API",
        "timestamp": datetime.datetime.now().isoformat()
    })

if __name__ == '__main__':
    logger.info("Starting WeChat Automation API Server...")
    logger.info("Server will run on http://localhost:5000")
    logger.info("CORS enabled for http://localhost:5174")
    
    try:
        app.run(host='0.0.0.0', port=5000, debug=True)
    except Exception as e:
        logger.error(f"Failed to start server: {e}")
        sys.exit(1)
