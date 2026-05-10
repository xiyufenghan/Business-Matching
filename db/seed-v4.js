/**
 * V4 Demo 数据 seed：
 * 1. 达人 4 字段：账号介绍 / 粉丝画像 / 代表作品 / 公众号开关
 * 2. 商家需求"卖点 / 备注" 字段补 demo 内容
 * 3. 收藏数据（admin / 商家 / 达人 各预置几条）
 * 4. 置顶数据（商家需求 + 达人需求各 2-3 条）
 *
 * 幂等：仅当字段为空 / 数据不存在时才填充
 *
 * 用法：node db/seed-v4.js
 */
const Database = require('better-sqlite3');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, 'merchant_match.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// ========== 1. 达人 4 字段 mock ==========
const introMock = {
  '读书小达人': '深耕图书内容 5 年，专注教育类、科普类好书推荐。粉丝粘性高，转化率行业领先。每周稳定更新 3-5 条优质内容。',
  '知识课堂': 'K12 教育垂类头部账号，专业团队制作课程内容。擅长课程拆解+场景化讲解，是教育类商家的优质合作伙伴。',
  '亲子阅读馆': '专注亲子阅读领域，打造温馨亲子陪伴内容。粉丝以宝妈群体为主，对绘本、童书、亲子课程有强烈购买力。',
  '学霸说': '高考备考类头部账号，主打提分干货分享。直播带货能力突出，单场 GMV 稳定在 30 万+。',
  '好书推荐官': '文学好书推荐垂类账号，深度书评+片段共读形式深受粉丝喜爱。文学小说、人文社科类带货转化优秀。',
};

const audienceMock = {
  '读书小达人': '女性 65% / 25-40 岁 60% / 一二线城市 55% / 教师与家长群体为主',
  '知识课堂': '女性 70% / 30-45 岁 70% / 全国分布均衡 / 中小学家长群体',
  '亲子阅读馆': '女性 90% / 25-38 岁 75% / 一二线城市 60% / 0-12 岁孩子的妈妈',
  '学霸说': '男女均衡 / 16-22 岁 50% / 25-45 岁家长 35% / 全国分布',
  '好书推荐官': '女性 60% / 22-40 岁 65% / 一二线城市 70% / 高知文艺青年',
};

const worksMock = {
  '读书小达人': 'https://channels.weixin.qq.com/example/dushu-1; https://channels.weixin.qq.com/example/dushu-2; https://channels.weixin.qq.com/example/dushu-3',
  '知识课堂': 'https://channels.weixin.qq.com/example/zskt-1; https://channels.weixin.qq.com/example/zskt-2',
  '亲子阅读馆': 'https://channels.weixin.qq.com/example/qzyd-1; https://channels.weixin.qq.com/example/qzyd-2; https://channels.weixin.qq.com/example/qzyd-3',
  '学霸说': 'https://channels.weixin.qq.com/example/xbs-1; https://channels.weixin.qq.com/example/xbs-2',
  '好书推荐官': 'https://channels.weixin.qq.com/example/hstj-1; https://channels.weixin.qq.com/example/hstj-2',
};

// 30% 概率为"是"，模拟有公众号
const officialMap = { '读书小达人': '是', '知识课堂': '是', '亲子阅读馆': '否', '学霸说': '否', '好书推荐官': '是' };

const updInf = db.prepare(`
  UPDATE influencers
  SET introduction = COALESCE(NULLIF(introduction, ''), ?),
      audience_profile = COALESCE(NULLIF(audience_profile, ''), ?),
      representative_works = COALESCE(NULLIF(representative_works, ''), ?),
      has_official_account = COALESCE(NULLIF(has_official_account, ''), ?)
  WHERE video_account_name = ?
`);

const allInfs = db.prepare('SELECT id, video_account_name FROM influencers').all();
let infUpdated = 0;
for (const inf of allInfs) {
  const name = inf.video_account_name;
  const intro = introMock[name] || `${name} 是优质内容创作者，粉丝活跃度高，专注垂类内容生产，欢迎洽谈合作。`;
  const audience = audienceMock[name] || '女性 60% / 25-35 岁 55% / 一二线城市 60%';
  const works = worksMock[name] || `https://channels.weixin.qq.com/example/${inf.id}-1`;
  const official = officialMap[name] || (Math.random() < 0.3 ? '是' : '否');
  const r = updInf.run(intro, audience, works, official, name);
  if (r.changes > 0) infUpdated++;
}
console.log(`[V4 seed] 达人 4 字段补齐完成，更新 ${infUpdated} 条`);

