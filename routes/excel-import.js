const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// 配置文件上传
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
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

// 图书需求字段映射
const BOOK_FIELD_MAP = {
  '图书图片': 'book_image',
  '图书商家': 'book_merchant',
  '图书名称': 'book_name',
  '目标人群': 'target_audience',
  '图书分类': 'book_category',
  '产品图片': 'product_image',
  '图书介绍': 'book_introduction',
  '微信小店商品链接': 'wechat_shop_link',
  '图书规格': 'specification',
  '售价': 'selling_price',
  '纯佣金': 'pure_commission',
  '投流佣金': 'ad_commission',
  '物流快递': 'logistics',
  '库存': 'stock',
  '归属销售': 'sales_owner_name'
};

const BOOK_FIELDS_ORDER = [
  '图书图片', '图书商家', '图书名称', '目标人群', '图书分类', '产品图片',
  '图书介绍', '微信小店商品链接', '图书规格', '售价',
  '纯佣金', '投流佣金', '物流快递', '库存', '归属销售'
];

// 课程需求字段映射
const COURSE_FIELD_MAP = {
  '课程图片': 'course_image',
  '课程商家': 'course_merchant',
  '课程名称': 'course_name',
  '课程价格': 'unit_price',
  '学段': 'grade_level',
  '学科': 'subject',
  '课程介绍': 'course_introduction',
  '课程链接': 'course_link',
  '归属销售': 'sales_owner_name'
};

const COURSE_FIELDS_ORDER = [
  '课程图片', '课程商家', '课程名称', '课程价格',
  '学段', '学科', '课程介绍', '课程链接', '归属销售'
];

// 工具函数：根据商家名称查找或自动创建 merchant
function findOrCreateMerchant(db, merchantName, salesOwnerId) {
  if (!merchantName) return null;
  // 先按 company 或 name 精确匹配
  let merchant = db.prepare('SELECT id FROM merchants WHERE company = ? OR name = ? LIMIT 1').get(merchantName, merchantName);
  if (merchant) return merchant.id;
  // 不存在则自动创建
  const id = uuidv4();
  db.prepare(`INSERT INTO merchants (id, name, company, phone, email, industry, description, sales_owner_id)
              VALUES (?, ?, ?, '', '', '图书/课程', '批量导入自动创建', ?)`)
    .run(id, merchantName, merchantName, salesOwnerId || null);
  return id;
}

// 工具函数：根据销售姓名查找销售管理员ID
function findSalesOwnerId(db, salesName) {
  if (!salesName) return null;
  const row = db.prepare("SELECT id FROM admins WHERE admin_role = '销售' AND (name = ? OR username = ?) LIMIT 1").get(salesName, salesName);
  return row ? row.id : null;
}

