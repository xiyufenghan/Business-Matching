const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

// ====== 商家招募需求（商家需求） ======

// GET / - 列表（多维筛选+分页）
router.get('/', (req, res) => {
  try {
    const {
      merchant_id, recruitment_type, status, level, target_province,
      fans_min, fans_max, keyword, page, pageSize, operator_id, sales_owner_id
    } = req.query;

    let sql = `
      SELECT mr.*, m.name as merchant_name, m.company as merchant_company,
        m.sales_owner_id as merchant_sales_owner_id, sa.name as merchant_sales_owner_name,
        ld.title as linked_demand_title, ld.demand_type as linked_demand_type
      FROM merchant_recruitments mr
      LEFT JOIN merchants m ON mr.merchant_id = m.id
      LEFT JOIN admins sa ON m.sales_owner_id = sa.id AND sa.admin_role = '销售'
      LEFT JOIN demands ld ON mr.linked_demand_id = ld.id
      WHERE 1=1
    `;
    let countSql = `SELECT COUNT(*) as total FROM merchant_recruitments mr LEFT JOIN merchants m ON mr.merchant_id = m.id WHERE 1=1`;
    const params = [];
    const countParams = [];

    if (sales_owner_id) {
      const f = " AND (m.sales_owner_id = ? OR m.sales_owner_id IS NULL OR m.sales_owner_id = '')";
      sql += f; countSql += f;
      params.push(sales_owner_id); countParams.push(sales_owner_id);
    } else if (operator_id) {
      sql += ' AND mr.operator_id = ?'; countSql += ' AND mr.operator_id = ?';
      params.push(operator_id); countParams.push(operator_id);
    }
    if (merchant_id) {
      sql += ' AND mr.merchant_id = ?'; countSql += ' AND mr.merchant_id = ?';
      params.push(merchant_id); countParams.push(merchant_id);
    }
    if (recruitment_type) {
      sql += ' AND mr.recruitment_type = ?'; countSql += ' AND mr.recruitment_type = ?';
      params.push(recruitment_type); countParams.push(recruitment_type);
    }
    if (status) {
      sql += ' AND mr.status = ?'; countSql += ' AND mr.status = ?';
      params.push(status); countParams.push(status);
    }
    // target_levels 是逗号分隔的字符串，做 LIKE 包含匹配
    if (level) {
      sql += " AND (mr.target_levels LIKE ? OR mr.target_levels IS NULL OR mr.target_levels = '')";
      countSql += " AND (mr.target_levels LIKE ? OR mr.target_levels IS NULL OR mr.target_levels = '')";
      params.push('%' + level + '%'); countParams.push('%' + level + '%');
    }
    if (target_province) {
      sql += " AND (mr.target_provinces LIKE ? OR mr.target_provinces IS NULL OR mr.target_provinces = '')";
      countSql += " AND (mr.target_provinces LIKE ? OR mr.target_provinces IS NULL OR mr.target_provinces = '')";
      params.push('%' + target_province + '%'); countParams.push('%' + target_province + '%');
    }
    // 粉丝量区间：与招募的目标区间有交集
    if (fans_min) {
      const v = parseInt(fans_min) || 0;
      sql += ' AND (mr.target_fans_max = 0 OR mr.target_fans_max >= ?)';
      countSql += ' AND (mr.target_fans_max = 0 OR mr.target_fans_max >= ?)';
      params.push(v); countParams.push(v);
    }
    if (fans_max) {
      const v = parseInt(fans_max) || 0;
      sql += ' AND (mr.target_fans_min <= ?)';
      countSql += ' AND (mr.target_fans_min <= ?)';
      params.push(v); countParams.push(v);
    }
    if (keyword) {
      const kw = '%' + keyword + '%';
      const k = ' AND (mr.title LIKE ? OR mr.description LIKE ? OR mr.commission_offer LIKE ? OR m.company LIKE ?)';
      sql += k; countSql += k;
      params.push(kw, kw, kw, kw); countParams.push(kw, kw, kw, kw);
    }

    sql += ' ORDER BY mr.created_at DESC';

    const currentPage = parseInt(page) || 1;
    const size = parseInt(pageSize) || 20;
    const offset = (currentPage - 1) * size;
    const total = req.db.prepare(countSql).get(...countParams).total;
    sql += ' LIMIT ? OFFSET ?';
    params.push(size, offset);

    const data = req.db.prepare(sql).all(...params);
    res.json({
      success: true,
      data,
      pagination: { page: currentPage, pageSize: size, total, totalPages: Math.ceil(total / size) }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /:id 详情
router.get('/:id', (req, res) => {
  try {
    const r = req.db.prepare(`
      SELECT mr.*, m.name as merchant_name, m.company as merchant_company,
        ld.title as linked_demand_title, ld.demand_type as linked_demand_type
      FROM merchant_recruitments mr
      LEFT JOIN merchants m ON mr.merchant_id = m.id
      LEFT JOIN demands ld ON mr.linked_demand_id = ld.id
      WHERE mr.id = ?
    `).get(req.params.id);
    if (!r) return res.status(404).json({ success: false, error: '招募需求不存在' });
    res.json({ success: true, data: r });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST 创建招募
router.post('/', (req, res) => {
  try {
    const {
      merchant_id, title, recruitment_type, linked_demand_id,
      target_levels, target_fans_min, target_fans_max,
      target_categories, target_provinces, target_audience,
      cooperation_mode, commission_offer, budget_min, budget_max,
      description, deadline, operator_id
    } = req.body;
    if (!merchant_id || !title) {
      return res.status(400).json({ success: false, error: '商家ID、招募标题为必填' });
    }
    const id = uuidv4();
    req.db.prepare(`
      INSERT INTO merchant_recruitments (
        id, merchant_id, title, recruitment_type, linked_demand_id,
        target_levels, target_fans_min, target_fans_max,
        target_categories, target_provinces, target_audience,
        cooperation_mode, commission_offer, budget_min, budget_max,
        description, deadline, status, operator_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'recruiting', ?)
    `).run(
      id, merchant_id, title, recruitment_type || '图书推广', linked_demand_id || null,
      target_levels || '', parseInt(target_fans_min) || 0, parseInt(target_fans_max) || 0,
      target_categories || '', target_provinces || '', target_audience || '',
      cooperation_mode || '', commission_offer || '', parseFloat(budget_min) || 0, parseFloat(budget_max) || 0,
      description || '', deadline || null, operator_id || null
    );
    const created = req.db.prepare('SELECT * FROM merchant_recruitments WHERE id = ?').get(id);
    res.status(201).json({ success: true, data: created, message: '招募需求发布成功' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /:id 更新
router.put('/:id', (req, res) => {
  try {
    const id = req.params.id;
    const existing = req.db.prepare('SELECT * FROM merchant_recruitments WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ success: false, error: '招募需求不存在' });
    const fields = [
      'title', 'recruitment_type', 'linked_demand_id',
      'target_levels', 'target_fans_min', 'target_fans_max',
      'target_categories', 'target_provinces', 'target_audience',
      'cooperation_mode', 'commission_offer', 'budget_min', 'budget_max',
      'description', 'deadline', 'status'
    ];
    const intFields = new Set(['target_fans_min', 'target_fans_max']);
    const floatFields = new Set(['budget_min', 'budget_max']);
    const updates = []; const params = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        let v = req.body[f];
        if (intFields.has(f)) v = parseInt(v) || 0;
        else if (floatFields.has(f)) v = parseFloat(v) || 0;
        updates.push(`${f} = ?`); params.push(v);
      }
    }
    if (updates.length === 0) return res.status(400).json({ success: false, error: '没有需要更新的字段' });
    updates.push("updated_at = CURRENT_TIMESTAMP");
    params.push(id);
    req.db.prepare(`UPDATE merchant_recruitments SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    const updated = req.db.prepare('SELECT * FROM merchant_recruitments WHERE id = ?').get(id);
    res.json({ success: true, data: updated, message: '招募需求已更新' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /:id
router.delete('/:id', (req, res) => {
  try {
    req.db.prepare('DELETE FROM merchant_recruitments WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: '删除成功' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /all/clear - 一键清空（仅超管）
router.delete('/all/clear', (req, res) => {
  if (!req.user || req.user.role !== 'admin' || !req.user.is_super) {
    return res.status(403).json({ success: false, error: '无权限：仅超级管理员可执行此操作' });
  }
  try {
    const { merchant_id } = req.query;
    if (merchant_id) {
      req.db.prepare('DELETE FROM merchant_recruitments WHERE merchant_id = ?').run(merchant_id);
    } else {
      req.db.prepare('DELETE FROM merchant_recruitments').run();
    }
    res.json({ success: true, message: '已清空' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
