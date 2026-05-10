# 商达撮合系统 V4 调整需求文档（最终版）

> **整理日期**：2026-05-10（周日）
> **输入材料**：
> - `修改意见.docx`（106 段、21 张配图，2026-05-09 周六讨论纪要）
> - `达人等级全部(1).xlsx`（达人字段：16 列）
> - `达人需求字段.xlsx`（达人发布需求字段：7 列）
> - ~~`图书货盘导入模板.xlsx`~~（已废弃，不再使用）
>
> **当前代码版本**：`975dc54`（V3）· 三端一致
> **目标**：以 **Demo 演示效果优先**，做出一版字段标准化、流程清晰、视觉饱满的体验
> **角色定义**：本项目无独立程序员，由 **产品经理（Alex）** + **AI 程序员（Claude）** 两人协作完成

---

## 〇、本文档的一锤定音决定（已与产品经理逐项确认）

### 1. 视觉与文案
- **侧边栏分组**：保留分组结构，把"主工作区"这个 section header 改名为 **"资源广场"**
- **撮合管理菜单名**：商家视角 → "我的需求"；达人视角 → "我的需求"；管理员视角 → 维持"撮合管理"
- **合作意向按钮**：商家点 → "邀请合作"；达人点 → "申请合作"；管理员按上下文（商家需求看到"邀请合作"，达人需求看到"申请合作"）
- **数据看板顶部加横幅**："Demo 占位，正式口径待确认"

### 2. 商家货盘概念彻底清理（重要）
- **概念层面**：完全移除"商家货盘"的说法，统一改为 **"商家需求"**
- **UI 层面**：所有"商家货盘 / 图书货盘 / 课程货盘 / 货盘数 / 关联货盘"措辞全部清理（具体见 §四清理清单）
- **数据库层面**：底层表名 `book_demands` / `course_demands` / `demands` **不改名**（程序员视角的英文标识符，用户看不到）
- **图书/课程区分**：UI 上保留——商家发布需求时，弹窗里有"图书 / 课程"两个 tab 切换，字段不同；底层仍存在两张表
- **图书货盘导入模板.xlsx** 这份文件 **不再使用**，本文档不参考其字段

### 3. 字段标准化
- 达人字段：以 `达人等级全部.xlsx` 16 列为准（DB 已全覆盖）
- 达人需求字段：以 `达人需求字段.xlsx` 7 列为准（DB 已覆盖，需求类型从单选改多选）
- 商家需求字段：以修改意见 §1.10 的 10 列为准（需新增"商品卖点"和"备注"两个字段）
- 达人新增 4 字段：账号介绍 / 粉丝画像 / 代表作品（最多 3 条链接）/ 是否有公众号

### 4. 撮合 5 段流程
**发布需求 → 需求回应 → 需求建联 → 样品寄送（可选） → 开始合作**

- 阶段定义：
  - 发布需求 = 商家或达人发出需求
  - 需求回应 = 对方点"邀请合作 / 申请合作"
  - 需求建联 = 对方接受响应，双方达成意向
  - 样品寄送 = 可选阶段，可跳过
  - 开始合作 = 真正进入合作

- 老数据迁移：**项目目前没有真实业务数据**，无需迁移映射

### 5. 业绩排行榜（4 类，按次数排序）
| 类别 | 排序口径 |
|---|---|
| 商家需求榜 | 该商家发布的需求总数 |
| 达人接单榜 | 该达人参与的合作次数 |
| 商家接单榜 | 该商家被达人发起合作邀约后接受的次数 |
| 达人需求榜 | 该达人发布的需求总数 |

### 6. 批量上传（仅管理员）
- 入口：管理员侧边栏新增 **"批量导入"** 工具
- 工具内 3 个 tab：
  1. 达人导入（16 列）
  2. 商家需求导入（10 列，按修改意见 §1.10）
  3. 达人需求导入（7 列）
- 商家自己的"我的需求"页 → ❌ 不放批量入口
- 达人自己的"我的需求"页 → ❌ 不放批量入口

### 7. 联络功能（管理员专属）
- 管理员在达人/商家详情页/列表行点 "联络"
- **方案 A（实现）**：弹窗显示对方的"手机号 / 邮箱 / 微信号 / 视频号"，提供"复制"按钮
- 后续可扩展：与企业微信消息通知联动（远期，非本次范围）

