const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'merchant_match.db');

function initDatabase() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  // 商家表
  db.exec(`
    CREATE TABLE IF NOT EXISTS merchants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      company TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT,
      industry TEXT,
      description TEXT,
      sales_owner_id TEXT,
      password TEXT DEFAULT '123456',
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 兼容已有库：补齐 merchants 的 status 字段
  try {
    const cols = db.prepare('PRAGMA table_info(merchants)').all().map(c => c.name);
    if (!cols.includes('status')) {
      db.exec("ALTER TABLE merchants ADD COLUMN status TEXT DEFAULT 'active'");
      db.prepare("UPDATE merchants SET status = 'active' WHERE status IS NULL").run();
    }
    // 邀请制字段
    if (!cols.includes('invite_code')) {
      db.exec("ALTER TABLE merchants ADD COLUMN invite_code TEXT");
    }
    if (!cols.includes('invite_status')) {
      db.exec("ALTER TABLE merchants ADD COLUMN invite_status TEXT DEFAULT 'active'");
      // 存量数据默认置为 active，避免现有登录行为中断
      db.prepare("UPDATE merchants SET invite_status = 'active' WHERE invite_status IS NULL").run();
    }
    if (!cols.includes('activated_at')) {
      db.exec("ALTER TABLE merchants ADD COLUMN activated_at DATETIME");
    }
    if (!cols.includes('invited_by')) {
      db.exec("ALTER TABLE merchants ADD COLUMN invited_by TEXT");
    }
  } catch (e) { /* ignore */ }

  // 达人表
  db.exec(`
    CREATE TABLE IF NOT EXISTS influencers (
      id TEXT PRIMARY KEY,
      level TEXT,
      video_account_name TEXT NOT NULL,
      video_category_track TEXT,
      monthly_short_video_sales REAL DEFAULT 0,
      monthly_live_sales REAL DEFAULT 0,
      fans_count INTEGER DEFAULT 0,
      cooperation_type TEXT,
      book_willingness TEXT,
      course_willingness TEXT,
      short_video_frequency TEXT,
      live_frequency TEXT,
      has_mcn TEXT DEFAULT '否',
      mcn_name TEXT,
      region TEXT,
      has_joined_mutual_select TEXT DEFAULT '否',
      sales_owner TEXT,
      official_account_name TEXT,
      sales_owner_id TEXT,
      password TEXT DEFAULT '123456',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

    // 兼容已有库：补齐 influencers 邀请制字段
  try {
    const infCols = db.prepare('PRAGMA table_info(influencers)').all().map(c => c.name);
    if (!infCols.includes('invite_code')) {
      db.exec("ALTER TABLE influencers ADD COLUMN invite_code TEXT");
    }
    if (!infCols.includes('invite_status')) {
      db.exec("ALTER TABLE influencers ADD COLUMN invite_status TEXT DEFAULT 'active'");
      db.prepare("UPDATE influencers SET invite_status = 'active' WHERE invite_status IS NULL").run();
    }
    if (!infCols.includes('activated_at')) {
      db.exec("ALTER TABLE influencers ADD COLUMN activated_at DATETIME");
    }
    if (!infCols.includes('invited_by')) {
      db.exec("ALTER TABLE influencers ADD COLUMN invited_by TEXT");
    }
    // 软删除状态字段
    if (!infCols.includes('status')) {
      db.exec("ALTER TABLE influencers ADD COLUMN status TEXT DEFAULT 'active'");
      db.prepare("UPDATE influencers SET status = 'active' WHERE status IS NULL").run();
    }
    if (!infCols.includes('operator_id')) {
      db.exec("ALTER TABLE influencers ADD COLUMN operator_id TEXT");
    }
    // V4 新增：达人详情 4 字段（账号介绍 / 粉丝画像 / 代表作品 / 公众号开关）
    if (!infCols.includes('introduction')) {
      db.exec("ALTER TABLE influencers ADD COLUMN introduction TEXT");
    }
    if (!infCols.includes('audience_profile')) {
      db.exec("ALTER TABLE influencers ADD COLUMN audience_profile TEXT");
    }
    if (!infCols.includes('representative_works')) {
      db.exec("ALTER TABLE influencers ADD COLUMN representative_works TEXT");
    }
    if (!infCols.includes('has_official_account')) {
      db.exec("ALTER TABLE influencers ADD COLUMN has_official_account TEXT DEFAULT '否'");
    }
    // V4.1 新增：达人手机号（登录用，主键之一）
    if (!infCols.includes('phone')) {
      db.exec("ALTER TABLE influencers ADD COLUMN phone TEXT");
    }
  } catch (e) { /* ignore */ }

  // 图书需求表
  db.exec(`
    CREATE TABLE IF NOT EXISTS book_demands (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL,
      book_image TEXT,
      book_merchant TEXT,
      book_name TEXT,
      target_audience TEXT,
      book_category TEXT,
      product_image TEXT,
      book_introduction TEXT,
      wechat_shop_link TEXT,
      specification TEXT,
      selling_price REAL DEFAULT 0,
      pure_commission REAL DEFAULT 0,
      ad_commission REAL DEFAULT 0,
      logistics TEXT,
      stock INTEGER DEFAULT 0,
      status TEXT DEFAULT 'published',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (merchant_id) REFERENCES merchants(id)
    )
  `);

  // 课程需求表
  db.exec(`
    CREATE TABLE IF NOT EXISTS course_demands (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL,
      course_image TEXT,
      course_name TEXT,
      unit_price REAL DEFAULT 0,
      grade_level TEXT,
      subject TEXT,
      pure_commission REAL DEFAULT 0,
      ad_commission REAL DEFAULT 0,
      course_introduction TEXT,
      course_link TEXT,
      status TEXT DEFAULT 'published',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (merchant_id) REFERENCES merchants(id)
    )
  `);

  // 兼容已有库：补齐 course_demands 的佣金字段
  try {
    const cdCols = db.prepare('PRAGMA table_info(course_demands)').all().map(c => c.name);
    if (!cdCols.includes('pure_commission')) {
      db.exec('ALTER TABLE course_demands ADD COLUMN pure_commission REAL DEFAULT 0');
    }
    if (!cdCols.includes('ad_commission')) {
      db.exec('ALTER TABLE course_demands ADD COLUMN ad_commission REAL DEFAULT 0');
    }
    // V4 新增：商家需求字段（卖点/备注/置顶时间）
    if (!cdCols.includes('selling_points')) {
      db.exec('ALTER TABLE course_demands ADD COLUMN selling_points TEXT');
    }
    if (!cdCols.includes('remark')) {
      db.exec('ALTER TABLE course_demands ADD COLUMN remark TEXT');
    }
    if (!cdCols.includes('pinned_at')) {
      db.exec('ALTER TABLE course_demands ADD COLUMN pinned_at DATETIME');
    }
    // operator_id：发布需求时的代发管理员 ID
    if (!cdCols.includes('operator_id')) {
      db.exec('ALTER TABLE course_demands ADD COLUMN operator_id TEXT');
    }
    // V5 新增：images 字段（JSON 数组，最多3张图片相对路径），与导入解耦
    if (!cdCols.includes('images')) {
      db.exec('ALTER TABLE course_demands ADD COLUMN images TEXT');
    }
  } catch (e) { /* ignore */ }

  // 兼容已有库：补齐 book_demands 的 V4 新增字段
  try {
    const bdCols = db.prepare('PRAGMA table_info(book_demands)').all().map(c => c.name);
    if (!bdCols.includes('selling_points')) {
      db.exec('ALTER TABLE book_demands ADD COLUMN selling_points TEXT');
    }
    if (!bdCols.includes('remark')) {
      db.exec('ALTER TABLE book_demands ADD COLUMN remark TEXT');
    }
    if (!bdCols.includes('pinned_at')) {
      db.exec('ALTER TABLE book_demands ADD COLUMN pinned_at DATETIME');
    }
    // V5 新增：images 字段（JSON 数组，最多3张图片相对路径），与导入解耦
    if (!bdCols.includes('images')) {
      db.exec('ALTER TABLE book_demands ADD COLUMN images TEXT');
    }
    // operator_id：发布需求时的代发管理员 ID
    if (!bdCols.includes('operator_id')) {
      db.exec('ALTER TABLE book_demands ADD COLUMN operator_id TEXT');
    }
  } catch (e) { /* ignore */ }

  // 兼容已有库：补齐 demands 的 operator_id 字段
  try {
    const demCols = db.prepare('PRAGMA table_info(demands)').all().map(c => c.name);
    if (!demCols.includes('operator_id')) {
      db.exec("ALTER TABLE demands ADD COLUMN operator_id TEXT");
    }
  } catch (e) { /* ignore */ }

  // 兼容已有库：补齐 influencer_demands 的 operator_id 字段
  try {
    const idCols = db.prepare('PRAGMA table_info(influencer_demands)').all().map(c => c.name);
    if (!idCols.includes('operator_id')) {
      db.exec("ALTER TABLE influencer_demands ADD COLUMN operator_id TEXT");
    }
  } catch (e) { /* ignore */ }

  // 通用需求表
  db.exec(`
    CREATE TABLE IF NOT EXISTS demands (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL,
      title TEXT NOT NULL,
      demand_type TEXT NOT NULL DEFAULT 'book',
      category TEXT NOT NULL,
      platform TEXT DEFAULT '视频号',
      budget_min REAL DEFAULT 0,
      budget_max REAL DEFAULT 0,
      fans_requirement TEXT,
      cooperation_type TEXT,
      description TEXT,
      requirements TEXT,
      status TEXT DEFAULT 'published',
      deadline TEXT,
      ref_demand_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (merchant_id) REFERENCES merchants(id)
    )
  `);

  // 达人需求表
  db.exec(`
    CREATE TABLE IF NOT EXISTS influencer_demands (
      id TEXT PRIMARY KEY,
      influencer_id TEXT NOT NULL,
      video_account_name TEXT,
      demand_category TEXT DEFAULT '图书需求',
      book_name TEXT,
      book_category TEXT,
      book_price_min REAL DEFAULT 0,
      book_price_max REAL DEFAULT 0,
      course_price_min REAL DEFAULT 0,
      course_price_max REAL DEFAULT 0,
      description TEXT,
      fans_count INTEGER DEFAULT 0,
      subject_category TEXT,
      status TEXT DEFAULT 'published',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 商家招募需求表（商家需求：找什么样的达人）
  db.exec(`
    CREATE TABLE IF NOT EXISTS merchant_recruitments (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL,
      title TEXT NOT NULL,
      recruitment_type TEXT DEFAULT '图书推广',
      linked_demand_id TEXT,
      target_levels TEXT,
      target_fans_min INTEGER DEFAULT 0,
      target_fans_max INTEGER DEFAULT 0,
      target_categories TEXT,
      target_provinces TEXT,
      target_audience TEXT,
      cooperation_mode TEXT,
      commission_offer TEXT,
      budget_min REAL DEFAULT 0,
      budget_max REAL DEFAULT 0,
      description TEXT,
      deadline DATETIME,
      status TEXT DEFAULT 'recruiting',
      operator_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (merchant_id) REFERENCES merchants(id)
    )
  `);

  // 接单表
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      demand_id TEXT NOT NULL,
      demand_type TEXT NOT NULL,
      ref_demand_id TEXT,
      influencer_id TEXT NOT NULL,
      merchant_id TEXT NOT NULL,
      status TEXT DEFAULT 'accepted',
      message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (influencer_id) REFERENCES influencers(id),
      FOREIGN KEY (merchant_id) REFERENCES merchants(id)
    )
  `);

  // 合作邀约表（商家邀请/达人带货申请）
  db.exec(`
    CREATE TABLE IF NOT EXISTS cooperation (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL,
      influencer_id TEXT NOT NULL,
      demand_id TEXT,
      demand_type TEXT,
      initiative TEXT NOT NULL DEFAULT 'merchant',
      status TEXT DEFAULT 'pending',
      message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 撮合管理表
  // source_type: 手动创建 / 邀约转化 / 申请转化 — 标记撮合来源
  // cooperation_id: 关联到孵化此撮合的 cooperation 记录（如有）
  db.exec(`
    CREATE TABLE IF NOT EXISTS matchmaking (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL,
      influencer_id TEXT NOT NULL,
      demand_id TEXT,
      demand_type TEXT,
      source TEXT DEFAULT '手动创建',
      source_type TEXT DEFAULT '手动创建',
      cooperation_id TEXT,
      stage TEXT DEFAULT 'published',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 兼容已有库：补齐 matchmaking 单向衔接字段
  try {
    const mmCols = db.prepare('PRAGMA table_info(matchmaking)').all().map(c => c.name);
    if (!mmCols.includes('source_type')) {
      db.exec("ALTER TABLE matchmaking ADD COLUMN source_type TEXT DEFAULT '手动创建'");
      db.prepare("UPDATE matchmaking SET source_type = '手动创建' WHERE source_type IS NULL").run();
    }
    if (!mmCols.includes('cooperation_id')) {
      db.exec('ALTER TABLE matchmaking ADD COLUMN cooperation_id TEXT');
    }
    // 补齐 cooperation.js 中使用的扩展字段
  } catch (e2) { /* ignore */ }

  // 兼容已有库：补齐 matchmaking 扩展字段（独立块）
  try {
    const mmCols2 = db.prepare('PRAGMA table_info(matchmaking)').all().map(c => c.name);
    const extraMmCols = ['product_name','influencer_account','product_price','cooperation_mode','commission_rate','gmv','matchmaking_time','order_count','upgrade_commission_rate','operator_id','sample_info','cooperation_details'];
    for (const col of extraMmCols) {
      if (!mmCols2.includes(col)) {
        db.exec(`ALTER TABLE matchmaking ADD COLUMN ${col} TEXT`);
      }
    }
  } catch (e3) { /* ignore */ }

  // 登录会话表（支持多设备同时在线，不互相踢出）
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_type TEXT NOT NULL,
      user_id TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_active_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME,
      client_info TEXT
    )
  `);
  // V5 兼容老库：sessions 表补 expires_at 字段
  try {
    const sCols = db.prepare('PRAGMA table_info(sessions)').all().map(c => c.name);
    if (!sCols.includes('expires_at')) {
      db.exec('ALTER TABLE sessions ADD COLUMN expires_at DATETIME');
      // 为已有 session 设置 30 天后过期（避免立即全员退出）
      db.exec("UPDATE sessions SET expires_at = datetime('now', '+30 days') WHERE expires_at IS NULL");
    }
  } catch (e) { console.error('[DB sessions.expires_at]', e.message); }

  // V5 安全加固：admins/merchants/influencers 加 password_hash 字段
  try {
    for (const t of ['admins', 'merchants', 'influencers']) {
      const cols = db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
      if (!cols.includes('password_hash')) {
        db.exec(`ALTER TABLE ${t} ADD COLUMN password_hash TEXT`);
      }
    }
  } catch (e) { console.error('[DB password_hash]', e.message); }

  // V5 索引加固
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_type, user_id, is_read)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_type, user_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_demands_ref ON demands(ref_demand_id, demand_type, status)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)');

    // V5 A2: merchants.company 唯一索引（防并发批量导入产生重复商家）
    // 仅对 status != 'deleted' 的记录生效（PARTIAL UNIQUE INDEX）
    try {
      // 先清理潜在的重复数据：保留最早创建的，其余标记为 deleted
      const dupGroups = db.prepare(`
        SELECT company, MIN(created_at) as min_t
        FROM merchants
        WHERE status != 'deleted' AND company IS NOT NULL AND company != ''
        GROUP BY company
        HAVING COUNT(*) > 1
      `).all();
      for (const dg of dupGroups) {
        db.prepare(`
          UPDATE merchants SET status = 'deleted'
          WHERE company = ? AND status != 'deleted' AND created_at != ?
        `).run(dg.company, dg.min_t);
      }
      if (dupGroups.length > 0) {
        console.log('[DB A2] 清理 merchants 重复 company:', dupGroups.length, '组');
      }
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_merchants_company_unique
               ON merchants(company) WHERE status != 'deleted' AND company IS NOT NULL AND company != ''`);
    } catch (e) { console.error('[DB A2 merchants.company unique]', e.message); }
  } catch (e) { console.error('[DB indexes]', e.message); }

  // V5 邀请码过期：merchants/influencers 表加 invite_code_expires_at 字段
  try {
    for (const t of ['merchants', 'influencers']) {
      const cols = db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
      if (!cols.includes('invite_code_expires_at')) {
        db.exec(`ALTER TABLE ${t} ADD COLUMN invite_code_expires_at DATETIME`);
        // 已有 invite_code 但 pending 状态的，给 7 天过期
        db.exec(`UPDATE ${t} SET invite_code_expires_at = datetime('now', '+7 days') WHERE invite_status = 'pending' AND invite_code IS NOT NULL AND invite_code_expires_at IS NULL`);
      }
    }
  } catch (e) { console.error('[DB invite_code_expires_at]', e.message); }

  // 撮合历史记录表
  db.exec(`
    CREATE TABLE IF NOT EXISTS matchmaking_history (
      id TEXT PRIMARY KEY,
      matchmaking_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      operator TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 管理员表
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password TEXT DEFAULT '123456',
      name TEXT NOT NULL,
      is_super INTEGER DEFAULT 0,
      admin_role TEXT DEFAULT '其他',
      phone TEXT,
      email TEXT,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 兼容已有库：补齐 admins 的 status / last_login_at 字段
  // 注意：token 字段已迁移到 sessions 表，此处不再使用
  try {
    const admCols = db.prepare('PRAGMA table_info(admins)').all().map(c => c.name);
    if (!admCols.includes('status')) { db.exec("ALTER TABLE admins ADD COLUMN status TEXT DEFAULT 'active'"); }
    if (!admCols.includes('last_login_at')) { db.exec("ALTER TABLE admins ADD COLUMN last_login_at DATETIME"); }
  } catch (e) { /* ignore */ }

  // ====== V3 新增表 ======

  // 站内通知表
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_type TEXT NOT NULL,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      related_id TEXT,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 系统设置表
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // V4 新增：收藏表（商家收藏达人 / 达人收藏商家 / 管理员收藏一切 + 任意需求）
  db.exec(`
    CREATE TABLE IF NOT EXISTS favorites (
      id TEXT PRIMARY KEY,
      user_type TEXT NOT NULL,
      user_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_type, user_id, target_type, target_id)
    )
  `);

  // 初始化企微 Webhook 配置
  try {
    const existing = db.prepare("SELECT key FROM settings WHERE key = 'wework_webhook_url'").get();
    if (!existing) {
      db.prepare("INSERT INTO settings (key, value) VALUES ('wework_webhook_url', '')").run();
    }
  } catch (e) { /* ignore */ }

  // ====== V3 补齐字段 ======

  // merchants: 隐私授权 + 商家广场展示字段
  try {
    const mCols = db.prepare('PRAGMA table_info(merchants)').all().map(c => c.name);
    if (!mCols.includes('privacy_consented')) db.exec('ALTER TABLE merchants ADD COLUMN privacy_consented INTEGER DEFAULT 0');
    if (!mCols.includes('privacy_consented_at')) db.exec('ALTER TABLE merchants ADD COLUMN privacy_consented_at DATETIME');
    if (!mCols.includes('logo')) db.exec('ALTER TABLE merchants ADD COLUMN logo TEXT');
    if (!mCols.includes('brand_desc')) db.exec('ALTER TABLE merchants ADD COLUMN brand_desc TEXT');
    if (!mCols.includes('website')) db.exec('ALTER TABLE merchants ADD COLUMN website TEXT');
  } catch (e) { /* ignore */ }

  // influencers: 隐私授权
  try {
    const infCols2 = db.prepare('PRAGMA table_info(influencers)').all().map(c => c.name);
    if (!infCols2.includes('privacy_consented')) db.exec('ALTER TABLE influencers ADD COLUMN privacy_consented INTEGER DEFAULT 0');
    if (!infCols2.includes('privacy_consented_at')) db.exec('ALTER TABLE influencers ADD COLUMN privacy_consented_at DATETIME');
  } catch (e) { /* ignore */ }

  // influencer_demands: 新增多选字段（JSON 数组字符串）
  try {
    const idCols2 = db.prepare('PRAGMA table_info(influencer_demands)').all().map(c => c.name);
    if (!idCols2.includes('book_promote_categories')) db.exec('ALTER TABLE influencer_demands ADD COLUMN book_promote_categories TEXT');
    if (!idCols2.includes('content_formats')) db.exec('ALTER TABLE influencer_demands ADD COLUMN content_formats TEXT');
    if (!idCols2.includes('cooperation_types')) db.exec('ALTER TABLE influencer_demands ADD COLUMN cooperation_types TEXT');
    // V4 新增：达人需求置顶字段
    if (!idCols2.includes('pinned_at')) db.exec('ALTER TABLE influencer_demands ADD COLUMN pinned_at DATETIME');
  } catch (e) { /* ignore */ }

  // cooperation: 补 influencer_demand_id 字段（模式C/D 关联达人需求）
  try {
    const coopCols = db.prepare('PRAGMA table_info(cooperation)').all().map(c => c.name);
    if (!coopCols.includes('influencer_demand_id')) db.exec('ALTER TABLE cooperation ADD COLUMN influencer_demand_id TEXT');
    if (!coopCols.includes('responded_at')) db.exec('ALTER TABLE cooperation ADD COLUMN responded_at DATETIME');
  } catch (e) { /* ignore */ }

  // demands: 补 publisher_role 字段（标记发布者角色：merchant/admin）
  try {
    const demCols2 = db.prepare('PRAGMA table_info(demands)').all().map(c => c.name);
    if (!demCols2.includes('publisher_role')) {
      db.exec("ALTER TABLE demands ADD COLUMN publisher_role TEXT DEFAULT 'merchant'");
      db.prepare("UPDATE demands SET publisher_role = 'merchant' WHERE publisher_role IS NULL").run();
    }
    if (!demCols2.includes('admin_publisher_id')) {
      db.exec('ALTER TABLE demands ADD COLUMN admin_publisher_id TEXT');
    }
  } catch (e) { /* ignore */ }

  // ============ 生产初始化：仅自动创建超管账号 ============
  // 所有业务数据（商家/达人/需求/合作/收藏等）从零开始，由用户通过 UI 或邀请链接录入
  try {
    const adminCount = db.prepare('SELECT COUNT(*) as c FROM admins').get().c;
    if (adminCount === 0) {
      db.prepare(`INSERT INTO admins (id, username, password, name, is_super, admin_role, phone, email, status)
        VALUES (?, ?, ?, ?, 1, '超管', ?, ?, 'active')`)
        .run('a_super', 'admin', 'admin123', '超级管理员', '', '');
      console.log('[DB] 已创建超管账号：admin / admin123 （请首次登录后立即修改密码）');
    }
  } catch (e) {
    console.error('[DB Init Admin]', e.message);
  }

  return db;
}

module.exports = { initDatabase, DB_PATH };
