const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

// 获取管理员列表（仅超管可用）
router.get('/', (req, res) => {
  try {
    const list = req.db.prepare('SELECT id, username, name, is_super, admin_role, phone, email, description, created_at FROM admins ORDER BY is_super DESC, created_at ASC').all();
    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取管理员列表（供登录选择用，不返回超管密码等敏感信息）
router.get('/login-list', (req, res) => {
  try {
    const list = req.db.prepare("SELECT id, username, name, is_super, admin_role FROM admins ORDER BY is_super DESC, created_at ASC").all();
    res.json({ success: true, data: list });
  } catch (err) {
    res.json({ success: true, data: [] });
  }
});

// 获取销售人员列表（用于商家/达人录入时选择归属销售）
router.get('/sales-list', (req, res) => {
  try {
    const list = req.db.prepare("SELECT id, username, name FROM admins WHERE admin_role = '销售' ORDER BY created_at ASC").all();
    res.json({ success: true, data: list });
  } catch (err) {
    res.json({ success: true, data: [] });
  }
});

// 新增管理员
router.post('/', (req, res) => {
  try {
    const { username, password, name, is_super, admin_role, phone, email, description } = req.body;
    if (!username || !name) {
      return res.status(400).json({ success: false, error: '用户名和姓名为必填' });
    }
    
    // 检查用户名唯一性
    const existing = req.db.prepare('SELECT id FROM admins WHERE username = ?').get(username);
    if (existing) {
      return res.status(400).json({ success: false, error: '用户名已存在' });
    }
    
    const id = uuidv4();
    req.db.prepare(`
      INSERT INTO admins (id, username, password, name, is_super, admin_role, phone, email, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, username, password || '123456', name, is_super ? 1 : 0, admin_role || '其他', phone || '', email || '', description || '');
    
    res.json({ success: true, data: { id, username, name, is_super: is_super ? 1 : 0, admin_role: admin_role || '其他' }, message: '管理员创建成功' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 更新管理员
router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { username, password, name, is_super, admin_role, phone, email, description } = req.body;
    
    const admin = req.db.prepare('SELECT * FROM admins WHERE id = ?').get(id);
    if (!admin) return res.status(404).json({ success: false, error: '管理员不存在' });
    
    // 检查用户名唯一性（排除自身）
    if (username && username !== admin.username) {
      const dup = req.db.prepare('SELECT id FROM admins WHERE username = ? AND id != ?').get(username, id);
      if (dup) return res.status(400).json({ success: false, error: '用户名已存在' });
    }
    
    req.db.prepare(`
      UPDATE admins SET
        username = COALESCE(?, username),
        password = COALESCE(?, password),
        name = COALESCE(?, name),
        is_super = COALESCE(?, is_super),
        admin_role = COALESCE(?, admin_role),
        phone = COALESCE(?, phone),
        email = COALESCE(?, email),
        description = COALESCE(?, description),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      username || null, password || null, name || null,
      is_super !== undefined ? (is_super ? 1 : 0) : null,
      admin_role || null,
      phone !== undefined ? phone : null,
      email !== undefined ? email : null,
      description !== undefined ? description : null,
      id
    );
    
    res.json({ success: true, message: '管理员信息已更新' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 删除管理员
router.delete('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const admin = req.db.prepare('SELECT * FROM admins WHERE id = ?').get(id);
    if (!admin) return res.status(404).json({ success: false, error: '管理员不存在' });
    if (admin.is_super) return res.status(400).json({ success: false, error: '不能删除超级管理员' });
    
    req.db.prepare('DELETE FROM admins WHERE id = ?').run(id);
    res.json({ success: true, message: '管理员已删除' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 重置密码
router.post('/:id/reset-password', (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;
    req.db.prepare("UPDATE admins SET password = ?, updated_at = datetime('now') WHERE id = ?").run(password || '123456', id);
    res.json({ success: true, message: '密码已重置' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
