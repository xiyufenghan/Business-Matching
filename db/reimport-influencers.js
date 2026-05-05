// 重新导入达人数据：直接读取 达人等级全部.xlsx，覆盖现有 influencers 表
// 用途：
//   1. 修复早期导入时 parseFloat("5万")=5 等解析错误
//   2. 自动关联销售姓名→admin_id
// 运行：node db/reimport-influencers.js

const Database = require('better-sqlite3');
const XLSX = require('xlsx');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { parseChineseNumber, normalizeText, normalizeYesNo } = require('../utils/chineseParser');

const db = new Database(path.join(__dirname, 'merchant_match.db'));
const xlsxPath = path.join(__dirname, '..', '达人等级全部.xlsx');

// === 字段映射（与 routes/influencers.js 保持一致）===
const FIELD_ALIASES = {
  level: ['达人等级', '等级'],
  video_account_name: ['视频号账号名称', '视频号', '账号名称'],
  video_category_track: ['视频号带货品类赛道', '带货品类'],
  monthly_short_video_sales: ['现视频号品类销售额（月）短视频（万）', '现视频号品类销售额（月）\n短视频（万）'],
  monthly_live_sales: ['现视频号品类销售额（月）直播（万）', '现视频号品类销售额（月）\n直播（万）'],
  fans_count: ['视频号粉丝数量'],
  cooperation_type: ['可接受的合作类型'],
  book_willingness: ['视频号图书品类带货意愿'],
  course_willingness: ['视频号少儿课程品类带货意愿'],
  short_video_frequency: ['最近3个月、日常短视频更新频率', '最近3个月短视频更新频率'],
  live_frequency: ['最近3个月、日常直播频率', '最近3个月直播频率'],
  has_mcn: ['是否有MCN'],
  mcn_name: ['MCN名称'],
  region: ['地区'],
  has_joined_mutual_select: ['是否已入驻互选'],
  sales_owner: ['归属销售'],
  official_account_name: ['公众号账号名称', '公众号名称'],
};

function mapRow(row) {
  const out = {};
  const normalized = {};
  Object.keys(row).forEach(k => {
    normalized[String(k).replace(/\s+/g, '').replace(/\n/g, '')] = row[k];
  });
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    let val = '';
    for (const alias of aliases) {
      if (row[alias] !== undefined && row[alias] !== '') { val = row[alias]; break; }
      const na = alias.replace(/\s+/g, '').replace(/\n/g, '');
      if (normalized[na] !== undefined && normalized[na] !== '') { val = normalized[na]; break; }
    }
    out[field] = val;
  }
  return out;
}

console.log('==> 重新导入达人数据');
console.log('Excel 文件:', xlsxPath);

const wb = XLSX.readFile(xlsxPath);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
console.log(`📦 Excel 共 ${rows.length} 行`);

// 销售姓名 → admin_id 映射
const salesAdmins = db.prepare(`SELECT id, name FROM admins WHERE admin_role='销售'`).all();
const salesNameToId = {};
salesAdmins.forEach(s => { salesNameToId[s.name] = s.id; });
console.log(`📦 销售人员: ${salesAdmins.map(s => s.name).join(', ')}`);

// 先备份现有数据中的关联引用（cooperation/orders/matchmaking 引用 influencer_id），保留旧 ID 映射
const existingRows = db.prepare(`SELECT id, video_account_name FROM influencers`).all();
const existingNameToId = {};
existingRows.forEach(r => { existingNameToId[r.video_account_name] = r.id; });
console.log(`📦 现有达人 ${existingRows.length} 条`);