### 8. 收藏功能（三方均可）
- **入口**：在需求卡片、达人卡片、商家卡片上加 ⭐ 图标，点亮即收藏
- **菜单位置**：每个角色侧边栏新增 **"我的收藏"** 菜单项（不放"个人中心"）
- **收藏页 2 个 tab**：
  - 需求列表（收藏的具体需求）
  - 主体列表（收藏的人/商家）
- **可收藏内容**：
  - 商家可收藏：达人 + 任意需求
  - 达人可收藏：商家主体（不是商家的具体需求）+ 任意需求
  - 管理员可收藏：商家 + 达人 + 任意需求

### 9. 热推与置顶（管理员专属）
- 仅管理员可操作
- 上限：商家需求广场上限 5 条 + 达人需求广场上限 5 条（**方案 1**，分别独立）
- 视觉：置顶卡片右上角加红色 🔥 "热推" 角标
- 期限：手动控制，不自动撤
- 排序：广场列表 `ORDER BY pinned_at DESC NULLS LAST, created_at DESC`

### 10. 看板指标
- 顶部加横幅：**"Demo 占位，正式口径待确认"**
- 待处理合作 tooltip：**"用户（达人/商家）收到一个需求或邀约后，未处理（未接受/未拒绝）的合作数量"**
- 新增合作 tooltip：**"用户处理完成后，系统产生的'新增'状态合作数量"**

### 11. F1–F10 全部"做"
| 编号 | 项 |
|---|---|
| F1 | 修改图表标题"需求商品品类" |
| F2 | 时间轴每条加"流程环节 + 商品品类"标签 |
| F3 | "我的需求"列表加"下架"按钮（替代删除），下架后可复制/恢复 |
| F4 | 达人"我的需求"页去掉"一键清空"按钮 |
| F5 | 所有广场/列表搜索框 → 改为字段下拉筛选 |
| F6 | 达人广场筛选不隐藏；"视频品类"= `video_category_track` |
| F7 | 合作管理与具体需求关联展示，链回原需求 |
| F8 | 合作管理收到意向后加"接受/拒绝"按钮 |
| F9 | "我的需求"加 5 段流转看板 |
| F10 | 达人合作管理拆"我发起的 / 别人找我的"两个 tab |

### 12. 代码同步策略（重要变更）
- **新主仓库**：Gitee（`gitee.com/xiyufenghan/Business-Matching`）
- **GitHub 仓库**：降级为备份仓库，不再作为主推送目标
- **本地 git remote 重整**：
  ```
  origin → Gitee（默认 push）
  github → GitHub（备份）
  ```
- **服务器 `/opt/bizmatch`**：远端切到 Gitee，从 Gitee pull
- **同步流程**：本地改完 → push origin (Gitee) → 服务器 git pull origin

### 13. 实施节奏
- 不分批次提交审阅，**一次性整体动手**做完整 Demo
- 完成后服务器一次部署，给产品经理整体演示

---

## 一、字段标准（落到具体表）

### 1.1 达人字段标准（来自 `达人等级全部(1).xlsx` 16 列）

| 序号 | 字段名 | DB 字段（`influencers` 表） | 状态 |
|---|---|---|---|
| 1 | 达人等级 | `level` | ✅ 已有 |
| 2 | 视频号账号名称 | `video_account_name` | ✅ 已有 |
| 3 | 视频号带货品类赛道 | `video_category_track` | ✅ 已有 |
| 4 | 现视频号品类销售额（月）短视频（万） | `monthly_short_video_sales` | ✅ 已有 |
| 5 | 现视频号品类销售额（月）直播（万） | `monthly_live_sales` | ✅ 已有 |
| 6 | 视频号粉丝数量 | `fans_count` | ✅ 已有 |
| 7 | 可接受的合作类型 | `cooperation_type` | ✅ 已有 |
| 8 | 视频号图书品类带货意愿 | `book_willingness` | ✅ 已有 |
| 9 | 视频号少儿课程品类带货意愿 | `course_willingness` | ✅ 已有 |
| 10 | 最近 3 个月日常短视频更新频率 | `short_video_frequency` | ✅ 已有 |
| 11 | 最近 3 个月日常直播频率 | `live_frequency` | ✅ 已有 |
| 12 | 是否有 MCN | `has_mcn` | ✅ 已有 |
| 13 | MCN 名称 | `mcn_name` | ✅ 已有 |
| 14 | 地区 | `region` | ✅ 已有 |
| 15 | 是否已入驻互选 | `has_joined_mutual_select` | ✅ 已有 |
| 16 | 归属销售 | `sales_owner` / `sales_owner_id` | ✅ 已有 |

