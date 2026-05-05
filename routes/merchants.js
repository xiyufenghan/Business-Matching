const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// 行业枚举（与前端发布需求枚举保持一致）
const INDUSTRIES = ['图书出版', '在线教育', '教辅出版', '数字内容', '课程平台', 'MCN代理', '其他'];

// ========== Excel 上传配置 ==========
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, 'merchants_' + Date.now() + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// 字段别名映射：Excel 列标题 → 数据库字段
const MERCHANT_FIELD_ALIASES = {
  '公司名称': 'company',
  '公司名': 'company',
  'company': 'company',
  '联系人': 'name',
  '联系人姓名': 'name',
  '姓名': 'name',
  'name': 'name',
  '手机号': 'phone',
  '手机': 'phone',
  '电话': 'phone',
  'phone': 'phone',
  '邮箱': 'email',
  'email': 'email',
  '行业': 'industry',
  'industry': 'industry',
  '描述': 'description',
  '简介': 'description',
  'description': 'description',
  '归属销售': 'sales_owner',
};
function mapMerchantRow(row) {
  const out = {};
  for (const key of Object.keys(row)) {
    const clean = String(key).trim();
    const field = MERCHANT_FIELD_ALIASES[clean];
    if (field) out[field] = row[key];
  }
  return out;
}
function normText(v) { return v == null ? '' : String(v).trim(); }

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

