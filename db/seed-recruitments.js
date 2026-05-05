// Seed demo data for merchant_recruitments
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const db = new Database('./db/merchant_match.db');

// 取现有商家
const merchants = db.prepare(`SELECT id, name, company FROM merchants LIMIT 3`).all();
if (merchants.length === 0) {
  console.log('没有商家数据，先初始化');
  process.exit(1);
}

db.prepare('DELETE FROM merchant_recruitments').run();

const demos = [
  {
    title: '寻找30万+亲子赛道达人推广《小学数学思维训练》',
    recruitment_type: '图书推广',
    target_levels: 'S级,A级',
    target_fans_min: 300000, target_fans_max: 0,
    target_categories: '亲子教育,图书,少儿',
    target_provinces: '广东,北京,上海',
    target_audience: '家长,小学生',
    cooperation_mode: '纯佣',
    commission_offer: '纯佣 30% + 优质达人额外补贴',
    budget_min: 5000, budget_max: 30000,
    description: '出版社直供货源，目标 6-12 岁家长群体，希望达人有稳定的家长粉丝基础，单场直播在线 1000+。可寄样审核。',
    deadline: '2026-06-15',
    days_ago: 0
  },
  {
    title: '招募成人英语类达人合作《职场英语速成课》',
    recruitment_type: '课程推广',
    target_levels: 'A级,B级',
    target_fans_min: 100000, target_fans_max: 1000000,
    target_categories: '成人教育,英语',
    target_provinces: '',
    target_audience: '职场,大学生',
    cooperation_mode: '投流',
    commission_offer: 'CPS 40%',
    budget_min: 10000, budget_max: 50000,
    description: '面向 22-35 岁职场人群的英语速成课，希望找擅长内容种草的达人，提供专属优惠码。',
    deadline: '2026-07-01',
    days_ago: 1
  },
  {
    title: '【专场直播】绘本类专场招募',
    recruitment_type: '专场直播',
    target_levels: 'S级',
    target_fans_min: 1000000, target_fans_max: 0,
    target_categories: '亲子,绘本,少儿教育',
    target_provinces: '',
    target_audience: '家长',
    cooperation_mode: '视频专场',
    commission_offer: '保底 5万 + GMV 抽 15%',
    budget_min: 50000, budget_max: 200000,
    description: '春季新书专场直播招募，全场绘本品类，需要达人提供 2 小时专场直播，保底+提成模式。',
    deadline: '2026-05-30',
    days_ago: 2
  },
  {
    title: '招募少儿编程类达人推广《Scratch启蒙营》',
    recruitment_type: '课程推广',
    target_levels: 'A级,B级,C级',
    target_fans_min: 50000, target_fans_max: 500000,
    target_categories: '编程,少儿教育,科技',
    target_provinces: '广东,浙江,江苏',
    target_audience: '小学生,家长',
    cooperation_mode: '混合',
    commission_offer: '纯佣 35% / 投流 50%',
    budget_min: 0, budget_max: 0,
    description: '面向 7-12 岁儿童的编程启蒙课，希望长期合作。课程方提供试听课链接和素材包。',
    deadline: '',
    days_ago: 3
  },
  {
    title: '综合招募：教辅/科普/绘本类达人',
    recruitment_type: '综合招募',
    target_levels: 'A级,B级,C级',
    target_fans_min: 0, target_fans_max: 0,
    target_categories: '亲子,图书,少儿教育',
    target_provinces: '',
    target_audience: '家长',
    cooperation_mode: '纯佣',
    commission_offer: '20-35% 视品类而定',
    budget_min: 0, budget_max: 0,
    description: '出版社综合招募，欢迎做教辅、科普、绘本品类的达人申请合作，按品类匹配选品。',
    deadline: '',
    days_ago: 5
  }
];

const stmt = db.prepare(`
  INSERT INTO merchant_recruitments (
    id, merchant_id, title, recruitment_type, target_levels,
    target_fans_min, target_fans_max, target_categories, target_provinces, target_audience,
    cooperation_mode, commission_offer, budget_min, budget_max,
    description, deadline, status, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'recruiting', datetime('now', '-' || ? || ' days'))
`);

demos.forEach((d, i) => {
  const m = merchants[i % merchants.length];
  stmt.run(
    uuidv4(), m.id,
    d.title, d.recruitment_type,
    d.target_levels,
    d.target_fans_min, d.target_fans_max,
    d.target_categories, d.target_provinces, d.target_audience,
    d.cooperation_mode, d.commission_offer,
    d.budget_min, d.budget_max,
    d.description, d.deadline || null,
    d.days_ago
  );
  console.log(`✓ ${m.company || m.name} → ${d.title.slice(0, 30)}...`);
});

console.log(`\n共插入 ${demos.length} 条招募 demo 数据`);
console.log('当前 merchant_recruitments 总数:', db.prepare('SELECT COUNT(*) as c FROM merchant_recruitments').get().c);
