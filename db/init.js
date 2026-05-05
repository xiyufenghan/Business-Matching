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

  // 达人货盘需求表
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
      stage TEXT DEFAULT '需求发布',
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
  } catch (e) { /* ignore */ }

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

  // 插入示例数据
  const merchantCount = db.prepare('SELECT COUNT(*) as count FROM merchants').get();
  if (merchantCount.count === 0) {
    const insertMerchant = db.prepare(`
      INSERT INTO merchants (id, name, company, phone, email, industry, description, password)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertMerchant.run('m001', '张经理', '知行图书出版社', '13800138001', 'zhang@book.com', '图书出版', '专注教育类图书出版发行', '123456');
    insertMerchant.run('m002', '李总监', '博学在线教育', '13800138002', 'li@edu.com', '在线教育', 'K12在线课程平台', '123456');
    insertMerchant.run('m003', '王主管', '启明文化传媒', '13800138003', 'wang@culture.com', '文化传媒', '儿童绘本与课程研发', '123456');

    const insertInfluencer = db.prepare(`
      INSERT INTO influencers (id, level, video_account_name, video_category_track, monthly_short_video_sales, monthly_live_sales, fans_count, cooperation_type, book_willingness, course_willingness, short_video_frequency, live_frequency, has_mcn, mcn_name, region, has_joined_mutual_select, sales_owner, official_account_name, password)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertInfluencer.run('i001', 'S', '读书小达人', '图书,教育', 15.5, 8.2, 500000, '纯佣,投流', '高', '中', '每周3-5条', '每周1-2场', '否', '', '北京', '是', '销售A', '读书小达人公众号', '123456');
    insertInfluencer.run('i002', 'A', '知识课堂', '课程,教育', 8.0, 25.0, 1200000, '纯佣,坑位费', '中', '高', '每周1-2条', '每周3-5场', '是', '星辰MCN', '上海', '是', '销售B', '知识课堂Official', '123456');
    insertInfluencer.run('i003', 'A', '亲子阅读馆', '图书,亲子', 12.0, 5.5, 800000, '纯佣', '高', '低', '每周5条以上', '每周1场', '否', '', '广州', '是', '销售A', '亲子阅读馆号', '123456');
    insertInfluencer.run('i004', 'S', '学霸说', '课程,考试', 5.0, 35.0, 2000000, '坑位费,投流', '低', '高', '每周1-2条', '每天1场', '是', '教育MCN联盟', '深圳', '是', '销售C', '学霸说公众号', '123456');
    insertInfluencer.run('i005', 'B', '好书推荐官', '图书,文学', 6.5, 2.0, 350000, '纯佣', '高', '低', '每周3-5条', '每月1-2场', '否', '', '成都', '否', '销售A', '好书每日推荐', '123456');

    // 图书需求
    const insertBookDemand = db.prepare(`
      INSERT INTO book_demands (id, merchant_id, book_image, book_merchant, book_name, target_audience, book_category, product_image, book_introduction, wechat_shop_link, specification, selling_price, pure_commission, ad_commission, logistics, stock)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertBookDemand.run('bd001', 'm001', '', '知行图书出版社', '趣味数学启蒙', '小学生,家长', '教育图书', '', '适合6-12岁儿童的数学思维训练图书', 'https://shop.weixin.qq.com/example1', '单本', 39.9, 25, 35, '中通快递', 5000);
    insertBookDemand.run('bd002', 'm003', '', '启明文化传媒', '经典绘本10册套装', '幼儿,宝妈', '儿童绘本', '', '获奖经典绘本合集，适合3-6岁亲子阅读', 'https://shop.weixin.qq.com/example2', '套组', 128.0, 30, 40, '顺丰快递', 3000);
    insertBookDemand.run('bd003', 'm001', '', '知行图书出版社', '高中必读名著精选', '中学生,教师', '文学经典', '', '高中语文推荐阅读书目合集', 'https://shop.weixin.qq.com/example3', '套组', 89.0, 20, 30, '中通快递', 8000);

    // 课程需求
    const insertCourseDemand = db.prepare(`
      INSERT INTO course_demands (id, merchant_id, course_image, course_name, unit_price, grade_level, subject, course_introduction, course_link)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertCourseDemand.run('cd001', 'm002', '', '少儿编程入门班', 1999, '小学,初中', '编程,信息技术', 'Scratch+Python双轨编程课程，适合8-15岁', 'https://edu.example.com/course1');
    insertCourseDemand.run('cd002', 'm002', '', '英语自然拼读课', 899, '幼儿园,小学', '英语', '外教自然拼读课程，帮助孩子轻松掌握拼读规则', 'https://edu.example.com/course2');
    insertCourseDemand.run('cd003', 'm003', '', '少儿美术创意课', 1299, '小学', '美术', '专业美术老师带领创意绘画，培养审美能力', 'https://edu.example.com/course3');

    // 通用需求表
    const insertDemand = db.prepare(`
      INSERT INTO demands (id, merchant_id, title, demand_type, category, platform, budget_min, budget_max, fans_requirement, cooperation_type, description, requirements, status, deadline, ref_demand_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertDemand.run('d001', 'm001', '趣味数学启蒙推广', 'book', '教育图书', '视频号', 5000, 20000, '30万以上', '短视频推广', '趣味数学启蒙图书需要视频号达人推广', '1.粉丝30万以上 2.教育类目', 'published', '2026-06-30', 'bd001');
    insertDemand.run('d002', 'm002', '少儿编程入门课程推广', 'course', '编程课程', '视频号', 8000, 30000, '50万以上', '视频推广+直播', '少儿编程入门课程推广招生', '1.教育类博主 2.有课程推广经验', 'published', '2026-05-30', 'cd001');
    insertDemand.run('d003', 'm003', '经典绘本套装带货', 'book', '儿童绘本', '视频号', 4000, 15000, '20万以上', '短视频+橱窗', '经典儿童绘本套装带货推广', '1.亲子类 2.有童书推广经验', 'published', '2026-05-20', 'bd002');
    insertDemand.run('d004', 'm001', '高中名著推广', 'book', '文学经典', '视频号', 3000, 10000, '10万以上', '短视频推广', '高中必读名著推广', '图书/教育类达人', 'published', '2026-07-15', 'bd003');
    insertDemand.run('d005', 'm002', '英语拼读课程推广', 'course', '英语课程', '视频号', 5000, 15000, '30万以上', '视频推广', '英语自然拼读课推广招生', '亲子/教育类达人', 'published', '2026-06-15', 'cd002');
    insertDemand.run('d006', 'm003', '少儿美术课程推广', 'course', '美术课程', '视频号', 4000, 12000, '20万以上', '直播推广', '少儿美术创意课招生推广', '亲子/教育类达人', 'published', '2026-06-20', 'cd003');

    // 达人需求
    const insertInfluencerDemand = db.prepare(`
      INSERT INTO influencer_demands (id, influencer_id, video_account_name, demand_category, book_name, book_category, book_price_min, book_price_max, course_price_min, course_price_max, description, fans_count, subject_category, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertInfluencerDemand.run('id001', 'i001', '读书小达人', '图书需求', '儿童科普百科全书', '科普读物', 20, 60, 0, 0, '想找适合6-10岁的科普类图书带货', 500000, '科学', 'published');
    insertInfluencerDemand.run('id002', 'i003', '亲子阅读馆', '图书需求,课程需求', '亲子互动绘本', '儿童绘本', 30, 80, 500, 2000, '寻找高质量的亲子互动绘本和早教课程', 800000, '语文,美术', 'published');
    insertInfluencerDemand.run('id003', 'i002', '知识课堂', '课程需求', '', '教辅', 0, 0, 800, 3000, '想找优质在线课程合作带货', 1200000, '数学,编程', 'published');

    // 接单
    const insertOrder = db.prepare(`
      INSERT INTO orders (id, demand_id, demand_type, ref_demand_id, influencer_id, merchant_id, status, message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertOrder.run('o001', 'd001', 'book', 'bd001', 'i001', 'm001', 'accepted', '我擅长图书推广');
    insertOrder.run('o002', 'd002', 'course', 'cd001', 'i002', 'm002', 'accepted', '教育课程是我的专长');

    // 示例撮合记录
    const { v4: uuidv4 } = require('uuid');
    const insertMatchmaking = db.prepare(`
      INSERT INTO matchmaking (id, merchant_id, influencer_id, demand_id, demand_type, source, stage, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `);
    const mm1 = uuidv4();
    insertMatchmaking.run(mm1, 'm001', 'i001', 'd001', 'book', '达人接单', '开始合作', '达人已接单并开始合作推广');
    const mm2 = uuidv4();
    insertMatchmaking.run(mm2, 'm002', 'i002', 'd002', 'course', '系统推荐', '样品寄送', '课程资料已发送给达人');
    const mm3 = uuidv4();
    insertMatchmaking.run(mm3, 'm003', 'i003', 'd003', 'book', '商家邀请', '合作匹配', '商家邀请达人合作推广绘本');

    const insertHistory = db.prepare(`
      INSERT INTO matchmaking_history (id, matchmaking_id, stage, operator, notes, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `);
    insertHistory.run(uuidv4(), mm1, '需求发布', '系统', '需求已发布');
    insertHistory.run(uuidv4(), mm1, '合作匹配', '系统', '达人接单匹配');
    insertHistory.run(uuidv4(), mm1, '样品寄送', '管理员', '样品已寄出');
    insertHistory.run(uuidv4(), mm1, '开始合作', '管理员', '双方确认开始合作');
    insertHistory.run(uuidv4(), mm2, '需求发布', '系统', '需求已发布');
    insertHistory.run(uuidv4(), mm2, '合作匹配', '系统', '系统智能推荐匹配');
    insertHistory.run(uuidv4(), mm2, '样品寄送', '管理员', '课程资料已发送');
    insertHistory.run(uuidv4(), mm3, '需求发布', '系统', '需求已发布');
    insertHistory.run(uuidv4(), mm3, '合作匹配', '管理员', '商家主动邀请达人');

    // 示例合作记录
    const insertCoop = db.prepare(`
      INSERT INTO cooperation (id, merchant_id, influencer_id, demand_id, demand_type, initiative, status, message, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `);
    insertCoop.run(uuidv4(), 'm001', 'i001', 'd001', 'invite', 'merchant', 'confirmed', '邀请您合作推广趣味数学启蒙');
    insertCoop.run(uuidv4(), 'm003', 'i003', 'd003', 'invite', 'merchant', 'pending', '邀请您合作推广绘本套装');
    insertCoop.run(uuidv4(), 'm002', 'i002', 'd002', 'apply', 'influencer', 'confirmed', '我想带货编程课程');
  }

  return db;
}

module.exports = { initDatabase, DB_PATH };
