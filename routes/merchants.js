const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

// 行业枚举（与前端发布需求枚举保持一致）
const INDUSTRIES = ['图书出版', '在线教育', '教辅出版', '数字内容', '课程平台', 'MCN代理', '其他'];

// ========== 商家管理 Hero 统计 ==========
router.get('/manage-stats', (req, res) => {
  try {
    const { sales_owner_id } = req.query;
    let where = " WHERE m.status != 'deleted'";
    const params = [];
    if (sales_owner_id) {
      where += " AND (m.sales_owner_id = ? OR m.sales_owner_id IS NULL OR m.sales_owner_id = '')";
      params.push(sales_owner_id);
    }

    const total = req.db.prepare(`SELECT COUNT(*) as c FROM merchants m ${where}`).get(...params).c;
    const withSales = req.db.prepare(`SELECT COUNT(*) as c FROM merchants m ${where} AND m.sales_owner_id IS NOT NULL AND m.sales_owner_id != ''`).get(...params).c;

    const oneM = new Date(); oneM.setMonth(oneM.getMonth() - 1);
    const newCount = req.db.prepare(`SELECT COUNT(*) as c FROM merchants m ${where} AND m.created_at >= ?`)
      .get(...params, oneM.toISOString().slice(0, 19).replace('T', ' ')).c;

    // 活跃商家：30 天内有过任何 demand 提交
    const activeRow = req.db.prepare(`
      SELECT COUNT(DISTINCT m.id) as c
      FROM merchants m
      LEFT JOIN demands d ON d.merchant_id = m.id AND d.created_at >= ?
      ${where} AND d.id IS NOT NULL
    `).get(oneM.toISOString().slice(0, 19).replace('T', ' '), ...params);
    const activeCount = activeRow ? activeRow.c : 0;

    // 行业分布
    const industries = req.db.prepare(`
      SELECT industry, COUNT(*) as c FROM merchants m ${where}
      GROUP BY industry ORDER BY c DESC
    `).all(...params);

    res.json({
      success: true,
      data: { total, withSales, newCount, activeCount, industries }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 行业枚举 ==========
router.get('/industries', (req, res) => {
  res.json({ success: true, data: INDUSTRIES });
});

// ========== 商家列表（支持分页 + 搜索 + 筛选 + 货盘数统计） ==========
router.get('/', (req, res) => {
  try {
    const { sales_owner_id, keyword, industry, status, has_sales, page, pageSize } = req.query;
    const includeDeleted = status === 'deleted' || status === 'all';

    let where = ' WHERE 1=1';
    const params = [];

    if (!includeDeleted) {
      where += " AND m.status != 'deleted'";
    } else if (status === 'deleted') {
      where += " AND m.status = 'deleted'";
    }
    if (sales_owner_id) {
      where += " AND (m.sales_owner_id = ? OR m.sales_owner_id IS NULL OR m.sales_owner_id = '')";
      params.push(sales_owner_id);
    }
    if (industry) {
      where += ' AND m.industry = ?';
      params.push(industry);
    }
    if (status && status !== 'all' && status !== 'deleted') {
      where += ' AND m.status = ?';
      params.push(status);
    }
    if (has_sales === 'yes') {
      where += " AND m.sales_owner_id IS NOT NULL AND m.sales_owner_id != ''";
    } else if (has_sales === 'no') {
      where += " AND (m.sales_owner_id IS NULL OR m.sales_owner_id = '')";
    }
    if (keyword) {
      const kw = '%' + keyword + '%';
      where += ' AND (m.name LIKE ? OR m.company LIKE ? OR m.phone LIKE ? OR m.email LIKE ?)';
      params.push(kw, kw, kw, kw);
    }

    const sql = `
      SELECT m.*, a.name as sales_owner_name,
        (SELECT COUNT(*) FROM demands d WHERE d.merchant_id = m.id) as demand_count
      FROM merchants m
      LEFT JOIN admins a ON m.sales_owner_id = a.id
      ${where}
      ORDER BY m.created_at DESC
    `;
    const countSql = `SELECT COUNT(*) as total FROM merchants m ${where}`;

    // 分页（pageSize 不传时返回全部，兼容旧调用）
    const total = req.db.prepare(countSql).get(...params).total;
    let rows;
    if (pageSize) {
      const currentPage = parseInt(page) || 1;
      const size = parseInt(pageSize) || 20;
      const offset = (currentPage - 1) * size;
      rows = req.db.prepare(sql + ' LIMIT ? OFFSET ?').all(...params, size, offset);
      res.json({
        success: true,
        data: rows,
        pagination: { page: currentPage, pageSize: size, total, totalPages: Math.ceil(total / size) }
      });
    } else {
      rows = req.db.prepare(sql).all(...params);
      res.json({ success: true, data: rows });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 导出 CSV ==========
router.get('/export', (req, res) => {
  try {
    const { sales_owner_id, keyword, industry, has_sales } = req.query;
    let where = " WHERE m.status != 'deleted'";
    const params = [];
    if (sales_owner_id) {
      where += " AND (m.sales_owner_id = ? OR m.sales_owner_id IS NULL OR m.sales_owner_id = '')";
      params.push(sales_owner_id);
    }
    if (industry) { where += ' AND m.industry = ?'; params.push(industry); }
    if (has_sales === 'yes') { where += " AND m.sales_owner_id IS NOT NULL AND m.sales_owner_id != ''"; }
    else if (has_sales === 'no') { where += " AND (m.sales_owner_id IS NULL OR m.sales_owner_id = '')"; }
    if (keyword) {
      const kw = '%' + keyword + '%';
      where += ' AND (m.name LIKE ? OR m.company LIKE ?)';
      params.push(kw, kw);
    }
    const rows = req.db.prepare(`
      SELECT m.*, a.name as sales_owner_name,
        (SELECT COUNT(*) FROM demands d WHERE d.merchant_id = m.id) as demand_count
      FROM merchants m
      LEFT JOIN admins a ON m.sales_owner_id = a.id
      ${where}
      ORDER BY m.created_at DESC
    `).all(...params);

    const headers = ['商家ID', '联系人姓名', '公司名称', '行业', '手机号', '邮箱', '描述', '归属销售', '货盘数', '状态', '创建时间'];
    const escape = (v) => {
      if (v == null) return '';
      const s = String(v).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    };
    const lines = [headers.join(',')];
    rows.forEach(r => {
      lines.push([
        r.id, r.name, r.company, r.industry, r.phone, r.email,
        r.description, r.sales_owner_name || '', r.demand_count, r.status, r.created_at
      ].map(escape).join(','));
    });
    const csv = '\uFEFF' + lines.join('\n');
    const filename = `merchants_${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 单个商家详情 ==========
router.get('/:id', (req, res) => {
  try {
    const merchant = req.db.prepare(`
      SELECT m.*, a.name as sales_owner_name,
        (SELECT COUNT(*) FROM demands d WHERE d.merchant_id = m.id) as demand_count,
        (SELECT COUNT(*) FROM merchant_recruitments mr WHERE mr.merchant_id = m.id) as recruitment_count,
        (SELECT COUNT(*) FROM matchmaking mm WHERE mm.merchant_id = m.id) as matchmaking_count
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

// ========== 创建商家（含唯一性校验） ==========
router.post('/', (req, res) => {
  try {
    const { name, company, phone, email, industry, description, sales_owner_id, password } = req.body;
    if (!name || !company || !phone) {
      return res.status(400).json({ success: false, error: '联系人姓名、公司名称、手机号为必填项' });
    }
    // 唯一性预检（按公司名+手机号）
    const dupCompany = req.db.prepare("SELECT id FROM merchants WHERE company = ? AND status != 'deleted'").get(company);
    if (dupCompany) return res.status(400).json({ success: false, error: '公司名已存在' });
    const dupPhone = req.db.prepare("SELECT id FROM merchants WHERE phone = ? AND status != 'deleted'").get(phone);
    if (dupPhone) return res.status(400).json({ success: false, error: '手机号已被其他商家使用' });

    const id = uuidv4();
    req.db.prepare(`
      INSERT INTO merchants (id, name, company, phone, email, industry, description, sales_owner_id, password, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `).run(id, name, company, phone, email || null, industry || null, description || null,
      sales_owner_id || null, password || '123456');

    const merchant = req.db.prepare('SELECT * FROM merchants WHERE id = ?').get(id);
    res.status(201).json({ success: true, data: merchant, message: '商家添加成功，初始密码为 123456' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 更新商家（动态字段构建 + 唯一性） ==========
router.put('/:id', (req, res) => {
  try {
    const id = req.params.id;
    const existing = req.db.prepare('SELECT * FROM merchants WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ success: false, error: '商家不存在' });

    const fields = ['name', 'company', 'phone', 'email', 'industry', 'description', 'sales_owner_id', 'status', 'password'];
    const updates = [];
    const params = [];

    // 唯一性校验（仅当 company / phone 实际变更时）
    if (req.body.company !== undefined && req.body.company !== existing.company) {
      const dup = req.db.prepare("SELECT id FROM merchants WHERE company = ? AND id != ? AND status != 'deleted'").get(req.body.company, id);
      if (dup) return res.status(400).json({ success: false, error: '公司名已存在' });
    }
    if (req.body.phone !== undefined && req.body.phone !== existing.phone) {
      const dup = req.db.prepare("SELECT id FROM merchants WHERE phone = ? AND id != ? AND status != 'deleted'").get(req.body.phone, id);
      if (dup) return res.status(400).json({ success: false, error: '手机号已被其他商家使用' });
    }

    for (const f of fields) {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = ?`);
        params.push(req.body[f] === '' ? null : req.body[f]);
      }
    }
    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: '无更新字段' });
    }
    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);
    req.db.prepare(`UPDATE merchants SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    const updated = req.db.prepare('SELECT * FROM merchants WHERE id = ?').get(id);
    res.json({ success: true, data: updated, message: '商家信息已更新' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 软删除（标记为 deleted） ==========
router.delete('/:id', (req, res) => {
  try {
    const id = req.params.id;
    const m = req.db.prepare('SELECT * FROM merchants WHERE id = ?').get(id);
    if (!m) return res.status(404).json({ success: false, error: '商家不存在' });

    // 关联数据预检
    const demandCount = req.db.prepare('SELECT COUNT(*) as c FROM demands WHERE merchant_id = ?').get(id).c;
    let recruitCount = 0, matchCount = 0;
    try {
      recruitCount = req.db.prepare('SELECT COUNT(*) as c FROM merchant_recruitments WHERE merchant_id = ?').get(id).c;
    } catch (e) { /* 表可能不存在 */ }
    try {
      matchCount = req.db.prepare('SELECT COUNT(*) as c FROM matchmaking WHERE merchant_id = ?').get(id).c;
    } catch (e) { /* 表可能不存在 */ }

    const force = req.query.force === '1';
    if ((demandCount > 0 || recruitCount > 0 || matchCount > 0) && !force) {
      return res.status(400).json({
        success: false,
        error: `该商家下还有 ${demandCount} 条货盘 / ${recruitCount} 条招募 / ${matchCount} 条撮合，请先处理后再删除`,
        data: { demandCount, recruitCount, matchCount, requireForce: true }
      });
    }

    req.db.prepare("UPDATE merchants SET status = 'deleted', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
    res.json({ success: true, message: '商家已删除（软删除，可恢复）' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 恢复软删除的商家 ==========
router.put('/:id/restore', (req, res) => {
  try {
    req.db.prepare("UPDATE merchants SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.id);
    res.json({ success: true, message: '商家已恢复' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 重置密码 ==========
router.put('/:id/reset-password', (req, res) => {
  try {
    const newPwd = req.body.password || '123456';
    req.db.prepare('UPDATE merchants SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newPwd, req.params.id);
    res.json({ success: true, message: `密码已重置为 ${newPwd}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
