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

// 登录接口：统一账号密码，后端自动识别用户类型
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ success: false, error: '请输入账号和密码' });
  }

  // 1. 优先匹配管理员
  const admin = db.prepare('SELECT * FROM admins WHERE username = ? AND password = ?').get(username, password);
  if (admin) {
    return res.json({ success: true, data: { 
      id: admin.id, 
      name: admin.name, 
      role: 'admin', 
      is_super: admin.is_super === 1,
      admin_role: admin.admin_role || '其他',
      username: admin.username,
    }});
  }

  // 2. 匹配商家（按 name 或 company 匹配，排除已删除）
  let merchant = db.prepare("SELECT * FROM merchants WHERE (name = ? OR company = ?) AND password = ? AND status != 'deleted'").get(username, username, password);
  if (!merchant) {
    merchant = db.prepare("SELECT * FROM merchants WHERE (name = ? OR company = ?) AND status != 'deleted'").get(username, username);
  }
  if (merchant && merchant.password === password) {
    return res.json({ success: true, data: { id: merchant.id, name: merchant.name, company: merchant.company, role: 'merchant', phone: merchant.phone, email: merchant.email, industry: merchant.industry }});
  }

  // 3. 匹配达人（按 video_account_name）
  const inf = db.prepare('SELECT * FROM influencers WHERE video_account_name = ? AND password = ?').get(username, password);
  if (inf) {
    return res.json({ success: true, data: { id: inf.id, name: inf.video_account_name, role: 'influencer', ...inf }});
  }

  res.status(401).json({ success: false, error: '账号或密码错误' });
});

// 路由
app.use('/api/merchants', require('./routes/merchants'));
app.use('/api/influencers', require('./routes/influencers'));
app.use('/api/demands', require('./routes/demands'));
app.use('/api/stats', require('./routes/stats'));
app.use('/api/excel', require('./routes/excel-import'));
app.use('/api/cooperation', require('./routes/cooperation'));
app.use('/api/admins', require('./routes/admins'));
app.use('/api/recruitments', require('./routes/recruitments'));

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