#### 达人新增 4 字段（修改意见 1.11）

| 序号 | 字段名 | DB 字段 | 类型 | 备注 |
|---|---|---|---|---|
| 17 | 达人账号介绍 | `introduction` | TEXT | 100-200 字 |
| 18 | 粉丝画像 | `audience_profile` | TEXT | 自由文本，例如"女性 70%/25-35 岁/华东 60%" |
| 19 | 代表作品链接 | `representative_works` | TEXT | 最多存 3 条链接，分号分隔 |
| 20 | 是否有公众号可接单 | `has_official_account` | TEXT | "是 / 否"，与现有 `official_account_name` 配合 |

**Demo 数据**：写一个 `seed-influencer-extra.js` 脚本，给现有所有达人补充上述 4 字段的合理 mock 数据。

### 1.2 达人发布需求字段标准（`达人需求字段.xlsx` 7 列）

| 序号 | 字段 | DB 字段（`influencer_demands` 表） | 状态 |
|---|---|---|---|
| 1 | 视频号名称 | `video_account_name` | ✅ 已有 |
| 2 | 需求类型（多选：图书 / 课程） | `cooperation_types` | ⚠️ 已有但需确认前端按多选 chip 渲染 |
| 3 | 图书售价范围（最低 9.9，最高不限） | `book_price_min` / `book_price_max` | ✅ 已有 |
| 4 | 图书分类（社科/经管/文学/杂志/童书/教辅/科技/其他自填） | `book_category` / `book_promote_categories` | ✅ 已有（多选） |
| 5 | 课程分类（可不填） | `subject_category` | ✅ 已有 |
| 6 | 粉丝数量 | `fans_count` | ✅ 已有 |
| 7 | 需求描述（自由填写） | `description` | ✅ 已有 |

### 1.3 商家发布需求字段标准（修改意见 §1.10）

| 序号 | 字段 | DB 字段 | 状态 |
|---|---|---|---|
| 1 | 标题（商品名称） | `title` / `book_name` / `course_name` | ✅ 已有 |
| 2 | 商品品类（图书 / 课程） | `category` / `book_category` | ✅ 已有 |
| 3 | 商品价格 | `selling_price` / `unit_price` | ✅ 已有 |
| 4 | 合作模式 | `cooperation_type` | ✅ 已有 |
| 5 | 佣金（纯佣 / 投流佣金） | `pure_commission` / `ad_commission` | ✅ 已有 |
| 6 | **商品卖点** | `selling_points` | 🆕 新增 TEXT |
| 7 | 粉丝要求 | `fans_requirement` | ✅ 已有 |
| 8 | 合作预算 | `budget_min` / `budget_max` | ✅ 已有 |
| 9 | **备注** | `remark` | 🆕 新增 TEXT |
| 10 | 商品展示图片 | `book_image` / `course_image` | ✅ 已有 |

**注**：底层依然分 `book_demands` 和 `course_demands` 两张表存（按图书/课程 tab）；UI 上文案统一为"商家需求"。

---

## 二、撮合 5 段流程定义

### 2.1 阶段定义

| # | 中文名 | 英文标识 | 触发时机 | 是否可选 |
|---|---|---|---|---|
| 1 | 发布需求 | `published` | 任意一方发布了需求，自动落到此阶段 | 必经 |
| 2 | 需求回应 | `responded` | 对方点击"邀请合作/申请合作"，自动从 1 → 2 | 必经 |
| 3 | 需求建联 | `connected` | 一方接受了响应，双方达成意向，自动从 2 → 3 | 必经 |
| 4 | 样品寄送 | `sample_sent` | 管理员/商家手动标记，可跳过 | **可选** |
| 5 | 开始合作 | `cooperating` | 任一上一阶段完成后手动推进 | 终态 |

### 2.2 UI 体现
- 看板：5 列横向布局，第 4 列（样品寄送）右上角加灰色"可选"角标
- 卡片可拖动或下拉选择跳转任意阶段；允许从 `connected` 直接跳 `cooperating`
- 撮合详情页有完整阶段时间线

### 2.3 表字段
- `matchmaking.stage` 字段值更新为 5 个枚举（沿用 `published` / `responded` / `connected` / `sample_sent` / `cooperating`）
- 现有 V3 数据中文阶段名（"需求发布/合作匹配/样品寄送/开始合作"）：**因无真实数据，不做迁移映射**，新建库即用新枚举

