const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

// 获取需求的申请列表
router.get('/demand/:demandId', (req, res) => {
  try {
    const applications = req.db.prepare(`
      SELECT a.*, inf.name as influencer_name, inf.platform, inf.fans_count, inf.category, inf.introduction, inf.score
      FROM applications a
      LEFT JOIN influencers inf ON a.influencer_id = inf.id
      WHERE a.demand_id = ?
      ORDER BY a.created_at DESC
    `).all(req.params.demandId);
    res.json({ success: true, data: applications });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 达人申请需求
router.post('/', (req, res) => {
  try {
    const { demand_id, influencer_id, message, quoted_price } = req.body;
    
    if (!demand_id || !influencer_id) {
      return res.status(400).json({ success: false, error: '需求ID和达人ID为必填项' });
    }
    
    const existing = req.db.prepare('SELECT id FROM applications WHERE demand_id=? AND influencer_id=?').get(demand_id, influencer_id);
    if (existing) {
      return res.status(400).json({ success: false, error: '该达人已申请过此需求' });
    }
    
    const id = uuidv4();
    req.db.prepare(`
      INSERT INTO applications (id, demand_id, influencer_id, message, quoted_price)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, demand_id, influencer_id, message || null, quoted_price || null);
    
    const application = req.db.prepare('SELECT * FROM applications WHERE id = ?').get(id);
    res.status(201).json({ success: true, data: application });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 商家审核申请（通过/拒绝）
router.patch('/:id/review', (req, res) => {
  try {
    const { status } = req.body;
    if (!['accepted', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, error: '状态只能为 accepted 或 rejected' });
    }
    
    req.db.prepare(`UPDATE applications SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(status, req.params.id);
    
    // 如果通过，自动创建撮合流程
    if (status === 'accepted') {
      const app = req.db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id);
      const demand = req.db.prepare('SELECT merchant_id FROM demands WHERE id = ?').get(app.demand_id);
      
      const matchId = uuidv4();
      const now = new Date().toISOString();
      const stageHistory = JSON.stringify([
        { stage: 'published', time: now, remark: '需求已发布' },
        { stage: 'accepted', time: now, remark: '达人已接单' }
      ]);
      
      req.db.prepare(`
        INSERT INTO match_processes (id, demand_id, merchant_id, influencer_id, stage, stage_history)
        VALUES (?, ?, ?, ?, 'accepted', ?)
      `).run(matchId, app.demand_id, demand.merchant_id, app.influencer_id, stageHistory);
    }
    
    res.json({ success: true, message: status === 'accepted' ? '已通过，进入撮合流程' : '已拒绝' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
