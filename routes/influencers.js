const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { parseChineseNumber, normalizeText, normalizeYesNo } = require('../utils/chineseParser');

// 配置文件上传
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    // 处理中文文件名
    const safeName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    cb(null, Date.now() + '-' + safeName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls'].includes(ext)) cb(null, true);
    else cb(new Error('仅支持 .xlsx 或 .xls 格式'));
  }
});

// 达人 Excel 字段映射（每个数据库字段允许多种 Excel 表头别名）
const INFLUENCER_FIELD_ALIASES = {
  level: ['达人等级', '等级'],
  video_account_name: ['账号名称', '视频号', '账号名称', '达人名称', '视频号账号名称'],
  video_category_track: ['内容赛道', '带货品类', '品类赛道', '视频号带货品类赛道'],
  monthly_short_video_sales: ['短视频月销（万）', '短视频月销', '短视频销售额', '现视频号品类销售额（月）短视频（万）'],
  monthly_live_sales: ['直播月销（万）', '直播月销', '直播销售额', '现视频号品类销售额（月）直播（万）'],
  fans_count: ['粉丝数', '粉丝量', '视频号粉丝数量'],
  cooperation_type: ['合作类型', '可接受的合作类型'],
  book_willingness: ['图书带货意愿', '图书品类', '视频号图书品类带货意愿'],
  course_willingness: ['课程带货意愿', '课程品类', '视频号少儿课程品类带货意愿'],
  short_video_frequency: ['短视频频率', '短视频更新频率', '最近3个月、日常短视频更新频率'],
  live_frequency: ['直播频率', '直播更新频率', '最近3个月、日常直播频率'],
  has_mcn: ['是否签约MCN', '是否有MCN'],
  mcn_name: ['MCN机构名称', 'MCN名称'],
  region: ['所在地区', '地区'],
  has_joined_mutual_select: ['是否入驻互选', '是否已入驻互选'],
  sales_owner: ['归属销售'],
  official_account_name: ['公众号名称', '公众号账号名称'],
};

// 把行对象 row 按 alias 列表映射到 db 字段
function mapRowByAliases(row) {
  const out = {};
  // 把 row 的 key 也做归一化（去空格/换行）以提高容错
  const normalized = {};
  Object.keys(row).forEach(k => {
    const nk = String(k).replace(/\s+/g, '').replace(/\n/g, '');
    normalized[nk] = row[k];
  });
  for (const [field, aliases] of Object.entries(INFLUENCER_FIELD_ALIASES)) {
    let val = '';
    for (const alias of aliases) {
      // 直接匹配
      if (row[alias] !== undefined && row[alias] !== '') { val = row[alias]; break; }
      // 归一化匹配（处理换行/空格）
      const na = alias.replace(/\s+/g, '').replace(/\n/g, '');
      if (normalized[na] !== undefined && normalized[na] !== '') { val = normalized[na]; break; }
    }
    out[field] = val;
  }
  return out;
}

const INFLUENCER_FIELDS_ORDER = [
  '达人等级', '账号名称', '内容赛道',
  '短视频月销（万）', '直播月销（万）',
  '粉丝数', '合作类型', '图书带货意愿', '课程带货意愿',
  '短视频频率', '直播频率',
  '是否签约MCN', 'MCN机构名称', '所在地区',
  '是否入驻互选', '归属销售', '公众号名称'
];