---

## 三、新增功能模块

### 3.1 收藏功能

#### 数据模型
新建 `favorites` 表：
```sql
CREATE TABLE favorites (
  id TEXT PRIMARY KEY,
  user_type TEXT NOT NULL,    -- merchant / influencer / admin
  user_id TEXT NOT NULL,
  target_type TEXT NOT NULL,  -- merchant / influencer / merchant_demand / influencer_demand
  target_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_type, user_id, target_type, target_id)
);
```

#### 收藏对象矩阵
| 收藏者 \ 被收藏 | 商家主体 | 达人主体 | 商家需求 | 达人需求 |
|---|---|---|---|---|
| 商家 | ❌ | ✅ | ✅ | ✅ |
| 达人 | ✅ | ❌ | ✅ | ✅ |
| 管理员 | ✅ | ✅ | ✅ | ✅ |

#### UI 入口
- 列表卡片右上角 / 详情页顶部加 ⭐ 图标
- ⭐ 默认空心，点亮后实心+橙色

#### "我的收藏"页
- 侧边栏"资源广场"分组下新增"我的收藏"菜单项
- 页内 2 个 tab：
  - **需求列表**：商家需求 + 达人需求
  - **主体列表**：商家 + 达人

#### 后端接口
- `POST /api/favorites` body: `{target_type, target_id}` 添加收藏
- `DELETE /api/favorites` body: `{target_type, target_id}` 取消收藏
- `GET /api/favorites?type=demand|entity` 获取我的收藏（按类型分组）
- `GET /api/favorites/check?target_type=&target_id=` 查某个对象是否已被当前用户收藏（用于点亮 ⭐）

### 3.2 联络功能（管理员专属）

#### UI 入口
- 商家管理列表 / 达人管理列表 → 每行操作列加"联络"按钮
- 商家详情页 / 达人详情页 → 顶部加"联络"按钮

#### 弹窗内容
- 显示对方的：手机号、邮箱、视频号账号名（达人）/ 公司名（商家）
- 每条信息后跟"复制"按钮
- 弹窗底部预留"发送企微通知"按钮（**禁用状态 + tooltip "敬请期待"**）

#### 后端接口
- 复用现有 `GET /api/merchants/:id` 和 `GET /api/influencers/:id`，弹窗直接用返回数据

### 3.3 热推与置顶（管理员专属）

#### 数据模型
- `book_demands` / `course_demands` / `influencer_demands` 表分别新增字段：
  - `pinned_at DATETIME` （NULL = 未置顶；时间值 = 置顶时间，越新越靠前）

#### 上限规则
- 商家需求广场（`book_demands` + `course_demands` 联合）上限 5 条置顶
- 达人需求广场（`influencer_demands`）上限 5 条置顶
- 达到上限时管理员要先取消旧的才能置顶新的（前端弹错误）

#### UI
- 商家需求卡片 / 达人需求卡片：管理员视角下加"📌 置顶 / 取消置顶"按钮
- 已置顶的卡片右上角显示红色 🔥 "热推" 角标
- 广场列表查询 `ORDER BY pinned_at DESC NULLS LAST, created_at DESC`

#### 后端接口
- `PUT /api/demands/:id/pin` 置顶
- `PUT /api/demands/:id/unpin` 取消置顶
- `PUT /api/demands/influencer-demands/:id/pin` 置顶达人需求
- `PUT /api/demands/influencer-demands/:id/unpin` 取消置顶

### 3.4 下架功能（"我的需求"列表）

#### 数据模型
- 现有 `status` 字段新增枚举值 `archived`（下架）
- 状态机：`published` ⇄ `archived`，`archived` 不可参与新合作

#### UI
- 商家"我的需求" / 达人"我的需求" 列表行操作改为：
  - `published` 状态：[编辑] [下架] [删除]
  - `archived` 状态：[复制并恢复] [删除]
- "复制并恢复"= 创建一条新的 `published` 状态的需求，沿用旧字段（用户可改）

#### 后端接口
- `PUT /api/demands/:id/archive` 下架
- `POST /api/demands/:id/duplicate` 复制为新需求

### 3.5 批量导入工具（管理员专属）

#### UI
- 管理员侧边栏 → 工具区新增"批量导入"菜单项
- 页面内 3 个 tab：
  - **达人导入**（16 列对齐 `达人等级全部.xlsx`）
  - **商家需求导入**（10 列对齐 §1.3）
  - **达人需求导入**（7 列对齐 §1.2）