// 下载 Excel 模板
router.get('/template/:type', (req, res) => {
  try {
    const type = req.params.type;
    const wb = XLSX.utils.book_new();
    
    if (type === 'book') {
      const headers = BOOK_FIELDS_ORDER;
      const sampleData = [
        headers,
        ['', '知行图书出版社', '趣味数学思维训练', '小学生,家长', '教育图书', '', '适合6-12岁儿童的数学思维训练', 'https://shop.weixin.qq.com/xxx', '单本', 39.9, 25, 35, '中通快递', 5000, '销售小王'],
        ['', '启明文化传媒', '经典绘本套装', '幼儿,宝妈,教师', '儿童绘本', '', '获奖绘本合集，3-6岁适读', 'https://shop.weixin.qq.com/yyy', '套组', 128, 30, 40, '顺丰快递', 3000, '销售小李']
      ];
      const ws = XLSX.utils.aoa_to_sheet(sampleData);
      ws['!cols'] = headers.map(h => ({ wch: Math.max(h.length * 2, 12) }));
      XLSX.utils.book_append_sheet(wb, ws, '图书需求');
      
      const noteData = [
        ['字段', '说明', '是否必填'],
        ['图书图片', '图书封面图片URL（PNG/JPG，≤200K，正方形）', '否'],
        ['图书商家', '商家/出版社名称（不存在将自动创建商家）', '是'],
        ['图书名称', '图书名称', '是'],
        ['目标人群', '多值输入，逗号分隔，如：小学生,家长', '否'],
        ['图书分类', '多值输入，逗号分隔，如：教育图书,儿童绘本', '是'],
        ['产品图片', '产品详情图片URL（PNG/JPG，≤200K，正方形）', '否'],
        ['图书介绍', '简要介绍', '否'],
        ['微信小店商品链接', '商品URL', '否'],
        ['图书规格', '可选：单本 或 套组', '否'],
        ['售价', '数值，单位元', '是'],
        ['纯佣金', '数值，百分比', '是'],
        ['投流佣金', '数值，百分比', '否'],
        ['物流快递', '快递公司', '否'],
        ['库存', '数值', '否'],
        ['归属销售', '销售管理员的姓名或账号，需与系统中"销售"角色管理员匹配', '否']
      ];
      const noteWs = XLSX.utils.aoa_to_sheet(noteData);
      noteWs['!cols'] = [{ wch: 18 }, { wch: 50 }, { wch: 10 }];
      XLSX.utils.book_append_sheet(wb, noteWs, '填写说明');
    } else if (type === 'course') {
      const headers = COURSE_FIELDS_ORDER;
      const sampleData = [
        headers,
        ['', '少儿编程学院', '少儿编程入门班', 1999, '小学,初中', '编程,信息技术', 'Scratch+Python双轨课程', 'https://edu.example.com/course1', '销售小王'],
        ['', '外语教育集团', '英语自然拼读', 899, '幼儿园,小学', '英语', '外教自然拼读课程', 'https://edu.example.com/course2', '销售小李']
      ];
      const ws = XLSX.utils.aoa_to_sheet(sampleData);
      ws['!cols'] = headers.map(h => ({ wch: Math.max(h.length * 2, 12) }));
      XLSX.utils.book_append_sheet(wb, ws, '课程需求');
      
      const noteData = [
        ['字段', '说明', '是否必填'],
        ['课程图片', '课程封面图片URL（PNG/JPG，≤200K，正方形）', '否'],
        ['课程商家', '商家/机构名称（不存在将自动创建商家）', '是'],
        ['课程名称', '课程名称', '是'],
        ['课程价格', '数值，单位元', '是'],
        ['学段', '多值，逗号分隔，如：小学,初中', '否'],
        ['学科', '多值，逗号分隔，如：数学,英语', '否'],
        ['课程介绍', '简要介绍', '否'],
        ['课程链接', '课程URL', '否'],
        ['归属销售', '销售管理员的姓名或账号，需与系统中"销售"角色管理员匹配', '否']
      ];
      const noteWs = XLSX.utils.aoa_to_sheet(noteData);
      noteWs['!cols'] = [{ wch: 18 }, { wch: 50 }, { wch: 10 }];
      XLSX.utils.book_append_sheet(wb, noteWs, '填写说明');
    } else {
      return res.status(400).json({ success: false, error: '类型仅支持 book 或 course' });
    }
    
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = type === 'book' ? '图书需求批量导入模板.xlsx' : '课程需求批量导入模板.xlsx';
    
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Content-Length': buf.length
    });
    res.send(buf);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 上传 Excel - 图书需求
router.post('/import/book', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: '请上传Excel文件' });
    
    const merchantId = req.body.merchant_id;
    if (!merchantId) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, error: '请指定商家ID' });
    }
    
    const isAdmin = merchantId === 'admin';
    
    // 非管理员：验证商家存在性
    if (!isAdmin) {
      const merchant = req.db.prepare('SELECT id, company FROM merchants WHERE id = ?').get(merchantId);
      if (!merchant) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ success: false, error: '商家不存在，请联系管理员' });
      }
    }
    
    const wb = XLSX.readFile(req.file.path);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const jsonData = XLSX.utils.sheet_to_json(ws, { defval: '' });
    
    if (jsonData.length === 0) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, error: 'Excel文件为空或格式不正确' });
    }
    
    const results = { success: 0, failed: 0, errors: [] };
    
    if (isAdmin) req.db.pragma('foreign_keys = OFF');
    
    const insertBook = req.db.prepare(`
      INSERT INTO book_demands (id, merchant_id, book_image, book_merchant, book_name, target_audience, book_category, product_image, book_introduction, wechat_shop_link, specification, selling_price, pure_commission, ad_commission, logistics, stock)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const insertDemand = req.db.prepare(`
      INSERT INTO demands (id, merchant_id, title, demand_type, category, platform, budget_min, budget_max, description, status, ref_demand_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const importTransaction = req.db.transaction((rows) => {
      rows.forEach((row, idx) => {
        try {
          const mapped = {};
          for (const [cnKey, enKey] of Object.entries(BOOK_FIELD_MAP)) {
            mapped[enKey] = row[cnKey] !== undefined ? row[cnKey] : '';
          }
          
          if (!mapped.book_name || !mapped.book_category || !mapped.book_merchant) {
            results.errors.push(`第${idx + 2}行：图书名称、图书分类、图书商家为必填`);
            results.failed++;
            return;
          }
          
          // 归属销售映射
          const salesOwnerId = findSalesOwnerId(req.db, String(mapped.sales_owner_name || '').trim());
          
          // 决定用哪个 merchant_id
          let rowMerchantId = merchantId;
          if (isAdmin) {
            // 管理员导入：按"图书商家"名称查找或自动创建商家
            rowMerchantId = findOrCreateMerchant(req.db, String(mapped.book_merchant).trim(), salesOwnerId);
            // 若商家已存在但销售归属为空且本次Excel指定了销售，则自动回填销售归属
            if (rowMerchantId && salesOwnerId) {
              req.db.prepare("UPDATE merchants SET sales_owner_id = ? WHERE id = ? AND (sales_owner_id IS NULL OR sales_owner_id = '')").run(salesOwnerId, rowMerchantId);
            }
          }
          
          const bookId = uuidv4();
          insertBook.run(bookId, rowMerchantId,
            mapped.book_image || '', mapped.book_merchant || '',
            mapped.book_name, mapped.target_audience || '',
            mapped.book_category,
            mapped.product_image || '', mapped.book_introduction || '',
            mapped.wechat_shop_link || '', mapped.specification || '',
            parseFloat(mapped.selling_price) || 0,
            parseFloat(mapped.pure_commission) || 0,
            parseFloat(mapped.ad_commission) || 0,
            mapped.logistics || '', parseInt(mapped.stock) || 0
          );
          
          const demandId = uuidv4();
          insertDemand.run(demandId, rowMerchantId,
            mapped.book_name + ' 推广', 'book', mapped.book_category,
            '视频号', 0, 0,
            mapped.book_introduction || mapped.book_name,
            'published', bookId
          );
          
          results.success++;
        } catch (e) {
          results.errors.push(`第${idx + 2}行：${e.message}`);
          results.failed++;
        }
      });
    });
    
    importTransaction(jsonData);
    
    if (isAdmin) req.db.pragma('foreign_keys = ON');
    
    fs.unlinkSync(req.file.path);
    
    res.json({
      success: true,
      data: results,
      message: `导入完成：成功 ${results.success} 条，失败 ${results.failed} 条`
    });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 上传 Excel - 课程需求
router.post('/import/course', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: '请上传Excel文件' });
    
    const merchantId = req.body.merchant_id;
    if (!merchantId) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, error: '请指定商家ID' });
    }
    
    const isAdmin = merchantId === 'admin';
    
    if (!isAdmin) {
      const merchant = req.db.prepare('SELECT id, company FROM merchants WHERE id = ?').get(merchantId);
      if (!merchant) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ success: false, error: '商家不存在，请联系管理员' });
      }
    }
    
    const wb = XLSX.readFile(req.file.path);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const jsonData = XLSX.utils.sheet_to_json(ws, { defval: '' });
    
    if (jsonData.length === 0) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, error: 'Excel文件为空或格式不正确' });
    }
    
    const results = { success: 0, failed: 0, errors: [] };
    
    if (isAdmin) req.db.pragma('foreign_keys = OFF');
    
    const insertCourse = req.db.prepare(`
      INSERT INTO course_demands (id, merchant_id, course_image, course_name, unit_price, grade_level, subject, course_introduction, course_link)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const insertDemand = req.db.prepare(`
      INSERT INTO demands (id, merchant_id, title, demand_type, category, platform, budget_min, budget_max, description, status, ref_demand_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const importTransaction = req.db.transaction((rows) => {
      rows.forEach((row, idx) => {
        try {
          const mapped = {};
          for (const [cnKey, enKey] of Object.entries(COURSE_FIELD_MAP)) {
            mapped[enKey] = row[cnKey] !== undefined ? row[cnKey] : '';
          }
          
          if (!mapped.course_name) {
            results.errors.push(`第${idx + 2}行：课程名称为必填`);
            results.failed++;
            return;
          }
          
          const salesOwnerId = findSalesOwnerId(req.db, String(mapped.sales_owner_name || '').trim());
          
          let rowMerchantId = merchantId;
          if (isAdmin) {
            const merchName = String(mapped.course_merchant || '').trim();
            if (!merchName) {
              results.errors.push(`第${idx + 2}行：课程商家为必填`);
              results.failed++;
              return;
            }
            rowMerchantId = findOrCreateMerchant(req.db, merchName, salesOwnerId);
            if (rowMerchantId && salesOwnerId) {
              req.db.prepare("UPDATE merchants SET sales_owner_id = ? WHERE id = ? AND (sales_owner_id IS NULL OR sales_owner_id = '')").run(salesOwnerId, rowMerchantId);
            }
          }
          
          const courseId = uuidv4();
          insertCourse.run(courseId, rowMerchantId,
            mapped.course_image || '', mapped.course_name,
            parseFloat(mapped.unit_price) || 0,
            mapped.grade_level || '',
            mapped.subject || '', mapped.course_introduction || '',
            mapped.course_link || ''
          );
          
          const demandId = uuidv4();
          const category = mapped.subject ? mapped.subject.split(',')[0] + '课程' : '课程';
          insertDemand.run(demandId, rowMerchantId,
            mapped.course_name + ' 推广', 'course', category,
            '视频号', 0, 0,
            mapped.course_introduction || mapped.course_name,
            'published', courseId
          );
          
          results.success++;
        } catch (e) {
          results.errors.push(`第${idx + 2}行：${e.message}`);
          results.failed++;
        }
      });
    });
    
    importTransaction(jsonData);
    
    if (isAdmin) req.db.pragma('foreign_keys = ON');
    
    fs.unlinkSync(req.file.path);
    
    res.json({
      success: true,
      data: results,
      message: `导入完成：成功 ${results.success} 条，失败 ${results.failed} 条`
    });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取图书需求列表
router.get('/book', (req, res) => {
  try {
    const { merchant_id } = req.query;
    let sql = `
      SELECT bd.*, m.name as merchant_name, m.company as merchant_company 
      FROM book_demands bd
      LEFT JOIN merchants m ON bd.merchant_id = m.id
      WHERE 1=1
    `;
    const params = [];
    if (merchant_id) { sql += ' AND bd.merchant_id = ?'; params.push(merchant_id); }
    sql += ' ORDER BY bd.created_at DESC';
    
    const data = req.db.prepare(sql).all(...params);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取课程需求列表
router.get('/course', (req, res) => {
  try {
    const { merchant_id } = req.query;
    let sql = `
      SELECT cd.*, m.name as merchant_name, m.company as merchant_company
      FROM course_demands cd
      LEFT JOIN merchants m ON cd.merchant_id = m.id
      WHERE 1=1
    `;
    const params = [];
    if (merchant_id) { sql += ' AND cd.merchant_id = ?'; params.push(merchant_id); }
    sql += ' ORDER BY cd.created_at DESC';
    
    const data = req.db.prepare(sql).all(...params);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 删除图书需求
router.delete('/book/:id', (req, res) => {
  try {
    req.db.prepare('DELETE FROM book_demands WHERE id = ?').run(req.params.id);
    req.db.prepare('DELETE FROM demands WHERE ref_demand_id = ?').run(req.params.id);
    res.json({ success: true, message: '删除成功' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 删除课程需求
router.delete('/course/:id', (req, res) => {
  try {
    req.db.prepare('DELETE FROM course_demands WHERE id = ?').run(req.params.id);
    req.db.prepare('DELETE FROM demands WHERE ref_demand_id = ?').run(req.params.id);
    res.json({ success: true, message: '删除成功' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
