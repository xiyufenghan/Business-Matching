// Seed demo data for influencer_demands
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const db = new Database('./db/merchant_match.db');

// 选取 8 个真实存在的达人作为发布人
const picks = db.prepare(`
  SELECT id, video_account_name, fans_count
  FROM influencers
  WHERE video_account_name IS NOT NULL AND video_account_name != ''
  ORDER BY fans_count DESC
  LIMIT 8
`).all();

if (picks.length === 0) {
  console.log('没有可用的达人，请先导入达人数据');
  process.exit(1);
}

// 先清空（避免重复）
db.prepare('DELETE FROM influencer_demands').run();

const demos = [
  {
    title: '寻找 6-12 岁科普百科类图书',
    demand_category: '图书需求',
    book_name: '少儿科普百科 / 国家地理 / DK 系列',
    book_category: '少儿科普',
    book_price_min: 30, book_price_max: 80,
    course_price_min: 0, course_price_max: 0,
    subject_category: '科学',
    description: '主推家长群体，单场直播平均 1500+ 在线，希望找一手货源，要求出版社直采、佣金 25%+，可寄样审核。'
  },
  {
    title: '寻找成人英语学习类课程合作',
    demand_category: '课程需求',
    book_name: '',
    book_category: '',
    book_price_min: 0, book_price_max: 0,
    course_price_min: 99, course_price_max: 599,
    subject_category: '英语',
    description: '账号粉丝以 25-40 岁职场女性为主，倾向短期速成 / 实用口语类课程，希望佣金 ≥ 40%，可提供专属优惠码。'
  },
  {
    title: '寻找儿童绘本读物（3-6 岁）',
    demand_category: '图书需求',
    book_name: '中英双语绘本 / 情绪管理绘本',
    book_category: '绘本',
    book_price_min: 20, book_price_max: 60,
    course_price_min: 0, course_price_max: 0,
    subject_category: '语文',
    description: '近期粉丝增长稳定，亲子互动话题反馈好，希望找绘本类供应商建立长期合作，每月可承接 2-3 场专场。'
  },
  {
    title: '寻找 K12 数学教辅书',
    demand_category: '图书需求',
    book_name: '小学数学思维 / 奥数 / 计算训练',
    book_category: '教辅',
    book_price_min: 25, book_price_max: 90,
    course_price_min: 0, course_price_max: 0,
    subject_category: '数学',
    description: '账号家长粉占比 80%+，孩子年龄段以 7-12 岁为主，希望找名师推荐过的口碑教辅书，佣金 20%+。'
  },
  {
    title: '寻找少儿编程类课程',
    demand_category: '课程需求',
    book_name: '',
    book_category: '',
    book_price_min: 0, book_price_max: 0,
    course_price_min: 199, course_price_max: 1999,
    subject_category: '编程',
    description: '科技育儿赛道，对 Scratch / Python 启蒙类课程接受度高，要求课程方提供试听课链接，佣金可议。'
  },
  {
    title: '寻找文学类经典名著',
    demand_category: '图书需求',
    book_name: '世界名著 / 中国古典文学（精装版）',
    book_category: '文学',
    book_price_min: 50, book_price_max: 200,
    course_price_min: 0, course_price_max: 0,
    subject_category: '语文',
    description: '读书号定位，单条爆款视频 100w+ 播放，希望选品有收藏价值（精装、套装），佣金 25%+，可短视频深度种草。'
  },
  {
    title: '寻找艺术启蒙类课程',
    demand_category: '课程需求',
    book_name: '',
    book_category: '',
    book_price_min: 0, book_price_max: 0,
    course_price_min: 99, course_price_max: 999,
    subject_category: '艺术',
    description: '面向 4-10 岁儿童，倾向美术 / 音乐启蒙，希望课程方有体系化教案、佣金 30%+。'
  },
  {
    title: '寻找家庭教育类图书',
    demand_category: '图书需求',
    book_name: '正面管教 / 儿童心理学 / 家庭教育畅销书',
    book_category: '家庭教育',
    book_price_min: 30, book_price_max: 70,
    course_price_min: 0, course_price_max: 0,
    subject_category: '通用',
    description: '家长教育类账号，复购率高，希望与出版社或畅销书作者直连，可承接读者见面会等线下联动。'
  }
];

const stmt = db.prepare(`
  INSERT INTO influencer_demands
  (id, influencer_id, video_account_name, demand_category, book_name, book_category,
   book_price_min, book_price_max, course_price_min, course_price_max,
   description, fans_count, subject_category, status, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', datetime('now', '-' || ? || ' days'))
`);

picks.forEach((p, i) => {
  const d = demos[i % demos.length];
  stmt.run(
    uuidv4(),
    p.id,
    p.video_account_name,
    d.demand_category,
    d.book_name,
    d.book_category,
    d.book_price_min, d.book_price_max,
    d.course_price_min, d.course_price_max,
    d.description,
    p.fans_count || 0,
    d.subject_category,
    i  // 错开创建时间：今天、昨天、前天...
  );
  console.log(`✓ ${p.video_account_name} → ${d.title}`);
});

console.log('\n共插入', demos.length, '条达人需求 demo 数据');
console.log('当前 influencer_demands 总数:', db.prepare('SELECT COUNT(*) as c FROM influencer_demands').get().c);
