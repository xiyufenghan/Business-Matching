const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { initDatabase } = require('./db/init');

const app = express();
const PORT = process.env.PORT || 3000;

// 初始化数据库
const db = initDatabase();

// ====== 工具函数 ======
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function generateId() {
  return crypto.randomUUID();
}

// ====== 认证中间件（支持多设备同时在线） ======
function authMiddleware(req, res, next) {
  // 白名单：登录/登出/激活相关接口、模板下载、CSV导出 不需要认证
  // - /api/login                  : 登录
  // - /api/logout                 : 登出（无 token 时也允许调用，幂等）
  // - /api/invitations/*          : 邀请链接验证与激活（用户尚未登录时调用）
  // - /api/excel/template/*       : Excel 模板下载（<a> 链接无法带 header）
  // - /api/influencers/excel/template : 达人模板下载
  // - /api/merchants/excel/template   : 商家模板下载
  // - /api/influencers/export     : 达人 CSV 导出（<a>/window.open 无法带 header）
  // - /api/merchants/export       : 商家 CSV 导出
  const p = req.path;
  if (p === '/api/login' ||
      p === '/api/logout' ||
      p.startsWith('/api/invitations/') ||
      p.startsWith('/api/excel/template/') ||
      p === '/api/influencers/excel/template' ||
      p === '/api/merchants/excel/template' ||
      p === '/api/influencers/export' ||
      p === '/api/merchants/export' ||
      !p.startsWith('/api/')) {
    return next();
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!token) {
    return res.status(401).json({ success: false, error: '未登录，请重新登录', code: 'UNAUTHORIZED' });
  }

  // 在 sessions 表中查找 token
  const session = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
  if (!session) {
    return res.status(401).json({ success: false, error: '登录已过期，请重新登录', code: 'TOKEN_INVALID' });
  }

  // 更新最后活跃时间
  try { db.prepare("UPDATE sessions SET last_active_at = datetime('now') WHERE id = ?").run(session.id); } catch(e) {}

  // 根据 user_type 查出用户完整信息
  let user = null;
  if (session.user_type === 'admin') {
    const admin = db.prepare("SELECT id, username, name, is_super, admin_role, status, phone, email FROM admins WHERE id = ?").get(session.user_id);
    if (admin) {
      if (admin.status === 'disabled') {
        return res.status(403).json({ success: false, error: '账号已停用', code: 'DISABLED' });
      }
      user = { ...admin, is_super: admin.is_super === 1, role: 'admin' };
    }
  } else if (session.user_type === 'merchant') {
    const m = db.prepare("SELECT id, name, company, phone, email, industry FROM merchants WHERE id = ? AND status != 'deleted'").get(session.user_id);
    if (m) { user = { ...m, role: 'merchant' }; }
  } else if (session.user_type === 'influencer') {
    const inf = db.prepare("SELECT id, video_account_name, level, fans_count, invite_status FROM influencers WHERE id = ?").get(session.user_id);
    if (inf) { user = { ...inf, role: 'influencer' }; }
  }

  if (!user) {
    // 用户已被删除，清理过期会话
    try { db.prepare("DELETE FROM sessions WHERE id = ?").run(session.id); } catch(e) {}
    return res.status(401).json({ success: false, error: '用户不存在或已删除', code: 'USER_GONE' });
  }

  req.user = user;
  req.session_id = session.id;
  next();
}

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

// 应用认证中间件到所有 /api 路由（login/logout 除外）
app.use(authMiddleware);