- 每个 tab 提供"下载模板"按钮 + 文件上传区 + 预览校验

#### 后端接口
- 复用 `routes/excel-import.js`，新增达人导入和达人需求导入接口
- 模板下载：`/api/excel/template/:type`（`type` ∈ `influencer / merchant_demand / influencer_demand`）
- 上传：`/api/excel/import/:type`

---

## 四、"商家货盘"清理清单（UI 文案 + 注释）

### 必改文件

| 文件 | 行号 | 现状 | 改为 |
|---|---|---|---|
| `README.md` | 8 | "商家货盘 / 商家招募 / 达人需求" | "商家需求 / 达人需求" |
| `README.md` | 15 | "商家发布货盘/招募需求" | "商家发布需求" |
| `public/js/app.js` | 1168 | `'商家货盘'` | `'商家需求'` |
| `public/js/app.js` | 3277 | "拉取自己的货盘列表" 注释 | "拉取自己的需求列表" |
| `public/js/app.js` | 3297 | "商家货盘 - 我的需求" | "我的需求" |
| `public/js/app.js` | 3384 | `pubLinkableDemands` 变量 + 整段"关联货盘"逻辑 | **整段删除** |
| `public/js/app.js` | 3414/3418/3463 | "关联货盘（可选）"下拉表单字段 | **删除** |
| `public/js/app.js` | 3546 | "商家货盘 - 发布货品 modal" 注释 | "商家需求 - 发布需求 modal" |
| `public/js/app.js` | 3557 | "发布到「xxx」的货盘" | "发布到「xxx」的需求" |
| `public/js/app.js` | 3606 | "商家货盘 - Excel 导入 modal" 注释 | "商家需求 - Excel 导入 modal" |
| `public/js/app.js` | 4454 | `'达人货盘'` 标签色 case | `'达人需求'` |
| `public/js/app.js` | 5397 | "货盘数" 表头 | "需求数" |
| `public/js/app.js` | 5726 | "货盘数 N 条" | "需求数 N 条" |
| `public/js/app.js` | 6417 | "期望合作的货盘类型" placeholder | "期望合作的需求类型" |
| `public/css/style.css` | 872 | "9 列：…货盘数…" 注释 | "9 列：…需求数…" |
| `routes/cooperation.js` | 292/293/294 | "商家货盘壳子表 / 图书需求 / 课程需求" 注释 | "商家需求壳子表 / 图书需求 / 课程需求" |
| `routes/cooperation.js` | 318/319/322 | "图书货盘 / 课程货盘 / 商家货盘" | "图书需求 / 课程需求 / 商家需求" |
| `routes/cooperation.js` | 729/751/756 | "达人货盘需求" 注释 + `'达人货盘'` 标签 | "达人需求" |
| `routes/merchants.js` | 104 | "货盘数统计" 注释 | "需求数统计" |
| `routes/merchants.js` | 200 | "货盘数" Excel 表头 | "需求数" |
| `routes/merchants.js` | 474 | "下还有 N 条货盘" 错误信息 | "下还有 N 条需求" |
| `routes/demands.js` | 153/263/287/565/583/675 | "达人货盘需求" 注释 | "达人需求" |
| `db/init.js` | 204 | "达人货盘需求表" 注释 | "达人需求表" |
| `db/init.js` | 610 | 种子数据 description "优质商家货盘" | 改文案 |

### 不改的（程序员英文标识符 / 文件名 / 表名）

- `book_demands` / `course_demands` / `demands` / `influencer_demands` 表名 **不动**
- `routes/demands.js` 文件名 **不动**
- `pubLinkableDemands` 等变量名（**整段删除**则一并消失）

---

## 五、修改意见 → 任务对应表（按角色）

### 5.1 全局（G）

| 编号 | 任务 | 改动量 | 文件 |
|---|---|---|---|
| G1 | 侧边栏分组标题改为"资源广场" | S | `public/js/app.js:588/603` |
| G2 | 按钮文案：商家"邀请合作"/达人"申请合作"/管理员上下文 | S | `public/js/app.js:6183` 等 |
| G3 | 商家+达人侧边栏"撮合管理"→"我的需求"；管理员保持 | S | `public/js/app.js:582` 等 |
| G4 | 所有列表/广场搜索框 → 字段下拉筛选 | M | 多处 |

### 5.2 管理员视角（A）

