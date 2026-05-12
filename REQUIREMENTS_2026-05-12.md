# 商达撮合系统 V4.1 · Demo Review 调整需求（2026-05-12）

> **来源**：2026-05-12 23:14 用户在演示后提出的 11 条优化需求
> **目标**：完善 Demo 展示效果，去除不必要项，补足广场筛选

---

## 需求清单

### 1. 数据看板：删除"活跃主体"卡片
- 位置：`public/js/app.js` 第 824-831 行（kpi-row-primary 第 4 张大卡）
- 操作：直接删除整张 `kpi-purple` 卡片；4 张顶部卡 → 3 张
- 后端 `routes/stats.js` `/stats/dashboard` 中 `activeMerchants / activeInfluencers` 计算可保留（不影响），也可清理（先保留兼容）

### 2. 数据看板："撮合转化漏斗" 中英文混杂统一为中文
- 检查 `initFunnelChart()`（约 1000 行）：当前 chart 数据用 funnel.label（已是中文）
- 检查 `routes/stats.js` funnel 接口：返回 `{stage:'published', label:'发布需求'}` — label 是中文
- 实际混杂位置：tooltip / sub 文案 / x-axis 标签 — 需要逐项检查改为纯中文

### 3. 销售业绩排行榜：删除
- 位置：`public/js/app.js` 第 877-882 行 + 第 916 行 `initSalesRankChart` + 第 750 行 `salesRes` 拉取
- 操作：删除前端调用 + UI 卡片 + chart 函数 `initSalesRankChart`
- 后端 `/stats/sales-ranking` 接口可保留（兼容），不调用即可

### 4. 数据看板：删除"达人粉丝量段"图
- 位置：`public/js/app.js` 第 869-874 行 `<div class="dash-chart-card">达人粉丝量段</div>` + 第 915 行 `initFansChart`
- 操作：删除该图表卡片 + 调用；只剩"达人等级分布"独占一行（或与其它合并）
- 后端 `distribution.fansBuckets` 保留兼容
- ⚠️ 注意：达人广场筛选面板内的"粉丝量段"下拉（第 2680 行）**不要删**，那是搜索条件不是看板

### 5. 超管角色下"我的收藏"菜单：删除
- 位置：`public/js/app.js` 第 610 行（admin 侧边栏 `'资源广场'` items 中）
- 操作：删除该项；商家、达人侧边栏的"我的收藏"保留
- ⚠️ 后端 `/api/favorites` 接口和 `routes/favorites.js` 保留（商家/达人仍要用）
- ⚠️ `renderFavorites()` 函数保留（商家/达人入口仍需）

### 6. 达人广场：Hero 数据卡支持点击筛选
- 位置：`public/js/app.js` 第 2636-2662 行 `inf-hero-stats` 卡片组
- 行为：
  - 点击 `A级达人/B级达人/C级达人/S级达人` → 设置 `infFilters.level=[等级]` 触发 `applyInfFilter()`
  - 点击 `已入互选` → `infFilters.mutual_select='已入驻互选'`（先看 filter-options 对应值）
  - 点击 `MCN达人` → `infFilters.has_mcn='是'`
  - 再次点击同一卡片 → 清除该筛选（toggle）
  - 卡片高亮（active 样式）显示当前激活的快捷筛选
- 实现：在 `<div class="inf-stat-card">` 加 `onclick="quickFilterInf('level','A级')"` 等

### 7. "我的收藏" 主体列表 → 身份列表（仅文案）
- 位置：`public/js/app.js` 第 6912 行 / 第 6922 行函数注释 / 第 6943 行空状态文案
- 改动：
  - tab 标签 `主体列表` → `身份列表`
  - 空状态文案 `暂无收藏的主体` → `暂无收藏的身份`
- ⚠️ 字段名 `entities` 不动，只改文案

### 8. 数据看板"业绩排行榜" → "需求排行榜"
- 位置：`public/js/app.js` 第 887 行 `<div class="dash-chart-title">业绩排行榜 ...`
- 改动：`业绩排行榜` → `需求排行榜`；副标题 `4 类 · 按次数` 保留

### 9. 数据看板：删除"潜在合作金额"卡片
- 位置：`public/js/app.js` 第 808-815 行（kpi-green 第 2 张大卡）
- 操作：删除整张卡片；配合需求 1，顶部 KPI 由 4 张 → 2 张（"已确认合作"+"撮合达成率"）
- 后端 `potentialGmv` 保留兼容
- 因此：顶部大卡变成 **2 张**（已确认合作 / 撮合达成率）

### 10. 排行榜 Tab 标签微调
- 位置：`public/js/app.js` 第 889-892 行
- 改动：
  | 旧 | 新 |
  |---|---|
  | 商家需求 | 需求商家排行榜 |
  | 达人需求 | 需求达人排行榜 |
  | 商家接单 | 接单商家排行榜 |
  | 达人接单 | 接单达人排行榜 |
- 由于 tab 按钮宽度有限，可改为简洁版 `需求商家 / 需求达人 / 接单商家 / 接单达人`，标题里说明"需求排行榜"已涵盖语义

### 11. 需求广场新增筛选能力（核心功能）
- 现状：`renderDemandPlaza()` 只有 keyword 搜索框 + 分页（第 6175-6233 行）
- 目标：参考达人广场 `inf-filter-panel` 加一个可折叠筛选面板
- 筛选维度：
  - 类型：商家需求 / 达人需求（type=`merchant_demand|influencer_demand`）
  - 商品品类：图书 / 课程（demand_type）
  - 类目：从已有数据动态生成（category）
  - 关键词（已有）
- 后端：`routes/demands.js` `/plaza` 接口已有 keyword 支持，需要补 `type` 和 `demand_type` 参数过滤

---

## 实施顺序（约 1.5 小时）

1. **改前端文案 / 删卡片**（30min）— 需求 1, 2, 3, 4, 7, 8, 9, 10
2. **删超管收藏菜单**（5min）— 需求 5
3. **达人广场 Hero 卡可点击**（20min）— 需求 6
4. **需求广场筛选面板**（30min）— 需求 11（前端 + 后端 type/demand_type 参数）
5. **本地验收**（10min）→ 提交 → push Gitee → 服务器 `git pull && systemctl restart bizmatch`

---

## 三端同步流程

按 README 标准流程：
```bash
# 本地
git add -A && git commit -m "feat(v4.1): demo review 调整 11 项"
git push origin main

# 服务器
ssh / lighthouse execute_command:
cd /opt/bizmatch && git pull origin main && systemctl restart bizmatch
```
