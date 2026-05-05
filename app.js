const express = require('express');
const path = require('path');
const { initDatabase } = require('./db/init');

const app = express();
const PORT = 3000;

// 初始化数据库
const db = initDatabase();

// 中间件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js') || filePath.endsWith('.html') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// 将db注入到请求对象
app.use((req, res, next) => {
  req.db = db;
  next();
});

// 登录接口
app.post('/api/login', (req, res) => {
  const { username, password, role } = req.body;
  
  if (role === 'admin') {
    // 从admins表验证管理员身份
    const admin = db.prepare('SELECT * FROM admins WHERE username = ? AND password = ?').get(username, password);
    if (admin) {
      return res.json({ success: true, data: { 
        id: admin.id, 
        name: admin.name, 
        role: 'admin', 
        is_super: admin.is_super === 1,
        admin_role: admin.admin_role || '其他',
        username: admin.username,
        phone: admin.phone,
        email: admin.email,
        description: admin.description
      }});
    }
  } else if (role === 'merchant') {
    // 先精确匹配
    let merchant = db.prepare('SELECT * FROM merchants WHERE (name = ? OR company = ?) AND password = ?').get(username, username, password);
    // 尝试只用name/company匹配
    if (!merchant) {
      merchant = db.prepare('SELECT * FROM merchants WHERE name = ? OR company = ?').get(username, username);
    }
    if (merchant) {
      return res.json({ success: true, data: { id: merchant.id, name: merchant.name, company: merchant.company, role: 'merchant', phone: merchant.phone, email: merchant.email, industry: merchant.industry, description: merchant.description } });
    }
  } else if (role === 'influencer') {
    let inf = db.prepare('SELECT * FROM influencers WHERE video_account_name = ? AND password = ?').get(username, password);
    if (!inf) {
      inf = db.prepare('SELECT * FROM influencers WHERE video_account_name = ?').get(username);
    }
    if (!inf) {
      inf = db.prepare("SELECT * FROM influencers WHERE video_account_name LIKE ?").get(`%${username}%`);
    }
    if (inf) {
      return res.json({ success: true, data: { id: inf.id, name: inf.video_account_name, role: 'influencer', ...inf } });
    }
  }
  
  res.status(401).json({ success: false, error: '用户名或密码错误' });
});

// 获取可登录的达人列表
app.get('/api/login/influencer-list', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  try {
    const list = db.prepare("SELECT id, video_account_name FROM influencers WHERE video_account_name NOT IN ('无','暂无','新号','还没有','暂时没有','') AND video_account_name IS NOT NULL ORDER BY created_at DESC LIMIT 50").all();
    res.json({ success: true, data: list });
  } catch (err) {
    res.json({ success: true, data: [] });
  }
});

// 获取可登录的商家列表
app.get('/api/login/merchant-list', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  try {
    const list = db.prepare("SELECT id, name, company FROM merchants ORDER BY created_at DESC LIMIT 50").all();
    res.json({ success: true, data: list });
  } catch (err) {
    res.json({ success: true, data: [] });
  }
});

// 获取管理员列表（供登录选择用）—— 实时读取最新 username/name
app.get('/api/login/admin-list', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  try {
    const list = db.prepare("SELECT id, username, name, is_super, admin_role, updated_at FROM admins ORDER BY is_super DESC, created_at ASC").all();
    res.json({ success: true, data: list });
  } catch (err) {
    res.json({ success: true, data: [] });
  }
});

// 路由
app.use('/api/merchants', require('./routes/merchants'));
app.use('/api/influencers', require('./routes/influencers'));
app.use('/api/demands', require('./routes/demands'));
app.use('/api/stats', require('./routes/stats'));
app.use('/api/excel', require('./routes/excel-import'));
app.use('/api/cooperation', require('./routes/cooperation'));
app.use('/api/admins', require('./routes/admins'));

// 首页
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 错误处理
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: '服务器内部错误', message: err.message });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`商达撮合系统已启动: http://0.0.0.0:${PORT}`);
});

module.exports = app;
