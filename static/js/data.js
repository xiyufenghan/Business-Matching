/**
 * 数据层（API 版本 —— 通过后端 FastAPI + MySQL 持久化）
 *
 * 设计要点：
 * - 所有数据通过 /api/* 接口读写云端 MySQL 数据库
 * - 所有人访问同一链接都能读写同一份数据
 * - 保留与旧版 localStorage 版本完全一致的导出接口
 * - 内存缓存 + 按需刷新，减少不必要的网络请求
 *
 * 实体：
 *  - products 商品货盘：type: 'book'(图书) / 'course'(课程)
 *  - talents  达人信息
 *  - matches  撮合单
 */

/* ========== API 基础地址 ========== */
const API_BASE = '';

async function apiFetch(path, opts = {}) {
  const url = `${API_BASE}${path}`;
  const config = { headers: {}, ...opts };
  
  // 自动携带认证 token（如果存在）
  const token = localStorage.getItem('bizmatch_token') || '';
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`;
  }
  
  config.headers['Content-Type'] = 'application/json';
  
  if (config.body && typeof config.body === 'object' && !(config.body instanceof FormData)) {
    config.body = JSON.stringify(config.body);
  }
  let resp;
  try {
    resp = await fetch(url, config);
  } catch (networkErr) {
    throw new Error(`网络请求失败（可能是跨域拦截或网络不通）: ${networkErr.message}`);
  }
  if (!resp.ok) {
    // Token 过期 → 清除并跳转登录
    if (resp.status === 401) {
      localStorage.removeItem('bizmatch_token');
      localStorage.removeItem('bizmatch_user');
      window.location.href = '/static/login.html';
      throw new Error('登录已过期，请重新登录');
    }
    let errMsg = '';
    try {
      const ct = resp.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const errJson = await resp.json();
        errMsg = errJson.error || errJson.detail || JSON.stringify(errJson);
      } else {
        errMsg = await resp.text();
        if (errMsg.startsWith('<!') || errMsg.startsWith('<html')) {
          errMsg = '服务端返回了 HTML 页面而非 JSON，请检查 API 路径是否正确';
        }
      }
    } catch (_) { errMsg = resp.statusText; }
    throw new Error(`API ${resp.status}: ${errMsg}`);
  }
  const contentType = resp.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const bodyPreview = await resp.text().catch(() => '');
    const isHtml = bodyPreview.startsWith('<!') || bodyPreview.startsWith('<html');
    if (isHtml) {
      throw new Error('API 返回了 HTML 页面而非 JSON 数据，请检查后端服务是否正常运行');
    }
    try { return JSON.parse(bodyPreview); } catch (_) {
      throw new Error(`API 返回了非 JSON 响应 (${contentType})，请检查后端服务是否正常运行`);
    }
  }
  return resp.json();
}

/* ========== 常量定义 ========== */
/**
 * 撮合状态：简化为 4 个阶段
 * 货盘推荐 → 确认合作 → 样品寄送 → 开始带货
 */
export const STATUS_FLOW = [
  { key: 'recommend', name: '货盘推荐', color: 'badge-slate',  stage: '推荐' },
  { key: 'confirmed', name: '确认合作', color: 'badge-purple', stage: '合作' },
  { key: 'sampling',  name: '样品寄送', color: 'badge-amber',  stage: '合作' },
  { key: 'selling',   name: '开始带货', color: 'badge-green',  stage: '效果' },
];

/* 合作模式层级关系 */
export const COOP_PARENT = ['纯佣', '投流+佣金', '互选', '原生二次推广', '素材合作'];
export const COOP_CHILD = {
  '纯佣':       ['商品链接', '机构链接'],
  '投流+佣金':  ['商品链接', '投流链接'],
  '互选':         [],
  '原生二次推广': [],
  '素材合作':     []
};
export const COOP_MODES = {
  '纯佣-商品链接':      { parent: '纯佣',      child: '商品链接' },
  '纯佣-机构链接':      { parent: '纯佣',      child: '机构链接' },
  '投流+佣金-商品链接': { parent: '投流+佣金', child: '商品链接' },
  '投流+佣金-投流链接': { parent: '投流+佣金', child: '投流链接' },
  '互选':         { parent: '互选',         child: '' },
  '原生二次推广': { parent: '原生二次推广', child: '' },
  '素材合作':     { parent: '素材合作',     child: '' },
};

/* 商品类型 */
export const PRODUCT_TYPES = [
  { key: 'book',   name: '图书货盘' },
  { key: 'course', name: '课程货盘' },
];

/* 图书分类 */
export const CATEGORIES = ['少儿图书', '教辅教材', '文学小说', '社科历史', '科普百科', '艺术生活', '经管励志', '童书绘本'];

/* 课程相关 */
export const COURSE_TYPES    = ['大班课', '小班课', '一对一', '录播课', '训练营'];
export const COURSE_STAGES   = ['学前', '小学', '初中', '高中', '大学', '成人'];
export const COURSE_SUBJECTS = ['语文', '数学', '英语', '物理', '化学', '生物', '历史', '地理', '政治', '科学', '编程', '美术', '音乐', '体育', '综合'];

/* 达人相关 */
export const PLATFORMS  = ['抖音', '快手', '小红书', '视频号', '淘宝直播', 'B站', '公众号'];
export const TALENT_TIERS = ['头部', '腰部', '尾部'];
export const TALENT_LEVELS = ['S', 'A', 'B', 'C'];
export const TALENT_LEVEL_META = {
  'S': { name: 'S 级', desc: '核心战略达人', badge: 'badge-purple', color: '#7c3aed' },
  'A': { name: 'A 级', desc: '重点合作达人', badge: 'badge-blue',   color: '#2563eb' },
  'B': { name: 'B 级', desc: '常规合作达人', badge: 'badge-cyan',   color: '#0891b2' },
  'C': { name: 'C 级', desc: '潜力/观察期',  badge: 'badge-slate',  color: '#64748b' },
};
export const REGIONS = ['北京', '上海', '广州', '深圳', '杭州', '成都', '武汉', '南京', '长沙', '西安', '重庆', '其他'];
export const BOOK_CATEGORIES_FOR_TALENT = ['少儿图书', '教辅教材', '文学小说', '社科历史', '科普百科', '艺术生活', '经管励志', '童书绘本', '课程学习'];
export const CONTENT_FORMS = ['短视频', '公众号', '直播'];
export const COOP_ACCEPT = ['纯佣金', '商家投流+低佣金', '话题素材发布', '内容素材授权'];

/* 达人扩展字段 */
export const WILLINGNESS_LEVELS = ['强意愿', '一般意愿', '观望', '暂无意愿'];
export const UPDATE_FREQUENCIES = ['日更', '每周3-5次', '每周1-2次', '每月4-6次', '不定期', '很少更新'];
export const LIVE_FREQUENCIES   = ['每日直播', '每周3-5场', '每周1-2场', '每月4-6场', '不定期', '很少直播'];
export const YES_NO = ['是', '否'];

/* ========== 内存缓存 ========== */
let _state = { products: [], talents: [], matches: [] };
let _ready = false;

/* ========== 兼容性导出：后端状态相关 ========== */
export function isBackendAvailable() { return true; }
export function onBackendStatusChange(fn) {
  return () => {};
}

/* ========== 初始化：从 API 加载全部数据到内存缓存 ========== */
async function _fetchWithRetry(path, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await apiFetch(path);
    } catch (e) {
      console.warn(`[bizmatch] ${path} 第${i+1}次请求失败:`, e.message);
      if (i < retries - 1) {
        await new Promise(r => setTimeout(r, delay * (i + 1)));
      } else {
        throw e;
      }
    }
  }
}

export async function initData() {
  try {
    const [products, talents, matches] = await Promise.all([
      _fetchWithRetry('/api/products'),
      _fetchWithRetry('/api/talents'),
      _fetchWithRetry('/api/matches'),
    ]);
    _state.products = Array.isArray(products) ? products : [];
    _state.talents  = Array.isArray(talents)  ? talents  : [];
    _state.matches  = Array.isArray(matches)  ? matches  : [];
    console.log(`[bizmatch] 数据加载成功: ${_state.products.length} 商品, ${_state.talents.length} 达人, ${_state.matches.length} 撮合`);
  } catch (e) {
    console.warn('[bizmatch] API 加载失败，使用空数据：', e);
    _state = { products: [], talents: [], matches: [] };
  }
  _ready = true;
  return _state;
}

/** 手动刷新：重新从 API 加载 */
export async function refreshData() {
  return initData();
}

export function isReady() { return _ready; }

export async function resetAllData() {
  try {
    await Promise.all([
      apiFetch('/api/products/delete', { method: 'POST', body: { all: true } }),
      apiFetch('/api/talents/delete',  { method: 'POST', body: { all: true } }),
      apiFetch('/api/matches/delete',  { method: 'POST', body: { all: true } }),
    ]);
  } catch (e) {
    console.warn('[bizmatch] 清空数据失败：', e);
  }
  _state = { products: [], talents: [], matches: [] };
  _ready = true;
  return _state;
}

/* ========== 同步读取（从内存缓存） ========== */
export function getProducts() { return _state.products; }
export function getTalents()  { return _state.talents; }
export function getMatches()  { return _state.matches; }

export function getProduct(id) { return getProducts().find(p => p.id === id); }
export function getTalent(id)  { return getTalents().find(t => t.id === id); }
export function getMatch(id)   { return getMatches().find(m => m.id === id); }

/* ========== ID 生成（由后端处理，前端辅助） ========== */
export function nextId(prefix) {
  const list =
    prefix === 'P' ? getProducts() :
    prefix === 'T' ? getTalents() :
    getMatches();
  let max = 0;
  list.forEach(item => {
    const id = String(item.id || '');
    if (id.startsWith(prefix)) {
      const n = parseInt(id.slice(prefix.length), 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  });
  return prefix + String(max + 1).padStart(4, '0');
}

/* ========== CRUD（写操作同时更新 API + 内存缓存） ========== */

export async function upsertProduct(p) {
  if (!p.id) p.id = nextId('P');
  try {
    await apiFetch('/api/products', { method: 'POST', body: p });
  } catch (e) {
    console.error('[bizmatch] upsertProduct 失败：', e);
    throw e;
  }
  // 更新内存缓存
  const i = _state.products.findIndex(x => x.id === p.id);
  if (i >= 0) _state.products[i] = { ..._state.products[i], ...p };
  else _state.products.push(p);
}

export async function upsertTalent(t) {
  if (!t.id) t.id = nextId('T');
  try {
    await apiFetch('/api/talents', { method: 'POST', body: t });
  } catch (e) {
    console.error('[bizmatch] upsertTalent 失败：', e);
    throw e;
  }
  const i = _state.talents.findIndex(x => x.id === t.id);
  if (i >= 0) _state.talents[i] = { ..._state.talents[i], ...t };
  else _state.talents.push(t);
}

function _todayIso() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

export async function upsertMatch(m) {
  if (!m.id) m.id = nextId('M');
  const today = _todayIso();
  const incomingStageTimes = m.stageTimes || {};
  if (m.status && !incomingStageTimes[m.status]) incomingStageTimes[m.status] = today;
  m.stageTimes = incomingStageTimes;
  m.lastUpdate = today;

  try {
    await apiFetch('/api/matches', { method: 'POST', body: m });
  } catch (e) {
    console.error('[bizmatch] upsertMatch 失败：', e);
    throw e;
  }
  const i = _state.matches.findIndex(x => x.id === m.id);
  if (i >= 0) {
    const prev = _state.matches[i];
    const mergedStageTimes = { ...(prev.stageTimes || {}), ...incomingStageTimes };
    _state.matches[i] = { ...prev, ...m, stageTimes: mergedStageTimes, lastUpdate: today };
  } else {
    _state.matches.push({ ...m, lastUpdate: today });
  }
}

export async function deleteProducts(ids) {
  try {
    await apiFetch('/api/products/delete', { method: 'POST', body: { ids } });
  } catch (e) { console.error('[bizmatch] deleteProducts 失败：', e); throw e; }
  _state.products = _state.products.filter(p => !ids.includes(p.id));
}

export async function deleteAllProducts() {
  try {
    await apiFetch('/api/products/delete', { method: 'POST', body: { all: true } });
  } catch (e) { console.error('[bizmatch] deleteAllProducts 失败：', e); throw e; }
  _state.products = [];
}

export async function deleteProductsByType(type) {
  try {
    await apiFetch('/api/products/delete', { method: 'POST', body: { type } });
  } catch (e) { console.error('[bizmatch] deleteProductsByType 失败：', e); throw e; }
  _state.products = _state.products.filter(p => (p.type || 'book') !== type);
}

export async function deleteTalents(ids) {
  try {
    await apiFetch('/api/talents/delete', { method: 'POST', body: { ids } });
  } catch (e) { console.error('[bizmatch] deleteTalents 失败：', e); throw e; }
  _state.talents = _state.talents.filter(t => !ids.includes(t.id));
}

export async function deleteAllTalents() {
  try {
    await apiFetch('/api/talents/delete', { method: 'POST', body: { all: true } });
  } catch (e) { console.error('[bizmatch] deleteAllTalents 失败：', e); throw e; }
  _state.talents = [];
}

export async function deleteTalentsByLevel(level) {
  try {
    await apiFetch('/api/talents/delete', { method: 'POST', body: { level } });
  } catch (e) { console.error('[bizmatch] deleteTalentsByLevel 失败：', e); throw e; }
  _state.talents = _state.talents.filter(t => (t.level || '') !== level);
}

export async function deleteMatches(ids) {
  try {
    await apiFetch('/api/matches/delete', { method: 'POST', body: { ids } });
  } catch (e) { console.error('[bizmatch] deleteMatches 失败：', e); throw e; }
  _state.matches = _state.matches.filter(m => !ids.includes(m.id));
}

export async function batchUpsertProducts(list) {
  const items = list.map(item => {
    if (!item.id) item.id = nextId('P');
    return item;
  });
  try {
    await apiFetch('/api/products/batch', { method: 'POST', body: items });
  } catch (e) { console.error('[bizmatch] batchUpsertProducts 失败：', e); throw e; }
  // 更新内存缓存
  items.forEach(item => {
    const i = _state.products.findIndex(x => x.id === item.id);
    if (i >= 0) _state.products[i] = { ..._state.products[i], ...item };
    else _state.products.push(item);
  });
}

export async function batchUpsertTalents(list) {
  const items = list.map(item => {
    if (!item.id) item.id = nextId('T');
    return item;
  });
  try {
    await apiFetch('/api/talents/batch', { method: 'POST', body: items });
  } catch (e) { console.error('[bizmatch] batchUpsertTalents 失败：', e); throw e; }
  items.forEach(item => {
    const i = _state.talents.findIndex(x => x.id === item.id);
    if (i >= 0) _state.talents[i] = { ..._state.talents[i], ...item };
    else _state.talents.push(item);
  });
}

export async function batchUpsertMatches(list) {
  const today = _todayIso();
  const items = list.map(item => {
    if (!item.id) item.id = nextId('M');
    const stageTimes = { ...(item.stageTimes || {}) };
    if (item.status && !stageTimes[item.status]) stageTimes[item.status] = today;
    return { ...item, stageTimes, lastUpdate: today };
  });
  try {
    await apiFetch('/api/matches/batch', { method: 'POST', body: items });
  } catch (e) { console.error('[bizmatch] batchUpsertMatches 失败：', e); throw e; }
  items.forEach(item => {
    const i = _state.matches.findIndex(x => x.id === item.id);
    if (i >= 0) _state.matches[i] = { ..._state.matches[i], ...item };
    else _state.matches.push(item);
  });
}

/* ========== 排序权重（sortWeight） ========== */
export function sortBySortWeight(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item, idx) => ({ item, idx, w: Number(item?.sortWeight) || 0 }))
    .sort((a, b) => (b.w - a.w) || (a.idx - b.idx))
    .map(x => x.item);
}

export async function updateSortWeight(kind, id, weight) {
  let w = Number(weight);
  if (!Number.isFinite(w) || w < 1) w = 1;
  try {
    await apiFetch(`/api/${kind}/${id}/sort`, { method: 'POST', body: { sortWeight: w } });
  } catch (e) { console.error('[bizmatch] updateSortWeight 失败：', e); throw e; }
  // 更新内存缓存
  const listMap = { product: _state.products, talent: _state.talents, match: _state.matches };
  const list = listMap[kind];
  if (!list) return;
  const it = list.find(x => x.id === id);
  if (it) it.sortWeight = w;
}

/* ========== 辅助：状态元信息 ========== */
export function getStatusMeta(key) {
  return STATUS_FLOW.find(s => s.key === key) || STATUS_FLOW[0];
}
