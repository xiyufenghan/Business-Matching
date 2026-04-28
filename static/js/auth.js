/**
 * 前端认证模块
 * - Token 存储/读取/清除
 * - 登录状态检查
 * - API 请求自动携带 Authorization header
 * - 登出功能
 */

const TOKEN_KEY = 'bizmatch_token';
const USER_KEY = 'bizmatch_user';

/* ========== Token 操作 ========== */
export function getToken() {
    return localStorage.getItem(TOKEN_KEY) || '';
}

export function getUser() {
    try {
        const raw = localStorage.getItem(USER_KEY) || '';
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

export function getRole() {
    const u = getUser();
    return (u && u.role) || null;
}

export function isAdmin() {
    return getRole() === 'admin';
}

export function isLoggedIn() {
    return !!getToken();
}

export function saveAuth(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
}

/* ========== 登出 ========== */
export function doLogout() {
    clearAuth();
    window.location.href = '/static/login.html';  // 或 '/login.html' 取决于部署方式
}

/* ========== 认证守卫（未登录则跳转登录页） ========== */
export function requireLogin() {
    if (!isLoggedIn()) {
        window.location.href = '/static/login.html';
        return false;
    }
    return true;
}

/* ========== 带认证的 API fetch（自动附加 token） ========== */
export async function apiFetch(path, opts = {}) {
    // 确保已登录（可选：某些公开接口不需要）
    const url = `${path}`;
    const config = { headers: {}, ...opts };
    
    // 自动携带 token
    const token = getToken();
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
        throw new Error(`网络请求失败: ${networkErr.message}`);
    }
    
    // Token 过期或无效 → 跳转登录
    if (resp.status === 401) {
        clearAuth();
        window.location.href = '/static/login.html';
        throw new Error('登录已过期，请重新登录');
    }
    
    if (!resp.ok) {
        let errMsg = '';
        try {
            const ct = resp.headers.get('content-type') || '';
            if (ct.includes('application/json')) {
                const errJson = await resp.json();
                errMsg = errJson.error || errJson.detail || JSON.stringify(errJson);
            } else {
                errMsg = await resp.text();
            }
        } catch (_) { errMsg = resp.statusText; }
        throw new Error(`API ${resp.status}: ${errMsg}`);
    }
    
    const contentType = resp.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
        try { return JSON.parse(await resp.text()); } catch (_) {
            throw new Error('API 返回非 JSON 响应');
        }
    }
    return resp.json();
}
