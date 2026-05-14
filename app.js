const express = require('express');
const crypto = require('crypto');
const path = require('path');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { initDatabase } = require('./db/init');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_TTL_DAYS = 7;
const BCRYPT_COST = 10;

// V5: 允许的 Origin 列表（生产域名 + 本地开发）
const ALLOWED_ORIGINS = new Set([
  'https://bizmatch.dacongming.chat',
  'http://localhost:3000',
  'http://localhost:3099',
  'http://127.0.0.1:3000',
]);

// 初始化数据库
const db = initDatabase();

// V5: 开启 SQLite WAL 模式，提升并发读写性能
try {
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  console.log('[DB] WAL mode enabled');
} catch (e) { console.error('[DB pragma]', e.message); }

// V5: 定时 WAL checkpoint，防止 -wal 文件无限膨胀
setInterval(() => {
  try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (e) { /* ignore */ }
}, 3600 * 1000);

// 启动定时清理：每小时一次过期 session 清理
setInterval(() => {
  try {
    const r = db.prepare("DELETE FROM sessions WHERE expires_at IS NOT NULL AND datetime(expires_at) < datetime('now')").run();
    if (r.changes > 0) console.log('[sessions cleanup] 清理过期会话:', r.changes);
  } catch (e) { console.error('[sessions cleanup]', e.message); }
}, 3600 * 1000);

// ====== 工具函数 ======
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * 密码验证：兼容老明文 + 新 bcrypt 哈希
 * 首次匹配明文成功后自动升级为 bcrypt hash
 * @returns {boolean} 是否验证通过
 */
function verifyPassword(input, row, table) {
  if (!row || !input) return false;
  // 优先比较 password_hash（已升级）
  if (row.password_hash) {
    try { return bcrypt.compareSync(input, row.password_hash); } catch (e) { return false; }
  }
  // 兼容老明文
  if (row.password && row.password === input) {
    // 自动升级：写 hash，清掉明文
    try {
      const hash = bcrypt.hashSync(input, BCRYPT_COST);
      db.prepare(`UPDATE ${table} SET password_hash = ?, password = '' WHERE id = ?`).run(hash, row.id);
    } catch (e) { /* 升级失败不影响本次登录 */ }
    return true;
  }
  return false;
}

/**
 * 将密码哈希后写入指定表/行（用于注册、激活、改密码）
 */
function setPasswordHash(table, id, plainPwd) {
  const hash = bcrypt.hashSync(plainPwd, BCRYPT_COST);
  db.prepare(`UPDATE ${table} SET password_hash = ?, password = '' WHERE id = ?`).run(hash, id);
}

// 暴露给路由使用
app.locals.bcrypt = bcrypt;
app.locals.setPasswordHash = setPasswordHash;
app.locals.BCRYPT_COST = BCRYPT_COST;

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

  // 在 sessions 表中查找 token（V5：含过期判定）
  const session = db.prepare(`
    SELECT * FROM sessions
    WHERE token = ?
      AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
  `).get(token);
  if (!session) {
    return res.status(401).json({ success: false, error: '登录已过期，请重新登录', code: 'TOKEN_INVALID' });
  }

  // 更新最后活跃时间 + 滑动续期（每次访问延长到 7 天后过期）
  try {
    db.prepare(`UPDATE sessions SET last_active_at = datetime('now'), expires_at = datetime('now', '+${SESSION_TTL_DAYS} days') WHERE id = ?`).run(session.id);
  } catch(e) {}

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

// V5: helmet 安全响应头（CSP 暂不开，避免拦截已有 inline 脚本）
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  // 微信内置浏览器需要 frameguard 但允许同域
  frameguard: { action: 'sameorigin' },
}));

// V5: CORS Origin 白名单 + 跨站写入校验（防 CSRF）
app.use((req, res, next) => {
  const origin = req.get('origin');
  // GET 类请求不强制（避免静态资源被错误拦）
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    if (origin && ALLOWED_ORIGINS.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
      return res.sendStatus(204);
    }
    return next();
  }
  // 写请求：必须没有 origin（同站调用如 fetch 会带 origin），或在白名单内
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return res.status(403).json({ success: false, error: '跨域请求被拒绝', code: 'ORIGIN_REJECTED' });
  }
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  next();
});

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

// V5: 上传图片的静态托管（需求图片落盘到 uploads/demands/）
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  maxAge: '1d',
  setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=86400')
}));

// 将db注入到请求对象
app.use((req, res, next) => {
  req.db = db;
  next();
});

// 应用认证中间件到所有 /api 路由（login/logout 除外）
app.use(authMiddleware);

// V5: 登录限频（防暴力撞库）：单 IP 15 分钟内最多 10 次失败
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, error: '尝试次数过多，请 15 分钟后再试', code: 'TOO_MANY_REQUESTS' },
  standardHeaders: true,
  legacyHeaders: false,
  // 仅对失败请求计数（成功登录不算）
  skipSuccessfulRequests: true,
});

