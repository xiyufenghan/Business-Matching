const express = require('express');
const router = express.Router();

// =================================================================
// 工具函数
// =================================================================

// 构建权限过滤条件
function buildScope(query) {
  const { operator_id, sales_owner_id } = query;
  const scope = {
    demandWhere: '',  // 用于 demands JOIN merchants 的查询
    demandParams: [],
    coopWhere: '',
    coopParams: [],
    mmWhere: '',
    mmParams: [],
    orderWhere: '',
    orderParams: [],
    infWhere: '',
    infParams: [],
    merchWhere: '',
    merchParams: [],
  };
  if (sales_owner_id) {
    const merchScope = ' AND m.sales_owner_id = ?';
    scope.demandWhere = merchScope; scope.demandParams = [sales_owner_id];
    scope.coopWhere = merchScope; scope.coopParams = [sales_owner_id];
    scope.mmWhere = merchScope; scope.mmParams = [sales_owner_id];
    scope.orderWhere = merchScope; scope.orderParams = [sales_owner_id];
    scope.infWhere = ' AND inf.sales_owner_id = ?'; scope.infParams = [sales_owner_id];
    scope.merchWhere = ' AND m.sales_owner_id = ?'; scope.merchParams = [sales_owner_id];
  } else if (operator_id) {
    scope.demandWhere = ' AND d.operator_id = ?'; scope.demandParams = [operator_id];
    scope.infWhere = ' AND inf.operator_id = ?'; scope.infParams = [operator_id];
  }
  return scope;
}

function parseRange(query) {
  const days = parseInt(query.days) || 30;
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  return {
    days,
    start: start.toISOString().slice(0, 19).replace('T', ' '),
    startDay: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 19).replace('T', ' '),
  };
}

