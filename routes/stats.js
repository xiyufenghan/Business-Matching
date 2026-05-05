const express = require('express');
const router = express.Router();

// 获取系统统计数据 - 新看板
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
      // 商家需求：需要关联merchants表
      demandFilter = ` AND merchant_id IN (SELECT id FROM merchants WHERE sales_owner_id = ? OR sales_owner_id IS NULL OR sales_owner_id = '')`;
      demandParams = [sales_owner_id];
      // 达人需求：关联influencers表
      infDemandFilter = ` AND influencer_id IN (SELECT id FROM influencers WHERE sales_owner_id = ? OR sales_owner_id IS NULL OR sales_owner_id = '')`;
      infDemandParams = [sales_owner_id];
    } else if (operator_id) {
      infFilter = ' AND operator_id = ?';
      infParams = [operator_id];
      demandFilter = ' AND operator_id = ?';
      demandParams = [operator_id];
      infDemandFilter = ' AND operator_id = ?';
      infDemandParams = [operator_id];
    }
    
    // ========== 达人相关统计 ==========
    const totalInfluencers = req.db.prepare(`SELECT COUNT(*) as count FROM influencers WHERE 1=1${infFilter}`).get(...infParams).count;
    
    const influencerLevelStats = req.db.prepare(`
      SELECT level, COUNT(*) as count FROM influencers WHERE level IS NOT NULL AND level != ''${infFilter} GROUP BY level ORDER BY 
        CASE level WHEN 'S' THEN 1 WHEN 'A' THEN 2 WHEN 'B' THEN 3 WHEN 'C' THEN 4 ELSE 5 END
    `).all(...infParams);

    // ========== 需求统计 ==========
    const merchantDemandCount = req.db.prepare(`SELECT COUNT(*) as count FROM demands WHERE 1=1${demandFilter}`).get(...demandParams).count;
    const influencerDemandCount = req.db.prepare(`SELECT COUNT(*) as count FROM influencer_demands WHERE 1=1${infDemandFilter}`).get(...infDemandParams).count;
    const totalDemands = merchantDemandCount + influencerDemandCount;

    // ========== 商家和达人参与统计 ==========
    const demandMerchantCount = req.db.prepare(`SELECT COUNT(DISTINCT merchant_id) as count FROM demands WHERE 1=1${demandFilter}`).get(...demandParams).count;
    const demandInfluencerCount = req.db.prepare(`SELECT COUNT(DISTINCT influencer_id) as count FROM influencer_demands WHERE 1=1${infDemandFilter}`).get(...infDemandParams).count;

    // ========== 接单统计 ==========
    const totalOrders = req.db.prepare('SELECT COUNT(*) as count FROM orders').get().count;
    
    const influencerOrderCount = req.db.prepare(`
      SELECT COUNT(*) as count FROM orders WHERE demand_id IN (SELECT id FROM demands WHERE 1=1${demandFilter})
    `).get(...demandParams).count;
    
    const merchantOrderCount = req.db.prepare(`
      SELECT COUNT(*) as count FROM orders WHERE demand_id IN (SELECT id FROM influencer_demands WHERE 1=1${infDemandFilter})
    `).get(...infDemandParams).count;

    const merchantOrderRate = influencerDemandCount > 0 
      ? ((merchantOrderCount / influencerDemandCount) * 100).toFixed(1) 
      : '0.0';
    const influencerOrderRate = merchantDemandCount > 0 
      ? ((influencerOrderCount / merchantDemandCount) * 100).toFixed(1) 
      : '0.0';
    const totalOrderRate = totalDemands > 0 
      ? ((totalOrders / totalDemands) * 100).toFixed(1) 
      : '0.0';

    // ========== 需求类目分布 ==========
    const categoryStats = req.db.prepare(`
      SELECT category, COUNT(*) as count FROM demands WHERE 1=1${demandFilter} GROUP BY category ORDER BY count DESC
    `).all(...demandParams);

    // ========== 需求类型分布 ==========
    const typeStats = req.db.prepare(`
      SELECT demand_type, COUNT(*) as count FROM demands WHERE 1=1${demandFilter} GROUP BY demand_type
    `).all(...demandParams);

    res.json({
      success: true,
      data: {
        totalInfluencers,
        influencerLevelStats,
        merchantDemandCount,
        influencerDemandCount,
        totalDemands,
        demandMerchantCount,
        demandInfluencerCount,
        totalOrders,
        merchantOrderCount,
        influencerOrderCount,
        merchantOrderRate: parseFloat(merchantOrderRate),
        influencerOrderRate: parseFloat(influencerOrderRate),
        totalOrderRate: parseFloat(totalOrderRate),
        categoryStats,
        typeStats
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 达人等级统计（用于达人广场展示）
router.get('/influencer-levels', (req, res) => {
  try {
    const { operator_id, sales_owner_id } = req.query;
    let opFilter = '';
    let opParams = [];
    
    if (sales_owner_id) {
      opFilter = ` AND (sales_owner_id = ? OR sales_owner_id IS NULL OR sales_owner_id = '')`;
      opParams = [sales_owner_id];
    } else if (operator_id) {
      opFilter = " AND operator_id = ?";
      opParams = [operator_id];
    }
    
    const levelStats = req.db.prepare(`
      SELECT level, COUNT(*) as count FROM influencers WHERE level IS NOT NULL AND level != ''${opFilter} GROUP BY level ORDER BY 
        CASE level WHEN 'S' THEN 1 WHEN 'A' THEN 2 WHEN 'B' THEN 3 WHEN 'C' THEN 4 ELSE 5 END
    `).all(...opParams);
    
    const total = req.db.prepare(`SELECT COUNT(*) as count FROM influencers WHERE 1=1${opFilter}`).get(...opParams).count;
    
    res.json({ success: true, data: { levelStats, total } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
