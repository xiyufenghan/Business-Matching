const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

/**
 * V4 收藏功能
 * GET    /api/favorites?type=demand|entity   查询当前用户的收藏（按类型分组返回）
 * POST   /api/favorites                       添加收藏 body:{target_type,target_id}
 * DELETE /api/favorites                       取消收藏 body:{target_type,target_id}
 * GET    /api/favorites/check                 查询是否已被当前用户收藏
 *
 * target_type 取值：
 *   - influencer        达人主体
 *   - merchant          商家主体
 *   - merchant_demand   商家发布的需求（图书/课程/通用）
 *   - influencer_demand 达人发布的需求
 *
 * 收藏权限矩阵：
 *   商家   可收藏：达人 + 任意需求
 *   达人   可收藏：商家主体 + 任意需求（不可收藏其它达人）
 *   管理员 可收藏：所有
 */

const ALLOWED = {
  merchant: ['influencer', 'merchant_demand', 'influencer_demand'],
  influencer: ['merchant', 'merchant_demand', 'influencer_demand'],
  admin: ['merchant', 'influencer', 'merchant_demand', 'influencer_demand'],
};

function checkPermission(userRole, targetType) {
  return (ALLOWED[userRole] || []).includes(targetType);
}

// ========== GET /api/favorites ==========
// 列出当前用户的所有收藏。返回 { entities: [...], demands: [...] }
// entities 含商家/达人主体；demands 含商家需求/达人需求。
router.get('/', (req, res) => {
  try {
    const userType = req.user.role;
    const userId = req.user.id;

    const favs = req.db.prepare(`
      SELECT * FROM favorites
      WHERE user_type = ? AND user_id = ?
      ORDER BY created_at DESC
    `).all(userType, userId);

    const entities = [];
    const demands = [];

    for (const f of favs) {
      try {
        let detail = null;
        if (f.target_type === 'merchant') {
          detail = req.db.prepare('SELECT id, name, company, phone, email, industry, description FROM merchants WHERE id = ?').get(f.target_id);
          if (detail) entities.push({ ...detail, target_type: 'merchant', favorited_at: f.created_at, fav_id: f.id });
        } else if (f.target_type === 'influencer') {
          detail = req.db.prepare('SELECT id, video_account_name, level, video_category_track, fans_count, region, has_mcn, mcn_name, introduction, audience_profile FROM influencers WHERE id = ? AND COALESCE(status, \'active\') = \'active\'').get(f.target_id);
          if (detail) entities.push({ ...detail, target_type: 'influencer', favorited_at: f.created_at, fav_id: f.id });
        } else if (f.target_type === 'merchant_demand') {
          // 优先 demands 壳，再 book_demands / course_demands
          detail = req.db.prepare('SELECT * FROM demands WHERE id = ? AND COALESCE(status, \'published\') != \'archived\'').get(f.target_id);
          if (!detail) {
            detail = req.db.prepare('SELECT id, book_name as title, book_category as category, selling_price, "book" as kind FROM book_demands WHERE id = ?').get(f.target_id);
          }
          if (!detail) {
            detail = req.db.prepare('SELECT id, course_name as title, subject as category, unit_price as selling_price, "course" as kind FROM course_demands WHERE id = ?').get(f.target_id);
          }
          if (detail) demands.push({ ...detail, target_type: 'merchant_demand', favorited_at: f.created_at, fav_id: f.id });
        } else if (f.target_type === 'influencer_demand') {
          detail = req.db.prepare('SELECT * FROM influencer_demands WHERE id = ? AND COALESCE(status, \'published\') != \'archived\'').get(f.target_id);
          if (detail) demands.push({ ...detail, target_type: 'influencer_demand', favorited_at: f.created_at, fav_id: f.id });
        }
      } catch (e) { /* 忽略单条出错 */ }
    }

    res.json({ success: true, data: { entities, demands, total: favs.length } });
  } catch (err) {
    console.error('[favorites/get]', err);
    res.status(500).json({ success: false, error: '操作失败，请稍后重试' });
  }
});

// ========== POST /api/favorites ==========
router.post('/', (req, res) => {
  try {
    const { target_type, target_id } = req.body;
    if (!target_type || !target_id) {
      return res.status(400).json({ success: false, error: 'target_type 和 target_id 必填' });
    }
    if (!checkPermission(req.user.role, target_type)) {
      return res.status(403).json({ success: false, error: '当前角色不能收藏此类对象' });
    }

    const id = uuidv4();
    try {
      req.db.prepare(`
        INSERT INTO favorites (id, user_type, user_id, target_type, target_id)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, req.user.role, req.user.id, target_type, target_id);
    } catch (e) {
      if (/UNIQUE/.test(e.message)) {
        return res.json({ success: true, message: '已收藏', data: { already: true } });
      }
      throw e;
    }
    res.status(201).json({ success: true, message: '收藏成功', data: { id } });
  } catch (err) {
    console.error('[favorites/post]', err);
    res.status(500).json({ success: false, error: '操作失败，请稍后重试' });
  }
});

// ========== DELETE /api/favorites ==========
router.delete('/', (req, res) => {
  try {
    const { target_type, target_id } = req.body;
    if (!target_type || !target_id) {
      return res.status(400).json({ success: false, error: 'target_type 和 target_id 必填' });
    }
    const r = req.db.prepare(`
      DELETE FROM favorites
      WHERE user_type = ? AND user_id = ? AND target_type = ? AND target_id = ?
    `).run(req.user.role, req.user.id, target_type, target_id);
    res.json({ success: true, message: r.changes > 0 ? '已取消收藏' : '本就未收藏', data: { changes: r.changes } });
  } catch (err) {
    console.error('[favorites/delete]', err);
    res.status(500).json({ success: false, error: '操作失败，请稍后重试' });
  }
});

// ========== GET /api/favorites/check?target_type=&target_id= ==========
router.get('/check', (req, res) => {
  try {
    const { target_type, target_id } = req.query;
    if (!target_type || !target_id) return res.json({ success: true, data: { favorited: false } });
    const r = req.db.prepare(`
      SELECT id FROM favorites
      WHERE user_type = ? AND user_id = ? AND target_type = ? AND target_id = ?
    `).get(req.user.role, req.user.id, target_type, target_id);
    res.json({ success: true, data: { favorited: !!r } });
  } catch (err) {
    console.error('[' + "routes/favorites.js" + ']', err);
    res.status(500).json({ success: false, error: '操作失败，请稍后重试' });
  }
});

// ========== GET /api/favorites/ids ==========
// 一次性返回当前用户所有收藏的 (target_type, target_id) 列表
// 前端在渲染列表时一次拉取，本地标记每张卡片是否已收藏
router.get('/ids', (req, res) => {
  try {
    const rows = req.db.prepare(`
      SELECT target_type, target_id FROM favorites
      WHERE user_type = ? AND user_id = ?
    `).all(req.user.role, req.user.id);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[' + "routes/favorites.js" + ']', err);
    res.status(500).json({ success: false, error: '操作失败，请稍后重试' });
  }
});

module.exports = router;
