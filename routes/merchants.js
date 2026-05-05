const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

// 获取所有商家
router.get('/', (req, res) => {
  try {
    const { sales_owner_id } = req.query;
    let sql = `
      SELECT m.*, a.name as sales_owner_name 
      FROM merchants m
      LEFT JOIN admins a ON m.sales_owner_id = a.id
    `;
    const params = [];
    
    if (sales_owner_id) {
      // 销售角色：只能看归属自己的 + 没有归属的
      sql += " WHERE (m.sales_owner_id = ? OR m.sales_owner_id IS NULL OR m.sales_owner_id = '')";
      params.push(sales_owner_id);
    }
    
    sql += ' ORDER BY m.created_at DESC';
    const merchants = req.db.prepare(sql).all(...params);
    res.json({ success: true, data: merchants });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取单个商家
router.get('/:id', (req, res) => {
  try {
    const merchant = req.db.prepare(`
      SELECT m.*, a.name as sales_owner_name 
      FROM merchants m 
      LEFT JOIN admins a ON m.sales_owner_id = a.id 
      WHERE m.id = ?
    `).get(req.params.id);
    if (!merchant) return res.status(404).json({ success: false, error: '商家不存在' });
    res.json({ success: true, data: merchant });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 创建商家
router.post('/', (req, res) => {
  try {
    const { name, company, phone, email, industry, description, sales_owner_id } = req.body;
    if (!name || !company || !phone) {
      return res.status(400).json({ success: false, error: '姓名、公司、电话为必填项' });
    }
    const id = uuidv4();
    req.db.prepare(`
      INSERT INTO merchants (id, name, company, phone, email, industry, description, sales_owner_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, company, phone, email || null, industry || null, description || null, sales_owner_id || null);
    
    const merchant = req.db.prepare('SELECT * FROM merchants WHERE id = ?').get(id);
    res.status(201).json({ success: true, data: merchant });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 更新商家
router.put('/:id', (req, res) => {
  try {
    const { name, company, phone, email, industry, description, sales_owner_id } = req.body;
    req.db.prepare(`
      UPDATE merchants SET name=?, company=?, phone=?, email=?, industry=?, description=?, sales_owner_id=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(name, company, phone, email, industry, description, sales_owner_id || null, req.params.id);
    
    const merchant = req.db.prepare('SELECT * FROM merchants WHERE id = ?').get(req.params.id);
    res.json({ success: true, data: merchant });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 删除商家
router.delete('/:id', (req, res) => {
  try {
    req.db.prepare('DELETE FROM merchants WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: '删除成功' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
