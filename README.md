# 商达撮合系统

商家与达人（KOL/网红）智能撮合平台，实现商家需求发布、达人接单、撮合作业全流程管理。

## 功能特性

- **数据看板** — 实时展示平台核心数据指标
- **资源广场** — 达人广场 / 商家需求 / 达人需求
- **撮合管理** — 5 阶段看板（发布需求 → 需求回应 → 需求建联 → 样品寄送（可选） → 开始合作），单向孵化机制
- **系统管理** — 商家管理 / 达人管理 / 管理员管理（按角色分级）
- **我的收藏** — 三方均可收藏需求 / 主体（商家+达人）
- **批量导入** — 管理员侧统一入口，支持达人/商家需求/达人需求批量导入

## 业务流程

1. 商家发布需求；达人发布达人需求
2. 商家邀请达人 / 达人申请商家 → 落入 `cooperation` 意向池
3. 任一方点"接受" → 自动孵化一条 `matchmaking` 撮合工单（stage=connected 需求建联）
4. 运营在撮合管理看板里推进：发布需求 → 需求回应 → 需求建联 → 样品寄送（可选） → 开始合作
5. 运营也可"+ 新建合作"直接录入线下撮合，不依赖 cooperation

## 技术栈

- **后端**: Node.js + Express + better-sqlite3
- **前端**: 原生 HTML/CSS/JS（SPA 架构）
- **数据库**: SQLite，单文件 `db/merchant_match.db`

## 快速启动

```bash
npm install
node app.js
```

访问 http://localhost:3000

**首次登录**：
- 超管：`admin` / `admin123` （请首次登录后立即修改密码）
- 商家/达人：通过超管邀请链接激活注册，系统默认不预置任何业务账号

## 生产数据重置

如需清空所有业务数据（商家/达人/需求/合作/收藏等），回到全新部署状态：

```bash
node db/reset-to-production.js            # 交互确认
node db/reset-to-production.js --yes      # 非交互直接执行
```

执行前会自动备份 `db/merchant_match.db` 到 `merchant_match.db.bak.<时间戳>`。
清空后仅保留 `admin` 超管账号。

## API 模块

| 路径 | 说明 |
|------|------|
| /api/merchants | 商家管理（含软删除/导出） |
| /api/influencers | 达人管理（含批量上传/导出） |
| /api/demands | 商家需求 / 达人需求 / 接单 |
| /api/recruitments | 商家招募 |
| /api/cooperation | 合作邀约 + 撮合工单 + 看板统计 |
| /api/admins | 管理员/销售管理 |
| /api/excel | Excel 批量导入 |
| /api/stats | 数据统计 |
| /api/favorites | 收藏功能（V4） |

## 代码同步

- **主仓库（默认 push & pull）**：Gitee — `gitee.com/xiyufenghan/Business-Matching`
- **备份仓库**：GitHub — `github.com/xiyufenghan/Business-Matching`
- **生产服务器** `/opt/bizmatch`：从 Gitee 拉取

## 生产部署

**服务器**：腾讯云轻量应用服务器 `lhins-1kh87y02`（ap-beijing, 82.156.82.50）

**进程管理**：PM2，进程名 `bizmatch`

```bash
# 启动（必须指定 PORT=8001，默认 3000 被占用）
PORT=8001 pm2 start app.js --name bizmatch

# 更新代码并重启
cd /opt/bizmatch && git pull origin main && pm2 restart bizmatch

# 查看状态
pm2 show bizmatch
```

**Nginx 反代**：`bizmatch.dacongming.chat` → `127.0.0.1:8001`（SSL 证书 `/etc/letsencrypt/live/bizmatch.dacongming.chat/`）

### 北京服务器端口分配（3000-3005 均已占用）

| 端口 | 服务 | 方式 |
|------|------|------|
| 3000 | market-advisor | Docker |
| 3001 | flashcamp-class | PM2 |
| 3002 | skillstore | Docker |
| 3003 | huiben | Docker |
| 3005 | xiaodian-server | Docker |
| **8001** | **bizmatch（本系统）** | **PM2** |

> ⚠️ **重要**：`bizmatch` 必须使用 `PORT=8001`，绝不能使用默认 3000。2026-05-25 曾因 PM2 注册的 bizmatch 使用默认端口 3000 与 Docker 冲突，导致进程反复重启 106 次进入 errored 状态。今后重建 PM2 进程时务必带 `PORT=8001` 环境变量。
