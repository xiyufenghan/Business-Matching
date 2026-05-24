const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

// 角色白名单
const VALID_ROLES = ['销售', '运营', '管理员'];

// ========== 员工统计（Hero 数据） ==========
router.get('/stats', (req, res) => {
  try {
    const total = req.db.prepare('SELECT COUNT(*) as c FROM admins').get().c;
    const active = req.db.prepare("SELECT COUNT(*) as c FROM admins WHERE status != 'disabled'").get().c;
    const roles = req.db.prepare('SELECT admin_role, COUNT(*) as c FROM admins GROUP BY admin_role ORDER BY c DESC').all();
    // 各员工归属数据量
    const perEmployee = req.db.prepare(`
      SELECT a.id, a.name, a.admin_role,
        (SELECT COUNT(*) FROM merchants m WHERE m.sales_owner_id = a.id AND m.status != 'deleted') as merchant_count,
        (SELECT COUNT(*) FROM influencers i WHERE i.sales_owner_id = a.id AND (i.status IS NULL OR i.status != 'deleted')) as influencer_count
      FROM admins a WHERE a.is_super != 1
    `).all();

    res.json({ success: true, data: { total, active, roles, perEmployee } });
  } catch (err) {
    console.error('[' + "routes/admins.js" + ']', err);
    res.status(500).json({ success: false, error: '操作失败，请稍后重试' });
  }
});

// 获取管理员列表（支持筛选，仅超管可用）
router.get('/', (req, res) => {
  try {
    const { role, status, keyword } = req.query;

    let sql = `SELECT id, username, name, is_super, admin_role, phone, email, description, created_at, updated_at, status, last_login_at FROM admins WHERE 1=1`;
    const params = [];

    if (role) { sql += ` AND admin_role = ?`; params.push(role); }
    if (status === 'disabled') { sql += ` AND status = 'disabled'`; }
    else if (status === 'active') { sql += ` AND (status IS NULL OR status != 'disabled')`; }
    if (keyword) {
      sql += ` AND (name LIKE ? OR username LIKE ? OR phone LIKE ? OR email LIKE ? OR description LIKE ?)`;
      const kw = `%${keyword}%`;
      params.push(kw, kw, kw, kw, kw);
    }

    sql += ' ORDER BY is_super DESC, created_at ASC';

    const list = req.db.prepare(sql).all(...params);

    // 补充归属数据
    const enriched = list.map(a => ({
      ...a,
      merchant_count: req.db.prepare('SELECT COUNT(*) as c FROM merchants m WHERE m.sales_owner_id = ? AND m.status != \'deleted\'').get(a.id)?.c || 0,
      influencer_count: req.db.prepare('SELECT COUNT(*) as c FROM influencers i WHERE i.sales_owner_id = ? AND (i.status IS NULL OR i.status != \'deleted\')').get(a.id)?.c || 0,
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('[' + "routes/admins.js" + ']', err);
    res.status(500).json({ success: false, error: '操作失败，请稍后重试' });
  }
});

// 获取管理员列表（供登录选择用）
router.get('/login-list', (req, res) => {
  try {
    const list = req.db.prepare("SELECT id, username, name, is_super, admin_role FROM admins WHERE (status IS NULL OR status != 'disabled') ORDER BY is_super DESC, created_at ASC").all();
    res.json({ success: true, data: list });
  } catch (err) {
    res.json({ success: true, data: [] });
  }
});

// 获取销售人员列表（用于商家/达人录入时选择归属销售）
router.get('/sales-list', (req, res) => {
  try {
    const list = req.db.prepare(`SELECT id, username, name FROM admins WHERE admin_role = '销售' AND (status IS NULL OR status != 'disabled') ORDER BY created_at ASC`).all();
    res.json({ success: true, data: list });
  } catch (err) {
    res.json({ success: true, data: [] });
  }
});

// 新增员工/管理员
router.post('/', (req, res) => {
  try {
    const { username, password, name, is_super, admin_role, phone, email, description } = req.body;
    if (!username || !name) return res.status(400).json({ success: false, error: '用户名和姓名为必填' });

    const existing = req.db.prepare('SELECT id FROM admins WHERE username = ?').get(username);
    if (existing) return res.status(400).json({ success: false, error: '用户名已存在' });

    // 角色校验白名单
    const role = admin_role || '其他';
    if (!VALID_ROLES.includes(role) && !is_super) {
      return res.status(400).json({ success: false, error: `角色仅支持：${VALID_ROLES.join('、')}` });
    }

    const id = uuidv4();
    const plainPwd = password || '123456';
    req.db.prepare(`
      INSERT INTO admins (id, username, password, name, is_super, admin_role, phone, email, description)
      VALUES (?, ?, '', ?, ?, ?, ?, ?, ?)
    `).run(id, username, name, is_super ? 1 : 0, is_super ? '管理员' : role, phone || '', email || '', description || '');

    // P1 fix: 用 bcrypt 哈希密码，不存明文
    const setPasswordHash = req.app.locals.setPasswordHash;
    setPasswordHash('admins', id, plainPwd);

    res.json({ success: true, data: { id, username, name }, message: '员工创建成功' });
  } catch (err) {
    console.error('[' + "routes/admins.js" + ']', err);
    res.status(500).json({ success: false, error: '操作失败，请稍后重试' });
  }
});

// 更新员工信息
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { username, password, name, is_super, admin_role, phone, email, description, status } = req.body;

    const admin = req.db.prepare('SELECT * FROM admins WHERE id = ?').get(id);
    if (!admin) return res.status(404).json({ success: false, error: '员工不存在' });

    if (username && username !== admin.username) {
      const dup = req.db.prepare('SELECT id FROM admins WHERE username = ? AND id != ?').get(username, id);
      if (dup) return res.status(400).json({ success: false, error: '用户名已存在' });
    }

    let finalRole = admin_role;
    if (admin_role && !is_super && !VALID_ROLES.includes(admin_role)) {
      return res.status(400).json({ success: false, error: `角色仅支持：${VALID_ROLES.join('、')}` });
    }
    if (is_super || (is_super !== undefined && is_super)) finalRole = '管理员';
    else if (is_super === 0) finalRole = admin_role || admin.admin_role;

    // P1 fix: 密码单独处理，不通过 COALESCE 明文写入
    const newPassword = password || null;
    const updateFields = [];
    const updateParams = [];

    if (username) { updateFields.push('username = ?'); updateParams.push(username); }
    if (newPassword) { /* 密码在 UPDATE 后单独哈希 */ }
    if (name) { updateFields.push('name = ?'); updateParams.push(name); }
    updateFields.push('is_super = CASE WHEN ? IS NOT NULL THEN ? ELSE is_super END');
    updateParams.push(is_super, (is_super ? 1 : 0));
    updateFields.push('admin_role = CASE WHEN ? IS NOT NULL THEN ? ELSE admin_role END');
    updateParams.push(finalRole, finalRole);
    updateFields.push('phone = CASE WHEN ? IS NOT NULL THEN ? ELSE phone END');
    updateParams.push(phone, phone ?? null);
    updateFields.push('email = CASE WHEN ? IS NOT NULL THEN ? ELSE email END');
    updateParams.push(email, email ?? null);
    updateFields.push('description = CASE WHEN ? IS NOT NULL THEN ? ELSE description END');
    updateParams.push(description, description ?? null);
    updateFields.push('status = CASE WHEN ? IS NOT NULL THEN ? ELSE status END');
    updateParams.push(status, status ?? null);
    updateFields.push("updated_at = datetime('now')");

    updateParams.push(id);
    req.db.prepare(`UPDATE admins SET ${updateFields.join(', ')} WHERE id = ?`).run(...updateParams);

    // P1 fix: 有新密码时用 bcrypt 哈希
    if (newPassword) {
      const setPasswordHash = req.app.locals.setPasswordHash;
      setPasswordHash('admins', id, newPassword);
    }

    res.json({ success: true, message: '员工信息已更新' });
  } catch (err) {
    console.error('[' + "routes/admins.js" + ']', err);
    res.status(500).json({ success: false, error: '操作失败，请稍后重试' });
  }
});

