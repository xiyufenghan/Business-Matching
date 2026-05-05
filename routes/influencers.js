const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// 配置文件上传
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    // 处理中文文件名
    const safeName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    cb(null, Date.now() + '-' + safeName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls'].includes(ext)) cb(null, true);
    else cb(new Error('仅支持 .xlsx 或 .xls 格式'));
  }
});

// 达人 Excel 字段映射
const INFLUENCER_FIELD_MAP = {
  '达人等级': 'level',
  '视频号账号名称': 'video_account_name',
  '视频号带货品类赛道': 'video_category_track',
  '现视频号品类销售额（月）短视频（万）': 'monthly_short_video_sales',
  '现视频号品类销售额（月）直播（万）': 'monthly_live_sales',
  '视频号粉丝数量': 'fans_count',
  '可接受的合作类型': 'cooperation_type',
  '视频号图书品类带货意愿': 'book_willingness',
  '视频号少儿课程品类带货意愿': 'course_willingness',
  '最近3个月短视频更新频率': 'short_video_frequency',
  '最近3个月直播频率': 'live_frequency',
  '是否有MCN': 'has_mcn',
  'MCN名称': 'mcn_name',
  '地区': 'region',
  '是否已入驻互选': 'has_joined_mutual_select',
  '归属销售': 'sales_owner',
  '公众号账号名称': 'official_account_name'
};

const INFLUENCER_FIELDS_ORDER = [
  '达人等级', '视频号账号名称', '视频号带货品类赛道',
  '现视频号品类销售额（月）短视频（万）', '现视频号品类销售额（月）直播（万）',
  '视频号粉丝数量', '可接受的合作类型', '视频号图书品类带货意愿',
  '视频号少儿课程品类带货意愿', '最近3个月短视频更新频率', '最近3个月直播频率',
  '是否有MCN', 'MCN名称', '地区', '是否已入驻互选', '归属销售', '公众号账号名称'
];

