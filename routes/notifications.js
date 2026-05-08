const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

// GET /api/notifications/unread-count — 轮询未读数（仅 COUNT，极低负载）
router.get('/unread-count', (req, res) => {
  const { user_type, id } = req.user;
  const row = req.db.prepare(
    "SELECT COUNT(*) as count FROM notifications WHERE user_type = ? AND user_id = ? AND is_read = 0"
  ).get(user_type || req.user.role, id);
  res.json({ success: true, data: { count: row.count } });
});

// GET /api/notifications — 获取通知列表（最近 50 条）
router.get('/', (req, res) => {
  const { id } = req.user;
  const role = req.user.role;
  const list = req.db.prepare(
    "SELECT * FROM notifications WHERE user_type = ? AND user_id = ? ORDER BY created_at DESC LIMIT 50"
  ).all(role, id);
  res.json({ success: true, data: list });
});

// PUT /api/notifications/:id/read — 单条标记已读
router.put('/:id/read', (req, res) => {
  const { id } = req.user;
  const role = req.user.role;
  req.db.prepare(
    "UPDATE notifications SET is_read = 1 WHERE id = ? AND user_type = ? AND user_id = ?"
  ).run(req.params.id, role, id);
  res.json({ success: true });
});

// PUT /api/notifications/read-all — 全部标记已读
router.put('/read-all', (req, res) => {
  const { id } = req.user;
  const role = req.user.role;
  req.db.prepare(
    "UPDATE notifications SET is_read = 1 WHERE user_type = ? AND user_id = ?"
  ).run(role, id);
  res.json({ success: true });
});

module.exports = router;

// ====== 工具函数（供其他路由引用）======

/**
 * 写入一条站内通知
 * @param {object} db - better-sqlite3 实例
 * @param {string} userType - 接收方角色：'admin'|'merchant'|'influencer'
 * @param {string} userId   - 接收方 ID
 * @param {string} type     - 通知类型：'interest'|'response'|'confirmed'|'invite'|'system'
 * @param {string} content  - 通知正文
 * @param {string} relatedId - 关联业务 ID（cooperation_id 等）
 */
function writeNotification(db, userType, userId, type, content, relatedId = null) {
  try {
    db.prepare(
      "INSERT INTO notifications (id, user_type, user_id, type, content, related_id) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(uuidv4(), userType, userId, type, content, relatedId);
  } catch (e) {
    console.error('[Notification] write failed:', e.message);
  }
}

/**
 * 触发企微 Webhook（fire-and-forget，失败不阻塞主流程）
 * @param {object} db      - better-sqlite3 实例
 * @param {string} message - 推送正文
 */
async function notifyWework(db, message) {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'wework_webhook_url'").get();
    const webhookUrl = row && row.value;
    if (!webhookUrl) return;

    const https = require('https');
    const http = require('http');
    const body = JSON.stringify({ msgtype: 'text', text: { content: message } });
    const url = new URL(webhookUrl);
    const lib = url.protocol === 'https:' ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };

    const req = lib.request(options, (resp) => {
      resp.resume(); // 消费响应体防止内存泄漏
    });
    req.on('error', (e) => console.error('[WeWork Webhook] error:', e.message));
    req.write(body);
    req.end();
  } catch (e) {
    console.error('[WeWork Webhook] failed:', e.message);
  }
}

module.exports.writeNotification = writeNotification;
module.exports.notifyWework = notifyWework;