// =================================================================
// 老接口：基础统计 - 兼容
// =================================================================
router.get('/', (req, res) => {
  try {
    const { operator_id, sales_owner_id } = req.query;
    let infFilter = '';
    let demandFilter = '';
    let infDemandFilter = '';
    let infParams = [];
    let demandParams = [];
    let infDemandParams = [];

    if (sales_owner_id) {
      infFilter = ` AND (sales_owner_id = ? OR sales_owner_id IS NULL OR sales_owner_id = '')`;
      infParams = [sales_owner_id];
      demandFilter = ` AND merchant_id IN (SELECT id FROM merchants WHERE sales_owner_id = ? OR sales_owner_id IS NULL OR sales_owner_id = '')`;
      demandParams = [sales_owner_id];
      infDemandFilter = ` AND influencer_id IN (SELECT id FROM influencers WHERE sales_owner_id = ? OR sales_owner_id IS NULL OR sales_owner_id = '')`;
      infDemandParams = [sales_owner_id];
    } else if (operator_id) {
      infFilter = ' AND operator_id = ?'; infParams = [operator_id];
      demandFilter = ' AND operator_id = ?'; demandParams = [operator_id];
      infDemandFilter = ' AND operator_id = ?'; infDemandParams = [operator_id];
    }

    const totalInfluencers = req.db.prepare(`SELECT COUNT(*) as count FROM influencers WHERE 1=1${infFilter}`).get(...infParams).count;
    const totalMerchants = req.db.prepare(
      `SELECT COUNT(*) as count FROM merchants WHERE 1=1${demandFilter ? ' AND id IN (SELECT merchant_id FROM demands WHERE 1=1' + demandFilter + ')' : ''}`
    ).get(...(demandFilter ? demandParams : [])).count;
    const totalAdmins = req.db.prepare('SELECT COUNT(*) as count FROM admins').get().count;
    const merchantDemandCount = req.db.prepare(`SELECT COUNT(*) as count FROM demands WHERE 1=1${demandFilter}`).get(...demandParams).count;
    const influencerDemandCount = req.db.prepare(`SELECT COUNT(*) as count FROM influencer_demands WHERE 1=1${infDemandFilter}`).get(...infDemandParams).count;
    const totalDemands = merchantDemandCount + influencerDemandCount;
    const demandMerchantCount = req.db.prepare(`SELECT COUNT(DISTINCT merchant_id) as count FROM demands WHERE 1=1${demandFilter}`).get(...demandParams).count;
    const demandInfluencerCount = req.db.prepare(`SELECT COUNT(DISTINCT influencer_id) as count FROM influencer_demands WHERE 1=1${infDemandFilter}`).get(...infDemandParams).count;
    const influencerLevelStats = req.db.prepare(`
      SELECT level, COUNT(*) as count FROM influencers WHERE level IS NOT NULL AND level != ''${infFilter} GROUP BY level
    `).all(...infParams);
    const totalOrders = req.db.prepare('SELECT COUNT(*) as count FROM orders').get().count;
    const acceptedOrderCount = req.db.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'accepted'").get().count;
    const pendingCooperationCount = req.db.prepare("SELECT COUNT(*) as count FROM cooperation WHERE status = 'pending'").get().count;
    const totalCooperations = req.db.prepare('SELECT COUNT(*) as count FROM cooperation').get().count;
    const dealRate = totalDemands > 0 ? +((acceptedOrderCount / totalDemands) * 100).toFixed(1) : 0;
    const influencerAcceptRate = merchantDemandCount > 0 ? +((acceptedOrderCount / merchantDemandCount) * 100).toFixed(1) : 0;
    const matchRate = totalCooperations > 0 ? +(((totalCooperations - pendingCooperationCount) / totalCooperations) * 100).toFixed(1) : 0;
    const categoryStats = req.db.prepare(`
      SELECT category, COUNT(*) as count FROM demands WHERE 1=1${demandFilter} GROUP BY category ORDER BY count DESC
    `).all(...demandParams);
    const typeStats = req.db.prepare(`SELECT demand_type, COUNT(*) as count FROM demands WHERE 1=1${demandFilter} GROUP BY demand_type`).all(...demandParams);

    res.json({
      success: true,
      data: {
        totalInfluencers, totalMerchants, totalAdmins,
        influencerLevelStats,
        merchantDemandCount, influencerDemandCount, totalDemands,
        demandMerchantCount, demandInfluencerCount,
        totalOrders, acceptedOrderCount, pendingCooperationCount,
        dealRate, influencerAcceptRate, matchRate,
        categoryStats, typeStats
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// =================================================================
// 1. 看板 KPI 综合数据
// =================================================================
router.get('/dashboard', (req, res) => {
  try {
    const scope = buildScope(req.query);
    const { start, days } = parseRange(req.query);

    // 用户规模
    const merchantCount = req.db.prepare(`SELECT COUNT(*) as c FROM merchants m WHERE m.status != 'deleted'${scope.merchWhere}`).get(...scope.merchParams).c;
    const influencerCount = req.db.prepare(`SELECT COUNT(*) as c FROM influencers inf WHERE 1=1${scope.infWhere}`).get(...scope.infParams).c;
    const adminCount = req.db.prepare(`SELECT COUNT(*) as c FROM admins`).get().c;
    const salesCount = req.db.prepare(`SELECT COUNT(*) as c FROM admins WHERE admin_role='销售'`).get().c;

    // 需求规模
    const totalDemands = req.db.prepare(`SELECT COUNT(*) as c FROM demands d LEFT JOIN merchants m ON d.merchant_id=m.id WHERE 1=1${scope.demandWhere}`).get(...scope.demandParams).c;
    const totalInfDemands = req.db.prepare(`SELECT COUNT(*) as c FROM influencer_demands id_t LEFT JOIN influencers inf ON id_t.influencer_id=inf.id WHERE 1=1${scope.infWhere}`).get(...scope.infParams).c;

    // 本周新增需求
    const thisWeek = new Date(); thisWeek.setDate(thisWeek.getDate() - 7);
    const newDemandsThisWeek = req.db.prepare(`SELECT COUNT(*) as c FROM demands d LEFT JOIN merchants m ON d.merchant_id=m.id WHERE d.created_at >= ?${scope.demandWhere}`).get(thisWeek.toISOString().slice(0,19).replace('T',' '), ...scope.demandParams).c;

    // 撮合 / 合作 / 接单
    const totalMatchmaking = req.db.prepare(`SELECT COUNT(*) as c FROM matchmaking mm LEFT JOIN merchants m ON mm.merchant_id=m.id WHERE 1=1${scope.mmWhere}`).get(...scope.mmParams).c;
    const totalCooperations = req.db.prepare(`SELECT COUNT(*) as c FROM cooperation co LEFT JOIN merchants m ON co.merchant_id=m.id WHERE 1=1${scope.coopWhere}`).get(...scope.coopParams).c;
    const pendingCooperations = req.db.prepare(`SELECT COUNT(*) as c FROM cooperation co LEFT JOIN merchants m ON co.merchant_id=m.id WHERE co.status='pending'${scope.coopWhere}`).get(...scope.coopParams).c;
    const confirmedCooperations = req.db.prepare(`SELECT COUNT(*) as c FROM cooperation co LEFT JOIN merchants m ON co.merchant_id=m.id WHERE co.status='confirmed'${scope.coopWhere}`).get(...scope.coopParams).c;
    const totalOrders = req.db.prepare(`SELECT COUNT(*) as c FROM orders o LEFT JOIN merchants m ON o.merchant_id=m.id WHERE 1=1${scope.orderWhere}`).get(...scope.orderParams).c;
    const acceptedOrders = req.db.prepare(`SELECT COUNT(*) as c FROM orders o LEFT JOIN merchants m ON o.merchant_id=m.id WHERE o.status='accepted'${scope.orderWhere}`).get(...scope.orderParams).c;

    // 潜在合作金额（GMV估算）= 已确认合作的需求售价之和
    const gmvRow = req.db.prepare(`
      SELECT COALESCE(SUM(COALESCE(bd.selling_price, cd.unit_price, 0)), 0) as gmv
      FROM cooperation co
      LEFT JOIN merchants m ON co.merchant_id = m.id
      LEFT JOIN demands d ON co.demand_id = d.id
      LEFT JOIN book_demands bd ON d.ref_demand_id = bd.id AND d.demand_type='book'
      LEFT JOIN course_demands cd ON d.ref_demand_id = cd.id AND d.demand_type='course'
      WHERE co.status='confirmed'${scope.coopWhere}
    `).get(...scope.coopParams);
    const potentialGmv = Math.round(gmvRow.gmv || 0);

    // 转化率
    const dealRate = totalDemands > 0 ? +(confirmedCooperations / totalDemands * 100).toFixed(1) : 0;
    const matchRate = totalCooperations > 0 ? +(confirmedCooperations / totalCooperations * 100).toFixed(1) : 0;

    // 活跃主体（X天内有相关流转）
    const activeMerchants = req.db.prepare(`SELECT COUNT(DISTINCT d.merchant_id) as c FROM demands d LEFT JOIN merchants m ON d.merchant_id=m.id WHERE d.created_at >= ?${scope.demandWhere}`).get(start, ...scope.demandParams).c;
    const activeInfluencers = req.db.prepare(`SELECT COUNT(DISTINCT co.influencer_id) as c FROM cooperation co LEFT JOIN merchants m ON co.merchant_id=m.id WHERE co.created_at >= ?${scope.coopWhere}`).get(start, ...scope.coopParams).c;

    res.json({
      success: true,
      data: {
        merchantCount, influencerCount, adminCount, salesCount,
        totalDemands, totalInfDemands, newDemandsThisWeek,
        totalMatchmaking, totalCooperations, pendingCooperations, confirmedCooperations,
        totalOrders, acceptedOrders,
        potentialGmv,
        dealRate, matchRate,
        activeMerchants, activeInfluencers,
        days
      }
    });
  } catch (err) {
    console.error('[stats/dashboard]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// =================================================================
// 2. 撮合漏斗（matchmaking 4阶段）
// =================================================================
router.get('/funnel', (req, res) => {
  try {
    const scope = buildScope(req.query);
    const { start } = parseRange(req.query);

    const stage0 = req.db.prepare(`SELECT COUNT(*) as c FROM demands d LEFT JOIN merchants m ON d.merchant_id=m.id WHERE d.created_at >= ?${scope.demandWhere}`).get(start, ...scope.demandParams).c;

    const mmAll = req.db.prepare(`SELECT mm.stage, COUNT(*) as c FROM matchmaking mm LEFT JOIN merchants m ON mm.merchant_id=m.id WHERE mm.created_at >= ?${scope.mmWhere} GROUP BY mm.stage`).all(start, ...scope.mmParams);
    const stageMap = {};
    mmAll.forEach(r => { stageMap[r.stage] = r.c; });

    // 累积漏斗：到达该阶段及之后的总和
    const reachMatch = (stageMap['合作匹配'] || 0) + (stageMap['样品寄送'] || 0) + (stageMap['开始合作'] || 0);
    const reachSample = (stageMap['样品寄送'] || 0) + (stageMap['开始合作'] || 0);
    const reachStart = (stageMap['开始合作'] || 0);

    const funnel = [
      { stage: '需求发布', count: stage0 },
      { stage: '合作匹配', count: reachMatch },
      { stage: '样品寄送', count: reachSample },
      { stage: '开始合作', count: reachStart },
    ];
    funnel.forEach((f, i) => {
      f.conversionFromTop = stage0 > 0 ? +(f.count / stage0 * 100).toFixed(1) : 0;
      f.conversionFromPrev = i === 0 ? 100 : (funnel[i-1].count > 0 ? +(f.count / funnel[i-1].count * 100).toFixed(1) : 0);
    });

    res.json({ success: true, data: funnel });
  } catch (err) {
    console.error('[stats/funnel]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// =================================================================
// 3. 时间趋势
// =================================================================
router.get('/trend', (req, res) => {
  try {
    const scope = buildScope(req.query);
    const days = parseInt(req.query.days) || 30;
    const start = new Date(); start.setDate(start.getDate() - days + 1);
    const startStr = start.toISOString().slice(0,10);

    const dates = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(start); d.setDate(d.getDate() + i);
      dates.push(d.toISOString().slice(0, 10));
    }

    const dRows = req.db.prepare(`
      SELECT DATE(d.created_at) as day, COUNT(*) as c FROM demands d
      LEFT JOIN merchants m ON d.merchant_id=m.id
      WHERE DATE(d.created_at) >= ?${scope.demandWhere}
      GROUP BY DATE(d.created_at)
    `).all(startStr, ...scope.demandParams);
    const dMap = {}; dRows.forEach(r => dMap[r.day] = r.c);

    const cRows = req.db.prepare(`
      SELECT DATE(co.created_at) as day, COUNT(*) as c FROM cooperation co
      LEFT JOIN merchants m ON co.merchant_id=m.id
      WHERE DATE(co.created_at) >= ?${scope.coopWhere}
      GROUP BY DATE(co.created_at)
    `).all(startStr, ...scope.coopParams);
    const cMap = {}; cRows.forEach(r => cMap[r.day] = r.c);

    const oRows = req.db.prepare(`
      SELECT DATE(o.created_at) as day, COUNT(*) as c FROM orders o
      LEFT JOIN merchants m ON o.merchant_id=m.id
      WHERE DATE(o.created_at) >= ?${scope.orderWhere}
      GROUP BY DATE(o.created_at)
    `).all(startStr, ...scope.orderParams);
    const oMap = {}; oRows.forEach(r => oMap[r.day] = r.c);

    const trend = dates.map(day => ({
      date: day,
      demands: dMap[day] || 0,
      cooperations: cMap[day] || 0,
      orders: oMap[day] || 0,
    }));

    res.json({ success: true, data: trend });
  } catch (err) {
    console.error('[stats/trend]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// =================================================================
// 4. 类目/类型/达人分布
// =================================================================
router.get('/distribution', (req, res) => {
  try {
    const scope = buildScope(req.query);

    const typeStats = req.db.prepare(`
      SELECT d.demand_type as type, COUNT(*) as count FROM demands d
      LEFT JOIN merchants m ON d.merchant_id=m.id
      WHERE 1=1${scope.demandWhere} GROUP BY d.demand_type
    `).all(...scope.demandParams);

    const categoryStats = req.db.prepare(`
      SELECT d.category, COUNT(*) as count FROM demands d
      LEFT JOIN merchants m ON d.merchant_id=m.id
      WHERE d.category IS NOT NULL AND d.category != ''${scope.demandWhere}
      GROUP BY d.category ORDER BY count DESC LIMIT 10
    `).all(...scope.demandParams);

    const levelStats = req.db.prepare(`
      SELECT level, COUNT(*) as count FROM influencers inf
      WHERE level IS NOT NULL AND level != ''${scope.infWhere}
      GROUP BY level ORDER BY level
    `).all(...scope.infParams);

    const fansBuckets = req.db.prepare(`
      SELECT 
        CASE 
          WHEN fans_count < 10000 THEN '1万以下'
          WHEN fans_count < 100000 THEN '1-10万'
          WHEN fans_count < 500000 THEN '10-50万'
          WHEN fans_count < 1000000 THEN '50-100万'
          ELSE '100万以上'
        END as bucket,
        COUNT(*) as count
      FROM influencers inf WHERE 1=1${scope.infWhere}
      GROUP BY bucket
    `).all(...scope.infParams);
    const bucketOrder = ['1万以下','1-10万','10-50万','50-100万','100万以上'];
    fansBuckets.sort((a,b) => bucketOrder.indexOf(a.bucket) - bucketOrder.indexOf(b.bucket));

    res.json({ success: true, data: { typeStats, categoryStats, levelStats, fansBuckets } });
  } catch (err) {
    console.error('[stats/distribution]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// =================================================================
// 5. 销售业绩排行
// =================================================================
router.get('/sales-ranking', (req, res) => {
  try {
    const rows = req.db.prepare(`
      SELECT 
        sa.id, sa.name,
        (SELECT COUNT(*) FROM merchants WHERE sales_owner_id = sa.id) as merchant_count,
        (SELECT COUNT(*) FROM demands d JOIN merchants m ON d.merchant_id=m.id WHERE m.sales_owner_id = sa.id) as demand_count,
        (SELECT COUNT(*) FROM cooperation co JOIN merchants m ON co.merchant_id=m.id WHERE m.sales_owner_id = sa.id AND co.status='confirmed') as confirmed_count,
        (SELECT COUNT(*) FROM cooperation co JOIN merchants m ON co.merchant_id=m.id WHERE m.sales_owner_id = sa.id) as total_coop_count
      FROM admins sa
      WHERE sa.admin_role = '销售'
      ORDER BY confirmed_count DESC, demand_count DESC
    `).all();
    rows.forEach(r => {
      r.dealRate = r.total_coop_count > 0 ? +(r.confirmed_count / r.total_coop_count * 100).toFixed(1) : 0;
    });
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[stats/sales-ranking]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// =================================================================
// 6. Top10 商家 / 达人
// =================================================================
router.get('/top-entities', (req, res) => {
  try {
    const scope = buildScope(req.query);

    const topMerchants = req.db.prepare(`
      SELECT m.id, m.name, m.company,
        (SELECT COUNT(*) FROM demands WHERE merchant_id = m.id) as demand_count,
        (SELECT COUNT(*) FROM cooperation WHERE merchant_id = m.id AND status='confirmed') as confirmed_count
      FROM merchants m
      WHERE m.status != 'deleted'${scope.merchWhere}
      ORDER BY confirmed_count DESC, demand_count DESC LIMIT 10
    `).all(...scope.merchParams);

    const topInfluencers = req.db.prepare(`
      SELECT inf.id, inf.video_account_name as name, inf.level, inf.fans_count,
        (SELECT COUNT(*) FROM cooperation WHERE influencer_id = inf.id) as coop_count,
        (SELECT COUNT(*) FROM cooperation WHERE influencer_id = inf.id AND status='confirmed') as confirmed_count
      FROM influencers inf
      WHERE 1=1${scope.infWhere}
      ORDER BY confirmed_count DESC, coop_count DESC LIMIT 10
    `).all(...scope.infParams);

    res.json({ success: true, data: { topMerchants, topInfluencers } });
  } catch (err) {
    console.error('[stats/top-entities]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// =================================================================
// 7. 最新动态时间线
// =================================================================
router.get('/timeline', (req, res) => {
  try {
    const scope = buildScope(req.query);
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);

    const demandEvents = req.db.prepare(`
      SELECT 'demand' as kind, d.id, d.title as text, d.demand_type as subtype, d.created_at, m.company as merchant_name, NULL as influencer_name
      FROM demands d LEFT JOIN merchants m ON d.merchant_id=m.id
      WHERE 1=1${scope.demandWhere}
      ORDER BY d.created_at DESC LIMIT ?
    `).all(...scope.demandParams, limit);

    const coopEvents = req.db.prepare(`
      SELECT 'cooperation' as kind, co.id, co.status as text, co.initiative as subtype, co.created_at,
        m.company as merchant_name, inf.video_account_name as influencer_name
      FROM cooperation co
      LEFT JOIN merchants m ON co.merchant_id=m.id
      LEFT JOIN influencers inf ON co.influencer_id=inf.id
      WHERE 1=1${scope.coopWhere}
      ORDER BY co.created_at DESC LIMIT ?
    `).all(...scope.coopParams, limit);

    const events = [...demandEvents, ...coopEvents]
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
      .slice(0, limit);

    res.json({ success: true, data: events });
  } catch (err) {
    console.error('[stats/timeline]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 老接口兼容
router.get('/influencer-levels', (req, res) => {
  try {
    const { operator_id, sales_owner_id } = req.query;
    let opFilter = '';
    let opParams = [];
    if (sales_owner_id) {
      opFilter = ` AND (sales_owner_id = ? OR sales_owner_id IS NULL OR sales_owner_id = '')`;
      opParams = [sales_owner_id];
    } else if (operator_id) {
      opFilter = " AND operator_id = ?"; opParams = [operator_id];
    }
    const levelStats = req.db.prepare(`
      SELECT level, COUNT(*) as count FROM influencers WHERE level IS NOT NULL AND level != ''${opFilter} GROUP BY level
    `).all(...opParams);
    const total = req.db.prepare(`SELECT COUNT(*) as count FROM influencers WHERE 1=1${opFilter}`).get(...opParams).count;
    res.json({ success: true, data: { levelStats, total } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
