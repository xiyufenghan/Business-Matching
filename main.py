"""
教育行业商达撮合平台 - FastAPI 后端 (SQLite 版)
提供 products / talents / matches 的完整 CRUD API + 用户认证系统
数据库：SQLite（零运维，文件存储）
前端静态文件通过 StaticFiles 挂载
"""
import os
import json
import hashlib
import base64
import time
import sqlite3
from datetime import date, datetime
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, HTTPException, UploadFile, File, Body, Query, Request
from fastapi.responses import RedirectResponse, JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.staticfiles import StaticFiles

# ========== 数据库配置 ==========
DB_DIR = os.environ.get("BIZMATCH_DATA_DIR", os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(DB_DIR, "bizmatch.db")
os.makedirs(DB_DIR, exist_ok=True)

def get_conn():
    """获取数据库连接（Dict 模式）"""
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn

def _row_to_dict(row):
    """sqlite3.Row → dict"""
    return dict(row) if row else None

def _rows_to_list(rows):
    """List[Row] → List[dict]"""
    return [dict(r) for r in rows]

def _today():
    return date.today().isoformat()


# ========== 认证配置 ==========
AUTH_SECRET = os.environ.get("AUTH_SECRET", "bizmatch_2026_secret_key_change_in_production")
TOKEN_EXPIRE_HOURS = 24

def _hash_password(password: str) -> str:
    return hashlib.sha256((AUTH_SECRET + password).encode()).hexdigest()

def _generate_token(user: dict) -> str:
    payload = {
        "u": user["username"],
        "r": user.get("role", "operator"),
        "n": user.get("name", ""),
        "exp": int(time.time()) + TOKEN_EXPIRE_HOURS * 3600,
    }
    raw = json.dumps(payload, separators=(",", ":"))
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")

def _decode_token(token: str) -> Optional[dict]:
    try:
        padding = 4 - len(token) % 4
        if padding != 4:
            token += "=" * padding
        raw = base64.urlsafe_b64decode(token).decode()
        payload = json.loads(raw)
        if payload.get("exp", 0) < int(time.time()):
            return None
        return payload
    except Exception:
        return None


app = FastAPI(title="教育行业商达撮合平台 API")

# ========== 全局异常处理 ==========
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    import traceback
    detail = str(exc)
    tb = traceback.format_exc()
    print(f"[ERROR] {request.method} {request.url}: {detail}\n{tb}")
    return JSONResponse(status_code=500, content={"error": detail})

@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    if request.url.path.startswith("/api/"):
        return JSONResponse(status_code=exc.status_code, content={"error": exc.detail or f"HTTP {exc.status_code}"})
    if exc.status_code == 404:
        return RedirectResponse(url="/static/index.html")
    return JSONResponse(status_code=exc.status_code, content={"error": str(exc.detail)})

@app.middleware("http")
async def ensure_api_json_response(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/") and response.status_code >= 400:
        content_type = response.headers.get("content-type", "")
        if "text/html" in content_type:
            return JSONResponse(status_code=response.status_code, content={"error": f"服务端错误 (HTTP {response.status_code})"})
    return response


# ========== CORS ==========
app.add_middleware(
    CORSMiddleware,
    allow_origins=[],
    allow_origin_regex=r".*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


# ========== 辅助函数 ==========
JSON_FIELDS_PRODUCT = ["targetAudience", "courseType", "stage", "subject"]
JSON_FIELDS_TALENT = ["salesCategory", "coopAccept", "contentForms", "categories"]
JSON_FIELDS_MATCH = ["stageTimes"]

def _serialize_json_fields(row: dict, fields: list) -> dict:
    for f in fields:
        v = row.get(f)
        if v is not None and not isinstance(v, str):
            row[f] = json.dumps(v, ensure_ascii=False)
    return row

def _deserialize_json_fields(row: dict, fields: list) -> dict:
    if not row:
        return row
    for f in fields:
        v = row.get(f)
        if isinstance(v, str) and v:
            try:
                row[f] = json.loads(v)
            except (json.JSONDecodeError, TypeError):
                pass
    return row

_NUMERIC_FIELDS = {
    "products": {"salePrice", "price", "commissionPolicy", "adCommissionPolicy", "commissionRate", "stock", "sortWeight"},
    "talents":  {"shortVideoSales", "liveSales", "videoFans", "sortWeight"},
    "matches_": {"gmv", "orderCount", "unitPrice", "commissionRate", "changedCommissionRate", "commissionRateNew", "price", "sampleSent", "sortWeight"},
}

def _clean_empty_strings(data: dict, table: str) -> dict:
    numeric = _NUMERIC_FIELDS.get(table, set())
    cleaned = {}
    for k, v in data.items():
        if k in numeric and (v == "" or v is None):
            cleaned[k] = None
        elif k in numeric and isinstance(v, str):
            v_stripped = v.strip()
            if v_stripped == "":
                cleaned[k] = None
            else:
                try:
                    cleaned[k] = float(v_stripped) if "." in v_stripped else int(v_stripped)
                except (ValueError, TypeError):
                    cleaned[k] = None
        else:
            cleaned[k] = v
    return cleaned


# ========== 表结构初始化 ==========
def _get_table_columns(conn, table_name: str) -> set:
    """获取表的所有列名"""
    cur = conn.execute(f"SELECT name FROM pragma_table_info('{table_name}')")
    return {r["name"] for r in cur.fetchall()}

def _init_db():
    """创建所有表（如果不存在）"""
    conn = get_conn()
    try:
        # ---- products 商品货盘 ----
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS products (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL DEFAULT '',
                type TEXT NOT NULL DEFAULT 'book',
                salePrice REAL,
                price REAL,
                commissionPolicy REAL,
                adCommissionPolicy REAL,
                commissionRate REAL,
                stock INTEGER,
                category TEXT DEFAULT '',
                supplier TEXT DEFAULT '',
                description TEXT DEFAULT '',
                targetAudience TEXT DEFAULT '[]',
                courseType TEXT DEFAULT '[]',
                stage TEXT DEFAULT '[]',
                subject TEXT DEFAULT '[]',
                sortWeight INTEGER DEFAULT 1,
                createdAt TEXT DEFAULT '',
                updatedAt TEXT DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_products_type ON products(type);
            CREATE INDEX IF NOT EXISTS idx_products_sort ON products(sortWeight DESC);
        """)

        # ---- talents 达人 ----
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS talents (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL DEFAULT '',
                level TEXT DEFAULT 'C',
                region TEXT DEFAULT '',
                shortVideoAccount TEXT DEFAULT '',
                shortVideoSales INTEGER DEFAULT 0,
                liveSales INTEGER DEFAULT 0,
                videoAccount TEXT DEFAULT '',
                officialAccount TEXT DEFAULT '',
                videoFans INTEGER DEFAULT 0,
                gmv REAL DEFAULT 0,
                contentForms TEXT DEFAULT '[]',
                categories TEXT DEFAULT '[]',
                salesCategory TEXT DEFAULT '[]',
                coopAccept TEXT DEFAULT '[]',
                notes TEXT DEFAULT '',
                sortWeight INTEGER DEFAULT 1,
                createdAt TEXT DEFAULT '',
                updatedAt TEXT DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_talents_level ON talents(level);
            CREATE INDEX IF NOT EXISTS idx_talents_sort ON talents(sortWeight DESC);
        """)

        # ---- matches_ 撮合单 ----
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS matches_ (
                id TEXT PRIMARY KEY,
                productId TEXT DEFAULT '',
                productName TEXT DEFAULT '',
                talentId TEXT DEFAULT '',
                talentName TEXT DEFAULT '',
                status TEXT DEFAULT 'recommend',
                coopMode TEXT DEFAULT '',
                subMode TEXT DEFAULT '',
                commissionRate REAL,
                changedCommissionRate REAL,
                commissionRateNew REAL,
                unitPrice REAL,
                orderCount INTEGER DEFAULT 0,
                gmv REAL DEFAULT 0,
                price REAL,
                sampleSent INTEGER DEFAULT 0,
                stageTimes TEXT DEFAULT '{}',
                sortWeight INTEGER DEFAULT 1,
                adAccountId TEXT DEFAULT '',
                clientName TEXT DEFAULT '',
                supplyChainName TEXT DEFAULT '',
                createdAt TEXT DEFAULT '',
                lastUpdate TEXT DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_matches_status ON matches_(status);
            CREATE INDEX IF NOT EXISTS idx_matches_sort ON matches_(sortWeight DESC);
        """)

        # ---- users 用户表 ----
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                name TEXT NOT NULL DEFAULT '',
                role TEXT NOT NULL DEFAULT 'operator',
                dept TEXT DEFAULT '',
                status INTEGER NOT NULL DEFAULT 1,
                last_login TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        
        # 默认管理员
        row = conn.execute("SELECT COUNT(*) as cnt FROM users WHERE role='admin'").fetchone()
        if row["cnt"] == 0:
            admin_pw = _hash_password("admin123")
            conn.execute(
                "INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, ?, ?)",
                ("admin", admin_pw, "系统管理员", "admin"),
            )
            print("[INIT] 已创建默认管理员: admin / admin123")

        conn.commit()
        print(f"[INIT] SQLite 数据库就绪: {DB_PATH}")
        print("[INIT] 用户认证系统已启用")
    finally:
        conn.close()

_init_db()


# ========== 认证依赖 ==========
def get_current_user(request: Request) -> Optional[dict]:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth[7:]
    payload = _decode_token(token)
    if not payload:
        return None
    return {"username": payload["u"], "role": payload["r"], "name": payload.get("n", "")}

def require_auth(request: Request) -> dict:
    user = get_current_user(request)
    if not user:
        raise HTTPException(401, "未登录或登录已过期，请重新登录")
    return user

def require_admin(request: Request) -> dict:
    user = require_auth(request)
    if user["role"] != "admin":
        raise HTTPException(403, "需要管理员权限")
    return user


# ========== 自增 ID 生成 ==========
def next_id(prefix: str) -> str:
    table = "products" if prefix == "P" else ("talents" if prefix == "T" else "matches_")
    conn = get_conn()
    try:
        row = conn.execute(
            f"SELECT id FROM {table} WHERE id LIKE ? ORDER BY id DESC LIMIT 1",
            (f"{prefix}%",)
        ).fetchone()
        if row:
            num = int(row["id"][len(prefix):]) + 1
        else:
            num = 1
        return f"{prefix}{str(num).zfill(4)}"
    finally:
        conn.close()


# ==================== 路由 ====================

@app.get("/")
async def root():
    return RedirectResponse(url="/static/index.html")

@app.get("/login")
async def login_page():
    return FileResponse(os.path.join(os.path.dirname(os.path.abspath(__file__)), "login.html"), media_type="text/html")

@app.get("/api/health")
async def health_check():
    try:
        conn = get_conn()
        conn.execute("SELECT 1")
        conn.close()
        return {"status": "ok", "database": "connected", "db_path": DB_PATH}
    except Exception as e:
        return JSONResponse(status_code=500, content={"status": "error", "database": str(e)})


# ==================== PRODUCTS API ====================

@app.get("/api/products")
async def list_products(type: Optional[str] = None):
    conn = get_conn()
    try:
        if type:
            rows = conn.execute(
                "SELECT * FROM products WHERE type=? ORDER BY sortWeight DESC, id ASC", (type,)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM products ORDER BY sortWeight DESC, id ASC"
            ).fetchall()
        return [_deserialize_json_fields(_row_to_dict(r), JSON_FIELDS_PRODUCT) for r in rows]
    finally:
        conn.close()

@app.get("/api/products/{pid}")
async def get_product(pid: str):
    conn = get_conn()
    try:
        row = conn.execute("SELECT * FROM products WHERE id=?", (pid,)).fetchone()
        if not row:
            raise HTTPException(404, "商品不存在")
        return _deserialize_json_fields(_row_to_dict(row), JSON_FIELDS_PRODUCT)
    finally:
        conn.close()

@app.post("/api/products")
async def upsert_product(data: dict = Body(...)):
    conn = get_conn()
    try:
        pid = data.get("id") or next_id("P")
        data["id"] = pid
        if not data.get("createdAt"):
            data["createdAt"] = _today()
        data["updatedAt"] = _today()
        data = _clean_empty_strings(data, "products")
        data = _serialize_json_fields(data, JSON_FIELDS_PRODUCT)

        valid_cols = _get_table_columns(conn, "products")
        filtered = {k: v for k, v in data.items() if k in valid_cols}
        cols = list(filtered.keys())
        vals = list(filtered.values())
        placeholders = ", ".join(["?"] * len(cols))
        excl_updates = ", ".join([f"{c}=excluded.{c}" for c in cols if c != "id"])
        sql = f"INSERT INTO products ({', '.join(cols)}) VALUES ({placeholders}) ON CONFLICT(id) DO UPDATE SET {excl_updates}"
        conn.execute(sql, vals)
        conn.commit()
        return {"ok": True, "id": pid}
    finally:
        conn.close()

@app.post("/api/products/batch")
async def batch_upsert_products(items: list = Body(...)):
    results = []
    for item in items:
        pid = item.get("id") or next_id("P")
        item["id"] = pid
        if not item.get("createdAt"):
            item["createdAt"] = _today()
        item["updatedAt"] = _today()
        results.append(pid)

    conn = get_conn()
    try:
        valid_cols = _get_table_columns(conn, "products")
        for item in items:
            item_s = _clean_empty_strings(dict(item), "products")
            item_s = _serialize_json_fields(item_s, JSON_FIELDS_PRODUCT)
            filtered = {k: v for k, v in item_s.items() if k in valid_cols}
            cols = list(filtered.keys())
            vals = list(filtered.values())
            placeholders = ", ".join(["?"] * len(cols))
            excl_updates = ", ".join([f"{c}=excluded.{c}" for c in cols if c != "id"])
            sql = f"INSERT INTO products ({', '.join(cols)}) VALUES ({placeholders}) ON CONFLICT(id) DO UPDATE SET {excl_updates}"
            conn.execute(sql, vals)
        conn.commit()
        return {"ok": True, "count": len(items), "ids": results}
    finally:
        conn.close()

@app.delete("/api/products")
async def delete_products_bulk(request: Request):
    data = await request.json()
    ids = data.get("ids")
    type_ = data.get("type")
    all_ = data.get("all", False)
    conn = get_conn()
    try:
        if all_:
            conn.execute("DELETE FROM products")
        elif type_:
            conn.execute("DELETE FROM products WHERE type=?", (type_,))
        elif ids:
            placeholders = ", ".join(["?"] * len(ids))
            conn.execute(f"DELETE FROM products WHERE id IN ({placeholders})", ids)
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()

@app.post("/api/products/delete")
async def delete_products_bulk_post(request: Request):
    return await delete_products_bulk(request)


# ==================== TALENTS API ====================

@app.get("/api/talents")
async def list_talents(level: Optional[str] = None):
    conn = get_conn()
    try:
        if level:
            rows = conn.execute(
                "SELECT * FROM talents WHERE level=? ORDER BY sortWeight DESC, id ASC", (level,)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM talents ORDER BY sortWeight DESC, id ASC"
            ).fetchall()
        return [_deserialize_json_fields(_row_to_dict(r), JSON_FIELDS_TALENT) for r in rows]
    finally:
        conn.close()

@app.get("/api/talents/{tid}")
async def get_talent(tid: str):
    conn = get_conn()
    try:
        row = conn.execute("SELECT * FROM talents WHERE id=?", (tid,)).fetchone()
        if not row:
            raise HTTPException(404, "达人不存在")
        return _deserialize_json_fields(_row_to_dict(row), JSON_FIELDS_TALENT)
    finally:
        conn.close()

@app.post("/api/talents")
async def upsert_talent(data: dict = Body(...)):
    conn = get_conn()
    try:
        tid = data.get("id") or next_id("T")
        data["id"] = tid
        if not data.get("createdAt"):
            data["createdAt"] = _today()
        data["updatedAt"] = _today()
        data = _clean_empty_strings(data, "talents")
        data = _serialize_json_fields(data, JSON_FIELDS_TALENT)

        valid_cols = _get_table_columns(conn, "talents")
        filtered = {k: v for k, v in data.items() if k in valid_cols}
        cols = list(filtered.keys())
        vals = list(filtered.values())
        placeholders = ", ".join(["?"] * len(cols))
        excl_updates = ", ".join([f"{c}=excluded.{c}" for c in cols if c != "id"])
        sql = f"INSERT INTO talents ({', '.join(cols)}) VALUES ({placeholders}) ON CONFLICT(id) DO UPDATE SET {excl_updates}"
        conn.execute(sql, vals)
        conn.commit()
        return {"ok": True, "id": tid}
    finally:
        conn.close()

@app.post("/api/talents/batch")
async def batch_upsert_talents(items: list = Body(...)):
    results = []
    for item in items:
        tid = item.get("id") or next_id("T")
        item["id"] = tid
        if not item.get("createdAt"):
            item["createdAt"] = _today()
        item["updatedAt"] = _today()
        results.append(tid)
    conn = get_conn()
    try:
        valid_cols = _get_table_columns(conn, "talents")
        for item in items:
            item_s = _clean_empty_strings(dict(item), "talents")
            item_s = _serialize_json_fields(item_s, JSON_FIELDS_TALENT)
            filtered = {k: v for k, v in item_s.items() if k in valid_cols}
            cols = list(filtered.keys())
            vals = list(filtered.values())
            placeholders = ", ".join(["?"] * len(cols))
            excl_updates = ", ".join([f"{c}=excluded.{c}" for c in cols if c != "id"])
            sql = f"INSERT INTO talents ({', '.join(cols)}) VALUES ({placeholders}) ON CONFLICT(id) DO UPDATE SET {excl_updates}"
            conn.execute(sql, vals)
        conn.commit()
        return {"ok": True, "count": len(items), "ids": results}
    finally:
        conn.close()

@app.delete("/api/talents")
async def delete_talents_bulk(request: Request):
    data = await request.json()
    ids = data.get("ids")
    level = data.get("level")
    all_ = data.get("all", False)
    conn = get_conn()
    try:
        if all_:
            conn.execute("DELETE FROM talents")
        elif level:
            conn.execute("DELETE FROM talents WHERE level=?", (level,))
        elif ids:
            placeholders = ", ".join(["?"] * len(ids))
            conn.execute(f"DELETE FROM talents WHERE id IN ({placeholders})", ids)
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()

@app.post("/api/talents/delete")
async def delete_talents_bulk_post(request: Request):
    return await delete_talents_bulk(request)


# ==================== MATCHES API ====================

@app.get("/api/matches")
async def list_matches(status: Optional[str] = None):
    conn = get_conn()
    try:
        if status:
            rows = conn.execute(
                "SELECT * FROM matches_ WHERE status=? ORDER BY sortWeight DESC, id ASC", (status,)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM matches_ ORDER BY sortWeight DESC, id ASC"
            ).fetchall()
        return [_deserialize_json_fields(_row_to_dict(r), JSON_FIELDS_MATCH) for r in rows]
    finally:
        conn.close()

@app.get("/api/matches/{mid}")
async def get_match(mid: str):
    conn = get_conn()
    try:
        row = conn.execute("SELECT * FROM matches_ WHERE id=?", (mid,)).fetchone()
        if not row:
            raise HTTPException(404, "撮合单不存在")
        return _deserialize_json_fields(_row_to_dict(row), JSON_FIELDS_MATCH)
    finally:
        conn.close()

@app.post("/api/matches")
async def upsert_match(data: dict = Body(...)):
    conn = get_conn()
    try:
        mid = data.get("id") or next_id("M")
        data["id"] = mid
        today = _today()
        stage_times = data.get("stageTimes") or {}
        if data.get("status") and not stage_times.get(data["status"]):
            stage_times[data["status"]] = today
        data["stageTimes"] = stage_times
        data["lastUpdate"] = today
        if not data.get("createdAt"):
            data["createdAt"] = today
        data = _clean_empty_strings(data, "matches_")
        data = _serialize_json_fields(data, JSON_FIELDS_MATCH)

        valid_cols = _get_table_columns(conn, "matches_")
        filtered = {k: v for k, v in data.items() if k in valid_cols}
        cols = list(filtered.keys())
        vals = list(filtered.values())
        placeholders = ", ".join(["?"] * len(cols))
        excl_updates = ", ".join([f"{c}=excluded.{c}" for c in cols if c != "id"])
        sql = f"INSERT INTO matches_ ({', '.join(cols)}) VALUES ({placeholders}) ON CONFLICT(id) DO UPDATE SET {excl_updates}"
        conn.execute(sql, vals)
        conn.commit()
        return {"ok": True, "id": mid}
    finally:
        conn.close()

@app.post("/api/matches/batch")
async def batch_upsert_matches(items: list = Body(...)):
    results = []
    today = _today()
    for item in items:
        mid = item.get("id") or next_id("M")
        item["id"] = mid
        stage_times = item.get("stageTimes") or {}
        if item.get("status") and not stage_times.get(item["status"]):
            stage_times[item["status"]] = today
        item["stageTimes"] = stage_times
        item["lastUpdate"] = today
        if not item.get("createdAt"):
            item["createdAt"] = today
        results.append(mid)
    conn = get_conn()
    try:
        valid_cols = _get_table_columns(conn, "matches_")
        for item in items:
            item_s = _clean_empty_strings(dict(item), "matches_")
            item_s = _serialize_json_fields(item_s, JSON_FIELDS_MATCH)
            filtered = {k: v for k, v in item_s.items() if k in valid_cols}
            cols = list(filtered.keys())
            vals = list(filtered.values())
            placeholders = ", ".join(["?"] * len(cols))
            excl_updates = ", ".join([f"{c}=excluded.{c}" for c in cols if c != "id"])
            sql = f"INSERT INTO matches_ ({', '.join(cols)}) VALUES ({placeholders}) ON CONFLICT(id) DO UPDATE SET {excl_updates}"
            conn.execute(sql, vals)
        conn.commit()
        return {"ok": True, "count": len(items), "ids": results}
    finally:
        conn.close()

@app.delete("/api/matches")
async def delete_matches_bulk(request: Request):
    data = await request.json()
    ids = data.get("ids")
    status = data.get("status")
    all_ = data.get("all", False)
    conn = get_conn()
    try:
        if all_:
            conn.execute("DELETE FROM matches_")
        elif status:
            conn.execute("DELETE FROM matches_ WHERE status=?", (status,))
        elif ids:
            placeholders = ", ".join(["?"] * len(ids))
            conn.execute(f"DELETE FROM matches_ WHERE id IN ({placeholders})", ids)
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()

@app.post("/api/matches/delete")
async def delete_matches_bulk_post(request: Request):
    return await delete_matches_bulk(request)


# ========== 排序权重 ==========
@app.put("/api/{kind}/{item_id}/sort")
async def update_sort_weight(kind: str, item_id: str, data: dict = Body(...)):
    table = {"product": "products", "talent": "talents", "match": "matches_"}.get(kind)
    if not table:
        raise HTTPException(400, "无效的类型")
    weight = max(1, int(data.get("sortWeight", 1)))
    conn = get_conn()
    try:
        conn.execute(f"UPDATE {table} SET sortWeight=? WHERE id=?", (weight, item_id))
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()

@app.post("/api/{kind}/{item_id}/sort")
async def update_sort_weight_post(kind: str, item_id: str, data: dict = Body(...)):
    return await update_sort_weight(kind, item_id, data)


# ========== 统计 API ==========
@app.get("/api/stats")
async def get_stats():
    conn = get_conn()
    try:
        product_count = conn.execute("SELECT COUNT(*) as cnt FROM products").fetchone()["cnt"]
        book_count = conn.execute("SELECT COUNT(*) as cnt FROM products WHERE type='book'").fetchone()["cnt"]
        course_count = conn.execute("SELECT COUNT(*) as cnt FROM products WHERE type='course'").fetchone()["cnt"]
        talent_count = conn.execute("SELECT COUNT(*) as cnt FROM talents").fetchone()["cnt"]

        level_rows = conn.execute("SELECT level, COUNT(*) as cnt FROM talents GROUP BY level").fetchall()
        level_counts = {r["level"]: r["cnt"] for r in level_rows}

        match_count = conn.execute("SELECT COUNT(*) as cnt FROM matches_").fetchone()["cnt"]
        status_rows = conn.execute("SELECT status, COUNT(*) as cnt FROM matches_ GROUP BY status").fetchall()
        status_counts = {r["status"]: r["cnt"] for r in status_rows}

        total_gmv_row = conn.execute("SELECT COALESCE(SUM(gmv),0) as total FROM matches_ WHERE status='selling'").fetchone()
        total_gmv = float(total_gmv_row["total"])
        selling_count = status_counts.get("selling", 0)

        return {
            "productCount": product_count,
            "bookCount": book_count,
            "courseCount": course_count,
            "talentCount": talent_count,
            "levelCounts": level_counts,
            "matchCount": match_count,
            "statusCounts": status_counts,
            "totalGmv": total_gmv,
            "sellingCount": selling_count,
            "convRate": round(selling_count / match_count * 100, 1) if match_count > 0 else 0,
        }
    finally:
        conn.close()


# ==================== AUTH API ====================

@app.post("/api/auth/login")
async def login(data: dict = Body(...)):
    username = (data.get("username") or "").strip()
    password = data.get("password", "")
    if not username or not password:
        raise HTTPException(400, "请输入用户名和密码")
    conn = get_conn()
    try:
        user = conn.execute(
            "SELECT * FROM users WHERE username=? AND status=1", (username,)
        ).fetchone()
    finally:
        conn.close()
    if not user:
        raise HTTPException(401, "用户名或密码错误")
    user_dict = _row_to_dict(user)
    if _hash_password(password) != user_dict["password_hash"]:
        raise HTTPException(401, "用户名或密码错误")

    conn = get_conn()
    try:
        conn.execute("UPDATE users SET last_login=datetime('now') WHERE id=?", (user_dict["id"],))
        conn.commit()
    finally:
        conn.close()

    token = _generate_token(user_dict)
    return {
        "ok": True, "token": token,
        "user": {
            "username": user_dict["username"], "name": user_dict["name"],
            "role": user_dict["role"], "dept": user_dict.get("dept", ""),
        },
    }

@app.get("/api/auth/me")
async def get_me(request: Request):
    user = require_auth(request)
    return {"ok": True, "user": user}

@app.post("/api/auth/users")
async def manage_users(request: Request, data: dict = Body(...)):
    require_admin(request)
    action = data.get("action")
    conn = get_conn()
    try:
        if action == "list":
            rows = conn.execute(
                """SELECT id, username, name, role, dept, status,
                          strftime('%Y-%m-%d %H:%M', last_login) as last_login,
                          strftime('%Y-%m-%d', created_at) as created_at
                   FROM users ORDER BY id"""
            ).fetchall()
            return {"ok": True, "users": _rows_to_list(rows)}

        elif action == "create":
            username = (data.get("username") or "").strip()
            password = data.get("password", "")
            name = (data.get("name") or "").strip()
            role = data.get("role", "operator")
            if not username or not password or not name:
                raise HTTPException(400, "用户名、密码、姓名不能为空")
            if role not in ("admin", "operator"):
                raise HTTPException(400, "角色必须是 admin 或 operator")
            pw_hash = _hash_password(password)
            try:
                cur = conn.execute(
                    "INSERT INTO users (username, password_hash, name, role, dept) VALUES (?,?,?,?,?)",
                    (username, pw_hash, name, role, data.get("dept", "")),
                )
                conn.commit()
                uid = cur.lastrowid
            except sqlite3.IntegrityError:
                raise HTTPException(409, f"用户名 '{username}' 已存在")
            return {"ok": True, "id": uid, "msg": f"用户 {username} 创建成功"}

        elif action == "update":
            uid = data.get("id")
            if not uid:
                raise HTTPException(400, "缺少用户 ID")
            updates, vals = [], []
            for k in ("name", "role", "dept", "status"):
                if k in data:
                    updates.append(f"{k}=?"); vals.append(data[k])
            if "password" in data and data["password"]:
                updates.append("password_hash=?"); vals.append(_hash_password(data["password"]))
            if not updates:
                raise HTTPException(400, "没有要更新的字段")
            vals.append(uid)
            conn.execute(f"UPDATE users SET {', '.join(updates)} WHERE id=?", vals)
            conn.commit()
            return {"ok": True, "msg": "用户已更新"}

        elif action == "delete":
            uid = data.get("id")
            if not uid:
                raise HTTPException(400, "缺少用户 ID")
            conn.execute("DELETE FROM users WHERE id=? AND username!='admin'", (uid,))
            conn.commit()
            return {"ok": True, "msg": "用户已删除"}

        else:
            raise HTTPException(400, "未知操作")
    finally:
        conn.close()

@app.post("/api/auth/change-password")
async def change_password(request: Request, data: dict = Body(...)):
    user = require_auth(request)
    old_pw = data.get("old_password", "")
    new_pw = data.get("new_password", "")
    if not old_pw or not new_pw:
        raise HTTPException(400, "请输入旧密码和新密码")
    if len(new_pw) < 4:
        raise HTTPException(400, "新密码至少 4 位")
    conn = get_conn()
    try:
        row = conn.execute("SELECT password_hash FROM users WHERE username=?", (user["username"],)).fetchone()
        if not row or _hash_password(old_pw) != row["password_hash"]:
            raise HTTPException(401, "旧密码错误")
        conn.execute("UPDATE users SET password_hash=? WHERE username=?",
                     (_hash_password(new_pw), user["username"]))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True, "msg": "密码修改成功"}


# ========== 静态文件挂载（必须放在最后） ==========
import shutil
_root = os.path.dirname(os.path.abspath(__file__))
_static_dir = os.path.join(_root, "static")
os.makedirs(_static_dir, exist_ok=True)
os.makedirs(os.path.join(_static_dir, "css"), exist_ok=True)
os.makedirs(os.path.join(_static_dir, "js"), exist_ok=True)

# 同步前端文件到 static 目录
for item in ["index.html", "admin.html", "login.html", "css", "js"]:
    src = os.path.join(_root, item)
    dst = os.path.join(_static_dir, item)
    if os.path.exists(src) and os.path.abspath(src) != os.path.abspath(dst):
        try:
            if os.path.isdir(src):
                if os.path.exists(dst):
                    shutil.rmtree(dst)
                shutil.copytree(src, dst)
            else:
                shutil.copy2(src, dst)
            print(f"[INIT] 已同步 {item} -> static/{item}")
        except Exception as e:
            print(f"[WARN] 复制 {item} 到 static 失败: {e}")

print("[INIT] 已注册的 API 路由:")
for route in app.routes:
    if hasattr(route, 'path') and hasattr(route, 'methods'):
        print(f"  {route.methods} {route.path}")

app.mount("/static", StaticFiles(directory=_static_dir), name="static")