// ========== Excel 模板下载（必须在 /:id 之前）==========
router.get('/excel/template', (req, res) => {
  try {
    const headers = ['公司名称', '联系人姓名', '手机号', '邮箱', '行业', '描述', '归属销售'];
    const sampleData = [
      headers,
      ['知行图书出版社', '张经理', '13800138001', 'zhang@zxbook.com', '图书出版', '主营儿童绘本与教辅图书', ''],
      ['书海文化传媒', '李总监', '13800138002', 'li@shuhai.com', '数字内容', '专注K12教育内容', '']
    ];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(sampleData);
    ws['!cols'] = headers.map(h => ({ wch: Math.max(h.length * 2, 16) }));
    XLSX.utils.book_append_sheet(wb, ws, '商家数据');

    const noteData = [
      ['字段', '说明', '是否必填'],
      ['公司名称', '商家公司全称', '是'],
      ['联系人姓名', '主联系人姓名', '是'],
      ['手机号', '登录账号将使用此手机号', '是'],
      ['邮箱', '联系邮箱', '否'],
      ['行业', `可选：${INDUSTRIES.join(' / ')}`, '否'],
      ['描述', '商家简介', '否'],
      ['归属销售', '销售人员姓名（系统会自动关联）', '否']
    ];
    const noteWs = XLSX.utils.aoa_to_sheet(noteData);
    noteWs['!cols'] = [{ wch: 16 }, { wch: 40 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, noteWs, '填写说明');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('商家批量导入模板.xlsx')}`,
      'Content-Length': buf.length
    });
    res.send(buf);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 批量导入商家 Excel（必须在 /:id 之前）==========
// 导入的商家默认走邀请制（invite_status=pending），系统为每条生成 invite_code
router.post('/excel/import', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: '请上传 Excel 文件' });

    const wb = XLSX.readFile(req.file.path);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    if (rows.length === 0) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, error: 'Excel 为空或格式不正确' });
    }

    // 预加载销售 name → id 映射
    const salesAdmins = req.db.prepare("SELECT id, name FROM admins WHERE admin_role = '销售'").all();
    const salesNameToId = {};
    salesAdmins.forEach(s => { salesNameToId[s.name] = s.id; });

    // 预加载现有商家的 phone / company 用于去重
    const existingPhones = new Set();
    const existingCompanies = new Set();
    req.db.prepare("SELECT phone, company FROM merchants WHERE status != 'deleted'").all().forEach(m => {
      if (m.phone) existingPhones.add(m.phone);
      if (m.company) existingCompanies.add(m.company);
    });

    const results = { total: rows.length, inserted: 0, skipped: 0, failed: 0, errors: [], invites: [] };
    const invitedBy = req.body.invited_by || null;
    const defaultSalesOwnerId = req.body.default_sales_owner_id || null;

    const insertStmt = req.db.prepare(`
      INSERT INTO merchants (id, name, company, phone, email, industry, description, sales_owner_id, password, status,
        invite_code, invite_status, invited_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', 'active', ?, 'pending', ?)
    `);

    const importTransaction = req.db.transaction((rs) => {
      rs.forEach((raw, idx) => {
        try {
          const m = mapMerchantRow(raw);
          const company = normText(m.company);
          const name = normText(m.name);
          const phone = normText(m.phone);
          if (!company || !name || !phone) {
            results.errors.push(`第 ${idx + 2} 行：公司名称 / 联系人 / 手机号为必填`);
            results.failed++;
            return;
          }
          if (existingPhones.has(phone) || existingCompanies.has(company)) {
            results.errors.push(`第 ${idx + 2} 行：${company}（${phone}）已存在，跳过`);
            results.skipped++;
            return;
          }
          const salesText = normText(m.sales_owner);
          const salesOwnerId = salesNameToId[salesText] || defaultSalesOwnerId || null;
          const id = uuidv4();
          const inviteCode = uuidv4();
          insertStmt.run(
            id, name, company, phone,
            normText(m.email) || null,
            normText(m.industry) || null,
            normText(m.description) || null,
            salesOwnerId,
            inviteCode,
            invitedBy
          );
          existingPhones.add(phone);
          existingCompanies.add(company);
          results.inserted++;
          results.invites.push({ company, phone, invite_code: inviteCode });
        } catch (e) {
          results.errors.push(`第 ${idx + 2} 行：${e.message}`);
          results.failed++;
        }
      });
    });

    importTransaction(rows);
    fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      message: `共 ${results.total} 条，成功 ${results.inserted}，跳过 ${results.skipped}，失败 ${results.failed}`,
      data: results
    });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
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

// ========== 创建商家（含唯一性校验）==========
// 可选参数 invite_mode=1：走邀请制（status=pending，生成 invite_code，不设密码）
// 否则走直接录入模式（status=active，密码默认 123456）
router.post('/', (req, res) => {
  try {
    const { name, company, phone, email, industry, description, sales_owner_id, password, invite_mode, invited_by } = req.body;
    if (!name || !company || !phone) {
      return res.status(400).json({ success: false, error: '联系人姓名、公司名称、手机号为必填项' });
    }

    // 唯一性
    const existing = req.db.prepare("SELECT id FROM merchants WHERE (phone = ? OR company = ?) AND status != 'deleted'").get(phone, company);
    if (existing) {
      return res.status(400).json({ success: false, error: '该手机号或公司名称已存在' });
    }

    const id = uuidv4();
    const isInviteMode = invite_mode === 1 || invite_mode === '1' || invite_mode === true;
    const inviteCode = isInviteMode ? uuidv4() : null;
    const inviteStatus = isInviteMode ? 'pending' : 'active';
    const finalPassword = isInviteMode ? '' : (password || '123456');

    req.db.prepare(`
      INSERT INTO merchants (id, name, company, phone, email, industry, description, sales_owner_id, password, status,
        invite_code, invite_status, invited_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(id, name, company, phone, email || null, industry || null, description || null,
      sales_owner_id || null, finalPassword,
      inviteCode, inviteStatus, invited_by || null);

    const merchant = req.db.prepare('SELECT * FROM merchants WHERE id = ?').get(id);
    res.status(201).json({ success: true, data: merchant, invite_code: inviteCode });
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

// ========== 获取邀请链接（pending 状态可用）==========
router.get('/:id/invite-code', (req, res) => {
  try {
    const m = req.db.prepare('SELECT id, company, name, phone, invite_code, invite_status FROM merchants WHERE id = ?').get(req.params.id);
    if (!m) return res.status(404).json({ success: false, error: '商家不存在' });
    if (m.invite_status !== 'pending') return res.status(400).json({ success: false, error: '该商家账号已激活，无需邀请' });
    // 若没有 invite_code（历史数据），补生成
    let code = m.invite_code;
    if (!code) {
      const { v4: uuidv4 } = require('uuid');
      code = uuidv4();
      req.db.prepare('UPDATE merchants SET invite_code = ? WHERE id = ?').run(code, req.params.id);
    }
    res.json({ success: true, data: { code, company: m.company, name: m.name, phone: m.phone } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 停用/启用 商家账号 ==========
router.put('/:id/invite-status', (req, res) => {
  try {
    const { invite_status } = req.body;
    if (!['active', 'disabled'].includes(invite_status)) {
      return res.status(400).json({ success: false, error: '只能设为 active 或 disabled' });
    }
    req.db.prepare('UPDATE merchants SET invite_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(invite_status, req.params.id);
    res.json({ success: true, message: invite_status === 'active' ? '已启用' : '已停用' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
