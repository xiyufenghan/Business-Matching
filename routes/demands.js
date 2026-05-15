const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { notifyWework, WEWORK_EVENTS, getOwnerSalesMobiles } = require('./notifications');

// V5: markdown 推送辅助
function escapeMd(s) {
  if (s == null) return '';
  return String(s).replace(/[<>]/g, '');
}
function formatFans(n) {
  if (!n) return '';
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + 'w';
  return String(n);
}
function nowCN() {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

// 获取商家需求（支持筛选+搜索+分页）
router.get('/', (req, res) => {
  try {
    const { status, category, demand_type, merchant_id, keyword, page, pageSize, operator_id, sales_owner_id, sortField, sortOrder, book_category, grade_level, pure_commission_min, pure_commission_max, ad_commission_min, ad_commission_max, filter_sales_id } = req.query;
    let sql = `
      SELECT d.*, m.name as merchant_name, m.company as merchant_company,
        m.sales_owner_id as merchant_sales_owner_id, sa.name as merchant_sales_owner_name,
        bd.book_image, bd.book_merchant, bd.book_name, bd.target_audience as book_target_audience, 
        bd.book_category, bd.product_image, bd.book_introduction, bd.wechat_shop_link, 
        bd.specification, bd.selling_price, bd.pure_commission, bd.ad_commission, bd.logistics, bd.stock,
        cd.course_image, cd.course_name, cd.unit_price, cd.grade_level, cd.subject, cd.course_introduction, cd.course_link,
        cd.pure_commission as course_pure_commission, cd.ad_commission as course_ad_commission,
        COALESCE(bd.images, cd.images) as images
      FROM demands d
      LEFT JOIN merchants m ON d.merchant_id = m.id
      LEFT JOIN admins sa ON m.sales_owner_id = sa.id AND sa.admin_role = '销售'
      LEFT JOIN book_demands bd ON d.ref_demand_id = bd.id AND d.demand_type = 'book'
      LEFT JOIN course_demands cd ON d.ref_demand_id = cd.id AND d.demand_type = 'course'
      WHERE 1=1
    `;
    let countSql = `SELECT COUNT(*) as total FROM demands d LEFT JOIN merchants m ON d.merchant_id = m.id LEFT JOIN admins sa ON m.sales_owner_id = sa.id AND sa.admin_role = '销售' LEFT JOIN book_demands bd ON d.ref_demand_id = bd.id AND d.demand_type = 'book' LEFT JOIN course_demands cd ON d.ref_demand_id = cd.id AND d.demand_type = 'course' WHERE 1=1`;
    const params = [];
    const countParams = [];

    if (sales_owner_id) {
      // 销售角色：只看归属自己的商家发布的需求 + 无归属商家的需求
      const salesFilter = ` AND (m.sales_owner_id = ? OR m.sales_owner_id IS NULL OR m.sales_owner_id = '')`;
      sql += salesFilter; countSql += salesFilter;
      params.push(sales_owner_id); countParams.push(sales_owner_id);
    } else if (operator_id) {
      sql += ' AND d.operator_id = ?'; countSql += ' AND d.operator_id = ?';
      params.push(operator_id); countParams.push(operator_id);
    }
    if (status) { 
      sql += ' AND d.status = ?'; countSql += ' AND d.status = ?';
      params.push(status); countParams.push(status); 
    }
    if (category) { 
      sql += ' AND d.category = ?'; countSql += ' AND d.category = ?';
      params.push(category); countParams.push(category); 
    }
    if (demand_type) { 
      sql += ' AND d.demand_type = ?'; countSql += ' AND d.demand_type = ?';
      params.push(demand_type); countParams.push(demand_type); 
    }
    if (book_category) {
      // 模糊匹配（图书分类支持多值逗号分隔存储）
      const bcClause = ` AND (d.demand_type = 'book' AND bd.book_category LIKE ?)`;
      sql += bcClause; countSql += bcClause;
      params.push(`%${book_category}%`); countParams.push(`%${book_category}%`);
    }
    if (grade_level) {
      const glClause = ` AND (d.demand_type = 'course' AND cd.grade_level LIKE ?)`;
      sql += glClause; countSql += glClause;
      params.push(`%${grade_level}%`); countParams.push(`%${grade_level}%`);
    }
    // 佣金范围筛选（仅图书有这两字段，按比率/百分数兼容）
    const normalizeCommission = (v) => {
      const n = parseFloat(v);
      if (isNaN(n)) return null;
      // 用户输入 25 表示 25%，存储既可能是 25 也可能是 0.25 → 都转成百分数比较
      return n;
    };
    if (pure_commission_min !== undefined && pure_commission_min !== '') {
      const v = normalizeCommission(pure_commission_min);
      if (v !== null) {
        const clause = ` AND (CASE WHEN bd.pure_commission > 1 THEN bd.pure_commission ELSE bd.pure_commission * 100 END) >= ?`;
        sql += clause; countSql += clause;
        params.push(v); countParams.push(v);
      }
    }
    if (pure_commission_max !== undefined && pure_commission_max !== '') {
      const v = normalizeCommission(pure_commission_max);
      if (v !== null) {
        const clause = ` AND (CASE WHEN bd.pure_commission > 1 THEN bd.pure_commission ELSE bd.pure_commission * 100 END) <= ?`;
        sql += clause; countSql += clause;
        params.push(v); countParams.push(v);
      }
    }
    if (ad_commission_min !== undefined && ad_commission_min !== '') {
      const v = normalizeCommission(ad_commission_min);
      if (v !== null) {
        const clause = ` AND (CASE WHEN bd.ad_commission > 1 THEN bd.ad_commission ELSE bd.ad_commission * 100 END) >= ?`;
        sql += clause; countSql += clause;
        params.push(v); countParams.push(v);
      }
    }
    if (ad_commission_max !== undefined && ad_commission_max !== '') {
      const v = normalizeCommission(ad_commission_max);
      if (v !== null) {
        const clause = ` AND (CASE WHEN bd.ad_commission > 1 THEN bd.ad_commission ELSE bd.ad_commission * 100 END) <= ?`;
        sql += clause; countSql += clause;
        params.push(v); countParams.push(v);
      }
    }
    // 按归属销售筛选（admin 主动选择）
    if (filter_sales_id) {
      const fsClause = ` AND m.sales_owner_id = ?`;
      sql += fsClause; countSql += fsClause;
      params.push(filter_sales_id); countParams.push(filter_sales_id);
    }
    if (merchant_id) { 
      sql += ' AND d.merchant_id = ?'; countSql += ' AND d.merchant_id = ?';
      params.push(merchant_id); countParams.push(merchant_id); 
    }
    if (keyword) {
      const kw = `%${keyword}%`;
      // 关键词扩展：标题、类目、描述、商家名、图书名、图书商家、课程名、归属销售名
      const kwClause = ' AND (d.title LIKE ? OR d.category LIKE ? OR d.description LIKE ? OR m.company LIKE ? OR bd.book_name LIKE ? OR bd.book_merchant LIKE ? OR cd.course_name LIKE ? OR sa.name LIKE ?)';
      sql += kwClause; countSql += kwClause;
      params.push(kw, kw, kw, kw, kw, kw, kw, kw);
      countParams.push(kw, kw, kw, kw, kw, kw, kw, kw);
    }
    
    // 排序（防SQL注入：白名单校验）
    const allowedSortFields = ['created_at', 'title', 'price', 'status', 'sales'];
    let orderField = allowedSortFields.includes(sortField) ? sortField : 'created_at';
    if (orderField === 'price') {
      orderField = "COALESCE(bd.selling_price, cd.unit_price, 0)";
    } else if (orderField === 'sales') {
      orderField = "sa.name";
    } else if (orderField === 'title') {
      orderField = "d.title";
    } else {
      orderField = `d.${orderField}`;
    }
    const direction = sortOrder === 'asc' ? 'ASC' : 'DESC';
    sql += ` ORDER BY ${orderField} ${direction}`;
    
    // 分页
    const currentPage = parseInt(page) || 1;
    const size = parseInt(pageSize) || 20;
    const offset = (currentPage - 1) * size;
    const total = req.db.prepare(countSql).get(...countParams).total;
    
    sql += ' LIMIT ? OFFSET ?';
    params.push(size, offset);
    
    const demands = req.db.prepare(sql).all(...params);
    res.json({ 
      success: true, 
      data: demands, 
      pagination: { page: currentPage, pageSize: size, total, totalPages: Math.ceil(total / size) }
    });
  } catch (err) {
    console.error('[' + "routes/demands.js" + ']', err);
    res.status(500).json({ success: false, error: '操作失败，请稍后重试' });
  }
});

// 获取达人需求列表（支持搜索+分页+多维筛选）
router.get('/influencer-demands', (req, res) => {
  try {
    const {
      influencer_id, keyword, page, pageSize, operator_id, sales_owner_id,
      demand_category, book_category, subject_category, level, status,
      fans_min, fans_max, price_min, price_max
    } = req.query;
    let sql = `
      SELECT id_tbl.*, inf.video_account_name as inf_video_account_name, inf.level, inf.fans_count as inf_fans_count, inf.video_category_track, inf.region as inf_region, inf.sales_owner_id
      FROM influencer_demands id_tbl
      LEFT JOIN influencers inf ON id_tbl.influencer_id = inf.id
      WHERE 1=1
    `;
    let countSql = `SELECT COUNT(*) as total FROM influencer_demands id_tbl LEFT JOIN influencers inf ON id_tbl.influencer_id = inf.id WHERE 1=1`;
    const params = [];
    const countParams = [];

    if (sales_owner_id) {
      // 销售角色：只看归属自己的达人发布的需求 + 无归属达人的需求
      const salesFilter = ` AND (inf.sales_owner_id = ? OR inf.sales_owner_id IS NULL OR inf.sales_owner_id = '')`;
      sql += salesFilter; countSql += salesFilter;
      params.push(sales_owner_id); countParams.push(sales_owner_id);
    } else if (operator_id) {
      sql += ' AND id_tbl.operator_id = ?'; countSql += ' AND id_tbl.operator_id = ?';
      params.push(operator_id); countParams.push(operator_id);
    }
    if (influencer_id) { 
      sql += ' AND id_tbl.influencer_id = ?'; countSql += ' AND id_tbl.influencer_id = ?';
      params.push(influencer_id); countParams.push(influencer_id); 
    }
    // 需求类型（图书需求 / 课程需求）
    if (demand_category) {
      sql += ' AND id_tbl.demand_category = ?'; countSql += ' AND id_tbl.demand_category = ?';
      params.push(demand_category); countParams.push(demand_category);
    }
    // 图书分类
    if (book_category) {
      sql += ' AND id_tbl.book_category = ?'; countSql += ' AND id_tbl.book_category = ?';
      params.push(book_category); countParams.push(book_category);
    }
    // 学科分类
    if (subject_category) {
      sql += ' AND id_tbl.subject_category = ?'; countSql += ' AND id_tbl.subject_category = ?';
      params.push(subject_category); countParams.push(subject_category);
    }
    // 达人等级
    if (level) {
      sql += ' AND inf.level = ?'; countSql += ' AND inf.level = ?';
      params.push(level); countParams.push(level);
    }
    // 状态
    if (status) {
      sql += ' AND id_tbl.status = ?'; countSql += ' AND id_tbl.status = ?';
      params.push(status); countParams.push(status);
    }
    // 粉丝量区间（基于达人主表 fans_count，回退到需求表）
    if (fans_min) {
      sql += ' AND COALESCE(inf.fans_count, id_tbl.fans_count, 0) >= ?';
      countSql += ' AND COALESCE(inf.fans_count, id_tbl.fans_count, 0) >= ?';
      params.push(parseInt(fans_min) || 0); countParams.push(parseInt(fans_min) || 0);
    }
    if (fans_max) {
      sql += ' AND COALESCE(inf.fans_count, id_tbl.fans_count, 0) <= ?';
      countSql += ' AND COALESCE(inf.fans_count, id_tbl.fans_count, 0) <= ?';
      params.push(parseInt(fans_max) || 0); countParams.push(parseInt(fans_max) || 0);
    }
    // 客单价区间（图书优先取 book_price_max，课程取 course_price_max）
    if (price_min) {
      sql += ' AND (id_tbl.book_price_max >= ? OR id_tbl.course_price_max >= ?)';
      countSql += ' AND (id_tbl.book_price_max >= ? OR id_tbl.course_price_max >= ?)';
      const v = parseFloat(price_min) || 0;
      params.push(v, v); countParams.push(v, v);
    }
    if (price_max) {
      sql += ' AND ((id_tbl.book_price_min <= ? AND id_tbl.book_price_max > 0) OR (id_tbl.course_price_min <= ? AND id_tbl.course_price_max > 0))';
      countSql += ' AND ((id_tbl.book_price_min <= ? AND id_tbl.book_price_max > 0) OR (id_tbl.course_price_min <= ? AND id_tbl.course_price_max > 0))';
      const v = parseFloat(price_max) || 0;
      params.push(v, v); countParams.push(v, v);
    }
    if (keyword) {
      const kw = `%${keyword}%`;
      const kwClause = ' AND (id_tbl.video_account_name LIKE ? OR id_tbl.book_name LIKE ? OR id_tbl.book_category LIKE ? OR id_tbl.demand_category LIKE ? OR id_tbl.description LIKE ? OR id_tbl.subject_category LIKE ? OR inf.video_account_name LIKE ?)';
      sql += kwClause; countSql += kwClause;
      params.push(kw, kw, kw, kw, kw, kw, kw);
      countParams.push(kw, kw, kw, kw, kw, kw, kw);
    }
    
    sql += ' ORDER BY id_tbl.created_at DESC';
    
    // 分页
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
    console.error('[' + "routes/demands.js" + ']', err);
    res.status(500).json({ success: false, error: '操作失败，请稍后重试' });
  }
});

// 创建达人需求（新字段）
router.post('/influencer-demands', (req, res) => {
  try {
    const { influencer_id, video_account_name, demand_category, book_name, book_category, book_price_min, book_price_max, course_price_min, course_price_max, description, fans_count, subject_category, operator_id, book_promote_categories, content_formats, cooperation_types } = req.body;
    if (!influencer_id) {
      return res.status(400).json({ success: false, error: '达人ID为必填' });
    }
    const id = uuidv4();
    req.db.prepare(`
      INSERT INTO influencer_demands (id, influencer_id, video_account_name, demand_category, book_name, book_category, book_price_min, book_price_max, course_price_min, course_price_max, description, fans_count, subject_category, status, operator_id, book_promote_categories, content_formats, cooperation_types)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?, ?)
    `).run(id, influencer_id, video_account_name || '', demand_category || '图书需求', book_name || '', book_category || '', parseFloat(book_price_min) || 0, parseFloat(book_price_max) || 0, parseFloat(course_price_min) || 0, parseFloat(course_price_max) || 0, description || '', parseInt(fans_count) || 0, subject_category || '', operator_id || null,
      Array.isArray(book_promote_categories) ? JSON.stringify(book_promote_categories) : (book_promote_categories || null),
      Array.isArray(content_formats) ? JSON.stringify(content_formats) : (content_formats || null),
      Array.isArray(cooperation_types) ? JSON.stringify(cooperation_types) : (cooperation_types || null)
    );
    
    const demand = req.db.prepare('SELECT * FROM influencer_demands WHERE id = ?').get(id);

    // 企微推送：场景#1 达人发布带货意向
    try {
      const inf = req.db.prepare('SELECT video_account_name, level, fans_count FROM influencers WHERE id = ?').get(influencer_id);
      const mobiles = getOwnerSalesMobiles(req.db, { influencerId: influencer_id });
      notifyWework(req.db, {
        eventKey: WEWORK_EVENTS.INFLUENCER_DEMAND_PUBLISH.key,
        type: 'markdown',
        content: `**📢 达人发布带货意向**\n` +
                 `> 达人：<font color="warning">${escapeMd(inf ? inf.video_account_name : video_account_name || '未知达人')}</font>` +
                 `${inf && inf.level ? ` （${inf.level}）` : ''}` +
                 `${inf && inf.fans_count ? ` · 粉丝 ${formatFans(inf.fans_count)}` : ''}\n` +
                 (book_name ? `> 标题：${escapeMd(book_name)}\n` : '') +
                 (Array.isArray(content_formats) && content_formats.length ? `> 内容形式：${content_formats.join(' / ')}\n` : '') +
                 (Array.isArray(cooperation_types) && cooperation_types.length ? `> 合作类型：${cooperation_types.join(' / ')}\n` : '') +
                 `> 时间：${nowCN()}\n\n` +
                 `请关注新意向～`,
        mentionedMobiles: mobiles,
      });
    } catch (e) { /* fire-and-forget */ }

    res.status(201).json({ success: true, data: demand, message: '达人需求发布成功' });
  } catch (err) {
    console.error('[' + "routes/demands.js" + ']', err);
    res.status(500).json({ success: false, error: '操作失败，请稍后重试' });
  }
});

// 删除达人需求
router.delete('/influencer-demands/:id', (req, res) => {
  try {
    req.db.prepare('DELETE FROM influencer_demands WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: '删除成功' });
  } catch (err) {
    console.error('[' + "routes/demands.js" + ']', err);
    res.status(500).json({ success: false, error: '操作失败，请稍后重试' });
  }
});

// 获取需求详情（含关联的图书/课程信息）
router.get('/filter-options', (req, res) => {
  try {
    // 图书分类（来自 book_demands.book_category，可能多值逗号分隔）
    const bookRows = req.db.prepare(`SELECT DISTINCT book_category FROM book_demands WHERE book_category IS NOT NULL AND book_category != ''`).all();
    const bookCategories = [...new Set(
      bookRows.flatMap(r => (r.book_category || '').split(/[,，;；]/).map(s => s.trim()).filter(Boolean))
    )].sort();
    // 课程学段
    const gradeRows = req.db.prepare(`SELECT DISTINCT grade_level FROM course_demands WHERE grade_level IS NOT NULL AND grade_level != ''`).all();
    const gradeLevels = [...new Set(
      gradeRows.flatMap(r => (r.grade_level || '').split(/[,，;；]/).map(s => s.trim()).filter(Boolean))
    )].sort();
    // 销售人员列表（admin_role='销售' 的管理员）
    const salesRows = req.db.prepare(`SELECT id, name FROM admins WHERE admin_role = '销售' ORDER BY name`).all();
    res.json({ success: true, data: { book_categories: bookCategories, grade_levels: gradeLevels, sales_list: salesRows } });
  } catch (err) {
    console.error('[' + "routes/demands.js" + ']', err);
    res.status(500).json({ success: false, error: '操作失败，请稍后重试' });
  }
});

router.get('/:id', (req, res, next) => {
  // 排除保留路径，让后续中间件处理
  const reserved = ['plaza', 'merchant-plaza', 'influencer-demands'];
  if (reserved.includes(req.params.id)) return next();
  try {
    const demand = req.db.prepare(`
      SELECT d.*, m.name as merchant_name, m.company as merchant_company
      FROM demands d
      LEFT JOIN merchants m ON d.merchant_id = m.id
      WHERE d.id = ?
    `).get(req.params.id);
    if (!demand) return res.status(404).json({ success: false, error: '需求不存在' });
    
    let detail = null;
    if (demand.ref_demand_id) {
      if (demand.demand_type === 'book') {
        detail = req.db.prepare('SELECT * FROM book_demands WHERE id = ?').get(demand.ref_demand_id);
      } else {
        detail = req.db.prepare('SELECT * FROM course_demands WHERE id = ?').get(demand.ref_demand_id);
      }
    }
    
    res.json({ success: true, data: { ...demand, detail } });
  } catch (err) {
    console.error('[' + "routes/demands.js" + ']', err);
    res.status(500).json({ success: false, error: '操作失败，请稍后重试' });
  }
});

// 智能推荐商品 - 根据达人信息匹配需求
router.post('/recommend', (req, res) => {
  try {
    const { video_category_track, fans_count, book_willingness, course_willingness, cooperation_type } = req.body;
    
    let allDemands = req.db.prepare(`
      SELECT d.*, m.company as merchant_company,
        bd.book_name, bd.book_category, bd.selling_price, bd.pure_commission, bd.target_audience, bd.book_introduction,
        cd.course_name, cd.unit_price, cd.subject, cd.grade_level, cd.course_introduction
      FROM demands d
      LEFT JOIN merchants m ON d.merchant_id = m.id
      LEFT JOIN book_demands bd ON d.ref_demand_id = bd.id AND d.demand_type = 'book'
      LEFT JOIN course_demands cd ON d.ref_demand_id = cd.id AND d.demand_type = 'course'
      WHERE d.status = 'published'
    `).all();
    
    const tracks = (video_category_track || '').toLowerCase();
    const scored = allDemands.map(d => {
      let score = 0;
      
      if (d.demand_type === 'book') {
        if (tracks.includes('图书') || tracks.includes('教育') || tracks.includes('亲子')) score += 30;
        if (book_willingness === '高') score += 25;
        else if (book_willingness === '中') score += 15;
        if (d.category && tracks.includes(d.category.replace('图书', '').replace('课程', ''))) score += 10;
      } else {
        if (tracks.includes('课程') || tracks.includes('教育')) score += 30;
        if (course_willingness === '高') score += 25;
        else if (course_willingness === '中') score += 15;
      }
      
      if (d.fans_requirement) {
        const reqNum = parseInt(d.fans_requirement) * 10000;
        if (fans_count >= reqNum) score += 20;
        else if (fans_count >= reqNum * 0.7) score += 10;
      } else {
        score += 15;
      }
      
      return { ...d, matchScore: Math.min(score, 100) };
    })
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 10);
    
    res.json({ success: true, data: scored });
  } catch (err) {
    console.error('[' + "routes/demands.js" + ']', err);
    res.status(500).json({ success: false, error: '操作失败，请稍后重试' });
  }
});

// 单条图书需求发布
router.post('/book', (req, res) => {
  try {
    const { merchant_id, book_image, book_merchant, book_name, target_audience, book_category, product_image, book_introduction, wechat_shop_link, specification, selling_price, pure_commission, ad_commission, logistics, stock, operator_id, selling_points, remark } = req.body;
    if (!merchant_id || !book_name || !book_category || !book_merchant) {
      return res.status(400).json({ success: false, error: '商家ID、图书名称、图书分类、图书商家为必填项' });
    }
    const bookId = uuidv4();
    req.db.prepare(`
      INSERT INTO book_demands (id, merchant_id, book_image, book_merchant, book_name, target_audience, book_category, product_image, book_introduction, wechat_shop_link, specification, selling_price, pure_commission, ad_commission, logistics, stock, operator_id, selling_points, remark)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(bookId, merchant_id, book_image || '', book_merchant, book_name, target_audience || '', book_category, product_image || '', book_introduction || '', wechat_shop_link || '', specification || '', parseFloat(selling_price) || 0, parseFloat(pure_commission) || 0, parseFloat(ad_commission) || 0, logistics || '', parseInt(stock) || 0, operator_id || null, selling_points || '', remark || '');
    
    const demandId = uuidv4();
    req.db.prepare(`
      INSERT INTO demands (id, merchant_id, title, demand_type, category, platform, description, status, ref_demand_id, operator_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(demandId, merchant_id, book_name + ' 推广', 'book', book_category.split(',')[0], '视频号', book_introduction || book_name, 'published', bookId, operator_id || null);
    
    // 企微推送：场景#2 商家发布需求
    try {
      const m = req.db.prepare('SELECT company FROM merchants WHERE id = ?').get(merchant_id);
      const mobiles = getOwnerSalesMobiles(req.db, { merchantId: merchant_id });
      notifyWework(req.db, {
        eventKey: WEWORK_EVENTS.MERCHANT_DEMAND_PUBLISH.key,
        type: 'markdown',
        content: `**📦 商家发布图书需求**\n` +
                 `> 商家：<font color="info">${escapeMd(m ? m.company : book_merchant)}</font>\n` +
                 `> 标题：${escapeMd(book_name)}\n` +
                 `> 分类：${escapeMd(book_category)}\n` +
                 (selling_price ? `> 售价：¥${selling_price}\n` : '') +
                 (pure_commission ? `> 纯佣金：${pure_commission}%\n` : '') +
                 `> 时间：${nowCN()}\n\n` +
                 `请关注～`,
        mentionedMobiles: mobiles,
      });
    } catch (e) { /* fire-and-forget */ }

    res.status(201).json({ success: true, message: '图书需求发布成功' });
  } catch (err) {
    console.error('[' + "routes/demands.js" + ']', err);
    res.status(500).json({ success: false, error: '操作失败，请稍后重试' });
  }
});

// 单条课程需求发布
router.post('/course', (req, res) => {
  try {
    const { merchant_id, course_image, course_name, unit_price, grade_level, subject, pure_commission, ad_commission, course_introduction, course_link, operator_id } = req.body;
    if (!merchant_id || !course_name) {
      return res.status(400).json({ success: false, error: '商家ID、课程名称为必填项' });
    }
    const courseId = uuidv4();
    req.db.prepare(`
      INSERT INTO course_demands (id, merchant_id, course_image, course_name, unit_price, grade_level, subject, pure_commission, ad_commission, course_introduction, course_link, operator_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(courseId, merchant_id, course_image || '', course_name, parseFloat(unit_price) || 0, grade_level || '', subject || '', parseFloat(pure_commission) || 0, parseFloat(ad_commission) || 0, course_introduction || '', course_link || '', operator_id || null);
    
    const demandId = uuidv4();
    const category = subject ? subject.split(',')[0] + '课程' : '课程';
    req.db.prepare(`
      INSERT INTO demands (id, merchant_id, title, demand_type, category, platform, description, status, ref_demand_id, operator_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(demandId, merchant_id, course_name + ' 推广', 'course', category, '视频号', course_introduction || course_name, 'published', courseId, operator_id || null);
    
    // 企微推送：场景#2 商家发布课程需求
    try {
      const m = req.db.prepare('SELECT company FROM merchants WHERE id = ?').get(merchant_id);
      const mobiles = getOwnerSalesMobiles(req.db, { merchantId: merchant_id });
      notifyWework(req.db, {
        eventKey: WEWORK_EVENTS.MERCHANT_DEMAND_PUBLISH.key,
        type: 'markdown',
        content: `**📦 商家发布课程需求**\n` +
                 `> 商家：<font color="info">${escapeMd(m ? m.company : '未知商家')}</font>\n` +
                 `> 标题：${escapeMd(course_name)}\n` +
                 (grade_level ? `> 学段：${escapeMd(grade_level)}\n` : '') +
                 (subject ? `> 学科：${escapeMd(subject)}\n` : '') +
                 (unit_price ? `> 单价：¥${unit_price}\n` : '') +
                 `> 时间：${nowCN()}\n\n` +
                 `请关注～`,
        mentionedMobiles: mobiles,
      });
    } catch (e) { /* fire-and-forget */ }

    res.status(201).json({ success: true, message: '课程需求发布成功' });
  } catch (err) {
    console.error('[' + "routes/demands.js" + ']', err);
    res.status(500).json({ success: false, error: '操作失败，请稍后重试' });
  }
});

// 创建商家需求
router.post('/', (req, res) => {
  try {
    const body = req.body;
    // 自动推断发布者角色：admin 发布标 'admin'，商家发布标 'merchant'
    const inferPublisherRole = () => {
      if (req.user && req.user.role === 'admin') return 'admin';
      return 'merchant';
    };
    const adminPublisherId = (req.user && req.user.role === 'admin') ? req.user.id : null;

    if (Array.isArray(body)) {
      const results = [];
      const insertStmt = req.db.prepare(`
        INSERT INTO demands (id, merchant_id, title, demand_type, category, platform, budget_min, budget_max, fans_requirement, cooperation_type, description, requirements, deadline, publisher_role, admin_publisher_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertMany = req.db.transaction((demands) => {
        for (const d of demands) {
          if (!d.merchant_id || !d.title || !d.category) continue;
          const id = uuidv4();
          const role = d.publisher_role || inferPublisherRole();
          insertStmt.run(id, d.merchant_id, d.title, d.demand_type || 'book', d.category, '视频号', d.budget_min || 0, d.budget_max || 0, d.fans_requirement || null, d.cooperation_type || null, d.description || null, d.requirements || null, d.deadline || null, role, adminPublisherId);
          results.push(id);
        }
      });
      insertMany(body);
      res.status(201).json({ success: true, data: { count: results.length }, message: `成功发布 ${results.length} 条需求` });
    } else {
      const { merchant_id, title, demand_type, category, budget_min, budget_max, fans_requirement, cooperation_type, description, requirements, deadline, publisher_role } = body;
      if (!merchant_id || !title || !category) {
        return res.status(400).json({ success: false, error: '商家ID、标题、类目为必填项' });
      }
      const id = uuidv4();
      const role = publisher_role || inferPublisherRole();
      req.db.prepare(`
        INSERT INTO demands (id, merchant_id, title, demand_type, category, platform, budget_min, budget_max, fans_requirement, cooperation_type, description, requirements, deadline, publisher_role, admin_publisher_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, merchant_id, title, demand_type || 'book', category, '视频号', budget_min || 0, budget_max || 0, fans_requirement || null, cooperation_type || null, description || null, requirements || null, deadline || null, role, adminPublisherId);
      const demand = req.db.prepare('SELECT * FROM demands WHERE id = ?').get(id);
      res.status(201).json({ success: true, data: demand });
    }
  } catch (err) {
    console.error('[' + "routes/demands.js" + ']', err);
    res.status(500).json({ success: false, error: '操作失败，请稍后重试' });
  }
});

// 接单
router.post('/order', (req, res) => {
  try {
    const { demand_id, influencer_id, message } = req.body;
    if (!demand_id || !influencer_id) {
      return res.status(400).json({ success: false, error: '需求ID和达人ID为必填' });
    }
    
    const existing = req.db.prepare('SELECT id FROM orders WHERE demand_id = ? AND influencer_id = ?').get(demand_id, influencer_id);
    if (existing) {
      return res.status(400).json({ success: false, error: '已接过此需求' });
    }
    
    const demand = req.db.prepare('SELECT * FROM demands WHERE id = ?').get(demand_id);
    if (!demand) return res.status(404).json({ success: false, error: '需求不存在' });
    
    const id = uuidv4();
    req.db.prepare(`
      INSERT INTO orders (id, demand_id, demand_type, ref_demand_id, influencer_id, merchant_id, status, message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, demand_id, demand.demand_type, demand.ref_demand_id || null, influencer_id, demand.merchant_id, 'accepted', message || '');
    
    // 更新需求状态为已接单
    req.db.prepare('UPDATE demands SET status = ? WHERE id = ?').run('accepted', demand_id);
    
    res.status(201).json({ success: true, message: '接单成功' });
  } catch (err) {
    console.error('[' + "routes/demands.js" + ']', err);
    res.status(500).json({ success: false, error: '操作失败，请稍后重试' });
  }
});

// 批量删除商家需求（仅超管）
router.post('/batch-delete', (req, res) => {
  if (!req.user || req.user.role !== 'admin' || !req.user.is_super) {
    return res.status(403).json({ success: false, error: '无权限：仅超级管理员可执行此操作' });
  }
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: '请提供需要删除的ID列表' });
    }
    const placeholders = ids.map(() => '?').join(',');
    req.db.prepare(`DELETE FROM demands WHERE id IN (${placeholders})`).run(...ids);
    res.json({ success: true, message: `成功删除 ${ids.length} 条需求` });
  } catch (err) {
    console.error('[' + "routes/demands.js" + ']', err);
    res.status(500).json({ success: false, error: '操作失败，请稍后重试' });
  }
});

// 一键删除所有商家需求（仅超管，merchant_id 限定时允许商家本人）
router.delete('/all/clear', (req, res) => {
  const { merchant_id } = req.query;
  // 商家本人清空自己 / 超管清空全部
  const isSelfClean = merchant_id && req.user && req.user.role === 'merchant' && req.user.id === merchant_id;
  const isSuper = req.user && req.user.role === 'admin' && req.user.is_super;
  if (!isSelfClean && !isSuper) {
    return res.status(403).json({ success: false, error: '无权限：仅本人或超级管理员可执行此操作' });
  }
  try {
    const { merchant_id } = req.query;
    if (merchant_id) {
      req.db.prepare('DELETE FROM demands WHERE merchant_id = ?').run(merchant_id);
    } else {
      req.db.prepare('DELETE FROM demands').run();
    }
    res.json({ success: true, message: '所有需求已清空' });
  } catch (err) {
    console.error('[' + "routes/demands.js" + ']', err);
    res.status(500).json({ success: false, error: '操作失败，请稍后重试' });
  }
});

// 批量删除达人需求
router.post('/influencer-demands/batch-delete', (req, res) => {
  if (!req.user || req.user.role !== 'admin' || !req.user.is_super) {
    return res.status(403).json({ success: false, error: '无权限：仅超级管理员可执行此操作' });
  }
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: '请提供需要删除的ID列表' });
    }
    const placeholders = ids.map(() => '?').join(',');
    req.db.prepare(`DELETE FROM influencer_demands WHERE id IN (${placeholders})`).run(...ids);
    res.json({ success: true, message: `成功删除 ${ids.length} 条达人需求` });
  } catch (err) {
    console.error('[' + "routes/demands.js" + ']', err);
    res.status(500).json({ success: false, error: '操作失败，请稍后重试' });
  }
});

// 一键删除所有达人需求（仅超管）
router.delete('/influencer-demands/all/clear', (req, res) => {
  if (!req.user || req.user.role !== 'admin' || !req.user.is_super) {
    return res.status(403).json({ success: false, error: '无权限：仅超级管理员可执行此操作' });
  }
  try {
    const { influencer_id } = req.query;
    if (influencer_id) {
      req.db.prepare('DELETE FROM influencer_demands WHERE influencer_id = ?').run(influencer_id);
    } else {
      req.db.prepare('DELETE FROM influencer_demands').run();
    }
    res.json({ success: true, message: '所有达人需求已清空' });
  } catch (err) {
    console.error('[' + "routes/demands.js" + ']', err);
    res.status(500).json({ success: false, error: '操作失败，请稍后重试' });
  }
});

// 删除需求
router.delete('/:id', (req, res) => {
  try {
    req.db.prepare('DELETE FROM demands WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: '删除成功' });
  } catch (err) {
    console.error('[' + "routes/demands.js" + ']', err);
    res.status(500).json({ success: false, error: '操作失败，请稍后重试' });
  }
});

// ========== 更新图书需求字段 ==========
router.put('/book/:id', (req, res) => {
  try {
    const id = req.params.id;
    const existing = req.db.prepare('SELECT * FROM book_demands WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ success: false, error: '图书需求不存在' });
    const fields = ['book_image','book_merchant','book_name','target_audience','book_category','product_image','book_introduction','wechat_shop_link','specification','selling_price','pure_commission','ad_commission','logistics','stock','status'];
    const numericFields = new Set(['selling_price','pure_commission','ad_commission','stock']);
    const updates = [], params = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = ?`);
        params.push(numericFields.has(f) ? (parseFloat(req.body[f]) || 0) : req.body[f]);
      }
    }
    if (updates.length === 0) return res.status(400).json({ success: false, error: '没有需要更新的字段' });
    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);
    req.db.prepare(`UPDATE book_demands SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    // 同步更新 demands 主表的标题/描述/分类
    if (req.body.book_name || req.body.book_category || req.body.book_introduction) {
      const bd = req.db.prepare('SELECT * FROM book_demands WHERE id = ?').get(id);
      req.db.prepare(`UPDATE demands SET title = ?, category = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE ref_demand_id = ? AND demand_type = 'book'`)
        .run(bd.book_name + ' 推广', (bd.book_category || '').split(',')[0], bd.book_introduction || bd.book_name, id);
    }
    const updated = req.db.prepare('SELECT * FROM book_demands WHERE id = ?').get(id);
    res.json({ success: true, data: updated, message: '图书需求更新成功' });
  } catch (err) {
    console.error('[' + "routes/demands.js" + ']', err);
    res.status(500).json({ success: false, error: '操作失败，请稍后重试' });
  }
});

// ========== 更新课程需求字段 ==========
router.put('/course/:id', (req, res) => {
  try {
    const id = req.params.id;
    const existing = req.db.prepare('SELECT * FROM course_demands WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ success: false, error: '课程需求不存在' });
    const fields = ['course_image','course_name','unit_price','grade_level','subject','pure_commission','ad_commission','course_introduction','course_link','status'];
    const numericFields = new Set(['unit_price','pure_commission','ad_commission']);
    const updates = [], params = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = ?`);
        params.push(numericFields.has(f) ? (parseFloat(req.body[f]) || 0) : req.body[f]);
      }
    }
    if (updates.length === 0) return res.status(400).json({ success: false, error: '没有需要更新的字段' });
    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);
    req.db.prepare(`UPDATE course_demands SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    if (req.body.course_name || req.body.subject || req.body.course_introduction) {
      const cd = req.db.prepare('SELECT * FROM course_demands WHERE id = ?').get(id);
      const cat = cd.subject ? cd.subject.split(',')[0] + '课程' : '课程';
      req.db.prepare(`UPDATE demands SET title = ?, category = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE ref_demand_id = ? AND demand_type = 'course'`)
        .run(cd.course_name + ' 推广', cat, cd.course_introduction || cd.course_name, id);
    }
    const updated = req.db.prepare('SELECT * FROM course_demands WHERE id = ?').get(id);
    res.json({ success: true, data: updated, message: '课程需求更新成功' });
  } catch (err) {
    console.error('[' + "routes/demands.js" + ']', err);
    res.status(500).json({ success: false, error: '操作失败，请稍后重试' });
  }
});

// ========== 更新达人需求字段 ==========
router.put('/influencer-demands/:id', (req, res) => {
  try {
    const id = req.params.id;
    const existing = req.db.prepare('SELECT * FROM influencer_demands WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ success: false, error: '达人需求不存在' });
    const fields = ['video_account_name','demand_category','book_name','book_category','book_price_min','book_price_max','course_price_min','course_price_max','description','fans_count','subject_category','status'];
    const jsonFields = new Set(['book_promote_categories','content_formats','cooperation_types']);
    const floatFields = new Set(['book_price_min','book_price_max','course_price_min','course_price_max']);
    const intFields = new Set(['fans_count']);
    const updates = [], params = [];
    for (const f of [...fields, ...jsonFields]) {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = ?`);
        if (jsonFields.has(f)) params.push(Array.isArray(req.body[f]) ? JSON.stringify(req.body[f]) : (req.body[f] || null));
        else if (floatFields.has(f)) params.push(parseFloat(req.body[f]) || 0);
        else if (intFields.has(f)) params.push(parseInt(req.body[f]) || 0);
        else params.push(req.body[f]);
      }
    }
    if (updates.length === 0) return res.status(400).json({ success: false, error: '没有需要更新的字段' });
    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);
    req.db.prepare(`UPDATE influencer_demands SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    const updated = req.db.prepare('SELECT * FROM influencer_demands WHERE id = ?').get(id);
    res.json({ success: true, data: updated, message: '达人需求更新成功' });
  } catch (err) {
    console.error('[' + "routes/demands.js" + ']', err);
    res.status(500).json({ success: false, error: '操作失败，请稍后重试' });
  }
});

// ========== 需求广场统一接口（V3）==========
// 按当前用户角色自动过滤：
// - admin: 看所有（商家需求 + 达人需求 + admin代发）
// - merchant: 看达人需求 + admin代发的需求（不含其他商家的）
// - influencer: 看商家需求 + admin代发的需求（不含其他达人的）
router.get('/plaza', (req, res) => {
  try {
    const role = req.user.role;
    const userId = req.user.id;
    const { keyword, page, pageSize, source, type, demand_type, category } = req.query;
    const currentPage = parseInt(page) || 1;
    const size = parseInt(pageSize) || 20;

    // V4.1 type 维度：merchant_demand / influencer_demand / 空(全部)
    const wantMerchant = !type || type === 'merchant_demand';
    const wantInfluencer = !type || type === 'influencer_demand';

    // 三方来源统一结构：
    // source_type: 'merchant' | 'influencer' | 'admin'
    // 从 demands 表取（商家或 admin 发布）
    let merchantRows = [];
    let influencerRows = [];

    // 需求1：商家 / admin 发布的需求（来自 demands 表）
    if (wantMerchant && (role !== 'merchant' || source === 'all')) {
      // admin/influencer 看 demands 表：
      //   admin 看全部；influencer 看 publisher_role 为 merchant 或 admin 的
      let sql = `
        SELECT d.id, d.title, d.category, d.demand_type, d.platform, d.budget_min, d.budget_max,
          d.fans_requirement, d.cooperation_type, d.description, d.deadline, d.created_at,
          d.publisher_role, d.merchant_id, d.ref_demand_id,
          COALESCE(bd.pinned_at, cd.pinned_at) as pinned_at,
          COALESCE(bd.images, cd.images) as images,
          bd.book_name, bd.book_category, bd.selling_price, bd.pure_commission, bd.ad_commission,
          bd.specification, bd.book_introduction, bd.selling_points, bd.target_audience, bd.stock,
          cd.course_name, cd.unit_price, cd.grade_level, cd.subject, cd.course_introduction,
          cd.pure_commission as course_pure_commission, cd.ad_commission as course_ad_commission,
          m.company as merchant_company, m.industry as merchant_industry,
          'merchant_or_admin' as source_kind
        FROM demands d
        LEFT JOIN merchants m ON d.merchant_id = m.id
        LEFT JOIN book_demands bd ON d.ref_demand_id = bd.id AND d.demand_type = 'book'
        LEFT JOIN course_demands cd ON d.ref_demand_id = cd.id AND d.demand_type = 'course'
        WHERE d.status = 'published'
      `;
      const params = [];
      if (role === 'influencer') {
        sql += " AND d.publisher_role IN ('merchant', 'admin')";
      }
      if (keyword) { sql += ' AND (d.title LIKE ? OR d.description LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`); }
      // V4.1 商品品类（demand_type）过滤
      if (demand_type && (demand_type === 'book' || demand_type === 'course')) {
        sql += ' AND d.demand_type = ?'; params.push(demand_type);
      }
      // V4.1 类目（category）过滤
      if (category) { sql += ' AND d.category = ?'; params.push(category); }
      // V4: 置顶优先
      sql += " ORDER BY CASE WHEN COALESCE(bd.pinned_at, cd.pinned_at) IS NULL THEN 1 ELSE 0 END, COALESCE(bd.pinned_at, cd.pinned_at) DESC, d.created_at DESC";
      merchantRows = req.db.prepare(sql).all(...params);
    } else if (wantMerchant) {
      // merchant 视角：仅 admin 发布的 demands（不看其他商家）
      let sql = `
        SELECT d.id, d.title, d.category, d.demand_type, d.platform, d.budget_min, d.budget_max,
          d.fans_requirement, d.cooperation_type, d.description, d.deadline, d.created_at,
          d.publisher_role, d.merchant_id, d.ref_demand_id,
          COALESCE(bd.pinned_at, cd.pinned_at) as pinned_at,
          COALESCE(bd.images, cd.images) as images,
          bd.book_name, bd.book_category, bd.selling_price, bd.pure_commission, bd.ad_commission,
          bd.specification, bd.book_introduction, bd.selling_points, bd.target_audience, bd.stock,
          cd.course_name, cd.unit_price, cd.grade_level, cd.subject, cd.course_introduction,
          cd.pure_commission as course_pure_commission, cd.ad_commission as course_ad_commission,
          m.company as merchant_company, m.industry as merchant_industry,
          'merchant_or_admin' as source_kind
        FROM demands d
        LEFT JOIN merchants m ON d.merchant_id = m.id
        LEFT JOIN book_demands bd ON d.ref_demand_id = bd.id AND d.demand_type = 'book'
        LEFT JOIN course_demands cd ON d.ref_demand_id = cd.id AND d.demand_type = 'course'
        WHERE d.status = 'published' AND d.publisher_role = 'admin'
      `;
      const params = [];
      if (keyword) { sql += ' AND (d.title LIKE ? OR d.description LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`); }
      if (demand_type && (demand_type === 'book' || demand_type === 'course')) {
        sql += ' AND d.demand_type = ?'; params.push(demand_type);
      }
      if (category) { sql += ' AND d.category = ?'; params.push(category); }
      sql += " ORDER BY CASE WHEN COALESCE(bd.pinned_at, cd.pinned_at) IS NULL THEN 1 ELSE 0 END, COALESCE(bd.pinned_at, cd.pinned_at) DESC, d.created_at DESC";
      merchantRows = req.db.prepare(sql).all(...params);
    }

    // 需求2：达人发布的需求（来自 influencer_demands 表）
    if (wantInfluencer && role !== 'influencer') {
      // admin 和 merchant 都看得到所有达人发布
      let sql = `
        SELECT id_tbl.id, id_tbl.influencer_id, id_tbl.video_account_name, id_tbl.demand_category,
          id_tbl.description, id_tbl.fans_count, id_tbl.book_promote_categories,
          id_tbl.content_formats, id_tbl.cooperation_types, id_tbl.created_at, id_tbl.pinned_at,
          inf.level, inf.video_category_track, inf.region, inf.has_mcn,
          'influencer' as source_kind
        FROM influencer_demands id_tbl
        LEFT JOIN influencers inf ON id_tbl.influencer_id = inf.id
        WHERE id_tbl.status = 'published'
      `;
      const params = [];
      if (keyword) { sql += ' AND (id_tbl.video_account_name LIKE ? OR id_tbl.description LIKE ?)'; params.push(`%${keyword}%`, `%${keyword}%`); }
      // V4.1 类目筛选（达人需求按 demand_category 过滤）
      if (category) { sql += ' AND id_tbl.demand_category = ?'; params.push(category); }
      // V4: 置顶优先
      sql += ' ORDER BY CASE WHEN id_tbl.pinned_at IS NULL THEN 1 ELSE 0 END, id_tbl.pinned_at DESC, id_tbl.created_at DESC';
      influencerRows = req.db.prepare(sql).all(...params);
    }

    // 合并 + 置顶优先 + 创建时间倒序 + 分页
    const merged = [
      ...merchantRows.map(r => ({
        type: 'merchant_demand',
        id: r.id,
        title: r.title,
        category: r.category,
        description: r.description,
        publisher_role: r.publisher_role,
        publisher_label: r.publisher_role === 'admin' ? '腾讯营销' : (r.merchant_company || '商家'),
        budget_min: r.budget_min,
        budget_max: r.budget_max,
        fans_requirement: r.fans_requirement,
        cooperation_type: r.cooperation_type,
        deadline: r.deadline,
        merchant_id: r.merchant_id,
        ref_demand_id: r.ref_demand_id,
        demand_type: r.demand_type,
        pinned_at: r.pinned_at,
        images: r.images,
        // V5: 透出图书/课程子表字段，前端广场卡片直接展示价格/佣金/具体名等
        book_name: r.book_name,
        book_category: r.book_category,
        selling_price: r.selling_price,
        pure_commission: r.pure_commission,
        ad_commission: r.ad_commission,
        specification: r.specification,
        book_introduction: r.book_introduction,
        selling_points: r.selling_points,
        target_audience: r.target_audience,
        stock: r.stock,
        course_name: r.course_name,
        unit_price: r.unit_price,
        grade_level: r.grade_level,
        subject: r.subject,
        course_introduction: r.course_introduction,
        course_pure_commission: r.course_pure_commission,
        course_ad_commission: r.course_ad_commission,
        merchant_company: r.merchant_company,
        created_at: r.created_at,
      })),
      ...influencerRows.map(r => ({
        type: 'influencer_demand',
        id: r.id,
        title: r.video_account_name + ' · 带货意向',
        category: r.demand_category,
        description: r.description,
        publisher_role: 'influencer',
        publisher_label: r.video_account_name || '达人',
        level: r.level,
        fans_count: r.fans_count,
        region: r.region,
        book_promote_categories: r.book_promote_categories,
        content_formats: r.content_formats,
        cooperation_types: r.cooperation_types,
        influencer_id: r.influencer_id,
        pinned_at: r.pinned_at,
        created_at: r.created_at,
      }))
    ].sort((a, b) => {
      // 置顶优先：有 pinned_at 的排前
      const ap = a.pinned_at ? 1 : 0;
      const bp = b.pinned_at ? 1 : 0;
      if (ap !== bp) return bp - ap;
      if (ap) return new Date(b.pinned_at) - new Date(a.pinned_at);
      return new Date(b.created_at) - new Date(a.created_at);
    });

    const total = merged.length;
    const offset = (currentPage - 1) * size;
    const pageData = merged.slice(offset, offset + size);

    res.json({
      success: true,
      data: pageData,
      pagination: { page: currentPage, pageSize: size, total, totalPages: Math.ceil(total / size) }
    });
  } catch (err) {
    console.error('[' + "routes/demands.js" + ']', err);
    res.status(500).json({ success: false, error: '操作失败，请稍后重试' });
  }
});