| 编号 | 任务 | 改动量 | 文件 |
|---|---|---|---|
| A1 | 看板顶部加"Demo 占位"横幅 | S | 前端看板模块 |
| A2 | 撮合 5 段流程实施（4→5 段） | M | `cooperation.js` + 前端看板 |
| A3 | "待处理合作"加 tooltip | S | 前端 |
| A4 | "需求商品品类"标题改字 | S | 前端图表 |
| A5 | "新增合作"加 tooltip | S | 前端 |
| A6+A7 | 业绩榜按 4 类重做（次数排序） | M | `routes/stats.js` `top-entities` |
| A8 | 时间轴每条加"流程环节+商品品类"标签 | M | `routes/stats.js` `timeline` + 前端 |
| A9 | 需求广场搜索改下拉筛选 | M | 前端 |
| A10 | 商家需求字段标准化（10 列） + 新增"卖点/备注"字段 | M | `db/init.js` + 表单 |
| A11 | 达人广场筛选不隐藏 + "视频品类"= `video_category_track` | S | 前端 |
| A12 | 达人详情卡片加 4 字段展示（介绍/画像/作品/公众号） | M | 前端 + DB 4 字段 |
| A13-1 | 联络功能（弹窗显示联系方式） | M | 前端 + 复用查询 API |
| A13-2 | 收藏功能（管理员可收藏所有） | M | 新建 favorites 表 + API |
| A13-3 | 置顶功能（管理员，5+5 上限，🔥 角标） | M | DB 字段 + API + 前端 |
| A14 | 撮合管理筛选改下拉 | S | 前端 |
| A15 | 批量导入工具（3 个 tab） | L | 新页面 + 复用/扩展 `excel-import.js` |

### 5.3 商家视角（M）

| 编号 | 任务 | 改动量 | 文件 |
|---|---|---|---|
| M1 | 侧边栏"资源广场"（同 G1） | — | — |
| M2 | 官方需求加"邀请合作"按钮；统一文案 | S | 前端商家广场 |
| M3 | 达人发布需求字段标准化（7 列） | S | `influencer_demands` 表单 |
| M4 | 达人广场字段固化（同 A12） | — | — |
| M5 | "我的需求"字段统一（同 A10） | — | — |
| M6 | "下架/复制并恢复"按钮 | M | DB 状态 + 前端 |
| M7 | 合作管理与需求关联展示 | M | `cooperation.js` + 前端 |
| M8 | 合作管理"接受/拒绝"按钮露出 | S | 前端 |
| M9 | "我的需求"加 5 段看板 | M | 前端组件 |
| M10 | 收藏功能（可收藏达人 + 需求） | — | 同 A13-2 |

### 5.4 达人视角（I）

| 编号 | 任务 | 改动量 | 文件 |
|---|---|---|---|
| I1 | 商家发布需求字段固化（同 A10） | — | — |
| I2 | 按钮文案"申请合作" | S | 前端 |
| I3 | 商家需求广场搜索改下拉（同 A9） | — | — |
| I4 | 去掉"一键清空"按钮 | S | `app.js:1709` |
| I5 | "我的需求"字段标准化（同 §1.2） | S | 前端表单 |
| I6 | "下架/复制并恢复"按钮（同 M6） | — | — |
| I7 | "我的需求"加 5 段看板（同 M9） | — | — |
| I8 | 合作管理拆"我发起的 / 别人找我的" tab | M | `cooperation.js` 加 query + 前端 tab |
| I9 | 合作管理列表项 → 链回原需求 | S | 前端跳转 |
| I10 | 收藏功能（可收藏商家主体 + 需求） | — | 同 A13-2 |

---

## 六、数据库改动汇总

全部走 `ALTER TABLE ADD COLUMN` 兼容老库（与 V3 风格一致）。

### 6.1 `influencers` 表新增 4 字段
```sql
ALTER TABLE influencers ADD COLUMN introduction TEXT;
ALTER TABLE influencers ADD COLUMN audience_profile TEXT;
ALTER TABLE influencers ADD COLUMN representative_works TEXT;
ALTER TABLE influencers ADD COLUMN has_official_account TEXT DEFAULT '否';
```

### 6.2 `book_demands` / `course_demands` 表新增 2 字段
```sql
ALTER TABLE book_demands ADD COLUMN selling_points TEXT;
ALTER TABLE book_demands ADD COLUMN remark TEXT;
ALTER TABLE book_demands ADD COLUMN pinned_at DATETIME;
ALTER TABLE course_demands ADD COLUMN selling_points TEXT;
ALTER TABLE course_demands ADD COLUMN remark TEXT;
ALTER TABLE course_demands ADD COLUMN pinned_at DATETIME;
```