// 登录接口：统一账号密码，后端自动识别用户类型 + 签发 token（多端并发，不踢人）
app.post('/api/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ success: false, error: '请输入账号和密码' });
  }

  // session 写入辅助（含过期时间）
  const insertSession = (userType, userId) => {
    const token = generateToken();
    db.prepare(
      `INSERT INTO sessions (id, user_type, user_id, token, expires_at) VALUES (?, ?, ?, ?, datetime('now','+${SESSION_TTL_DAYS} days'))`
    ).run(generateId(), userType, userId, token);
    return token;
  };

  // 1. 优先匹配管理员（手机号优先 → 用户名兜底）
  let admin = db.prepare('SELECT * FROM admins WHERE phone = ?').get(username);
  if (!admin) {
    admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  }
  if (admin && verifyPassword(password, admin, 'admins')) {
    if (admin.status === 'disabled') {
      return res.status(403).json({ success: false, error: '账号已停用' });
    }
    db.prepare("UPDATE admins SET last_login_at = datetime('now') WHERE id = ?").run(admin.id);
    const token = insertSession('admin', admin.id);
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

  // 2. 匹配商家（phone / name / company）
  let merchant = db.prepare("SELECT * FROM merchants WHERE phone = ? AND status != 'deleted'").get(username);
  if (!merchant) {
    merchant = db.prepare("SELECT * FROM merchants WHERE (name = ? OR company = ?) AND status != 'deleted'").get(username, username);
  }
  if (merchant && verifyPassword(password, merchant, 'merchants')) {
    if (merchant.invite_status === 'pending') {
      return res.status(403).json({ success: false, error: '账号尚未激活，请先使用邀请链接完成激活' });
    }
    if (merchant.invite_status === 'disabled') {
      return res.status(403).json({ success: false, error: '账号已停用，请联系管理员' });
    }
    const token = insertSession('merchant', merchant.id);
    return res.json({ success: true, data: { token, id: merchant.id, name: merchant.name, company: merchant.company, role: 'merchant', phone: merchant.phone, email: merchant.email, industry: merchant.industry, privacy_consented: merchant.privacy_consented === 1 }});
  }

  // 3. 匹配达人（手机号优先 → 视频号账号名兜底）
  let inf = db.prepare('SELECT * FROM influencers WHERE phone = ?').get(username);
  if (!inf) {
    inf = db.prepare('SELECT * FROM influencers WHERE video_account_name = ?').get(username);
  }
  if (inf && verifyPassword(password, inf, 'influencers')) {
    if (inf.invite_status === 'pending') {
      return res.status(403).json({ success: false, error: '账号尚未激活，请先使用邀请链接完成激活' });
    }
    if (inf.invite_status === 'disabled') {
      return res.status(403).json({ success: false, error: '账号已停用，请联系管理员' });
    }
    const token = insertSession('influencer', inf.id);
    return res.json({ success: true, data: { token, id: inf.id, name: inf.video_account_name, role: 'influencer', video_account_name: inf.video_account_name, level: inf.level, fans_count: inf.fans_count, invite_status: inf.invite_status, privacy_consented: inf.privacy_consented === 1 }});
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
      phone: u.phone, email: u.email, industry: u.industry,
      privacy_consented: u.privacy_consented === 1
    }});
  }
  if (u.role === 'influencer') {
    return res.json({ success: true, data: {
      id: u.id, name: u.video_account_name, role: 'influencer',
      video_account_name: u.video_account_name, level: u.level,
      fans_count: u.fans_count, invite_status: u.invite_status,
      privacy_consented: u.privacy_consented === 1
    }});
  }
  res.status(400).json({ success: false, error: '未知用户类型' });
});

// 隐私授权接口：商家/达人首次登录确认后调用
app.post('/api/auth/consent', (req, res) => {
  const u = req.user;
  if (!u || (u.role !== 'merchant' && u.role !== 'influencer')) {
    return res.status(403).json({ success: false, error: '无权限' });
  }
  const table = u.role === 'merchant' ? 'merchants' : 'influencers';
  try {
    req.db.prepare(
      `UPDATE ${table} SET privacy_consented = 1, privacy_consented_at = datetime('now') WHERE id = ?`
    ).run(u.id);
    res.json({ success: true });
  } catch (e) {
    console.eor('[' + "app.js" + ']', e);
    res.status(500).json({ success: false, eor: '操作失败，请稍后重试' });
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
app.use('/api/recruitments', require('./routes/recruitments'));
app.use('/api/invitations', require('./routes/invitations'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/favorites', require('./routes/favorites'));
app.use('/api/demand-images', require('./routes/demand-images').router);

// 首页
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 错误处理（V5：不再向客户端泄漏内部错误信息）
app.use((err, req, res, next) => {
  console.error('[unhandled]', err.stack || err);
  res.status(500).json({ success: false, error: '服务器内部错误' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`商达撮合系统已启动: http://0.0.0.0:${PORT}`);
});

module.exports = app;