// 兼容旧版：/merchant-plaza 重定向到 /plaza
router.get('/merchant-plaza', (req, res) => {
  req.url = '/plaza' + (req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '');
  router.handle(req, res);
});

// ========== V4 置顶 / 下架 / 复制 ==========

// 置顶限额：商家广场 5 + 达人广场 5（独立计算）
const PIN_LIMIT_MERCHANT = 5;
const PIN_LIMIT_INFLUENCER = 5;

// ⚠️ 注意：达人需求路由必须注册在通配 /:type/:id/... 之前，
//    否则 Express 会把 'influencer-demands' 匹配成 :type 参数，
//    落到商家 pin/unpin 里报 "type 必须是 book 或 course"（V4.1 发现并修复）。

// 达人需求置顶（管理员）
router.put('/influencer-demands/:id/pin', (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, error: '仅管理员可置顶' });
    const { id } = req.params;
    const cnt = req.db.prepare('SELECT COUNT(*) as c FROM influencer_demands WHERE pinned_at IS NOT NULL').get().c;
    const cur = req.db.prepare('SELECT pinned_at FROM influencer_demands WHERE id = ?').get(id);
    if (!cur) return res.status(404).json({ success: false, error: '需求不存在' });
    if (cur.pinned_at) return res.json({ success: true, message: '已经置顶', data: { already: true } });
    if (cnt >= PIN_LIMIT_INFLUENCER) {
      return res.status(400).json({ success: false, error: `达人需求广场最多置顶 ${PIN_LIMIT_INFLUENCER} 条，请先取消其它置顶` });
    }
    req.db.prepare("UPDATE influencer_demands SET pinned_at = datetime('now') WHERE id = ?").run(id);
    res.json({ success: true, message: '置顶成功' });
  } catch (err) {
    console.error('[' + "routes/demands.js" + ']', err);
    res.status(500).json({ success: false, error: '操作失败，请稍后重试' });
  }
});