### 6.3 `influencer_demands` 表新增置顶字段
```sql
ALTER TABLE influencer_demands ADD COLUMN pinned_at DATETIME;
```

### 6.4 `matchmaking` 表 stage 枚举更新
- 旧值不迁移（无真实数据）
- 新值：`published / responded / connected / sample_sent / cooperating`
- `db/init.js` 中 `stage TEXT DEFAULT '需求发布'` 改为 `stage TEXT DEFAULT 'published'`

### 6.5 `book_demands` / `course_demands` / `influencer_demands` 状态扩展
- `status` 枚举加入 `archived`
- 所有 `WHERE status = 'published'` 的查询保持不变（archived 不出现在广场）
- 编辑/复制/恢复时切换 `status`

### 6.6 新建 `favorites` 表
```sql
CREATE TABLE favorites (
  id TEXT PRIMARY KEY,
  user_type TEXT NOT NULL,
  user_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_type, user_id, target_type, target_id)
);
```

---

## 七、新增 / 修改后端接口清单

### 7.1 收藏（新）
- `GET /api/favorites?type=demand|entity` — 查询当前用户收藏列表（按类型分组）
- `POST /api/favorites` — 添加收藏
- `DELETE /api/favorites` — 取消收藏
- `GET /api/favorites/check` — 查询某个对象是否已被当前用户收藏

### 7.2 置顶（新）
- `PUT /api/demands/:id/pin` / `PUT /api/demands/:id/unpin` — 商家需求置顶/取消
- `PUT /api/demands/influencer-demands/:id/pin` / `unpin` — 达人需求置顶/取消

### 7.3 下架/复制（新）
- `PUT /api/demands/:id/archive` — 商家需求下架
- `POST /api/demands/:id/duplicate` — 复制为新需求

### 7.4 业绩榜重写（改）
- `GET /api/stats/top-entities?category=merchant_demand|influencer_take|merchant_take|influencer_demand` — 4 类业绩榜

### 7.5 撮合 5 段（改）
- `cooperation.js` 涉及 `stage` 字段的所有查询、更新、看板返回均按新 5 段适配

### 7.6 批量导入（改）
- `GET /api/excel/template/influencer` — 达人导入模板（16 列）
- `GET /api/excel/template/influencer_demand` — 达人需求导入模板（7 列）
- `POST /api/excel/import/influencer` — 达人批量导入
- `POST /api/excel/import/influencer_demand` — 达人需求批量导入
- 现有 `/api/excel/import/book` 和 `/import/course` 保留

### 7.7 看板与时间轴（改）
- `GET /api/stats/dashboard` — 顶部加"Demo 占位"标识
- `GET /api/stats/timeline` — 每条记录返回 `stage_label` + `category_label` 两个标签

---

## 八、Demo 假数据策略

### 8.1 达人 4 字段 mock（脚本：`db/seed-influencer-extra.js`）
对所有现有达人补充：
- `introduction`：100-150 字账号介绍 mock
- `audience_profile`：随机生成"女性 X%/X-X 岁/华东 X%"格式
- `representative_works`：1-3 条 mock 链接（如 `https://channels.weixin.qq.com/...`）
- `has_official_account`：30% 的达人随机置"是"

### 8.2 收藏 mock
对每个 demo 账号（admin / 商家 / 达人）预置 2-3 条收藏数据，让"我的收藏"页一打开就有内容

### 8.3 置顶 mock
预置 2-3 条置顶需求（商家 / 达人广场各放几条），让广场顶部一进来就有 🔥 标识

### 8.4 5 段看板 mock
撮合数据均匀分布在 5 个阶段，让看板一打开 5 列都有卡片

---

## 九、Git 同步规则（重要）

### 9.1 远端仓库角色
- **Gitee**（主仓库，`gitee.com/xiyufenghan/Business-Matching`）— 默认 push & pull
- **GitHub**（备份仓库，`github.com/xiyufenghan/Business-Matching`）— 偶尔同步备份

### 9.2 本地 git remote 重整
```bash
# 本地 Mac
cd /Users/alex/CodeBuddy/Business-Matching
git remote remove origin
git remote add origin https://gitee.com/xiyufenghan/Business-Matching.git
git remote add github https://github.com/xiyufenghan/Business-Matching.git
git fetch origin
git branch -u origin/main main
```

