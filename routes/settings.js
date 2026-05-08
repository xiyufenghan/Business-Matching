const express = require('express');
const router = express.Router();

// GET /api/settings — 超管读取所有配置
router.get('/', (req, res) => {
  if (!req.user || req.user.role !== 'admin' || !req.user.is_super) {
    return res.status(403).json({ success: false, error: '无权限' });
  }
  const list = req.db.prepare('SELECT key, value, updated_at FROM settings').all();
  const data = {};
  list.forEach(row => { data[row.key] = row.value; });
  res.json({ success: true, data });
});

// PUT /api/settings — 超管写入配置
router.put('/', (req, res) => {
  if (!req.user || req.user.role !== 'admin' || !req.user.is_super) {
    return res.status(403).json({ success: false, error: '无权限' });
  }
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ success: false, error: '参数缺失' });

  req.db.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
  ).run(key, value || '');

  res.json({ success: true });
});

module.exports = router;