router.put('/influencer-demands/:id/unpin', (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, error: '仅管理员可操作' });
    req.db.prepare('UPDATE influencer_demands SET pinned_at = NULL WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: '已取消置顶' });
  } catch (err) {
    console.error('[' + "routes/demands.js" + ']', err);
    res.status(500).json({ success: false, error: '操作失败，请稍后重试' });
  }
});

// 商家需求置顶（管理员）
// PUT /api/demands/:type/:id/pin   type=book|course
router.put('/:type/:id/pin', (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, error: '仅管理员可置顶' });
    const { type, id } = req.params;
    if (!['book', 'course'].includes(type)) return res.status(400).json({ success: false, error: 'type 必须是 book 或 course' });
    const tbl = type === 'book' ? 'book_demands' : 'course_demands';

    // 检查总置顶数（商家广场 = book_demands + course_demands 联合）
    const cnt = req.db.prepare("SELECT (SELECT COUNT(*) FROM book_demands WHERE pinned_at IS NOT NULL) + (SELECT COUNT(*) FROM course_demands WHERE pinned_at IS NOT NULL) as c").get().c;
    // 检查当前是否已置顶
    const cur = req.db.prepare(`SELECT pinned_at FROM ${tbl} WHERE id = ?`).get(id);
    if (!cur) return res.status(404).json({ success: false, error: '需求不存在' });
    if (cur.pinned_at) return res.json({ success: true, message: '已经处于置顶状态', data: { already: true } });
    if (cnt >= PIN_LIMIT_MERCHANT) {
      return res.status(400).json({ success: false, error: `商家需求广场最多置顶 ${PIN_LIMIT_MERCHANT} 条，请先取消其它置顶` });
    }

    req.db.prepare(`UPDATE ${tbl} SET pinned_at = datetime('now') WHERE id = ?`).run(id);
    res.json({ success: true, message: '置顶成功' });
  } catch (err) {
    console.error('[demands/pin]', err);
    res.status(500).json({ success: false, error: '操作失败，请稍后重试' });
  }
});