// ========== Excel模板下载 (必须放在 /:id 之前) ==========
router.get('/excel/template', (req, res) => {
  try {
    const wb = XLSX.utils.book_new();
    const headers = INFLUENCER_FIELDS_ORDER;
    const sampleData = [
      headers,
      ['S', '读书小达人', '图书,教育', 15.5, 8.2, 500000, '纯佣,投流', '高', '中', '每周3-5条', '每周1-2场', '否', '', '北京', '是', '销售A', '读书小达人公众号'],
      ['A', '知识课堂', '课程,教育', 8.0, 25.0, 1200000, '纯佣,坑位费', '中', '高', '每周1-2条', '每周3-5场', '是', '星辰MCN', '上海', '是', '销售B', '知识课堂Official']
    ];
    const ws = XLSX.utils.aoa_to_sheet(sampleData);
    ws['!cols'] = headers.map(h => ({ wch: Math.max(h.length * 2, 14) }));
    XLSX.utils.book_append_sheet(wb, ws, '达人数据');
    
    const noteData = [
      ['字段', '说明', '是否必填'],
      ['达人等级', 'S/A/B/C等级', '否'],
      ['视频号账号名称', '视频号昵称', '是'],
      ['视频号带货品类赛道', '多值，逗号分隔，如：图书,课程', '否'],
      ['现视频号品类销售额（月）短视频（万）', '数值，单位万元', '否'],
      ['现视频号品类销售额（月）直播（万）', '数值，单位万元', '否'],
      ['视频号粉丝数量', '数值', '否'],
      ['可接受的合作类型', '多值，如：纯佣,投流,坑位费', '否'],
      ['视频号图书品类带货意愿', '高/中/低', '否'],
      ['视频号少儿课程品类带货意愿', '高/中/低', '否'],
      ['最近3个月短视频更新频率', '如：每周3-5条', '否'],
      ['最近3个月直播频率', '如：每周1-2场', '否'],
      ['是否有MCN', '是/否', '否'],
      ['MCN名称', 'MCN机构名称', '否'],
      ['地区', '所在地区', '否'],
      ['是否已入驻互选', '是/否', '否'],
      ['归属销售', '负责销售人员', '否'],
      ['公众号账号名称', '关联公众号名称', '否']
    ];
    const noteWs = XLSX.utils.aoa_to_sheet(noteData);
    noteWs['!cols'] = [{ wch: 35 }, { wch: 40 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, noteWs, '填写说明');
    
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('达人批量导入模板.xlsx')}`,
      'Content-Length': buf.length
    });
    res.send(buf);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 批量导入达人 Excel (必须放在 /:id 之前) ==========
router.post('/excel/import', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: '请上传Excel文件' });
    
    const wb = XLSX.readFile(req.file.path);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const jsonData = XLSX.utils.sheet_to_json(ws, { defval: '' });
    
    if (jsonData.length === 0) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, error: 'Excel文件为空或格式不正确' });
    }
    
    const results = { success: 0, failed: 0, errors: [] };
    
    const insertStmt = req.db.prepare(`
      INSERT INTO influencers (id, level, video_account_name, video_category_track, monthly_short_video_sales, monthly_live_sales, fans_count, cooperation_type, book_willingness, course_willingness, short_video_frequency, live_frequency, has_mcn, mcn_name, region, has_joined_mutual_select, sales_owner, official_account_name, password)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const importTransaction = req.db.transaction((rows) => {
      rows.forEach((row, idx) => {
        try {
          const mapped = {};
          for (const [cnKey, enKey] of Object.entries(INFLUENCER_FIELD_MAP)) {
            mapped[enKey] = row[cnKey] !== undefined ? String(row[cnKey]) : '';
          }
          
          if (!mapped.video_account_name) {
            results.errors.push(`第${idx + 2}行：视频号账号名称为必填`);
            results.failed++;
            return;
          }
          
          const id = uuidv4();
          insertStmt.run(
            id, mapped.level || '', mapped.video_account_name,
            mapped.video_category_track || '',
            parseFloat(mapped.monthly_short_video_sales) || 0,
            parseFloat(mapped.monthly_live_sales) || 0,
            parseInt(mapped.fans_count) || 0,
            mapped.cooperation_type || '', mapped.book_willingness || '',
            mapped.course_willingness || '', mapped.short_video_frequency || '',
            mapped.live_frequency || '', mapped.has_mcn || '否',
            mapped.mcn_name || '', mapped.region || '',
            mapped.has_joined_mutual_select || '否',
            mapped.sales_owner || '', mapped.official_account_name || '', '123456'
          );
          results.success++;
        } catch (e) {
          results.errors.push(`第${idx + 2}行：${e.message}`);
          results.failed++;
        }
      });
    });
    
    importTransaction(jsonData);
    fs.unlinkSync(req.file.path);
    
    res.json({
      success: true,
      data: results,
      message: `导入完成：成功 ${results.success} 条，失败 ${results.failed} 条`
    });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 获取所有达人（支持搜索+分页） ==========
router.get('/', (req, res) => {
  try {
    const { keyword, category, page, pageSize, operator_id, sales_owner_id } = req.query;
    let sql = `SELECT i.*, a.name as sales_owner_name, a.username as sales_owner_username 
               FROM influencers i 
               LEFT JOIN admins a ON i.sales_owner_id = a.id AND a.admin_role = '销售'
               WHERE 1=1`;
    let countSql = 'SELECT COUNT(*) as total FROM influencers i WHERE 1=1';
    const params = [];
    const countParams = [];
    
    if (sales_owner_id) {
      // 销售角色：只能看归属自己的 + 没有归属的
      const salesFilter = ` AND (i.sales_owner_id = ? OR i.sales_owner_id IS NULL OR i.sales_owner_id = '')`;
      sql += salesFilter; countSql += salesFilter;
      params.push(sales_owner_id); countParams.push(sales_owner_id);
    } else if (operator_id) {
      sql += ' AND i.operator_id = ?'; countSql += ' AND i.operator_id = ?';
      params.push(operator_id); countParams.push(operator_id);
    }
    if (keyword) {
      const kwClause = ' AND (i.video_account_name LIKE ? OR i.video_category_track LIKE ? OR i.region LIKE ? OR i.mcn_name LIKE ? OR i.sales_owner LIKE ? OR i.cooperation_type LIKE ? OR i.level LIKE ?)';
      sql += kwClause; countSql += kwClause;
      const kw = `%${keyword}%`;
      params.push(kw, kw, kw, kw, kw, kw, kw);
      countParams.push(kw, kw, kw, kw, kw, kw, kw);
    }
    if (category) {
      sql += ' AND i.video_category_track LIKE ?';
      countSql += ' AND i.video_category_track LIKE ?';
      params.push(`%${category}%`);
      countParams.push(`%${category}%`);
    }
    
    sql += ' ORDER BY i.fans_count DESC';
    
    // 分页
    const currentPage = parseInt(page) || 1;
    const size = parseInt(pageSize) || 20;
    const offset = (currentPage - 1) * size;
    const total = req.db.prepare(countSql).get(...countParams).total;
    
    sql += ' LIMIT ? OFFSET ?';
    params.push(size, offset);
    
    const influencers = req.db.prepare(sql).all(...params);
    res.json({ 
      success: true, 
      data: influencers, 
      pagination: { page: currentPage, pageSize: size, total, totalPages: Math.ceil(total / size) }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 达人推荐 ==========
router.post('/recommend', (req, res) => {
  try {
    const { type, book_name, book_introduction, target_audience, selling_price, book_category } = req.body;
    
    let allInfluencers = req.db.prepare('SELECT * FROM influencers').all();
    
    const scored = allInfluencers.map(inf => {
      let score = 0;
      const tracks = (inf.video_category_track || '').toLowerCase();
      
      if (type === 'book' || !type) {
        if (tracks.includes('图书') || tracks.includes('教育')) score += 30;
        if (inf.book_willingness === '高') score += 25;
        else if (inf.book_willingness === '中') score += 15;
        if (target_audience && book_category) {
          if (tracks.includes('亲子') && (target_audience.includes('家长') || target_audience.includes('宝妈'))) score += 15;
          if (tracks.includes('教育') && (target_audience.includes('学生') || target_audience.includes('教师'))) score += 15;
        }
        if (inf.monthly_short_video_sales >= 10) score += 15;
        else if (inf.monthly_short_video_sales >= 5) score += 10;
        if (inf.fans_count >= 1000000) score += 15;
        else if (inf.fans_count >= 500000) score += 10;
        else if (inf.fans_count >= 200000) score += 5;
      } else {
        if (tracks.includes('课程') || tracks.includes('教育')) score += 30;
        if (inf.course_willingness === '高') score += 25;
        else if (inf.course_willingness === '中') score += 15;
        if (inf.monthly_live_sales >= 20) score += 15;
        else if (inf.monthly_live_sales >= 10) score += 10;
        if (inf.live_frequency && (inf.live_frequency.includes('每天') || inf.live_frequency.includes('每周3'))) score += 10;
        if (inf.fans_count >= 1000000) score += 15;
        else if (inf.fans_count >= 500000) score += 10;
        else if (inf.fans_count >= 200000) score += 5;
      }
      
      return { ...inf, matchScore: Math.min(score, 100) };
    })
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 10);
    
    res.json({ success: true, data: scored });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 获取单个达人 ==========
router.get('/:id', (req, res) => {
  try {
    const influencer = req.db.prepare('SELECT * FROM influencers WHERE id = ?').get(req.params.id);
    if (!influencer) return res.status(404).json({ success: false, error: '达人不存在' });
    res.json({ success: true, data: influencer });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 更新达人信息 ==========
router.put('/:id', (req, res) => {
  try {
    const id = req.params.id;
    const existing = req.db.prepare('SELECT * FROM influencers WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ success: false, error: '达人不存在' });
    
    // 联动处理：若传入 sales_owner_id，则用管理员当前 name 覆盖 sales_owner 文本；若仅传 sales_owner 文本，则尝试反查 id
    const body = { ...req.body };
    if (body.sales_owner_id !== undefined) {
      if (body.sales_owner_id) {
        const adm = req.db.prepare("SELECT name FROM admins WHERE id = ? AND admin_role = '销售'").get(body.sales_owner_id);
        if (adm) {
          body.sales_owner = adm.name;
        } else {
          body.sales_owner_id = null;
        }
      } else {
        // 清空关联时不动文本
      }
    } else if (body.sales_owner !== undefined && body.sales_owner) {
      const key = String(body.sales_owner).trim();
      const adm = req.db.prepare("SELECT id, name FROM admins WHERE admin_role = '销售' AND (name = ? OR username = ?)").get(key, key);
      if (adm) {
        body.sales_owner_id = adm.id;
        body.sales_owner = adm.name;
      }
    }
    
    const fields = ['level', 'video_account_name', 'video_category_track', 'monthly_short_video_sales', 'monthly_live_sales', 'fans_count', 'cooperation_type', 'book_willingness', 'course_willingness', 'short_video_frequency', 'live_frequency', 'has_mcn', 'mcn_name', 'region', 'has_joined_mutual_select', 'sales_owner', 'official_account_name', 'sales_owner_id'];
    
    const updates = [];
    const params = [];
    for (const field of fields) {
      if (body[field] !== undefined) {
        updates.push(`${field} = ?`);
        params.push(body[field]);
      }
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: '没有需要更新的字段' });
    }
    
    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);
    
    req.db.prepare(`UPDATE influencers SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    
    const updated = req.db.prepare('SELECT * FROM influencers WHERE id = ?').get(id);
    res.json({ success: true, data: updated, message: '更新成功' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 单独添加达人 (必须放在 /:id 之前) ==========
router.post('/add', (req, res) => {
  try {
    let { level, video_account_name, video_category_track, monthly_short_video_sales, monthly_live_sales, fans_count, cooperation_type, book_willingness, course_willingness, short_video_frequency, live_frequency, has_mcn, mcn_name, region, has_joined_mutual_select, sales_owner, official_account_name, operator_id, sales_owner_id } = req.body;
    
    if (!video_account_name) {
      return res.status(400).json({ success: false, error: '视频号账号名称为必填' });
    }
    
    // 联动：若传了 sales_owner_id，则以管理员当前 name 覆盖 sales_owner 文本
    if (sales_owner_id) {
      const adm = req.db.prepare("SELECT name, username FROM admins WHERE id = ? AND admin_role = '销售'").get(sales_owner_id);
      if (adm) {
        sales_owner = adm.name;
      } else {
        // 无效 id 清空
        sales_owner_id = null;
      }
    } else if (sales_owner && String(sales_owner).trim()) {
      // 反查：没传 id 但传了 name/username，模糊匹配销售角色管理员
      const key = String(sales_owner).trim();
      const adm = req.db.prepare("SELECT id, name FROM admins WHERE admin_role = '销售' AND (name = ? OR username = ?)").get(key, key);
      if (adm) {
        sales_owner_id = adm.id;
        sales_owner = adm.name;
      }
    }
    
    const id = uuidv4();
    req.db.prepare(`
      INSERT INTO influencers (id, level, video_account_name, video_category_track, monthly_short_video_sales, monthly_live_sales, fans_count, cooperation_type, book_willingness, course_willingness, short_video_frequency, live_frequency, has_mcn, mcn_name, region, has_joined_mutual_select, sales_owner, official_account_name, password, operator_id, sales_owner_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, level || '', video_account_name,
      video_category_track || '',
      parseFloat(monthly_short_video_sales) || 0,
      parseFloat(monthly_live_sales) || 0,
      parseInt(fans_count) || 0,
      cooperation_type || '', book_willingness || '',
      course_willingness || '', short_video_frequency || '',
      live_frequency || '', has_mcn || '否',
      mcn_name || '', region || '',
      has_joined_mutual_select || '否',
      sales_owner || '', official_account_name || '', '123456',
      operator_id || null, sales_owner_id || null
    );
    
    const newInf = req.db.prepare('SELECT * FROM influencers WHERE id = ?').get(id);
    res.json({ success: true, data: newInf, message: '达人添加成功' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 批量删除达人 ==========
router.post('/batch-delete', (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: '请提供需要删除的ID列表' });
    }
    const placeholders = ids.map(() => '?').join(',');
    // 先删除关联数据
    req.db.prepare(`DELETE FROM orders WHERE influencer_id IN (${placeholders})`).run(...ids);
    req.db.prepare(`DELETE FROM influencer_demands WHERE influencer_id IN (${placeholders})`).run(...ids);
    req.db.prepare(`DELETE FROM influencers WHERE id IN (${placeholders})`).run(...ids);
    res.json({ success: true, message: `成功删除 ${ids.length} 位达人` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 一键删除所有达人 ==========
router.delete('/all/clear', (req, res) => {
  try {
    req.db.prepare('DELETE FROM orders').run();
    req.db.prepare('DELETE FROM influencer_demands').run();
    req.db.prepare('DELETE FROM influencers').run();
    res.json({ success: true, message: '所有达人已清空' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 删除达人 ==========
router.delete('/:id', (req, res) => {
  try {
    req.db.prepare('DELETE FROM influencers WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: '删除成功' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