// 登录接口：统一账号密码，后端自动识别用户类型 + 签发 token（多端并发，不踢人）
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ success: false, error: '请输入账号和密码' });
  }

  // 1. 优先匹配管理员
  const admin = db.prepare('SELECT * FROM admins WHERE username = ? AND password = ?').get(username, password);
  if (admin) {
    if (admin.status === 'disabled') {
      return res.status(403).json({ success: false, error: '账号已停用' });
    }
    db.prepare("UPDATE admins SET last_login_at = datetime('now') WHERE id = ?").run(admin.id);
    const token = generateToken();
    db.prepare("INSERT INTO sessions (id, user_type, user_id, token) VALUES (?, ?, ?, ?)").run(generateId(), 'admin', admin.id, token);
    return res.json({ success: true, data: { 
      token,
      id: admin.id, 
      name: admin.name, 
      role: 'admin', 
      is_super: admin.is_super === 1,
      admin_role: admin.admin_role || '其他',
      username: admin.username,
    }});
  }

  // 2. 匹配商家
  let merchant = db.prepare("SELECT * FROM merchants WHERE phone = ? AND status != 'deleted'").get(username);
  if (!merchant) {
    merchant = db.prepare("SELECT * FROM merchants WHERE (name = ? OR company = ?) AND status != 'deleted'").get(username, username);
  }
  if (merchant && merchant.password === password) {
    if (merchant.invite_status === 'pending') {
      return res.status(403).json({ success: false, error: '账号尚未激活，请先使用邀请链接完成激活' });
    }
    if (merchant.invite_status === 'disabled') {
      return res.status(403).json({ success: false, error: '账号已停用，请联系管理员' });
    }
    const token = generateToken();
    db.prepare("INSERT INTO sessions (id, user_type, user_id, token) VALUES (?, ?, ?, ?)").run(generateId(), 'merchant', merchant.id, token);
    return res.json({ success: true, data: { token, id: merchant.id, name: merchant.name, company: merchant.company, role: 'merchant', phone: merchant.phone, email: merchant.email, industry: merchant.industry }});
  }

  // 3. 匹配达人
  const inf = db.prepare('SELECT * FROM influencers WHERE video_account_name = ? AND password = ?').get(username, password);
  if (inf) {
    if (inf.invite_status === 'pending') {
      return res.status(403).json({ success: false, error: '账号尚未激活，请先使用邀请链接完成激活' });
    }
    if (inf.invite_status === 'disabled') {
      return res.status(403).json({ success: false, error: '账号已停用，请联系管理员' });
    }
    const token = generateToken();
    db.prepare("INSERT INTO sessions (id, user_type, user_id, token) VALUES (?, ?, ?, ?)").run(generateId(), 'influencer', inf.id, token);
    return res.json({ success: true, data: { token, id: inf.id, name: inf.video_account_name, role: 'influencer', video_account_name: inf.video_account_name, level: inf.level, fans_count: inf.fans_count, invite_status: inf.invite_status }});
  }

  res.status(401).json({ success: false, error: '账号或密码错误' });
});

// 登出接口（仅清除当前设备的 session，不影响其他设备）
app.post('/api/logout', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (token) {
    try { db.prepare("DELETE FROM sessions WHERE token = ?").run(token); } catch(e) {}
  }
  res.json({ success: true, message: '已退出登录' });
});

// 获取当前登录用户信息（用于刷新页面恢复登录态）
app.get('/api/auth/me', (req, res) => {
  if (!req.user) {
    return res.status(401).json({ success: false, error: '未登录' });
  }
  // 根据用户类型返回前端需要的字段
  const u = req.user;
  if (u.role === 'admin') {
    return res.json({ success: true, data: {
      id: u.id, name: u.name, role: 'admin',
      is_super: u.is_super === true || u.is_super === 1,
      admin_role: u.admin_role || '其他',
      username: u.username, phone: u.phone, email: u.email
    }});
  }
  if (u.role === 'merchant') {
    return res.json({ success: true, data: {
      id: u.id, name: u.name, company: u.company, role: 'merchant',
      phone: u.phone, email: u.email, industry: u.industry
    }});
  }
  if (u.role === 'influencer') {
    return res.json({ success: true, data: {
      id: u.id, name: u.video_account_name, role: 'influencer',
      video_account_name: u.video_account_name, level: u.level,
      fans_count: u.fans_count, invite_status: u.invite_status
    }});
  }
  res.status(400).json({ success: false, error: '未知用户类型' });
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
app.use('/api/invitations', require('./routes/invitations'));

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