// 商家需求取消置顶
router.put('/:type/:id/unpin', (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, error: '仅管理员可操作' });
    const { type, id } = req.params;
    if (!['book', 'course'].includes(type)) return res.status(400).json({ success: false, error: 'type 必须是 book 或 course' });
    const tbl = type === 'book' ? 'book_demands' : 'course_demands';
    req.db.prepare(`UPDATE ${tbl} SET pinned_at = NULL WHERE id = ?`).run(id);
    res.json({ success: true, message: '已取消置顶' });
  } catch (err) {
    console.error('[' + "routes/demands.js" + ']', err);
    res.status(500).json({ success: false, error: '操作失败，请稍后重试' });
  }
});

// ========== 下架（archive）==========
// PUT /api/demands/:type/:id/archive    type=book|course|influencer
router.put('/:type/:id/archive', (req, res) => {
  try {
    const { type, id } = req.params;
    if (!['book', 'course', 'influencer'].includes(type)) {
      return res.status(400).json({ success: false, error: 'type 必须是 book/course/influencer' });
    }
    const tbl = type === 'book' ? 'book_demands' : type === 'course' ? 'course_demands' : 'influencer_demands';
    req.db.prepare(`UPDATE ${tbl} SET status = 'archived', updated_at = datetime('now') WHERE id = ?`).run(id);
    // 同步把 demands 壳子表 archive 掉（仅商家需求）
    if (type === 'book' || type === 'course') {
      try {
        req.db.prepare(`UPDATE demands SET status = 'archived' WHERE ref_demand_id = ? AND demand_type = ?`).run(id, type);
      } catch (e) {}
    }
    res.json({ success: true, message: '已下架' });
  } catch (err) {
    console.error('[demands/archive]', err);
    res.status(500).json({ success: false, error: '操作失败，请稍后重试' });
  }
});