// ========== Excel模板下载 (必须放在 /:id 之前) ==========
router.get('/excel/template', (req, res) => {
  try {
    const wb = XLSX.utils.book_new();
    const headers = INFLUENCER_FIELDS_ORDER;
    const sampleData = [
      headers,
      ['S', '读书小达人', '图书,教育', 15.5, 8.2, 500000, '纯佣,投流', '高', '中', '每周3-5条', '每周1-2场', '否', '', '北京', '是', '销售A', '读书小达人公众号'],
      ['A', '知识课堂', '课程,教育', 8.0, 25.0, 1200000, '纯佣,坑位费', '中', '高', '每周1-2条', '每周3-5场', '是', '星辰MCN', '上海', '是', '销售B', '知识课堂Official']
    ];
    const ws = XLSX.utils.aoa_to_sheet(sampleData);
    ws['!cols'] = headers.map(h => ({ wch: Math.max(h.length * 2, 14) }));
    XLSX.utils.book_append_sheet(wb, ws, '达人数据');
    
    const noteData = [
      ['字段', '说明', '是否必填'],
      ['达人等级', 'S/A/B/C/D等级', '否'],
      ['账号名称', '视频号昵称（唯一标识）', '是'],
      ['内容赛道', '多值，逗号分隔，如：图书,课程', '否'],
      ['短视频月销（万）', '数值，单位万元', '否'],
      ['直播月销（万）', '数值，单位万元', '否'],
      ['粉丝数', '数值', '否'],
      ['合作类型', '多值，如：纯佣,投流,坑位费', '否'],
      ['图书带货意愿', '高/中/低', '否'],
      ['课程带货意愿', '高/中/低', '否'],
      ['短视频频率', '如：每周3-5条', '否'],
      ['直播频率', '如：每周1-2场', '否'],
      ['是否签约MCN', '是/否', '否'],
      ['MCN机构名称', 'MCN机构全称', '否'],
      ['所在地区', '如：北京 / 广州 / 上海', '否'],
      ['是否入驻互选', '是/否', '否'],
      ['归属销售', '负责销售人员（系统自动关联）', '否'],
      ['公众号名称', '关联公众号名称', '否']
    ];
    const noteWs = XLSX.utils.aoa_to_sheet(noteData);
    noteWs['!cols'] = [{ wch: 35 }, { wch: 40 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, noteWs, '填写说明');
    
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('达人批量导入模板.xlsx')}`,
      'Content-Length': buf.length
    });
    res.send(buf);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 批量导入达人 Excel (必须放在 /:id 之前) ==========
router.post('/excel/import', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: '请上传Excel文件' });
    
    const wb = XLSX.readFile(req.file.path);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const jsonData = XLSX.utils.sheet_to_json(ws, { defval: '' });
    
    if (jsonData.length === 0) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, error: 'Excel文件为空或格式不正确' });
    }
    
    // 预加载销售人员名 → admin_id 映射，用于 sales_owner 文本→sales_owner_id 关联
    const salesAdmins = req.db.prepare(`SELECT id, name FROM admins WHERE admin_role='销售'`).all();
    const salesNameToId = {};
    salesAdmins.forEach(s => { salesNameToId[s.name] = s.id; });

    const results = { success: 0, failed: 0, updated: 0, inserted: 0, errors: [] };
    
    // 按 video_account_name UPSERT：重复账号则更新，新账号则插入
    const findStmt = req.db.prepare(`SELECT id FROM influencers WHERE video_account_name = ?`);
    const insertStmt = req.db.prepare(`
      INSERT INTO influencers (id, level, video_account_name, video_category_track, monthly_short_video_sales, monthly_live_sales, fans_count, cooperation_type, book_willingness, course_willingness, short_video_frequency, live_frequency, has_mcn, mcn_name, region, has_joined_mutual_select, sales_owner, sales_owner_id, official_account_name, password)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updateStmt = req.db.prepare(`
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

    const importTransaction = req.db.transaction((rows) => {
      rows.forEach((row, idx) => {
        try {
          const mapped = mapRowByAliases(row);
          const accountName = normalizeText(mapped.video_account_name);
          if (!accountName) {
            results.errors.push(`第${idx + 2}行：视频号账号名称为必填`);
            results.failed++;
            return;
          }

          const salesOwnerText = normalizeText(mapped.sales_owner);
          const salesOwnerId = salesNameToId[salesOwnerText] || null;

          const fields = {
            level: normalizeText(mapped.level),
            video_category_track: normalizeText(mapped.video_category_track),
            monthly_short_video_sales: parseChineseNumber(mapped.monthly_short_video_sales) || 0,
            monthly_live_sales: parseChineseNumber(mapped.monthly_live_sales) || 0,
            fans_count: parseChineseNumber(mapped.fans_count) || 0,
            cooperation_type: normalizeText(mapped.cooperation_type),
            book_willingness: normalizeText(mapped.book_willingness),
            course_willingness: normalizeText(mapped.course_willingness),
            short_video_frequency: normalizeText(mapped.short_video_frequency),
            live_frequency: normalizeText(mapped.live_frequency),
            has_mcn: normalizeYesNo(mapped.has_mcn, '否'),
            mcn_name: normalizeText(mapped.mcn_name),
            region: normalizeText(mapped.region),
            has_joined_mutual_select: normalizeYesNo(mapped.has_joined_mutual_select, '否'),
            sales_owner: salesOwnerText,
            sales_owner_id: salesOwnerId,
            official_account_name: normalizeText(mapped.official_account_name),
          };

          const existing = findStmt.get(accountName);
          if (existing) {
            updateStmt.run(
              fields.level, fields.video_category_track,
              fields.monthly_short_video_sales, fields.monthly_live_sales, fields.fans_count,
              fields.cooperation_type, fields.book_willingness, fields.course_willingness,
              fields.short_video_frequency, fields.live_frequency,
              fields.has_mcn, fields.mcn_name, fields.region,
              fields.has_joined_mutual_select, fields.sales_owner, fields.sales_owner_id,
              fields.official_account_name,
              existing.id
            );
            results.updated++;
          } else {
            const id = uuidv4();
            insertStmt.run(
              id, fields.level, accountName, fields.video_category_track,
              fields.monthly_short_video_sales, fields.monthly_live_sales, fields.fans_count,
              fields.cooperation_type, fields.book_willingness, fields.course_willingness,
              fields.short_video_frequency, fields.live_frequency,
              fields.has_mcn, fields.mcn_name, fields.region,
              fields.has_joined_mutual_select, fields.sales_owner, fields.sales_owner_id,
              fields.official_account_name, '123456'
            );
            results.inserted++;
          }
          results.success++;
        } catch (e) {
          results.errors.push(`第${idx + 2}行：${e.message}`);
          results.failed++;
        }
      });
    });
    
    importTransaction(jsonData);
    fs.unlinkSync(req.file.path);
    
    res.json({
      success: true,
      data: results,
      message: `导入完成：新增 ${results.inserted} 条，更新 ${results.updated} 条，失败 ${results.failed} 条`
    });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 获取所有达人（支持搜索+分页） ==========
router.get('/', (req, res) => {
  try {
    const {
      keyword, category, page, pageSize, operator_id, sales_owner_id,
      level, fans_min, fans_max, sales_min, sales_max,
      region_province, book_category, course_category,
      has_mcn, mutual_select, cooperation_type, filter_sales_id,
      sortField, sortOrder, status
    } = req.query;
    // 软删除过滤：默认隐藏已删除，status=deleted 时仅显示已删除
    const includeDeleted = status === 'deleted' || status === 'all';
    let sql = `SELECT i.*, a.name as sales_owner_name, a.username as sales_owner_username,
                 (COALESCE(i.monthly_short_video_sales, 0) + COALESCE(i.monthly_live_sales, 0)) as total_sales
               FROM influencers i 
               LEFT JOIN admins a ON i.sales_owner_id = a.id AND a.admin_role = '销售'
               WHERE 1=1`;
    let countSql = 'SELECT COUNT(*) as total FROM influencers i WHERE 1=1';
    const params = [];
    const countParams = [];

    if (!includeDeleted) {
      sql += " AND (i.status IS NULL OR i.status != 'deleted')";
      countSql += " AND (i.status IS NULL OR i.status != 'deleted')";
    } else if (status === 'deleted') {
      sql += " AND i.status = 'deleted'";
      countSql += " AND i.status = 'deleted'";
    }

    // 销售/运营权限过滤
    if (sales_owner_id) {
      const salesFilter = ` AND (i.sales_owner_id = ? OR i.sales_owner_id IS NULL OR i.sales_owner_id = '')`;
      sql += salesFilter; countSql += salesFilter;
      params.push(sales_owner_id); countParams.push(sales_owner_id);
    } else if (operator_id) {
      sql += ' AND i.operator_id = ?'; countSql += ' AND i.operator_id = ?';
      params.push(operator_id); countParams.push(operator_id);
    }

    // 等级（支持多选，逗号分隔）
    if (level) {
      const levels = String(level).split(',').filter(Boolean);
      if (levels.length) {
        const placeholders = levels.map(() => '?').join(',');
        sql += ` AND i.level IN (${placeholders})`;
        countSql += ` AND i.level IN (${placeholders})`;
        params.push(...levels); countParams.push(...levels);
      }
    }

    // 粉丝数区间
    if (fans_min !== undefined && fans_min !== '') {
      const v = parseInt(fans_min); if (!isNaN(v)) {
        sql += ' AND i.fans_count >= ?'; countSql += ' AND i.fans_count >= ?';
        params.push(v); countParams.push(v);
      }
    }
    if (fans_max !== undefined && fans_max !== '') {
      const v = parseInt(fans_max); if (!isNaN(v)) {
        sql += ' AND i.fans_count <= ?'; countSql += ' AND i.fans_count <= ?';
        params.push(v); countParams.push(v);
      }
    }

    // 月销总额（短视频+直播）区间
    if (sales_min !== undefined && sales_min !== '') {
      const v = parseInt(sales_min); if (!isNaN(v)) {
        sql += ' AND (COALESCE(i.monthly_short_video_sales,0) + COALESCE(i.monthly_live_sales,0)) >= ?';
        countSql += ' AND (COALESCE(i.monthly_short_video_sales,0) + COALESCE(i.monthly_live_sales,0)) >= ?';
        params.push(v); countParams.push(v);
      }
    }
    if (sales_max !== undefined && sales_max !== '') {
      const v = parseInt(sales_max); if (!isNaN(v)) {
        sql += ' AND (COALESCE(i.monthly_short_video_sales,0) + COALESCE(i.monthly_live_sales,0)) <= ?';
        countSql += ' AND (COALESCE(i.monthly_short_video_sales,0) + COALESCE(i.monthly_live_sales,0)) <= ?';
        params.push(v); countParams.push(v);
      }
    }

    // 地区（按省份模糊匹配）— 同时兼容"省,市"格式 + "市"单独存储的脏数据
    if (region_province) {
      // 该省份对应的城市列表（脏数据可能存的是城市名）
      const PROVINCE_TO_CITIES = {
        '浙江': ['杭州','宁波','温州','金华','嘉兴','绍兴','台州','湖州','丽水','衢州','舟山'],
        '湖北': ['武汉','宜昌','襄阳'],
        '广东': ['深圳','广州','东莞','佛山','珠海','中山','汕头'],
        '江苏': ['南京','苏州','无锡','常州','南通','徐州','扬州'],
        '山东': ['济南','青岛','烟台','潍坊','临沂','淄博'],
        '四川': ['成都','绵阳'],
        '陕西': ['西安','宝鸡'],
        '河南': ['郑州','洛阳','开封'],
        '湖南': ['长沙','株洲','岳阳'],
        '云南': ['昆明','大理'],
        '广西': ['南宁','桂林','柳州'],
        '河北': ['石家庄','保定','邯郸','唐山','秦皇岛'],
        '辽宁': ['沈阳','大连'],
        '吉林': ['长春'],
        '黑龙江': ['哈尔滨'],
        '山西': ['太原'],
        '安徽': ['合肥','芜湖'],
        '江西': ['南昌'],
        '福建': ['福州','厦门','泉州'],
        '海南': ['海口','三亚'],
        '贵州': ['贵阳'],
        '甘肃': ['兰州'],
        '青海': ['西宁'],
        '西藏': ['拉萨'],
        '宁夏': ['银川'],
        '新疆': ['乌鲁木齐'],
        '内蒙古': ['呼和浩特'],
      };
      const conditions = [`i.region LIKE ?`];
      const condParams = [`${region_province}%`];
      const cities = PROVINCE_TO_CITIES[region_province] || [];
      cities.forEach(c => {
        conditions.push(`i.region LIKE ?`);
        condParams.push(`${c}%`);
      });
      const clause = ' AND (' + conditions.join(' OR ') + ')';
      sql += clause; countSql += clause;
      params.push(...condParams); countParams.push(...condParams);
    }

    // 视频品类赛道
    if (category) {
      sql += ' AND i.video_category_track LIKE ?';
      countSql += ' AND i.video_category_track LIKE ?';
      params.push(`%${category}%`); countParams.push(`%${category}%`);
    }
    // 图书品类（book_willingness 字段实际存的是品类）
    if (book_category) {
      sql += ' AND i.book_willingness LIKE ?';
      countSql += ' AND i.book_willingness LIKE ?';
      params.push(`%${book_category}%`); countParams.push(`%${book_category}%`);
    }
    // 课程品类（course_willingness 字段实际存的是品类）
    if (course_category) {
      sql += ' AND i.course_willingness LIKE ?';
      countSql += ' AND i.course_willingness LIKE ?';
      params.push(`%${course_category}%`); countParams.push(`%${course_category}%`);
    }
    // 是否 MCN
    if (has_mcn) {
      sql += ' AND i.has_mcn = ?'; countSql += ' AND i.has_mcn = ?';
      params.push(has_mcn); countParams.push(has_mcn);
    }
    // 是否互选
    if (mutual_select) {
      sql += ' AND i.has_joined_mutual_select = ?';
      countSql += ' AND i.has_joined_mutual_select = ?';
      params.push(mutual_select); countParams.push(mutual_select);
    }
    // 合作类型（模糊匹配）
    if (cooperation_type) {
      sql += ' AND i.cooperation_type LIKE ?';
      countSql += ' AND i.cooperation_type LIKE ?';
      params.push(`%${cooperation_type}%`); countParams.push(`%${cooperation_type}%`);
    }
    // 主动按归属销售筛选（超管使用）
    if (filter_sales_id) {
      sql += ' AND i.sales_owner_id = ?';
      countSql += ' AND i.sales_owner_id = ?';
      params.push(filter_sales_id); countParams.push(filter_sales_id);
    }

    // 关键词搜索（扩展销售姓名）
    if (keyword) {
      const kwClause = ' AND (i.video_account_name LIKE ? OR i.video_category_track LIKE ? OR i.region LIKE ? OR i.mcn_name LIKE ? OR i.sales_owner LIKE ? OR i.cooperation_type LIKE ? OR i.level LIKE ? OR i.book_willingness LIKE ? OR i.course_willingness LIKE ? OR a.name LIKE ?)';
      sql += kwClause; countSql += kwClause.replace('a.name LIKE ?', 'i.sales_owner LIKE ?');
      const kw = `%${keyword}%`;
      params.push(kw, kw, kw, kw, kw, kw, kw, kw, kw, kw);
      countParams.push(kw, kw, kw, kw, kw, kw, kw, kw, kw, kw);
    }

    // 排序（白名单）
    const allowedSortFields = ['fans_count', 'total_sales', 'level', 'created_at', 'monthly_short_video_sales', 'monthly_live_sales'];
    let orderField = allowedSortFields.includes(sortField) ? sortField : 'fans_count';
    if (orderField === 'total_sales') {
      orderField = '(COALESCE(i.monthly_short_video_sales,0) + COALESCE(i.monthly_live_sales,0))';
    } else {
      orderField = `i.${orderField}`;
    }
    const dir = sortOrder === 'asc' ? 'ASC' : 'DESC';
    sql += ` ORDER BY ${orderField} ${dir}`;

    // 分页
    const currentPage = parseInt(page) || 1;
    const size = parseInt(pageSize) || 20;
    const offset = (currentPage - 1) * size;
    const total = req.db.prepare(countSql).get(...countParams).total;
    
    sql += ' LIMIT ? OFFSET ?';
    params.push(size, offset);
    
    const influencers = req.db.prepare(sql).all(...params);
    res.json({ 
      success: true, 
      data: influencers, 
      pagination: { page: currentPage, pageSize: size, total, totalPages: Math.ceil(total / size) }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 达人广场筛选选项 ==========
router.get('/filter-options', (req, res) => {
  try {
    // 等级
    const levelRows = req.db.prepare(`SELECT level, COUNT(*) as count FROM influencers WHERE level IS NOT NULL AND level != '' GROUP BY level ORDER BY level`).all();
    
    // 视频品类（多值，拆分去重）
    const trackRows = req.db.prepare(`SELECT DISTINCT video_category_track FROM influencers WHERE video_category_track IS NOT NULL AND video_category_track != ''`).all();
    const videoCategories = [...new Set(
      trackRows.flatMap(r => (r.video_category_track || '').split(/[,，、;；]/).map(s => s.trim()).filter(Boolean))
    )].sort();
    
    // 图书品类
    const bookRows = req.db.prepare(`SELECT DISTINCT book_willingness FROM influencers WHERE book_willingness IS NOT NULL AND book_willingness != ''`).all();
    const bookCategories = [...new Set(
      bookRows.flatMap(r => (r.book_willingness || '').split(/[,，、;；]/).map(s => s.trim()).filter(Boolean))
    )].sort();
    
    // 课程品类
    const courseRows = req.db.prepare(`SELECT DISTINCT course_willingness FROM influencers WHERE course_willingness IS NOT NULL AND course_willingness != ''`).all();
    const courseCategories = [...new Set(
      courseRows.flatMap(r => (r.course_willingness || '').split(/[,，、;；]/).map(s => s.trim()).filter(Boolean))
    )].sort();
    
    // 省份（地区"省,市"）— 规范化：只保留合法省份，单独"X市"反查省份
    const PROVINCES_WHITELIST = new Set([
      '北京','天津','上海','重庆',
      '河北','山西','辽宁','吉林','黑龙江','江苏','浙江','安徽','福建','江西','山东',
      '河南','湖北','湖南','广东','海南','四川','贵州','云南','陕西','甘肃','青海',
      '内蒙古','广西','西藏','宁夏','新疆',
      '香港','澳门','台湾'
    ]);
    const CITY_TO_PROVINCE = {
      '杭州':'浙江','宁波':'浙江','温州':'浙江','金华':'浙江','嘉兴':'浙江','绍兴':'浙江','台州':'浙江','湖州':'浙江','丽水':'浙江','衢州':'浙江','舟山':'浙江',
      '武汉':'湖北','宜昌':'湖北','襄阳':'湖北',
      '深圳':'广东','广州':'广东','东莞':'广东','佛山':'广东','珠海':'广东','中山':'广东','汕头':'广东',
      '南京':'江苏','苏州':'江苏','无锡':'江苏','常州':'江苏','南通':'江苏','徐州':'江苏','扬州':'江苏',
      '济南':'山东','青岛':'山东','烟台':'山东','潍坊':'山东','临沂':'山东','淄博':'山东',
      '成都':'四川','绵阳':'四川',
      '西安':'陕西','宝鸡':'陕西',
      '郑州':'河南','洛阳':'河南','开封':'河南',
      '长沙':'湖南','株洲':'湖南','岳阳':'湖南',
      '昆明':'云南','大理':'云南',
      '南宁':'广西','桂林':'广西','柳州':'广西',
      '石家庄':'河北','保定':'河北','邯郸':'河北','唐山':'河北','秦皇岛':'河北',
      '沈阳':'辽宁','大连':'辽宁',
      '长春':'吉林',
      '哈尔滨':'黑龙江',
      '太原':'山西',
      '合肥':'安徽','芜湖':'安徽',
      '南昌':'江西',
      '福州':'福建','厦门':'福建','泉州':'福建',
      '海口':'海南','三亚':'海南',
      '贵阳':'贵州',
      '兰州':'甘肃',
      '西宁':'青海',
      '拉萨':'西藏',
      '银川':'宁夏',
      '乌鲁木齐':'新疆',
      '呼和浩特':'内蒙古',
      '香港':'香港','澳门':'澳门','台北':'台湾',
    };
    const regionRows = req.db.prepare(`SELECT DISTINCT region FROM influencers WHERE region IS NOT NULL AND region != ''`).all();
    const provinceSet = new Set();
    regionRows.forEach(r => {
      const raw = (r.region || '').split(/[,，、]/)[0].trim().replace(/[省市自治区]+$/, '');
      if (!raw) return;
      if (PROVINCES_WHITELIST.has(raw)) {
        provinceSet.add(raw);
      } else if (CITY_TO_PROVINCE[raw]) {
        provinceSet.add(CITY_TO_PROVINCE[raw]);
      }
    });
    const provinces = [...provinceSet].sort();
    
    // 合作类型
    const coopRows = req.db.prepare(`SELECT DISTINCT cooperation_type FROM influencers WHERE cooperation_type IS NOT NULL AND cooperation_type != ''`).all();
    const cooperationTypes = [...new Set(
      coopRows.flatMap(r => (r.cooperation_type || '').split(/[,，、;；]/).map(s => s.trim()).filter(Boolean))
    )].sort();
    
    // 销售人员
    const salesList = req.db.prepare(`SELECT id, name FROM admins WHERE admin_role = '销售' ORDER BY name`).all();
    
    res.json({
      success: true,
      data: {
        levels: levelRows,
        videoCategories,
        bookCategories,
        courseCategories,
        provinces,
        cooperationTypes,
        salesList
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 达人名单导出 (CSV) ==========
router.get('/export', (req, res) => {
  try {
    const { keyword, level, operator_id, sales_owner_id, has_mcn } = req.query;
    let sql = `SELECT inf.*, sa.name as sales_owner_name FROM influencers inf
               LEFT JOIN admins sa ON inf.sales_owner_id = sa.id AND sa.admin_role = '销售'
               WHERE 1=1`;
    const params = [];
    if (sales_owner_id) {
      sql += " AND (inf.sales_owner_id = ? OR inf.sales_owner_id IS NULL OR inf.sales_owner_id = '')";
      params.push(sales_owner_id);
    } else if (operator_id) {
      sql += ' AND inf.operator_id = ?';
      params.push(operator_id);
    }
    if (level) { sql += ' AND inf.level = ?'; params.push(level); }
    if (has_mcn) { sql += ' AND inf.has_mcn = ?'; params.push(has_mcn); }
    if (keyword) {
      const kw = '%' + keyword + '%';
      sql += ' AND (inf.video_account_name LIKE ? OR inf.region LIKE ? OR inf.video_category_track LIKE ?)';
      params.push(kw, kw, kw);
    }
    sql += ' ORDER BY CAST(inf.fans_count AS INTEGER) DESC';
    const rows = req.db.prepare(sql).all(...params);

    // CSV 头
    const headers = [
      '达人ID', '等级', '视频号账号', '视频号官方账号', '内容赛道', '所在地',
      '粉丝量', '月度短视频销售额', '月度直播销售额',
      '合作类型', '图书带货意向', '课程带货意向',
      '短视频频次', '直播频次', '是否MCN', 'MCN名称', '互选状态',
      '归属销售', '创建时间'
    ];
    const escape = (v) => {
      if (v == null) return '';
      const s = String(v).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    };
    const lines = [headers.join(',')];
    rows.forEach(r => {
      lines.push([
        r.id, r.level, r.video_account_name, r.official_account_name,
        r.video_category_track, r.region,
        r.fans_count, r.monthly_short_video_sales, r.monthly_live_sales,
        r.cooperation_type, r.book_willingness, r.course_willingness,
        r.short_video_frequency, r.live_frequency, r.has_mcn, r.mcn_name,
        r.has_joined_mutual_select,
        r.sales_owner_name || r.sales_owner || '', r.created_at
      ].map(escape).join(','));
    });
    const csv = '\uFEFF' + lines.join('\n'); // BOM 避免中文乱码

    const filename = `influencers_${new Date().toISOString().slice(0,10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 达人广场顶部数据条 ==========
router.get('/hero-stats', (req, res) => {
  try {
    const { operator_id, sales_owner_id } = req.query;
    let where = '';
    const params = [];
    if (sales_owner_id) {
      where = ` AND (sales_owner_id = ? OR sales_owner_id IS NULL OR sales_owner_id = '')`;
      params.push(sales_owner_id);
    } else if (operator_id) {
      where = ` AND operator_id = ?`;
      params.push(operator_id);
    }
    const total = req.db.prepare(`SELECT COUNT(*) as c FROM influencers WHERE 1=1${where}`).get(...params).c;
    const levels = req.db.prepare(`SELECT level, COUNT(*) as c FROM influencers WHERE level IS NOT NULL AND level != ''${where} GROUP BY level ORDER BY level`).all(...params);
    const mcnCount = req.db.prepare(`SELECT COUNT(*) as c FROM influencers WHERE has_mcn = '是'${where}`).get(...params).c;
    const mutualCount = req.db.prepare(`SELECT COUNT(*) as c FROM influencers WHERE has_joined_mutual_select = '是'${where}`).get(...params).c;
    const oneM = new Date(); oneM.setMonth(oneM.getMonth() - 1);
    const newCount = req.db.prepare(`SELECT COUNT(*) as c FROM influencers WHERE created_at >= ?${where}`).get(oneM.toISOString().slice(0,19).replace('T',' '), ...params).c;
    const highSales = req.db.prepare(`SELECT COUNT(*) as c FROM influencers WHERE (COALESCE(monthly_short_video_sales,0) + COALESCE(monthly_live_sales,0)) >= 100000${where}`).get(...params).c;
    res.json({
      success: true,
      data: { total, levels, mcnCount, mutualCount, newCount, highSales }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 达人推荐 ==========
router.post('/recommend', (req, res) => {
  try {
    const { type, book_name, book_introduction, target_audience, selling_price, book_category } = req.body;
    
    let allInfluencers = req.db.prepare('SELECT * FROM influencers').all();
    
    const scored = allInfluencers.map(inf => {
      let score = 0;
      const tracks = (inf.video_category_track || '').toLowerCase();
      
      if (type === 'book' || !type) {
        if (tracks.includes('图书') || tracks.includes('教育')) score += 30;
        if (inf.book_willingness === '高') score += 25;
        else if (inf.book_willingness === '中') score += 15;
        if (target_audience && book_category) {
          if (tracks.includes('亲子') && (target_audience.includes('家长') || target_audience.includes('宝妈'))) score += 15;
          if (tracks.includes('教育') && (target_audience.includes('学生') || target_audience.includes('教师'))) score += 15;
        }
        if (inf.monthly_short_video_sales >= 10) score += 15;
        else if (inf.monthly_short_video_sales >= 5) score += 10;
        if (inf.fans_count >= 1000000) score += 15;
        else if (inf.fans_count >= 500000) score += 10;
        else if (inf.fans_count >= 200000) score += 5;
      } else {
        if (tracks.includes('课程') || tracks.includes('教育')) score += 30;
        if (inf.course_willingness === '高') score += 25;
        else if (inf.course_willingness === '中') score += 15;
        if (inf.monthly_live_sales >= 20) score += 15;
        else if (inf.monthly_live_sales >= 10) score += 10;
        if (inf.live_frequency && (inf.live_frequency.includes('每天') || inf.live_frequency.includes('每周3'))) score += 10;
        if (inf.fans_count >= 1000000) score += 15;
        else if (inf.fans_count >= 500000) score += 10;
        else if (inf.fans_count >= 200000) score += 5;
      }
      
      return { ...inf, matchScore: Math.min(score, 100) };
    })
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 10);
    
    res.json({ success: true, data: scored });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 获取单个达人 ==========
router.get('/:id', (req, res) => {
  try {
    const influencer = req.db.prepare('SELECT * FROM influencers WHERE id = ?').get(req.params.id);
    if (!influencer) return res.status(404).json({ success: false, error: '达人不存在' });
    res.json({ success: true, data: influencer });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 更新达人信息 ==========
router.put('/:id', (req, res) => {
  try {
    const id = req.params.id;
    const existing = req.db.prepare('SELECT * FROM influencers WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ success: false, error: '达人不存在' });
    
    // 联动处理：若传入 sales_owner_id，则用管理员当前 name 覆盖 sales_owner 文本；若仅传 sales_owner 文本，则尝试反查 id
    const body = { ...req.body };
    if (body.sales_owner_id !== undefined) {
      if (body.sales_owner_id) {
        const adm = req.db.prepare("SELECT name FROM admins WHERE id = ? AND admin_role = '销售'").get(body.sales_owner_id);
        if (adm) {
          body.sales_owner = adm.name;
        } else {
          body.sales_owner_id = null;
        }
      } else {
        // 清空关联时不动文本
      }
    } else if (body.sales_owner !== undefined && body.sales_owner) {
      const key = String(body.sales_owner).trim();
      const adm = req.db.prepare("SELECT id, name FROM admins WHERE admin_role = '销售' AND (name = ? OR username = ?)").get(key, key);
      if (adm) {
        body.sales_owner_id = adm.id;
        body.sales_owner = adm.name;
      }
    }
    
    const fields = ['level', 'video_account_name', 'video_category_track', 'monthly_short_video_sales', 'monthly_live_sales', 'fans_count', 'cooperation_type', 'book_willingness', 'course_willingness', 'short_video_frequency', 'live_frequency', 'has_mcn', 'mcn_name', 'region', 'has_joined_mutual_select', 'sales_owner', 'official_account_name', 'sales_owner_id'];
    
    const updates = [];
    const params = [];
    for (const field of fields) {
      if (body[field] !== undefined) {
        updates.push(`${field} = ?`);
        params.push(body[field]);
      }
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: '没有需要更新的字段' });
    }
    
    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);
    
    req.db.prepare(`UPDATE influencers SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    
    const updated = req.db.prepare('SELECT * FROM influencers WHERE id = ?').get(id);
    res.json({ success: true, data: updated, message: '更新成功' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 单独添加达人 (必须放在 /:id 之前) ==========
// 可选参数 invite_mode=1：走邀请制（status=pending，生成 invite_code，不设密码）
router.post('/add', (req, res) => {
  try {
    let { level, video_account_name, video_category_track, monthly_short_video_sales, monthly_live_sales, fans_count, cooperation_type, book_willingness, course_willingness, short_video_frequency, live_frequency, has_mcn, mcn_name, region, has_joined_mutual_select, sales_owner, official_account_name, operator_id, sales_owner_id, invite_mode, invited_by } = req.body;

    if (!video_account_name) {
      return res.status(400).json({ success: false, error: '视频号账号名称为必填' });
    }

    // 唯一性：video_account_name 全局唯一
    const dup = req.db.prepare('SELECT id FROM influencers WHERE video_account_name = ?').get(video_account_name);
    if (dup) {
      return res.status(400).json({ success: false, error: '该视频号账号名已存在' });
    }
    
    // 联动：若传了 sales_owner_id，则以管理员当前 name 覆盖 sales_owner 文本
    if (sales_owner_id) {
      const adm = req.db.prepare("SELECT name, username FROM admins WHERE id = ? AND admin_role = '销售'").get(sales_owner_id);
      if (adm) {
        sales_owner = adm.name;
      } else {
        // 无效 id 清空
        sales_owner_id = null;
      }
    } else if (sales_owner && String(sales_owner).trim()) {
      // 反查：没传 id 但传了 name/username，模糊匹配销售角色管理员
      const key = String(sales_owner).trim();
      const adm = req.db.prepare("SELECT id, name FROM admins WHERE admin_role = '销售' AND (name = ? OR username = ?)").get(key, key);
      if (adm) {
        sales_owner_id = adm.id;
        sales_owner = adm.name;
      }
    }
    
    const id = uuidv4();
    const isInviteMode = invite_mode === 1 || invite_mode === '1' || invite_mode === true;
    const inviteCode = isInviteMode ? uuidv4() : null;
    const inviteStatus = isInviteMode ? 'pending' : 'active';
    const finalPassword = isInviteMode ? '' : '123456';

    req.db.prepare(`
      INSERT INTO influencers (id, level, video_account_name, video_category_track, monthly_short_video_sales, monthly_live_sales, fans_count, cooperation_type, book_willingness, course_willingness, short_video_frequency, live_frequency, has_mcn, mcn_name, region, has_joined_mutual_select, sales_owner, official_account_name, password, operator_id, sales_owner_id,
        invite_code, invite_status, invited_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, level || '', video_account_name,
      video_category_track || '',
      parseFloat(monthly_short_video_sales) || 0,
      parseFloat(monthly_live_sales) || 0,
      parseInt(fans_count) || 0,
      cooperation_type || '', book_willingness || '',
      course_willingness || '', short_video_frequency || '',
      live_frequency || '', has_mcn || '否',
      mcn_name || '', region || '',
      has_joined_mutual_select || '否',
      sales_owner || '', official_account_name || '', finalPassword,
      operator_id || null, sales_owner_id || null,
      inviteCode, inviteStatus, invited_by || null
    );

    const newInf = req.db.prepare('SELECT * FROM influencers WHERE id = ?').get(id);
    res.status(201).json({ success: true, data: newInf, invite_code: inviteCode });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 批量删除达人 ==========
router.post('/batch-delete', (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: '请提供需要删除的ID列表' });
    }
    const placeholders = ids.map(() => '?').join(',');
    // 先删除关联数据
    req.db.prepare(`DELETE FROM orders WHERE influencer_id IN (${placeholders})`).run(...ids);
    req.db.prepare(`DELETE FROM influencer_demands WHERE influencer_id IN (${placeholders})`).run(...ids);
    req.db.prepare(`DELETE FROM influencers WHERE id IN (${placeholders})`).run(...ids);
    res.json({ success: true, message: `成功删除 ${ids.length} 位达人` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 删除达人（软删除） ==========
router.delete('/:id', (req, res) => {
  try {
    const existing = req.db.prepare('SELECT * FROM influencers WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ success: false, error: '达人不存在' });
    // 检查关联数据
    const orderCount = req.db.prepare('SELECT COUNT(*) as c FROM orders WHERE influencer_id = ?').get(req.params.id).c;
    const coopCount = req.db.prepare('SELECT COUNT(*) as c FROM cooperation WHERE influencer_id = ?').get(req.params.id).c;
    const mmCount = req.db.prepare('SELECT COUNT(*) as c FROM matchmaking WHERE influencer_id = ?').get(req.params.id).c;
    if (orderCount > 0 || coopCount > 0 || mmCount > 0) {
      return res.status(400).json({ success: false, error: `该达人存在关联数据（${orderCount}条接单 / ${coopCount}条合作 / ${mmCount}条撮合），无法删除`, data: { requireForce: true, orderCount, coopCount, mmCount } });
    }
    req.db.prepare("UPDATE influencers SET status = 'deleted', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.id);
    res.json({ success: true, message: '达人已删除（软删除，可恢复）' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 恢复软删除的达人 ==========
router.put('/:id/restore', (req, res) => {
  try {
    req.db.prepare("UPDATE influencers SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.id);
    res.json({ success: true, message: '达人已恢复' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 获取邀请链接（pending 状态可用） ==========
router.get('/:id/invite-code', (req, res) => {
  try {
    const inf = req.db.prepare('SELECT id, video_account_name, invite_code, invite_status FROM influencers WHERE id = ?').get(req.params.id);
    if (!inf) return res.status(404).json({ success: false, error: '达人不存在' });
    if (inf.invite_status !== 'pending') return res.status(400).json({ success: false, error: '该达人账号已激活，无需邀请' });
    let code = inf.invite_code;
    if (!code) {
      code = uuidv4();
      req.db.prepare('UPDATE influencers SET invite_code = ? WHERE id = ?').run(code, req.params.id);
    }
    res.json({ success: true, data: { code, video_account_name: inf.video_account_name } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 停用/启用 达人账号 ==========
router.put('/:id/invite-status', (req, res) => {
  try {
    const { invite_status } = req.body;
    if (!['active', 'disabled'].includes(invite_status)) {
      return res.status(400).json({ success: false, error: '只能设为 active 或 disabled' });
    }
    req.db.prepare('UPDATE influencers SET invite_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(invite_status, req.params.id);
    res.json({ success: true, message: invite_status === 'active' ? '已启用' : '已停用' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 重置密码 ==========
router.put('/:id/reset-password', (req, res) => {
  try {
    const newPwd = req.body.password || '123456';
    req.db.prepare('UPDATE influencers SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newPwd, req.params.id);
    res.json({ success: true, message: `密码已重置为 ${newPwd}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
