const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { notifyWework, WEWORK_EVENTS } = require('./notifications');
const BCRYPT_COST = 10;

function escapeMd(s) {
  if (s == null) return '';
  return String(s).replace(/[<>]/g, '');
}
function nowCN() {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

// 工具：脱敏显示名字（张三 → 张*；人民邮电出版社 → 人民**出版社）
function maskName(name) {
  if (!name) return '';
  if (name.length <= 2) return name.charAt(0) + '*';
  if (name.length <= 4) return name.charAt(0) + '*'.repeat(name.length - 2) + name.charAt(name.length - 1);
  return name.substring(0, 2) + '**' + name.substring(name.length - 2);
}

// 根据 code 在 merchants / influencers 表里找（V5 加过期校验）
function findInvite(db, code) {
  const m = db.prepare(`
    SELECT 'merchant' as kind, id, name, company, phone, invite_status, invite_code_expires_at
    FROM merchants
    WHERE invite_code = ?
      AND (invite_code_expires_at IS NULL OR datetime(invite_code_expires_at) > datetime('now'))
  `).get(code);
  if (m) return m;
  const i = db.prepare(`
    SELECT 'influencer' as kind, id, video_account_name, invite_status, invite_code_expires_at
    FROM influencers
    WHERE invite_code = ?
      AND (invite_code_expires_at IS NULL OR datetime(invite_code_expires_at) > datetime('now'))
  `).get(code);
  return i || null;
}

// 验证邀请码，返回脱敏信息
router.get('/validate', (req, res) => {
  try {
    const code = (req.query.code || '').trim();
    if (!code) return res.status(400).json({ success: false, error: '邀请码不能为空' });

    const rec = findInvite(req.db, code);
    if (!rec) return res.status(404).json({ success: false, error: '邀请链接无效或已过期' });

    if (rec.invite_status === 'active') {
      return res.status(400).json({ success: false, error: '该账号已激活，请直接登录' });
    }
    if (rec.invite_status === 'disabled') {
      return res.status(400).json({ success: false, error: '该账号已停用，请联系管理员' });
    }

    const data = { kind: rec.kind };
    if (rec.kind === 'merchant') {
      data.display_name = maskName(rec.company || rec.name);
      data.verify_field = 'company';
      data.verify_hint = '请输入完整的公司名称以确认身份';
    } else {
      data.display_name = maskName(rec.video_account_name);
      data.verify_field = 'video_account_name';
      data.verify_hint = '请输入完整的视频号账号名以确认身份';
    }
    res.json({ success: true, data });
  } catch (err) {
    console.error('[' + "routes/invitations.js" + ']', err);
    res.status(500).json({ success: false, error: '操作失败，请稍后重试' });
  }
});

// 激活账号：校验 code + 验证身份 + 设置密码
router.post('/activate', (req, res) => {
  try {
    const { code, verify_value, password } = req.body;
    if (!code || !verify_value || !password) {
      return res.status(400).json({ success: false, error: '参数不完整' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, error: '密码至少 6 位' });
    }

    const rec = findInvite(req.db, code);
    if (!rec) return res.status(404).json({ success: false, error: '邀请链接无效或已过期' });
    if (rec.invite_status !== 'pending') {
      return res.status(400).json({ success: false, error: '该邀请已失效（账号可能已激活或停用）' });
    }

    // V5: 密码哈希存储（不再写明文）
    const pwdHash = bcrypt.hashSync(password, BCRYPT_COST);

    // 身份验证：公司名/达人账号名必须完全匹配
    const trimVal = verify_value.trim();
    let loginUsername = '';
    if (rec.kind === 'merchant') {
      if (trimVal !== (rec.company || '').trim() && trimVal !== (rec.name || '').trim()) {
        return res.status(400).json({ success: false, error: '公司名称不匹配，请核对后重试' });
      }
      // V5: 激活成功后清空 invite_code 实现一次性使用
      req.db.prepare(`
        UPDATE merchants
        SET password_hash = ?, password = '', invite_status = 'active', activated_at = datetime('now'),
            status = 'active', invite_code = NULL, invite_code_expires_at = NULL,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(pwdHash, rec.id);
      loginUsername = rec.phone || '';
    } else {
      if (trimVal !== (rec.video_account_name || '').trim()) {
        return res.status(400).json({ success: false, error: '账号名不匹配，请核对后重试' });
      }
      req.db.prepare(`
        UPDATE influencers
        SET password_hash = ?, password = '', invite_status = 'active', activated_at = datetime('now'),
            invite_code = NULL, invite_code_expires_at = NULL,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(pwdHash, rec.id);
      loginUsername = rec.video_account_name || '';
    }

    res.json({
      success: true,
      message: '账号激活成功',
      data: { login_username: loginUsername, kind: rec.kind }
    });

    // 企微推送：场景#10 新用户激活入驻（异步，不阻塞响应）
    try {
      notifyWework(req.db, {
        eventKey: WEWORK_EVENTS.USER_ACTIVATED.key,
        type: 'markdown',
        content: `**👤 新用户激活入驻**\n` +
                 `> 类型：${rec.kind === 'merchant' ? '🏢 商家' : '🎤 达人'}\n` +
                 `> 名称：<font color="info">${escapeMd(rec.kind === 'merchant' ? (rec.company || rec.name) : rec.video_account_name)}</font>\n` +
                 `> 登录账号：${escapeMd(loginUsername)}\n` +
                 `> 时间：${nowCN()}`,
      });
    } catch (e) { /* fire-and-forget */ }
  } catch (err) {
    console.error('[' + "routes/invitations.js" + ']', err);
    res.status(500).json({ success: false, error: '操作失败，请稍后重试' });
  }
});

module.exports = router;