// 上架（恢复）
router.put('/:type/:id/unarchive', (req, res) => {
  try {
    const { type, id } = req.params;
    if (!['book', 'course', 'influencer'].includes(type)) {
      return res.status(400).json({ success: false, error: 'type 必须是 book/course/influencer' });
    }
    const tbl = type === 'book' ? 'book_demands' : type === 'course' ? 'course_demands' : 'influencer_demands';
    req.db.prepare(`UPDATE ${tbl} SET status = 'published', updated_at = datetime('now') WHERE id = ?`).run(id);
    if (type === 'book' || type === 'course') {
      try {
        req.db.prepare(`UPDATE demands SET status = 'published' WHERE ref_demand_id = ? AND demand_type = ?`).run(id, type);
      } catch (e) {}
    }
    res.json({ success: true, message: '已恢复上架' });
  } catch (err) {
    console.error('[' + "routes/demands.js" + ']', err);
    res.status(500).json({ success: false, error: '操作失败，请稍后重试' });
  }
});

// 复制（duplicate）— 复制为新需求并置为 published
router.post('/:type/:id/duplicate', (req, res) => {
  try {
    const { type, id } = req.params;
    if (!['book', 'course', 'influencer'].includes(type)) {
      return res.status(400).json({ success: false, error: 'type 必须是 book/course/influencer' });
    }
    const tbl = type === 'book' ? 'book_demands' : type === 'course' ? 'course_demands' : 'influencer_demands';
    const src = req.db.prepare(`SELECT * FROM ${tbl} WHERE id = ?`).get(id);
    if (!src) return res.status(404).json({ success: false, error: '原需求不存在' });

    const { v4: uuidv4 } = require('uuid');
    const newId = uuidv4();

    // 取所有列除去自动管理的字段
    const skipFields = new Set(['id', 'created_at', 'updated_at', 'pinned_at']);
    const cols = Object.keys(src).filter(k => !skipFields.has(k));

    // 强制 status='published'
    const colValues = cols.map(k => k === 'status' ? 'published' : src[k]);

    const insertCols = ['id', ...cols, 'created_at', 'updated_at'].join(',');
    const insertPlaceholders = ['?', ...cols.map(() => '?'), "datetime('now')", "datetime('now')"].join(',');
    const sql = `INSERT INTO ${tbl} (${insertCols}) VALUES (${insertPlaceholders})`;
    req.db.prepare(sql).run(newId, ...colValues);

    res.status(201).json({ success: true, message: '复制成功', data: { id: newId } });
  } catch (err) {
    console.error('[demands/duplicate]', err);
    res.status(500).json({ success: false, error: '操作失败，请稍后重试' });
  }
});

module.exports = router;
