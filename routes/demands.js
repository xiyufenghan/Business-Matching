const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

// 获取商家需求（支持筛选+搜索+分页）
router.get('/', (req, res) => {
  try {
    const { status, category, demand_type, merchant_id, keyword, page, pageSize, operator_id, sales_owner_id } = req.query;
    let sql = `
      SELECT d.*, m.name as merchant_name, m.company as merchant_company,
        m.sales_owner_id as merchant_sales_owner_id, sa.name as merchant_sales_owner_name,
        bd.book_image, bd.book_merchant, bd.book_name, bd.target_audience as book_target_audience, 
        bd.book_category, bd.product_image, bd.book_introduction, bd.wechat_shop_link, 
        bd.specification, bd.selling_price, bd.pure_commission, bd.ad_commission, bd.logistics, bd.stock,
        cd.course_image, cd.course_name, cd.unit_price, cd.grade_level, cd.subject, cd.course_introduction, cd.course_link
      FROM demands d
      LEFT JOIN merchants m ON d.merchant_id = m.id
      LEFT JOIN admins sa ON m.sales_owner_id = sa.id AND sa.admin_role = '销售'
      LEFT JOIN book_demands bd ON d.ref_demand_id = bd.id AND d.demand_type = 'book'
      LEFT JOIN course_demands cd ON d.ref_demand_id = cd.id AND d.demand_type = 'course'
      WHERE 1=1
    `;
    let countSql = `SELECT COUNT(*) as total FROM demands d LEFT JOIN merchants m ON d.merchant_id = m.id LEFT JOIN book_demands bd ON d.ref_demand_id = bd.id AND d.demand_type = 'book' LEFT JOIN course_demands cd ON d.ref_demand_id = cd.id AND d.demand_type = 'course' WHERE 1=1`;
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
    if (merchant_id) { 
      sql += ' AND d.merchant_id = ?'; countSql += ' AND d.merchant_id = ?';
      params.push(merchant_id); countParams.push(merchant_id); 
    }
    if (keyword) {
      const kw = `%${keyword}%`;
      const kwClause = ' AND (d.title LIKE ? OR d.category LIKE ? OR d.description LIKE ? OR m.company LIKE ? OR bd.book_name LIKE ? OR bd.book_merchant LIKE ? OR cd.course_name LIKE ?)';
      sql += kwClause; countSql += kwClause;
      params.push(kw, kw, kw, kw, kw, kw, kw);
      countParams.push(kw, kw, kw, kw, kw, kw, kw);
    }
    
    sql += ' ORDER BY d.created_at DESC';
    
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
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取达人货盘需求列表（支持搜索+分页）
router.get('/influencer-demands', (req, res) => {
  try {
    const { influencer_id, keyword, page, pageSize, operator_id, sales_owner_id } = req.query;
    let sql = `
      SELECT id_tbl.*, inf.video_account_name as inf_video_account_name, inf.level, inf.fans_count as inf_fans_count, inf.video_category_track, inf.sales_owner_id
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
    res.status(500).json({ success: false, error: err.message });
  }
});

// 创建达人货盘需求（新字段）
router.post('/influencer-demands', (req, res) => {
  try {
    const { influencer_id, video_account_name, demand_category, book_name, book_category, book_price_min, book_price_max, course_price_min, course_price_max, description, fans_count, subject_category, operator_id } = req.body;
    if (!influencer_id) {
      return res.status(400).json({ success: false, error: '达人ID为必填' });
    }
    const id = uuidv4();
    req.db.prepare(`
      INSERT INTO influencer_demands (id, influencer_id, video_account_name, demand_category, book_name, book_category, book_price_min, book_price_max, course_price_min, course_price_max, description, fans_count, subject_category, status, operator_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?)
    `).run(id, influencer_id, video_account_name || '', demand_category || '图书需求', book_name || '', book_category || '', parseFloat(book_price_min) || 0, parseFloat(book_price_max) || 0, parseFloat(course_price_min) || 0, parseFloat(course_price_max) || 0, description || '', parseInt(fans_count) || 0, subject_category || '', operator_id || null);
    
    const demand = req.db.prepare('SELECT * FROM influencer_demands WHERE id = ?').get(id);
    res.status(201).json({ success: true, data: demand, message: '达人需求发布成功' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 删除达人货盘需求
router.delete('/influencer-demands/:id', (req, res) => {
  try {
    req.db.prepare('DELETE FROM influencer_demands WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: '删除成功' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取需求详情（含关联的图书/课程信息）
router.get('/:id', (req, res) => {
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
    res.status(500).json({ success: false, error: err.message });
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
    res.status(500).json({ success: false, error: err.message });
  }
});

// 单条图书需求发布
router.post('/book', (req, res) => {
  try {
    const { merchant_id, book_image, book_merchant, book_name, target_audience, book_category, product_image, book_introduction, wechat_shop_link, specification, selling_price, pure_commission, ad_commission, logistics, stock, operator_id } = req.body;
    if (!merchant_id || !book_name || !book_category || !book_merchant) {
      return res.status(400).json({ success: false, error: '商家ID、图书名称、图书分类、图书商家为必填项' });
    }
    const bookId = uuidv4();
    req.db.prepare(`
      INSERT INTO book_demands (id, merchant_id, book_image, book_merchant, book_name, target_audience, book_category, product_image, book_introduction, wechat_shop_link, specification, selling_price, pure_commission, ad_commission, logistics, stock, operator_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(bookId, merchant_id, book_image || '', book_merchant, book_name, target_audience || '', book_category, product_image || '', book_introduction || '', wechat_shop_link || '', specification || '', parseFloat(selling_price) || 0, parseFloat(pure_commission) || 0, parseFloat(ad_commission) || 0, logistics || '', parseInt(stock) || 0, operator_id || null);
    
    const demandId = uuidv4();
    req.db.prepare(`
      INSERT INTO demands (id, merchant_id, title, demand_type, category, platform, description, status, ref_demand_id, operator_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(demandId, merchant_id, book_name + ' 推广', 'book', book_category.split(',')[0], '视频号', book_introduction || book_name, 'published', bookId, operator_id || null);
    
    res.status(201).json({ success: true, message: '图书需求发布成功' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 单条课程需求发布
router.post('/course', (req, res) => {
  try {
    const { merchant_id, course_image, course_name, unit_price, grade_level, subject, course_introduction, course_link, operator_id } = req.body;
    if (!merchant_id || !course_name) {
      return res.status(400).json({ success: false, error: '商家ID、课程名称为必填项' });
    }
    const courseId = uuidv4();
    req.db.prepare(`
      INSERT INTO course_demands (id, merchant_id, course_image, course_name, unit_price, grade_level, subject, course_introduction, course_link, operator_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(courseId, merchant_id, course_image || '', course_name, parseFloat(unit_price) || 0, grade_level || '', subject || '', course_introduction || '', course_link || '', operator_id || null);
    
    const demandId = uuidv4();
    const category = subject ? subject.split(',')[0] + '课程' : '课程';
    req.db.prepare(`
      INSERT INTO demands (id, merchant_id, title, demand_type, category, platform, description, status, ref_demand_id, operator_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(demandId, merchant_id, course_name + ' 推广', 'course', category, '视频号', course_introduction || course_name, 'published', courseId, operator_id || null);
    
    res.status(201).json({ success: true, message: '课程需求发布成功' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 创建商家需求
router.post('/', (req, res) => {
  try {
    const body = req.body;
    if (Array.isArray(body)) {
      const results = [];
      const insertStmt = req.db.prepare(`
        INSERT INTO demands (id, merchant_id, title, demand_type, category, platform, budget_min, budget_max, fans_requirement, cooperation_type, description, requirements, deadline)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertMany = req.db.transaction((demands) => {
        for (const d of demands) {
          if (!d.merchant_id || !d.title || !d.category) continue;
          const id = uuidv4();
          insertStmt.run(id, d.merchant_id, d.title, d.demand_type || 'book', d.category, '视频号', d.budget_min || 0, d.budget_max || 0, d.fans_requirement || null, d.cooperation_type || null, d.description || null, d.requirements || null, d.deadline || null);
          results.push(id);
        }
      });
      insertMany(body);
      res.status(201).json({ success: true, data: { count: results.length }, message: `成功发布 ${results.length} 条需求` });
    } else {
      const { merchant_id, title, demand_type, category, budget_min, budget_max, fans_requirement, cooperation_type, description, requirements, deadline } = body;
      if (!merchant_id || !title || !category) {
        return res.status(400).json({ success: false, error: '商家ID、标题、类目为必填项' });
      }
      const id = uuidv4();
      req.db.prepare(`
        INSERT INTO demands (id, merchant_id, title, demand_type, category, platform, budget_min, budget_max, fans_requirement, cooperation_type, description, requirements, deadline)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, merchant_id, title, demand_type || 'book', category, '视频号', budget_min || 0, budget_max || 0, fans_requirement || null, cooperation_type || null, description || null, requirements || null, deadline || null);
      const demand = req.db.prepare('SELECT * FROM demands WHERE id = ?').get(id);
      res.status(201).json({ success: true, data: demand });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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
    res.status(500).json({ success: false, error: err.message });
  }
});

// 批量删除商家需求
router.post('/batch-delete', (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: '请提供需要删除的ID列表' });
    }
    const placeholders = ids.map(() => '?').join(',');
    req.db.prepare(`DELETE FROM demands WHERE id IN (${placeholders})`).run(...ids);
    res.json({ success: true, message: `成功删除 ${ids.length} 条需求` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 一键删除所有商家需求
router.delete('/all/clear', (req, res) => {
  try {
    const { merchant_id } = req.query;
    if (merchant_id) {
      req.db.prepare('DELETE FROM demands WHERE merchant_id = ?').run(merchant_id);
    } else {
      req.db.prepare('DELETE FROM demands').run();
    }
    res.json({ success: true, message: '所有需求已清空' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 批量删除达人货盘需求
router.post('/influencer-demands/batch-delete', (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: '请提供需要删除的ID列表' });
    }
    const placeholders = ids.map(() => '?').join(',');
    req.db.prepare(`DELETE FROM influencer_demands WHERE id IN (${placeholders})`).run(...ids);
    res.json({ success: true, message: `成功删除 ${ids.length} 条达人需求` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 一键删除所有达人货盘需求
router.delete('/influencer-demands/all/clear', (req, res) => {
  try {
    const { influencer_id } = req.query;
    if (influencer_id) {
      req.db.prepare('DELETE FROM influencer_demands WHERE influencer_id = ?').run(influencer_id);
    } else {
      req.db.prepare('DELETE FROM influencer_demands').run();
    }
    res.json({ success: true, message: '所有达人需求已清空' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 删除需求
router.delete('/:id', (req, res) => {
  try {
    req.db.prepare('DELETE FROM demands WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: '删除成功' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 更新课程需求字段 ==========
router.put('/course/:id', (req, res) => {
  try {
    const id = req.params.id;
    const existing = req.db.prepare('SELECT * FROM course_demands WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ success: false, error: '课程需求不存在' });
    const fields = ['course_image','course_name','unit_price','grade_level','subject','course_introduction','course_link','status'];
    const numericFields = new Set(['unit_price']);
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
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 更新达人货盘需求字段 ==========
router.put('/influencer-demands/:id', (req, res) => {
  try {
    const id = req.params.id;
    const existing = req.db.prepare('SELECT * FROM influencer_demands WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ success: false, error: '达人需求不存在' });
    const fields = ['video_account_name','demand_category','book_name','book_category','book_price_min','book_price_max','course_price_min','course_price_max','description','fans_count','subject_category','status'];
    const floatFields = new Set(['book_price_min','book_price_max','course_price_min','course_price_max']);
    const intFields = new Set(['fans_count']);
    const updates = [], params = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = ?`);
        if (floatFields.has(f)) params.push(parseFloat(req.body[f]) || 0);
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
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
