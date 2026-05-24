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

// POST /api/notifications/test-wework — 超管测试企微推送（同步等待结果）
router.post('/test-wework', async (req, res) => {
  if (!req.user || req.user.role !== 'admin' || !req.user.is_super) {
    return res.status(403).json({ success: false, error: '无权限' });
  }
  try {
    const row = req.db.prepare("SELECT value FROM settings WHERE key = 'wework_webhook_url'").get();
    const webhookUrl = row && row.value;
    if (!webhookUrl) {
      return res.status(400).json({ success: false, error: '请先在「系统设置」配置 Webhook URL' });
    }

    const content = `**🔔 企微推送测试**\n` +
                    `> 来源：腾讯营销·商达撮合平台\n` +
                    `> 时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n\n` +
                    `如果你看到这条消息，说明 Webhook 配置成功！`;
    // 测试推送直接同步等待 postWebhook 结果
    await postWebhook(webhookUrl, { msgtype: 'markdown', markdown: { content } });
    res.json({ success: true, message: '测试消息已发送，请查看企微群' });
  } catch (e) {
    console.error('[notifications/test-wework]', e);
    res.status(500).json({ success: false, error: '操作失败，请稍后重试' });
  }
});

module.exports = router;

// ====== 工具函数（供其他路由引用）======

/**
 * V5: 企微推送事件键定义（用于配置开关）
 * 每个事件可独立开关，存在 settings 表中：wework_event_<key> = 'on' | 'off'
 */
const WEWORK_EVENTS = {
  INFLUENCER_DEMAND_PUBLISH: { key: 'wework_event_inf_publish',   label: '达人发布带货意向', defaultOn: false },
  MERCHANT_DEMAND_PUBLISH:   { key: 'wework_event_mer_publish',   label: '商家发布需求',     defaultOn: false },
  INFLUENCER_APPLY:          { key: 'wework_event_inf_apply',     label: '达人响应商家需求', defaultOn: true  },
  MERCHANT_INVITE:           { key: 'wework_event_mer_invite',    label: '商家邀约达人',     defaultOn: true  },
  MERCHANT_ACCEPT:           { key: 'wework_event_mer_accept',    label: '商家接受达人申请', defaultOn: true  },
  INFLUENCER_ACCEPT:         { key: 'wework_event_inf_accept',    label: '达人接受商家邀约', defaultOn: true  },
  INTENT_CONFIRMED:          { key: 'wework_event_confirmed',     label: '双方意向达成',     defaultOn: true  },
  STAGE_SAMPLE_SENT:         { key: 'wework_event_sample',        label: '撮合-样品寄送',    defaultOn: false },
  STAGE_COOPERATING:         { key: 'wework_event_cooperating',   label: '撮合-开始合作',    defaultOn: true  },
  USER_ACTIVATED:            { key: 'wework_event_activated',     label: '新用户激活入驻',   defaultOn: false },
};

/**
 * 写入一条站内通知
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
 * 查询某个事件是否启用推送
 */
function isEventEnabled(db, eventKey) {
  if (!eventKey) return true; // 测试推送等场景跳过开关
  const ev = Object.values(WEWORK_EVENTS).find(e => e.key === eventKey);
  if (!ev) return false;
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(eventKey);
    if (row && row.value) return row.value === 'on';
    return ev.defaultOn;
  } catch (e) { return ev.defaultOn; }
}

/**
 * V5 升级版：企微 Webhook 推送（markdown 格式，不 @人）
 * @param {object} db
 * @param {object} payload
 *   - eventKey: string|null  事件键，用于查开关；null 跳过开关（如测试推送）
 *   - type: 'markdown' | 'text'
 *   - content: string  消息正文
 *
 * 兼容旧调用方式：notifyWework(db, '纯文本消息')
 * 注意：按业务约定不做 @人，mentionedMobiles/mentionedAll 参数已弃用（向后兼容但不会执行）
 */
/**
 * V5 升级版：企微 Webhook 推送（markdown 格式，不 @人）
 *
 * V5 B4: 完全异步化（fire-and-forget）
 * - 调用方不需要 await，立即返回
 * - 实际 webhook 发送通过 setImmediate 推到下个事件循环
 * - 所以业务路由不会因为企微推送阻塞响应（HTTPS 请求 + 5s 超时）
 *
 * @param {object} db
 * @param {object} payload
 *   - eventKey: string|null  事件键，用于查开关；null 跳过开关
 *   - type: 'markdown' | 'text'
 *   - content: string  消息正文
 *
 * 兼容旧调用方式：notifyWework(db, '纯文本消息')
 */
function notifyWework(db, payload) {
  // 兼容旧签名：第二个参数是字符串
  if (typeof payload === 'string') {
    payload = { eventKey: null, type: 'text', content: payload };
  }
  const { eventKey, type = 'markdown', content } = payload;

  // 事件开关（同步检查 - 极快）
  if (!isEventEnabled(db, eventKey)) return;

  let webhookUrl;
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'wework_webhook_url'").get();
    webhookUrl = row && row.value;
  } catch (e) { return; }
  if (!webhookUrl) return;

  // 构造消息体（按业务要求：不 @人，只发内容）
  const body = type === 'markdown'
    ? { msgtype: 'markdown', markdown: { content } }
    : { msgtype: 'text', text: { content } };

  // 异步发送：推到下个事件循环，不阻塞当前请求
  setImmediate(() => {
    postWebhook(webhookUrl, body).catch(e => {
      console.error('[WeWork Webhook] async post failed:', e.message);
    });
  });
}

/**
 * 实际发起 HTTPS 请求（封装）
 */
function postWebhook(webhookUrl, body) {
  return new Promise((resolve) => {
    try {
      const https = require('https');
      const http = require('http');
      const data = JSON.stringify(body);
      const url = new URL(webhookUrl);
      const lib = url.protocol === 'https:' ? https : http;

      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
        timeout: 5000,
      };

      const req = lib.request(options, (resp) => {
        resp.resume();
        resolve();
      });
      req.on('error', (e) => { console.error('[WeWork Webhook] error:', e.message); resolve(); });
      req.on('timeout', () => { req.destroy(); resolve(); });
      req.write(data);
      req.end();
    } catch (e) {
      console.error('[WeWork Webhook] post failed:', e.message);
      resolve();
    }
  });
}

/**
 * 根据 merchant / influencer 找到归属销售的手机号（用于 @）
 * 返回 string[] 销售手机号列表（已去重）
 */
function getOwnerSalesMobiles(db, { merchantId, influencerId }) {
  const mobiles = new Set();
  try {
    if (merchantId) {
      const row = db.prepare(`
        SELECT a.phone FROM merchants m
        LEFT JOIN admins a ON m.sales_owner_id = a.id
        WHERE m.id = ? AND a.phone IS NOT NULL AND a.phone != ''
      `).get(merchantId);
      if (row && row.phone) mobiles.add(row.phone);
    }
    if (influencerId) {
      const row = db.prepare(`
        SELECT a.phone FROM influencers i
        LEFT JOIN admins a ON i.sales_owner_id = a.id
        WHERE i.id = ? AND a.phone IS NOT NULL AND a.phone != ''
      `).get(influencerId);
      if (row && row.phone) mobiles.add(row.phone);
    }
  } catch (e) { /* ignore */ }
  return Array.from(mobiles);
}

module.exports.writeNotification = writeNotification;
module.exports.notifyWework = notifyWework;
module.exports.WEWORK_EVENTS = WEWORK_EVENTS;
module.exports.getOwnerSalesMobiles = getOwnerSalesMobiles;
