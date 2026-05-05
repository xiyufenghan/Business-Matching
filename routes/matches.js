const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

// 获取所有撮合流程
router.get('/', (req, res) => {
  try {
    const { stage } = req.query;
    let sql = `
      SELECT mp.*, 
        d.title as demand_title, d.demand_type, d.category,
        m.name as merchant_name, m.company as merchant_company,
        inf.name as influencer_name, inf.fans_count, inf.score as influencer_score
      FROM match_processes mp
      LEFT JOIN demands d ON mp.demand_id = d.id
      LEFT JOIN merchants m ON mp.merchant_id = m.id
      LEFT JOIN influencers inf ON mp.influencer_id = inf.id
      WHERE 1=1
    `;
    const params = [];
    if (stage) { sql += ' AND mp.stage = ?'; params.push(stage); }
    sql += ' ORDER BY mp.updated_at DESC';
    
    const processes = req.db.prepare(sql).all(...params);
    res.json({ success: true, data: processes });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取单个撮合详情
router.get('/:id', (req, res) => {
  try {
    const process = req.db.prepare(`
      SELECT mp.*, 
        d.title as demand_title, d.demand_type, d.category, d.description as demand_description, d.budget_min, d.budget_max,
        m.name as merchant_name, m.company as merchant_company, m.phone as merchant_phone,
        inf.name as influencer_name, inf.fans_count, inf.phone as influencer_phone, inf.score as influencer_score
      FROM match_processes mp
      LEFT JOIN demands d ON mp.demand_id = d.id
      LEFT JOIN merchants m ON mp.merchant_id = m.id
      LEFT JOIN influencers inf ON mp.influencer_id = inf.id
      WHERE mp.id = ?
    `).get(req.params.id);
    
    if (!process) return res.status(404).json({ success: false, error: '撮合记录不存在' });
    res.json({ success: true, data: process });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 创建撮合流程（从接单环节开始）
router.post('/', (req, res) => {
  try {
    const { demand_id, merchant_id, influencer_id } = req.body;
    if (!demand_id || !merchant_id || !influencer_id) {
      return res.status(400).json({ success: false, error: '需求ID、商家ID、达人ID为必填' });
    }
    
    // 检查是否已存在
    const existing = req.db.prepare('SELECT id FROM match_processes WHERE demand_id=? AND influencer_id=?').get(demand_id, influencer_id);
    if (existing) {
      return res.status(400).json({ success: false, error: '该撮合流程已存在' });
    }
    
    const id = uuidv4();
    const now = new Date().toISOString();
    const stageHistory = JSON.stringify([{ stage: 'published', time: now, remark: '需求已发布' }, { stage: 'accepted', time: now, remark: '达人已接单' }]);
    
    req.db.prepare(`
      INSERT INTO match_processes (id, demand_id, merchant_id, influencer_id, stage, stage_history)
      VALUES (?, ?, ?, ?, 'accepted', ?)
    `).run(id, demand_id, merchant_id, influencer_id, stageHistory);
    
    const process = req.db.prepare('SELECT * FROM match_processes WHERE id = ?').get(id);
    res.status(201).json({ success: true, data: process });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 推进撮合流程阶段
router.patch('/:id/advance', (req, res) => {
  try {
    const { stage, remark, sample_tracking_no, sample_address } = req.body;
    const validStages = ['published', 'accepted', 'sample_sent', 'cooperating', 'completed'];
    
    if (!validStages.includes(stage)) {
      return res.status(400).json({ success: false, error: '无效的阶段，可选: published, accepted, sample_sent, cooperating, completed' });
    }
    
    const process = req.db.prepare('SELECT * FROM match_processes WHERE id = ?').get(req.params.id);
    if (!process) return res.status(404).json({ success: false, error: '撮合记录不存在' });
    
    // 更新阶段历史
    const history = JSON.parse(process.stage_history || '[]');
    const now = new Date().toISOString();
    history.push({ stage, time: now, remark: remark || '' });
    
    let updateSql = `UPDATE match_processes SET stage=?, stage_history=?, remark=?, updated_at=CURRENT_TIMESTAMP`;
    const params = [stage, JSON.stringify(history), remark || process.remark];
    
    if (stage === 'sample_sent') {
      updateSql += `, sample_tracking_no=?, sample_address=?, sample_sent_at=?`;
      params.push(sample_tracking_no || null, sample_address || null, now);
    }
    if (stage === 'cooperating') {
      updateSql += `, cooperation_start_at=?`;
      params.push(now);
    }
    if (stage === 'completed') {
      updateSql += `, cooperation_end_at=?`;
      params.push(now);
    }
    
    updateSql += ` WHERE id=?`;
    params.push(req.params.id);
    
    req.db.prepare(updateSql).run(...params);
    
    const updated = req.db.prepare('SELECT * FROM match_processes WHERE id = ?').get(req.params.id);
    res.json({ success: true, data: updated, message: `已推进到: ${stage}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 删除撮合流程
router.delete('/:id', (req, res) => {
  try {
    req.db.prepare('DELETE FROM match_processes WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: '删除成功' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
