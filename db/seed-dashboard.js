// 数据看板演示数据生成脚本
// 用途：扩充 demands/matchmaking/cooperation/orders 数据，分散时间到最近 30 天，让看板趋势/漏斗有可视化效果
// 运行：node db/seed-dashboard.js

const Database = require('better-sqlite3');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const db = new Database(path.join(__dirname, 'merchant_match.db'));

// ===== 工具函数 =====
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// 返回 N 天前的随机时刻 ISO datetime（含小时分钟）
function dateNDaysAgo(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(randInt(8, 22), randInt(0, 59), randInt(0, 59));
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

console.log('==> 开始生成看板演示数据...');

// 检测已扩充过则跳过 step1-3
const demandsCount = db.prepare('SELECT COUNT(*) as c FROM demands').get().c;
const skipDemands = demandsCount >= 35;
let newDemandsLen = 0;

if (!skipDemands) {
  // ===== 1. 把现有 demands 的 created_at 分散到最近 30 天 =====
  const existingDemands = db.prepare('SELECT id FROM demands ORDER BY created_at').all();
  console.log(`📦 已有需求 ${existingDemands.length} 条，正在分散时间...`);
  const updateDemandTime = db.prepare('UPDATE demands SET created_at = ?, updated_at = ? WHERE id = ?');
  existingDemands.forEach((d, idx) => {
    const daysAgo = Math.floor(30 - (idx / existingDemands.length) * 28) + randInt(-2, 2);
    const ts = dateNDaysAgo(Math.max(1, Math.min(30, daysAgo)));
    updateDemandTime.run(ts, ts, d.id);
  });

  // ===== 2. 新增 30 条需求 =====
  const merchants = db.prepare('SELECT id FROM merchants').all();
  const titles = [
    '小学数学思维训练手册', '初中物理实验大全', '儿童英语启蒙绘本', '高中化学必刷题',
    '编程从入门到精通', '人工智能科普读物', '亲子阅读时光', '幼儿园识字卡片',
    '中学历史故事集', '语文阅读理解专项', '小学奥数竞赛指南', '中考冲刺真题',
    '少儿口才训练', '科学小实验100例', '世界名著青少版', '英语单词速记',
    '高效学习方法', '中国古典文学', '数学几何基础', '物理力学精讲',
    '化学元素周期表', '生物细胞结构', '地理地图册', '历史朝代表',
    '思想品德教材', '美术素描入门', '音乐基础理论', '体育健康常识',
    '信息技术基础', '劳动教育实践'
  ];
  const categories = ['教育图书', '教辅', '科技', '少儿', '童书', '儿童绘本', '社科', '文学经典', '经管', '科普'];
  console.log('📦 新增 30 条历史需求...');
  const insertDemand = db.prepare(`
    INSERT INTO demands (id, merchant_id, title, demand_type, category, platform, description, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, '视频号', ?, ?, ?, ?)
  `);
  for (let i = 0; i < 30; i++) {
    const id = uuidv4();
    const daysAgo = randInt(1, 30);
    const ts = dateNDaysAgo(daysAgo);
    const type = Math.random() > 0.4 ? 'book' : 'course';
    const r = Math.random();
    const status = r < 0.6 ? 'published' : r < 0.85 ? 'accepted' : 'closed';
    const m = pick(merchants);
    const title = pick(titles) + (type === 'course' ? ' 课程' : '') + ' 推广';
    insertDemand.run(id, m.id, title, type, pick(categories), title, status, ts, ts);
    newDemandsLen++;
  }
  
  // ===== 3. 把现有 matchmaking 时间分散 =====
  const existingMm = db.prepare('SELECT id FROM matchmaking').all();
  const updateMmTime = db.prepare('UPDATE matchmaking SET created_at = ?, updated_at = ? WHERE id = ?');
  existingMm.forEach((m) => {
    const ts = dateNDaysAgo(randInt(5, 30));
    updateMmTime.run(ts, ts, m.id);
  });
} else {
  console.log(`⏭️  跳过step1-3 (demands 已有 ${demandsCount} 条)`);
}

// ===== 4. 新增 60 条 matchmaking 记录，4 阶段比例分布（漏斗） =====
const influencers = db.prepare(`SELECT id FROM influencers WHERE level IS NOT NULL AND level != '' LIMIT 200`).all();
if (influencers.length === 0) {
  console.error('❌ 没有可用的达人数据，退出');
  process.exit(1);
}
console.log(`📦 可用达人 ${influencers.length} 名`);
const allDemands = db.prepare('SELECT id, merchant_id, demand_type FROM demands').all();
const insertMm = db.prepare(`
  INSERT INTO matchmaking (id, merchant_id, influencer_id, demand_id, demand_type, source, stage, notes, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const sources = ['达人接单', '系统推荐', '商家邀请', '手动创建'];
// 漏斗 4 阶段：需求发布 → 合作匹配 → 样品寄送 → 开始合作
// 比例：100% → 70% → 45% → 25%（典型漏斗形状）
const stageDist = [
  { stage: '合作匹配', count: 28 },  // 70% × 40
  { stage: '样品寄送', count: 18 },  // 45% × 40
  { stage: '开始合作', count: 14 },  // 25% × 40
];
console.log('📦 新增 matchmaking 流转数据...');
let mmCreated = 0;
stageDist.forEach(({ stage, count }) => {
  for (let i = 0; i < count; i++) {
    const id = uuidv4();
    const d = pick(allDemands);
    const inf = pick(influencers);
    const ts = dateNDaysAgo(randInt(1, 28));
    insertMm.run(id, d.merchant_id, inf.id, d.id, d.demand_type, pick(sources), stage, '自动生成测试数据', ts, ts);
    mmCreated++;
  }
});

// ===== 5. 新增 cooperation 数据（pending/confirmed/rejected） =====
const insertCoop = db.prepare(`
  INSERT INTO cooperation (id, merchant_id, influencer_id, demand_id, demand_type, initiative, status, message, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
console.log('📦 新增 cooperation 数据...');
let coopCreated = 0;
for (let i = 0; i < 25; i++) {
  const d = pick(allDemands);
  const inf = pick(influencers);
  const ts = dateNDaysAgo(randInt(1, 30));
  // 比例：50% confirmed / 35% pending / 15% rejected
  const r = Math.random();
  const status = r < 0.5 ? 'confirmed' : r < 0.85 ? 'pending' : 'rejected';
  const initiative = Math.random() > 0.5 ? 'merchant' : 'influencer';
  insertCoop.run(uuidv4(), d.merchant_id, inf.id, d.id, d.demand_type, initiative, status, '看板模拟数据', ts, ts);
  coopCreated++;
}

// ===== 6. 新增 orders（成交） =====
const insertOrder = db.prepare(`
  INSERT INTO orders (id, demand_id, demand_type, influencer_id, merchant_id, status, message, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
console.log('📦 新增 orders 数据...');
let orderCreated = 0;
for (let i = 0; i < 18; i++) {
  const d = pick(allDemands);
  const inf = pick(influencers);
  const ts = dateNDaysAgo(randInt(1, 25));
  insertOrder.run(uuidv4(), d.id, d.demand_type, inf.id, d.merchant_id, 'accepted', '已接单合作', ts, ts);
  orderCreated++;
}

// ===== 7. 同步刷一下 matchmaking_history（每条 mm 至少 1-3 条历史） =====
const insertHistory = db.prepare(`
  INSERT INTO matchmaking_history (id, matchmaking_id, stage, operator, notes, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const allMm = db.prepare('SELECT id, stage, created_at FROM matchmaking').all();
allMm.forEach(m => {
  // 已有的就不补了，新增的补
  const exists = db.prepare('SELECT COUNT(*) as c FROM matchmaking_history WHERE matchmaking_id = ?').get(m.id).c;
  if (exists === 0) {
    insertHistory.run(uuidv4(), m.id, '需求发布', '系统', '需求已发布', m.created_at);
    if (['合作匹配', '样品寄送', '开始合作'].includes(m.stage)) {
      insertHistory.run(uuidv4(), m.id, '合作匹配', '系统', '完成匹配', m.created_at);
    }
    if (['样品寄送', '开始合作'].includes(m.stage)) {
      insertHistory.run(uuidv4(), m.id, '样品寄送', '管理员', '样品已寄送', m.created_at);
    }
    if (m.stage === '开始合作') {
      insertHistory.run(uuidv4(), m.id, '开始合作', '管理员', '双方确认合作', m.created_at);
    }
  }
});

console.log('\n========== 模拟数据生成完成 ==========');
console.log(`✅ 需求时间已分散，新增 ${newDemandsLen} 条历史需求`);
console.log(`✅ matchmaking 新增 ${mmCreated} 条`);
console.log(`✅ cooperation 新增 ${coopCreated} 条`);
console.log(`✅ orders 新增 ${orderCreated} 条`);
console.log('\n现状:');
console.log(`   demands: ${db.prepare('SELECT COUNT(*) as c FROM demands').get().c}`);
console.log(`   matchmaking: ${db.prepare('SELECT COUNT(*) as c FROM matchmaking').get().c}`);
console.log(`   cooperation: ${db.prepare('SELECT COUNT(*) as c FROM cooperation').get().c}`);
console.log(`   orders: ${db.prepare('SELECT COUNT(*) as c FROM orders').get().c}`);
db.close();