// === 开始事务式 UPSERT ===
const insertStmt = db.prepare(`
  INSERT INTO influencers (id, level, video_account_name, video_category_track, monthly_short_video_sales, monthly_live_sales, fans_count, cooperation_type, book_willingness, course_willingness, short_video_frequency, live_frequency, has_mcn, mcn_name, region, has_joined_mutual_select, sales_owner, sales_owner_id, official_account_name, password)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const updateStmt = db.prepare(`
  UPDATE influencers SET 
    level = ?, video_category_track = ?,
    monthly_short_video_sales = ?, monthly_live_sales = ?, fans_count = ?,
    cooperation_type = ?, book_willingness = ?, course_willingness = ?,
    short_video_frequency = ?, live_frequency = ?,
    has_mcn = ?, mcn_name = ?, region = ?,
    has_joined_mutual_select = ?, sales_owner = ?, sales_owner_id = ?,
    official_account_name = ?, updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const stats = { inserted: 0, updated: 0, skipped: 0, errors: [] };

const tx = db.transaction(() => {
  rows.forEach((row, idx) => {
    try {
      const m = mapRow(row);
      const accountName = normalizeText(m.video_account_name);
      if (!accountName) { stats.skipped++; return; }

      const salesText = normalizeText(m.sales_owner);
      const salesId = salesNameToId[salesText] || null;

      const fields = [
        normalizeText(m.level),                           // level
        normalizeText(m.video_category_track),            // video_category_track
        parseChineseNumber(m.monthly_short_video_sales) || 0,
        parseChineseNumber(m.monthly_live_sales) || 0,
        parseChineseNumber(m.fans_count) || 0,
        normalizeText(m.cooperation_type),
        normalizeText(m.book_willingness),
        normalizeText(m.course_willingness),
        normalizeText(m.short_video_frequency),
        normalizeText(m.live_frequency),
        normalizeYesNo(m.has_mcn, '否'),
        normalizeText(m.mcn_name),
        normalizeText(m.region),
        normalizeYesNo(m.has_joined_mutual_select, '否'),
        salesText,
        salesId,
        normalizeText(m.official_account_name),
      ];

      const existingId = existingNameToId[accountName];
      if (existingId) {
        // UPDATE: 保留原 id，外键不破坏
        updateStmt.run(...fields, existingId);
        stats.updated++;
      } else {
        // INSERT
        insertStmt.run(uuidv4(),
          fields[0], accountName, fields[1],
          fields[2], fields[3], fields[4],
          fields[5], fields[6], fields[7],
          fields[8], fields[9],
          fields[10], fields[11], fields[12],
          fields[13], fields[14], fields[15],
          fields[16],
          '123456'
        );
        stats.inserted++;
      }
    } catch (e) {
      stats.errors.push(`行 ${idx + 2}: ${e.message}`);
    }
  });
});

tx();

// 校验：抽 5 个看修复效果
console.log(`\n========== 导入完成 ==========`);
console.log(`✅ 新增: ${stats.inserted}`);
console.log(`✅ 更新: ${stats.updated}`);
console.log(`⚠️  跳过: ${stats.skipped}`);
console.log(`❌ 失败: ${stats.errors.length}`);
if (stats.errors.length) console.log('错误示例:', stats.errors.slice(0, 3));

console.log(`\n校验抽样:`);
const samples = db.prepare(`
  SELECT video_account_name, level, fans_count, monthly_short_video_sales, monthly_live_sales, sales_owner, sales_owner_id
  FROM influencers WHERE fans_count > 100000 ORDER BY fans_count DESC LIMIT 5
`).all();
samples.forEach(s => {
  console.log(`  ${s.video_account_name} | ${s.level} | 粉丝${s.fans_count} | 短视频¥${s.monthly_short_video_sales} | 直播¥${s.monthly_live_sales} | 销售=${s.sales_owner}(${s.sales_owner_id ? '已关联' : '未关联'})`);
});

console.log(`\n关键字段统计:`);
const r1 = db.prepare(`SELECT COUNT(*) as c FROM influencers WHERE fans_count > 0`).get().c;
const r2 = db.prepare(`SELECT COUNT(*) as c FROM influencers WHERE monthly_short_video_sales > 0`).get().c;
const r3 = db.prepare(`SELECT COUNT(*) as c FROM influencers WHERE monthly_live_sales > 0`).get().c;
const r4 = db.prepare(`SELECT COUNT(*) as c FROM influencers WHERE sales_owner_id IS NOT NULL`).get().c;
console.log(`  粉丝数 > 0: ${r1}`);
console.log(`  短视频月销 > 0: ${r2}`);
console.log(`  直播月销 > 0: ${r3}`);
console.log(`  已关联销售 admin_id: ${r4}`);

db.close();