// ========== 2. 商家需求 卖点+备注 字段 mock ==========
const updBd = db.prepare(`
  UPDATE book_demands SET
    selling_points = COALESCE(NULLIF(selling_points, ''), ?),
    remark = COALESCE(NULLIF(remark, ''), ?)
  WHERE id = ?
`);
const bdSell = {
  'bd001': '①教育部白名单图书 ②思维启蒙类畅销书 ③配套答案+解析视频',
  'bd002': '①国际安徒生奖获奖作品 ②3-6 岁亲子阅读首选 ③送精装收纳盒',
  'bd003': '①新课标推荐书目 ②附赠考点解析手册 ③知名出版社授权',
};
const bdRemark = {
  'bd001': '可提供达人专属优惠码，转化率高的达人可申请样书',
  'bd002': '订单需 7 个工作日内发货，节假日顺延',
  'bd003': '高考前推广效果最佳，建议 4-5 月集中投放',
};
let bdUpdated = 0;
for (const id of Object.keys(bdSell)) {
  const r = updBd.run(bdSell[id], bdRemark[id], id);
  if (r.changes > 0) bdUpdated++;
}
console.log(`[V4 seed] 图书需求卖点/备注补齐 ${bdUpdated} 条`);

const updCd = db.prepare(`
  UPDATE course_demands SET
    selling_points = COALESCE(NULLIF(selling_points, ''), ?),
    remark = COALESCE(NULLIF(remark, ''), ?)
  WHERE id = ?
`);
const cdSell = {
  'cd001': '①Scratch+Python 双轨课程 ②全国信息学奥赛教练授课 ③小班直播+录播双模式',
  'cd002': '①外教 1v1 拼读训练 ②AI 语音纠音 ③学完即可读绘本',
  'cd003': '①专业美院教师团队 ②每节课配套画材包邮 ③创意启蒙+技法兼顾',
};
const cdRemark = {
  'cd001': '寒暑假为转化高峰期，建议提前 2 周预热',
  'cd002': '学龄前家长决策快，建议直播+短视频组合投放',
  'cd003': '画材寄送需 5-7 天，建议预留缓冲时间',
};
let cdUpdated = 0;
for (const id of Object.keys(cdSell)) {
  const r = updCd.run(cdSell[id], cdRemark[id], id);
  if (r.changes > 0) cdUpdated++;
}
console.log(`[V4 seed] 课程需求卖点/备注补齐 ${cdUpdated} 条`);

// ========== 3. 置顶 mock ==========
// 商家需求广场置顶 2 条（图书 + 课程各 1）
const pinDemoCount = db.prepare("SELECT COUNT(*) as c FROM book_demands WHERE pinned_at IS NOT NULL").get().c;
if (pinDemoCount === 0) {
  db.prepare("UPDATE book_demands SET pinned_at = datetime('now') WHERE id = 'bd001'").run();
  db.prepare("UPDATE course_demands SET pinned_at = datetime('now', '-1 minutes') WHERE id = 'cd001'").run();
  console.log('[V4 seed] 商家需求置顶 2 条（bd001/cd001）');
}

// 达人需求广场置顶 2 条
const pinInfDem = db.prepare("SELECT COUNT(*) as c FROM influencer_demands WHERE pinned_at IS NOT NULL").get().c;
if (pinInfDem === 0) {
  db.prepare("UPDATE influencer_demands SET pinned_at = datetime('now') WHERE id = 'demo_infd_001'").run();
  db.prepare("UPDATE influencer_demands SET pinned_at = datetime('now', '-2 minutes') WHERE id = 'demo_infd_002'").run();
  console.log('[V4 seed] 达人需求置顶 2 条（demo_infd_001/002）');
}

// ========== 4. 收藏 mock ==========
const favCount = db.prepare('SELECT COUNT(*) as c FROM favorites').get().c;
if (favCount === 0) {
  const insFav = db.prepare(`
    INSERT INTO favorites (id, user_type, user_id, target_type, target_id)
    VALUES (?, ?, ?, ?, ?)
  `);
  // 管理员 a_super 收藏：1 个达人 + 1 个商家 + 1 个商家需求 + 1 个达人需求
  insFav.run(uuidv4(), 'admin', 'a_super', 'influencer', 'i001');
  insFav.run(uuidv4(), 'admin', 'a_super', 'merchant', 'm001');
  insFav.run(uuidv4(), 'admin', 'a_super', 'merchant_demand', 'd001');
  insFav.run(uuidv4(), 'admin', 'a_super', 'influencer_demand', 'demo_infd_001');

  // 商家 m001 收藏：2 个达人 + 1 个达人需求
  insFav.run(uuidv4(), 'merchant', 'm001', 'influencer', 'i001');
  insFav.run(uuidv4(), 'merchant', 'm001', 'influencer', 'i003');
  insFav.run(uuidv4(), 'merchant', 'm001', 'influencer_demand', 'demo_infd_001');

  // 达人 i001 收藏：2 个商家主体 + 1 个商家需求
  insFav.run(uuidv4(), 'influencer', 'i001', 'merchant', 'm001');
  insFav.run(uuidv4(), 'influencer', 'i001', 'merchant', 'm002');
  insFav.run(uuidv4(), 'influencer', 'i001', 'merchant_demand', 'd002');

  console.log('[V4 seed] 收藏数据预置完成（admin/merchant/influencer 各几条）');
}

console.log('[V4 seed] DONE');
db.close();