// 删除员工
router.delete('/:id', (req, res) => {
  try {
    const admin = req.db.prepare('SELECT * FROM admins WHERE id = ?').get(req.params.id);
    if (!admin) return res.status(404).json({ success: false, error: '员工不存在' });
    if (admin.is_super) return res.status(400).json({ success: false, error: '不能删除超级管理员' });

    // 检查关联数据
    const mc = req.db.prepare("SELECT COUNT(*) as c FROM merchants WHERE sales_owner_id = ? AND status != 'deleted'").get(req.params.id).c;
    const ic = req.db.prepare("SELECT COUNT(*) as c FROM influencers WHERE sales_owner_id = ? AND (status IS NULL OR status != 'deleted')").get(req.params.id).c;
    if (mc > 0 || ic > 0) {
      return res.status(400).json({
        success: false,
        error: `该员工名下有 ${mc} 个商家 / ${ic} 位达人关联，无法删除。请先转移归属或改为停用`,
        data: { merchantCount: mc, influencerCount: ic }
      });
    }

    req.db.prepare('DELETE FROM admins WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: '员工已删除' });
  } catch (err) {
    console.error('[' + "routes/admins.js" + ']', err);
    res.status(500).json({ success: false, error: '操作失败，请稍后重试' });
  }
});

// 重置密码
router.post('/:id/reset-password', (req, res) => {
  try {
    const newPwd = req.body.password || '123456';
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync(newPwd, 10);
    req.db.prepare("UPDATE admins SET password_hash = ?, password = '', updated_at = datetime('now') WHERE id = ?").run(hash, req.params.id);
    res.json({ success: true, message: '密码已重置' });
  } catch (err) {
    console.error('[admins/reset-password]', err);
    res.status(500).json({ success: false, error: '操作失败' });
  }
});

module.exports = router;