### 9.3 服务器 remote 切换
```bash
# 服务器 /opt/bizmatch
ssh root@82.156.82.50 "cd /opt/bizmatch && \
  git remote remove origin && \
  git remote add origin https://gitee.com/xiyufenghan/Business-Matching.git && \
  git fetch origin && git branch -u origin/main main"
```

### 9.4 标准开发流程
1. 本地修改 → `git add` → `git commit`
2. 推 Gitee：`git push origin main`
3. 服务器拉取：`ssh root@82.156.82.50 "cd /opt/bizmatch && git pull origin main && systemctl restart bizmatch"`
4. （可选）同步 GitHub 备份：`git push github main`

---

## 十、风险与注意

1. **数据库改动全部用 `ALTER TABLE ADD COLUMN`** — 与 V3 兼容写法一致，不需要停机迁移。
2. **`status` 增加 `archived` 值** — 影响所有 `WHERE status = 'published'` 的查询，统一审一遍 `routes/demands.js`、`routes/cooperation.js`，确保广场查询逻辑只取 `published`。
3. **撮合阶段中文枚举换英文** — `routes/cooperation.js` 和前端看板有大量字符串硬编码，需要全文替换。
4. **生产数据库** 中 `merchant_match.db-wal` 当前 2.8MB（演示数据），ALTER 会在线生效，**不需要重建**。
5. **服务器部署节奏** — 一次性整体改完后，统一服务器拉取重启，不分批。
6. **Gitee 远端切换** — 需要确认 Gitee 账号已配置好（`xiyufenghan`），仓库存在且可推送。

---

## 十一、待启动操作清单（最终确认通过后立即执行）

### 阶段 1：基础设施
1. 切换本地 git remote 到 Gitee（GitHub 改名为 `github`）
2. 切换服务器 git remote 到 Gitee
3. 验证从 Gitee push / pull 通畅

### 阶段 2：数据库与 mock 数据
4. 更新 `db/init.js`：新增 4 个达人字段、商家需求 2 字段、置顶字段、archived 状态、favorites 表、stage 5 段枚举
5. 写 `db/seed-influencer-extra.js` mock 4 字段
6. 写 `db/seed-favorites-pinned.js` mock 收藏和置顶数据

### 阶段 3：商家货盘清理
7. 全文替换 `public/js/app.js` 中的"商家货盘/图书货盘/课程货盘/货盘数/关联货盘"等
8. 删除"关联货盘（可选）"功能（`app.js:3384/3414/3418/3463`）
9. 改 `routes/cooperation.js`、`routes/merchants.js`、`routes/demands.js`、`README.md` 等所有相关注释和返回值
10. 删除 `db/init.js:610` 种子数据中的"商家货盘"措辞

### 阶段 4：核心功能改造
11. 侧边栏改名（"资源广场" + "我的需求"）
12. 按钮文案统一（邀请合作/申请合作/上下文）
13. 撮合 5 段流程改造（DB + 后端 + 前端看板）
14. 业绩榜 4 类重做
15. 看板顶部"Demo 占位"横幅 + tooltip
16. 时间轴双标签
17. 字段下拉筛选

### 阶段 5：新增功能
18. 收藏功能（DB + API + UI）
19. 联络功能（管理员弹窗）
20. 热推/置顶（DB + API + UI 角标）
21. 下架/复制并恢复
22. 批量导入工具（3 个 tab）
23. 达人详情 4 字段展示
24. 商家需求新增"卖点/备注"字段

### 阶段 6：合作管理增强
25. 合作管理与需求关联
26. 接受/拒绝按钮
27. 我的需求 5 段看板
28. 达人合作"我发起的 / 别人找我的"tab

### 阶段 7：清理细节
29. 去掉达人"一键清空"按钮
30. 改"需求商品品类"标题
31. 达人广场筛选不隐藏

### 阶段 8：联调与部署
32. 本地全功能验证
33. 一次性 commit + push Gitee
34. 服务器 git pull + 重启
35. 生产环境 Demo 演示

---

## 十二、本文档与产品经理的最后确认

**本文档已锁定，等待产品经理（Alex）最终扫一眼点头。**

任何不一致或漏掉的点，请直接在本文档对应章节标注 `// FIXME` 或在对话中指出。

确认无误后，AI 程序员（Claude）将按 §十一阶段顺序开始执行，不再分批审阅。

---

**文档结束**
