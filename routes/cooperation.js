const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

// ===== 工具：从 cooperation 孵化 matchmaking =====
// 在 cooperation 被 confirm 时调用。同一对 (merchant, influencer) 若已存在未关闭的撮合则不重复建。
// 返回 { incubated: bool, matchmaking_id }
function incubateMatchmakingFromCooperation(db, coop) {
  if (!coop || !coop.merchant_id || !coop.influencer_id) {
    return { incubated: false };
  }
  // 已存在尚未"开始合作"的撮合 → 不重复建，仅追加历史
  const existing = db.prepare(`
    SELECT id FROM matchmaking
    WHERE merchant_id = ? AND influencer_id = ?
      AND stage IN ('需求发布','合作匹配','样品寄送')
    ORDER BY updated_at DESC LIMIT 1
  `).get(coop.merchant_id, coop.influencer_id);

  const sourceType = coop.initiative === 'merchant' ? '邀约转化' : '申请转化';
  const sourceLabel = coop.initiative === 'merchant' ? '商家邀约' : '达人申请';

  if (existing) {
    db.prepare(`
      INSERT INTO matchmaking_history (id, matchmaking_id, stage, operator, notes, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(uuidv4(), existing.id, '合作匹配', '系统', `${sourceLabel} cooperation#${coop.id.slice(0,8)} 已确认，沿用现有撮合`);
    // 回填 cooperation_id（若之前是手动建的，没记 cooperation 来源）
    db.prepare(`UPDATE matchmaking SET cooperation_id = COALESCE(cooperation_id, ?) WHERE id = ?`).run(coop.id, existing.id);
    return { incubated: false, matchmaking_id: existing.id, reused: true };
  }

  const id = uuidv4();
  db.prepare(`
    INSERT INTO matchmaking
      (id, merchant_id, influencer_id, demand_id, demand_type, source, source_type, cooperation_id,
       stage, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(
    id,
    coop.merchant_id,
    coop.influencer_id,
    coop.demand_id || null,
    coop.demand_type || null,
    sourceLabel,
    sourceType,
    coop.id,
    '合作匹配',
    coop.message ? `来自${sourceLabel}：${coop.message}` : `自动孵化自${sourceLabel}`
  );
  db.prepare(`
    INSERT INTO matchmaking_history (id, matchmaking_id, stage, operator, notes, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).run(uuidv4(), id, '合作匹配', '系统', `${sourceLabel}确认 → 自动孵化撮合工单`);
  return { incubated: true, matchmaking_id: id };
}

// ===== 合作邀约/带货申请 =====

// 发起合作邀约（商家邀请达人）
router.post('/invite', (req, res) => {
  try {
    const { merchant_id, influencer_id, demand_id, demand_type, message } = req.body;
    if (!merchant_id || !influencer_id) {
      return res.status(400).json({ success: false, error: '商家ID和达人ID为必填' });
    }
    const id = uuidv4();
    req.db.prepare(`
      INSERT INTO cooperation (id, merchant_id, influencer_id, demand_id, demand_type, initiative, status, message, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'merchant', 'pending', ?, datetime('now'), datetime('now'))
    `).run(id, merchant_id, influencer_id, demand_id || null, demand_type || 'invite', message || '');
    res.status(201).json({ success: true, message: '邀请已发送', data: { id } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 达人发起带货申请
router.post('/apply', (req, res) => {
  try {
    const { influencer_id, merchant_id, demand_id, demand_type, message } = req.body;
    if (!influencer_id || !merchant_id) {
      return res.status(400).json({ success: false, error: '达人ID和商家ID为必填' });
    }
    // 检查是否已存在相同的申请
    const existing = req.db.prepare('SELECT id FROM cooperation WHERE influencer_id = ? AND demand_id = ? AND initiative = ?').get(influencer_id, demand_id, 'influencer');
    if (existing) {
      return res.status(400).json({ success: false, error: '已发起过带货申请' });
    }
    const id = uuidv4();
    req.db.prepare(`
      INSERT INTO cooperation (id, merchant_id, influencer_id, demand_id, demand_type, initiative, status, message, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'influencer', 'pending', ?, datetime('now'), datetime('now'))
    `).run(id, merchant_id, influencer_id, demand_id || null, demand_type || 'apply', message || '');
    res.status(201).json({ success: true, message: '带货申请已发送', data: { id } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 确认合作（接受邀约/申请）→ 自动孵化一条 matchmaking 撮合工单
router.put('/confirm/:id', (req, res) => {
  try {
    const { id } = req.params;
    const coop = req.db.prepare('SELECT * FROM cooperation WHERE id = ?').get(id);
    if (!coop) return res.status(404).json({ success: false, error: '合作记录不存在' });
    if (coop.status === 'confirmed') {
      return res.json({ success: true, message: '已确认过，无需重复操作' });
    }
    req.db.prepare("UPDATE cooperation SET status = 'confirmed', updated_at = datetime('now') WHERE id = ?").run(id);
    // 单向衔接：confirm 后孵化撮合
    let incubateResult = { incubated: false };
    try {
      incubateResult = incubateMatchmakingFromCooperation(req.db, coop);
    } catch (e) {
      console.error('[cooperation/confirm] 孵化撮合失败:', e.message);
    }
    res.json({
      success: true,
      message: incubateResult.incubated ? '已确认合作，撮合工单已自动生成' : (incubateResult.reused ? '已确认合作，沿用既有撮合' : '已确认合作'),
      data: { matchmaking_id: incubateResult.matchmaking_id || null, incubated: !!incubateResult.incubated }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 拒绝合作
router.put('/reject/:id', (req, res) => {
  try {
    const { id } = req.params;
    req.db.prepare("UPDATE cooperation SET status = 'rejected', updated_at = datetime('now') WHERE id = ?").run(id);
    res.json({ success: true, message: '已拒绝合作' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取商家相关的合作记录（发起的邀约 + 收到的带货申请）
router.get('/merchant/:merchantId', (req, res) => {
  try {
    const { merchantId } = req.params;
    const { type } = req.query; // 'sent' or 'received'
    
    let data;
    if (type === 'sent') {
      // 商家发出的邀约
      data = req.db.prepare(`
        SELECT c.*, inf.video_account_name, inf.level, inf.fans_count, inf.video_category_track,
          inf.cooperation_type as inf_cooperation_type, inf.book_willingness, inf.course_willingness
        FROM cooperation c
        LEFT JOIN influencers inf ON c.influencer_id = inf.id
        WHERE c.merchant_id = ? AND c.initiative = 'merchant'
        ORDER BY c.created_at DESC
      `).all(merchantId);
    } else if (type === 'received') {
      // 商家收到的带货申请
      data = req.db.prepare(`
        SELECT c.*, inf.video_account_name, inf.level, inf.fans_count, inf.video_category_track,
          inf.cooperation_type as inf_cooperation_type, inf.book_willingness, inf.course_willingness
        FROM cooperation c
        LEFT JOIN influencers inf ON c.influencer_id = inf.id
        WHERE c.merchant_id = ? AND c.initiative = 'influencer'
        ORDER BY c.created_at DESC
      `).all(merchantId);
    } else {
      // 所有
      data = req.db.prepare(`
        SELECT c.*, inf.video_account_name, inf.level, inf.fans_count, inf.video_category_track,
          inf.cooperation_type as inf_cooperation_type, inf.book_willingness, inf.course_willingness
        FROM cooperation c
        LEFT JOIN influencers inf ON c.influencer_id = inf.id
        WHERE c.merchant_id = ?
        ORDER BY c.created_at DESC
      `).all(merchantId);
    }
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取达人相关的合作记录（发起的带货申请 + 收到的邀约）
router.get('/influencer/:influencerId', (req, res) => {
  try {
    const { influencerId } = req.params;
    const { type } = req.query;
    
    let data;
    if (type === 'sent') {
      // 达人发出的带货申请
      data = req.db.prepare(`
        SELECT c.*, m.name as merchant_name, m.company as merchant_company,
          d.title as demand_title, d.category as demand_category, d.demand_type as d_demand_type
        FROM cooperation c
        LEFT JOIN merchants m ON c.merchant_id = m.id
        LEFT JOIN demands d ON c.demand_id = d.id
        WHERE c.influencer_id = ? AND c.initiative = 'influencer'
        ORDER BY c.created_at DESC
      `).all(influencerId);
    } else if (type === 'received') {
      // 达人收到的邀约
      data = req.db.prepare(`
        SELECT c.*, m.name as merchant_name, m.company as merchant_company,
          d.title as demand_title, d.category as demand_category, d.demand_type as d_demand_type
        FROM cooperation c
        LEFT JOIN merchants m ON c.merchant_id = m.id
        LEFT JOIN demands d ON c.demand_id = d.id
        WHERE c.influencer_id = ? AND c.initiative = 'merchant'
        ORDER BY c.created_at DESC
      `).all(influencerId);
    } else {
      data = req.db.prepare(`
        SELECT c.*, m.name as merchant_name, m.company as merchant_company,
          d.title as demand_title, d.category as demand_category, d.demand_type as d_demand_type
        FROM cooperation c
        LEFT JOIN merchants m ON c.merchant_id = m.id
        LEFT JOIN demands d ON c.demand_id = d.id
        WHERE c.influencer_id = ?
        ORDER BY c.created_at DESC
      `).all(influencerId);
    }
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== 撮合管理（管理员） =====

// 公共：matchmaking 多源 demand 反查 SQL 片段
// 同一个 mm.demand_id 可能落在以下任一表（取决于业务场景）：
//   - demands             商家货盘壳子表（title 通常是"xxx 推广"）
//   - book_demands        图书需求（book_name）
//   - course_demands      课程需求（course_name）
//   - influencer_demands  达人货盘需求（book_name）
//   - merchant_recruitments 商家招募（title）
// 用 COALESCE 串起来按优先级取第一个非空，再用 product_name 兜底
const MM_DEMAND_JOINS = `
  LEFT JOIN demands d                 ON mm.demand_id = d.id
  LEFT JOIN book_demands bd           ON mm.demand_id = bd.id
  LEFT JOIN course_demands cd         ON mm.demand_id = cd.id
  LEFT JOIN influencer_demands id_t   ON mm.demand_id = id_t.id
  LEFT JOIN merchant_recruitments mr  ON mm.demand_id = mr.id
`;
const MM_DEMAND_TITLE_EXPR = `
  COALESCE(
    NULLIF(d.title, ''),
    NULLIF(bd.book_name, ''),
    NULLIF(cd.course_name, ''),
    NULLIF(id_t.book_name, ''),
    NULLIF(mr.title, ''),
    NULLIF(mm.product_name, '')
  )
`;
// demand 来源类别（虚拟列）：标记 demand_id 落在哪张表
const MM_DEMAND_KIND_EXPR = `
  CASE
    WHEN bd.id IS NOT NULL THEN '图书货盘'
    WHEN cd.id IS NOT NULL THEN '课程货盘'
    WHEN id_t.id IS NOT NULL THEN '达人需求'
    WHEN mr.id IS NOT NULL THEN '商家招募'
    WHEN d.id IS NOT NULL THEN '商家货盘'
    ELSE NULL
  END
`;

// 获取所有撮合记录（含环节进展）
router.get('/matchmaking', (req, res) => {
  try {
    const { stage, keyword, source_type, only_upgrade, page, pageSize, operator_id, sales_owner_id } = req.query;

    let sql = `
      SELECT mm.*,
        m.name as merchant_name, m.company as merchant_company, m.sales_owner_id as m_sales_owner_id,
        COALESCE(NULLIF(inf.video_account_name, ''), NULLIF(mm.influencer_account, '')) as video_account_name,
        inf.level as inf_level, inf.sales_owner_id as inf_sales_owner_id,
        ${MM_DEMAND_TITLE_EXPR} as demand_title,
        ${MM_DEMAND_KIND_EXPR} as demand_kind,
        d.demand_type as d_type, d.category as d_category
      FROM matchmaking mm
      LEFT JOIN merchants m ON mm.merchant_id = m.id
      LEFT JOIN influencers inf ON mm.influencer_id = inf.id
      ${MM_DEMAND_JOINS}
      WHERE 1=1
    `;
    let countSql = `
      SELECT COUNT(*) as total FROM matchmaking mm
      LEFT JOIN merchants m ON mm.merchant_id = m.id
      LEFT JOIN influencers inf ON mm.influencer_id = inf.id
      ${MM_DEMAND_JOINS}
      WHERE 1=1
    `;
    const params = [];
    const countParams = [];

    if (sales_owner_id) {
      const salesFilter = ` AND ((m.sales_owner_id = ? OR m.sales_owner_id IS NULL OR m.sales_owner_id = '') OR (inf.sales_owner_id = ? OR inf.sales_owner_id IS NULL OR inf.sales_owner_id = ''))`;
      sql += salesFilter; countSql += salesFilter;
      params.push(sales_owner_id, sales_owner_id); countParams.push(sales_owner_id, sales_owner_id);
    } else if (operator_id) {
      sql += ' AND mm.operator_id = ?'; countSql += ' AND mm.operator_id = ?';
      params.push(operator_id); countParams.push(operator_id);
    }
    if (stage) {
      sql += ' AND mm.stage = ?'; countSql += ' AND mm.stage = ?';
      params.push(stage); countParams.push(stage);
    }
    if (source_type) {
      sql += ' AND mm.source_type = ?'; countSql += ' AND mm.source_type = ?';
      params.push(source_type); countParams.push(source_type);
    }
    if (only_upgrade === '1' || only_upgrade === 'true') {
      // 仅看升级佣金高于原佣金的撮合
      const upgradeFilter = ' AND mm.upgrade_commission_rate IS NOT NULL AND mm.commission_rate IS NOT NULL AND CAST(mm.upgrade_commission_rate AS REAL) > CAST(mm.commission_rate AS REAL)';
      sql += upgradeFilter; countSql += upgradeFilter;
    }
    if (keyword) {
      const kw = `%${keyword}%`;
      // 关键字搜索：商家公司 / 达人账号 / 多源 demand 标题 / 来源 / 商品名
      const kwClause = ` AND (
        m.company LIKE ? OR inf.video_account_name LIKE ?
        OR d.title LIKE ? OR bd.book_name LIKE ? OR cd.course_name LIKE ?
        OR id_t.book_name LIKE ? OR mr.title LIKE ?
        OR mm.source LIKE ? OR mm.product_name LIKE ?
      )`;
      sql += kwClause; countSql += kwClause;
      const kwArr = [kw, kw, kw, kw, kw, kw, kw, kw, kw];
      params.push(...kwArr); countParams.push(...kwArr);
    }

    sql += ' ORDER BY mm.updated_at DESC';

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

// 获取撮合统计
router.get('/matchmaking/stats', (req, res) => {
  try {
    const { operator_id, sales_owner_id, source_type, only_upgrade } = req.query;

    let whereClause = '';
    let joinClause = '';
    const opParams = [];

    if (sales_owner_id) {
      joinClause = ' LEFT JOIN merchants m ON matchmaking.merchant_id = m.id LEFT JOIN influencers inf ON matchmaking.influencer_id = inf.id';
      whereClause = ` WHERE ((m.sales_owner_id = ? OR m.sales_owner_id IS NULL OR m.sales_owner_id = '') OR (inf.sales_owner_id = ? OR inf.sales_owner_id IS NULL OR inf.sales_owner_id = ''))`;
      opParams.push(sales_owner_id, sales_owner_id);
    } else if (operator_id) {
      whereClause = ' WHERE matchmaking.operator_id = ?';
      opParams.push(operator_id);
    }
    if (source_type) {
      whereClause += (whereClause ? ' AND ' : ' WHERE ') + 'matchmaking.source_type = ?';
      opParams.push(source_type);
    }
    if (only_upgrade === '1' || only_upgrade === 'true') {
      whereClause += (whereClause ? ' AND ' : ' WHERE ') +
        'matchmaking.upgrade_commission_rate IS NOT NULL AND matchmaking.commission_rate IS NOT NULL ' +
        'AND CAST(matchmaking.upgrade_commission_rate AS REAL) > CAST(matchmaking.commission_rate AS REAL)';
    }

    const stages = req.db.prepare(`
      SELECT matchmaking.stage, COUNT(*) as count FROM matchmaking${joinClause}${whereClause} GROUP BY matchmaking.stage
    `).all(...opParams);

    const sources = req.db.prepare(`
      SELECT matchmaking.source, COUNT(*) as count FROM matchmaking${joinClause}${whereClause} GROUP BY matchmaking.source
    `).all(...opParams);

    const sourceTypes = req.db.prepare(`
      SELECT matchmaking.source_type, COUNT(*) as count FROM matchmaking${joinClause}${whereClause} GROUP BY matchmaking.source_type
    `).all(...opParams);

    const total = req.db.prepare(`SELECT COUNT(*) as count FROM matchmaking${joinClause}${whereClause}`).get(...opParams).count;

    // 累计 GMV：仅算 stage='开始合作' 阶段已落地的（其他阶段 GMV 多为预估，不计入）
    const gmvWhere = whereClause ? whereClause + " AND matchmaking.stage = '开始合作'" : " WHERE matchmaking.stage = '开始合作'";
    const gmvRow = req.db.prepare(`
      SELECT COALESCE(SUM(matchmaking.gmv),0) as g, COUNT(*) as c FROM matchmaking${joinClause}${gmvWhere}
    `).get(...opParams);
    const totalGmv = gmvRow.g || 0;
    const dealCount = gmvRow.c || 0;

    res.json({ success: true, data: { stages, sources, sourceTypes, total, totalGmv, dealCount } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 创建新的撮合记录
router.post('/matchmaking', (req, res) => {
  try {
    const {
      merchant_id, influencer_id, demand_id, demand_type, source, stage, notes, operator_id,
      product_name, influencer_account, product_price, cooperation_mode, commission_rate, gmv, matchmaking_time,
      order_count, upgrade_commission_rate
    } = req.body;
    if (!merchant_id || !influencer_id) {
      return res.status(400).json({ success: false, error: '商家和达人为必填' });
    }
    const id = uuidv4();
    // 自动计算 GMV：若提供了商品价格和订单量，则 GMV = 价格 × 订单量；否则使用传入 gmv
    const priceNum = product_price != null && product_price !== '' ? parseFloat(product_price) : null;
    const orderNum = order_count != null && order_count !== '' ? parseInt(order_count) : null;
    let finalGmv = gmv != null && gmv !== '' ? parseFloat(gmv) : null;
    if (priceNum != null && orderNum != null && !isNaN(priceNum) && !isNaN(orderNum)) {
      finalGmv = +(priceNum * orderNum).toFixed(2);
    }
    req.db.prepare(`
      INSERT INTO matchmaking (id, merchant_id, influencer_id, demand_id, demand_type, source, stage, notes, operator_id,
        product_name, influencer_account, product_price, cooperation_mode, commission_rate, gmv, matchmaking_time,
        order_count, upgrade_commission_rate,
        created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      id, merchant_id, influencer_id, demand_id || null, demand_type || '',
      source || '手动创建', stage || '需求发布', notes || '', operator_id || null,
      product_name || null, influencer_account || null,
      priceNum,
      cooperation_mode || null,
      commission_rate != null && commission_rate !== '' ? parseFloat(commission_rate) : null,
      finalGmv,
      matchmaking_time || null,
      orderNum,
      upgrade_commission_rate != null && upgrade_commission_rate !== '' ? parseFloat(upgrade_commission_rate) : null
    );
    
    // 记录阶段历史
    req.db.prepare(`
      INSERT INTO matchmaking_history (id, matchmaking_id, stage, operator, notes, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(uuidv4(), id, stage || '需求发布', '管理员', notes || '手动创建撮合记录');
    
    const record = req.db.prepare(`
      SELECT mm.*, m.name as merchant_name, m.company as merchant_company,
        COALESCE(NULLIF(inf.video_account_name, ''), NULLIF(mm.influencer_account, '')) as video_account_name
      FROM matchmaking mm
      LEFT JOIN merchants m ON mm.merchant_id = m.id
      LEFT JOIN influencers inf ON mm.influencer_id = inf.id
      WHERE mm.id = ?
    `).get(id);
    res.status(201).json({ success: true, data: record, message: '撮合记录创建成功' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 更新撮合环节（流转）
router.put('/matchmaking/:id/stage', (req, res) => {
  try {
    const { id } = req.params;
    const { stage, notes } = req.body;
    if (!stage) return res.status(400).json({ success: false, error: '环节为必填' });
    
    req.db.prepare("UPDATE matchmaking SET stage = ?, notes = COALESCE(?, notes), updated_at = datetime('now') WHERE id = ?")
      .run(stage, notes || null, id);
    
    // 记录历史
    req.db.prepare(`
      INSERT INTO matchmaking_history (id, matchmaking_id, stage, operator, notes, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(uuidv4(), id, stage, '管理员', notes || `流转到${stage}阶段`);
    
    res.json({ success: true, message: `已流转到「${stage}」阶段` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 编辑撮合记录详情
router.put('/matchmaking/:id', (req, res) => {
  try {
    const { id } = req.params;
    const {
      merchant_id, influencer_id, demand_id, source, stage, notes, sample_info, cooperation_details,
      product_name, influencer_account, product_price, cooperation_mode, commission_rate, gmv, matchmaking_time,
      order_count, upgrade_commission_rate
    } = req.body;
    
    const record = req.db.prepare('SELECT * FROM matchmaking WHERE id = ?').get(id);
    if (!record) return res.status(404).json({ success: false, error: '记录不存在' });
    
    // 动态构建更新SQL
    const updates = [];
    const params = [];
    
    if (merchant_id !== undefined) { updates.push('merchant_id = ?'); params.push(merchant_id); }
    if (influencer_id !== undefined) { updates.push('influencer_id = ?'); params.push(influencer_id); }
    if (demand_id !== undefined) { updates.push('demand_id = ?'); params.push(demand_id); }
    if (source !== undefined) { updates.push('source = ?'); params.push(source); }
    if (stage !== undefined) { updates.push('stage = ?'); params.push(stage); }
    if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }
    if (sample_info !== undefined) { updates.push('sample_info = ?'); params.push(sample_info); }
    if (cooperation_details !== undefined) { updates.push('cooperation_details = ?'); params.push(cooperation_details); }
    if (product_name !== undefined) { updates.push('product_name = ?'); params.push(product_name); }
    if (influencer_account !== undefined) { updates.push('influencer_account = ?'); params.push(influencer_account); }
    if (product_price !== undefined) { updates.push('product_price = ?'); params.push(product_price === '' || product_price === null ? null : parseFloat(product_price)); }
    if (cooperation_mode !== undefined) { updates.push('cooperation_mode = ?'); params.push(cooperation_mode); }
    if (commission_rate !== undefined) { updates.push('commission_rate = ?'); params.push(commission_rate === '' || commission_rate === null ? null : parseFloat(commission_rate)); }
    if (order_count !== undefined) { updates.push('order_count = ?'); params.push(order_count === '' || order_count === null ? null : parseInt(order_count)); }
    if (upgrade_commission_rate !== undefined) { updates.push('upgrade_commission_rate = ?'); params.push(upgrade_commission_rate === '' || upgrade_commission_rate === null ? null : parseFloat(upgrade_commission_rate)); }

    // 自动计算 GMV：若 product_price 或 order_count 有变化，按最新值 × 计算
    const priceProvided = product_price !== undefined;
    const orderProvided = order_count !== undefined;
    const gmvProvided = gmv !== undefined;
    if (priceProvided || orderProvided) {
      const newPrice = priceProvided
        ? (product_price === '' || product_price === null ? null : parseFloat(product_price))
        : (record.product_price != null ? parseFloat(record.product_price) : null);
      const newOrder = orderProvided
        ? (order_count === '' || order_count === null ? null : parseInt(order_count))
        : (record.order_count != null ? parseInt(record.order_count) : null);
      if (newPrice != null && newOrder != null && !isNaN(newPrice) && !isNaN(newOrder)) {
        updates.push('gmv = ?');
        params.push(+(newPrice * newOrder).toFixed(2));
      } else if (gmvProvided) {
        updates.push('gmv = ?');
        params.push(gmv === '' || gmv === null ? null : parseFloat(gmv));
      }
    } else if (gmvProvided) {
      updates.push('gmv = ?');
      params.push(gmv === '' || gmv === null ? null : parseFloat(gmv));
    }
    if (matchmaking_time !== undefined) { updates.push('matchmaking_time = ?'); params.push(matchmaking_time || null); }
    
    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: '无更新内容' });
    }
    
    updates.push("updated_at = datetime('now')");
    params.push(id);
    
    req.db.prepare(`UPDATE matchmaking SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    
    // 如果环节变更，记录历史
    if (stage && stage !== record.stage) {
      req.db.prepare(`
        INSERT INTO matchmaking_history (id, matchmaking_id, stage, operator, notes, created_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `).run(uuidv4(), id, stage, '管理员', notes || `更新到${stage}阶段`);
    }
    
    const updated = req.db.prepare(`
      SELECT mm.*, m.name as merchant_name, m.company as merchant_company,
        COALESCE(NULLIF(inf.video_account_name, ''), NULLIF(mm.influencer_account, '')) as video_account_name
      FROM matchmaking mm
      LEFT JOIN merchants m ON mm.merchant_id = m.id
      LEFT JOIN influencers inf ON mm.influencer_id = inf.id
      WHERE mm.id = ?
    `).get(id);
    
    res.json({ success: true, data: updated, message: '撮合记录已更新' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取撮合详情及历史 + 关联的原始 cooperation
router.get('/matchmaking/:id', (req, res) => {
  try {
    const { id } = req.params;
    const record = req.db.prepare(`
      SELECT mm.*, m.name as merchant_name, m.company as merchant_company,
        COALESCE(NULLIF(inf.video_account_name, ''), NULLIF(mm.influencer_account, '')) as video_account_name,
        inf.level as inf_level, inf.fans_count as inf_fans,
        m.sales_owner_id as m_sales_owner_id, inf.sales_owner_id as inf_sales_owner_id,
        inf.sales_owner as inf_sales_owner_text,
        sa_m.name as merchant_sales_owner_name, sa_m.username as merchant_sales_owner_username,
        sa_i.name as influencer_sales_owner_name, sa_i.username as influencer_sales_owner_username,
        ${MM_DEMAND_TITLE_EXPR} as demand_title,
        ${MM_DEMAND_KIND_EXPR} as demand_kind,
        d.demand_type as d_type
      FROM matchmaking mm
      LEFT JOIN merchants m ON mm.merchant_id = m.id
      LEFT JOIN influencers inf ON mm.influencer_id = inf.id
      LEFT JOIN admins sa_m ON m.sales_owner_id = sa_m.id AND sa_m.admin_role = '销售'
      LEFT JOIN admins sa_i ON inf.sales_owner_id = sa_i.id AND sa_i.admin_role = '销售'
      ${MM_DEMAND_JOINS}
      WHERE mm.id = ?
    `).get(id);
    if (!record) return res.status(404).json({ success: false, error: '记录不存在' });

    const history = req.db.prepare(`
      SELECT * FROM matchmaking_history WHERE matchmaking_id = ? ORDER BY created_at ASC
    `).all(id);

    // 反查原始 cooperation（如果是孵化来的）
    let cooperation = null;
    if (record.cooperation_id) {
      cooperation = req.db.prepare(`
        SELECT id, initiative, status, message, created_at, updated_at FROM cooperation WHERE id = ?
      `).get(record.cooperation_id);
    }

    res.json({ success: true, data: { ...record, history, cooperation } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 删除撮合记录
router.delete('/matchmaking/:id', (req, res) => {
  try {
    req.db.prepare('DELETE FROM matchmaking_history WHERE matchmaking_id = ?').run(req.params.id);
    req.db.prepare('DELETE FROM matchmaking WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: '删除成功' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取未读通知数量
// merchant: 收到的待处理带货申请数
// influencer: 收到的待处理邀约数
// admin: 责任范围内"合作匹配"阶段的撮合数（孵化但未推进）
router.get('/notifications/count', (req, res) => {
  try {
    const { user_id, role } = req.query;
    if (!user_id || !role) return res.json({ success: true, data: { count: 0 } });

    let count = 0;
    if (role === 'merchant') {
      count = req.db.prepare("SELECT COUNT(*) as count FROM cooperation WHERE merchant_id = ? AND initiative = 'influencer' AND status = 'pending'").get(user_id).count;
    } else if (role === 'influencer') {
      count = req.db.prepare("SELECT COUNT(*) as count FROM cooperation WHERE influencer_id = ? AND initiative = 'merchant' AND status = 'pending'").get(user_id).count;
    } else if (role === 'admin') {
      // 超管：全平台"合作匹配"撮合数
      // 销售：只看自己归属的商家或达人参与的"合作匹配"撮合
      const admin = req.db.prepare('SELECT id, is_super FROM admins WHERE id = ?').get(user_id);
      if (!admin) return res.json({ success: true, data: { count: 0 } });
      if (admin.is_super) {
        count = req.db.prepare("SELECT COUNT(*) as count FROM matchmaking WHERE stage = '合作匹配'").get().count;
      } else {
        count = req.db.prepare(`
          SELECT COUNT(*) as count FROM matchmaking mm
          LEFT JOIN merchants m ON mm.merchant_id = m.id
          LEFT JOIN influencers inf ON mm.influencer_id = inf.id
          WHERE mm.stage = '合作匹配'
            AND (m.sales_owner_id = ? OR inf.sales_owner_id = ?)
        `).get(user_id, user_id).count;
      }
    }
    res.json({ success: true, data: { count } });
  } catch (err) {
    res.json({ success: true, data: { count: 0 } });
  }
});

// ============ 撮合联想候选接口 ============
// 返回三类候选源:
//   - products: 图书名 + 课程名 + 达人货盘需求的 book_name + 历史撮合 product_name（去重合并）
//   - influencers: 达人列表（video_account_name / official_account_name），供达人账号字段模糊检索
// 支持 q 参数做模糊过滤，limit 限制返回数量
router.get('/matchmaking/suggest/products', (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const like = '%' + q + '%';

    const rows = [];
    // 1. 图书需求
    const books = q
      ? req.db.prepare("SELECT DISTINCT book_name FROM book_demands WHERE book_name IS NOT NULL AND book_name != '' AND book_name LIKE ? LIMIT ?").all(like, limit)
      : req.db.prepare("SELECT DISTINCT book_name FROM book_demands WHERE book_name IS NOT NULL AND book_name != '' LIMIT ?").all(limit);
    books.forEach(b => rows.push({ name: b.book_name, source: '图书需求' }));

    // 2. 课程需求
    const courses = q
      ? req.db.prepare("SELECT DISTINCT course_name FROM course_demands WHERE course_name IS NOT NULL AND course_name != '' AND course_name LIKE ? LIMIT ?").all(like, limit)
      : req.db.prepare("SELECT DISTINCT course_name FROM course_demands WHERE course_name IS NOT NULL AND course_name != '' LIMIT ?").all(limit);
    courses.forEach(c => rows.push({ name: c.course_name, source: '课程需求' }));

    // 3. 达人货盘需求
    try {
      const infDem = q
        ? req.db.prepare("SELECT DISTINCT book_name FROM influencer_demands WHERE book_name IS NOT NULL AND book_name != '' AND book_name LIKE ? LIMIT ?").all(like, limit)
        : req.db.prepare("SELECT DISTINCT book_name FROM influencer_demands WHERE book_name IS NOT NULL AND book_name != '' LIMIT ?").all(limit);
      infDem.forEach(d => rows.push({ name: d.book_name, source: '达人货盘' }));
    } catch (e) { /* 表不存在则跳过 */ }

    // 4. 历史撮合 product_name
    const hist = q
      ? req.db.prepare("SELECT DISTINCT product_name FROM matchmaking WHERE product_name IS NOT NULL AND product_name != '' AND product_name LIKE ? LIMIT ?").all(like, limit)
      : req.db.prepare("SELECT DISTINCT product_name FROM matchmaking WHERE product_name IS NOT NULL AND product_name != '' LIMIT ?").all(limit);
    hist.forEach(h => rows.push({ name: h.product_name, source: '历史撮合' }));

    // 去重：同名优先保留第一个来源
    const seen = new Set();
    const dedup = [];
    for (const r of rows) {
      if (!r.name || seen.has(r.name)) continue;
      seen.add(r.name);
      dedup.push(r);
      if (dedup.length >= limit) break;
    }
    res.json({ success: true, data: dedup });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/matchmaking/suggest/influencers', (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const like = '%' + q + '%';

    const rows = q
      ? req.db.prepare(`
          SELECT id, video_account_name, official_account_name, fans_count, level, region
          FROM influencers
          WHERE (video_account_name LIKE ? OR official_account_name LIKE ?)
          ORDER BY CAST(fans_count AS INTEGER) DESC
          LIMIT ?
        `).all(like, like, limit)
      : req.db.prepare(`
          SELECT id, video_account_name, official_account_name, fans_count, level, region
          FROM influencers
          ORDER BY CAST(fans_count AS INTEGER) DESC
          LIMIT ?
        `).all(limit);

    // 历史已录入的撮合达人账号（字面量文本，可能与 influencers 表外的值不同）
    const hist = q
      ? req.db.prepare("SELECT DISTINCT influencer_account FROM matchmaking WHERE influencer_account IS NOT NULL AND influencer_account != '' AND influencer_account LIKE ? LIMIT 50").all(like)
      : req.db.prepare("SELECT DISTINCT influencer_account FROM matchmaking WHERE influencer_account IS NOT NULL AND influencer_account != '' LIMIT 50").all();

    const list = rows.map(r => ({
      id: r.id,
      name: r.video_account_name || r.official_account_name || '',
      official: r.official_account_name || '',
      fans: r.fans_count || 0,
      level: r.level || '',
      region: r.region || '',
      source: '达人广场'
    })).filter(x => x.name);

    const seenNames = new Set(list.map(x => x.name));
    hist.forEach(h => {
      if (h.influencer_account && !seenNames.has(h.influencer_account)) {
        list.push({ id: '', name: h.influencer_account, source: '历史撮合' });
        seenNames.add(h.influencer_account);
      }
    });

    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
