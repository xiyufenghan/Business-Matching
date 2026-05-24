# 商达撮合系统 — 品牌设计规范

> 基于腾讯广告品牌手册，品牌视觉沿用腾讯广告体系，对外名称统一为"腾讯营销"

---

## 1. 品牌标识

### 1.1 图形标志

![腾讯营销图形标志](public/images/logo-tencent-ads.png)

- 6 条圆角胶囊形组成的倾斜阵列
- 深蓝 × 浅蓝 × 橙色 三色渐变
- 倾斜角度：约 45°
- 圆角半径：胶囊两端完全圆角（border-radius: 999px）

### 1.2 组合标志

```
[图形标志] + 腾讯营销 或 腾讯营销·商达撮合
```

- 图形标志与文字间距：12px
- 文字字重：500（Medium），颜色 #1a1a1a
- 副标题（如"商达撮合"）字号：主标 60%，颜色 #8c8c8c

### 1.3 Logo 使用规范

| 场景 | 尺寸建议 | 位置 |
|---|---|---|
| 登录页 | 64×64 px + 文字 | 卡片顶部居中 |
| 侧边栏顶部 | 32×32 px + 文字 | 左侧 header |
| Favicon | 32×32 px | 浏览器标签 |
| 导出文档水印 | 24×24 px 灰度 | 页脚 |

---

## 2. 色彩体系

### 2.1 品牌色（从 Logo 提取）

| 色名 | Hex | 使用场景 |
|---|---|---|
| 品牌蓝 | `#2B6BF5` | 主按钮、链接、选中态、侧边栏激活 |
| 品牌浅蓝 | `#7EC8FD` | 辅助图形、渐变、hover 背景 |
| 品牌橙 | `#FFAA00` | 高亮、标签、成就徽章、重要提示 |
| 品牌深蓝 | `#1E3A8A` | 深色背景、登录页渐变起止色 |

### 2.2 功能色

| 色名 | Hex | 使用场景 |
|---|---|---|
| 成功绿 | `#10B981` | 通过、完成、在线状态 |
| 警告黄 | `#F59E0B` | 待处理、提醒、pending |
| 危险红 | `#EF4444` | 删除、错误、拒绝 |
| 信息蓝 | `#3B82F6` | 提示、信息卡片 |

### 2.3 中性色

| 色名 | Hex | 使用场景 |
|---|---|---|
| 标题黑 | `#1A1A1A` | 页面大标题、正文主色 |
| 正文灰 | `#595959` | 正文、描述 |
| 次要灰 | `#8C8C8C` | 占位符、禁用态、次要信息 |
| 边框灰 | `#D9D9D9` | 边框、分割线 |
| 背景灰 | `#F5F5F5` | 页面底色、卡片背景 |
| 纯白 | `#FFFFFF` | 卡片、弹窗、输入框 |

### 2.4 渐变规范

```css
/* 登录页背景 */
background: linear-gradient(135deg, #1E3A8A 0%, #2B6BF5 50%, #06B6D4 100%);

/* 品牌卡片渐变 */
background: linear-gradient(135deg, #2B6BF5 0%, #7EC8FD 100%);

/* 橙色高亮渐变 */
background: linear-gradient(135deg, #FFAA00 0%, #FFB84D 100%);
```

---

## 3. 字体规范

### 3.1 字体栈

```css
font-family: "PingFang SC", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```

- 优先使用系统默认中文字体
- 数字和英文使用系统字体回退

### 3.2 字号层级

| 层级 | 字号 | 字重 | 行高 | 使用场景 |
|---|---|---|---|---|
| Display | 32px | 600 | 1.2 | 登录页标题、空态页 |
| H1 | 24px | 600 | 1.3 | 页面标题 |
| H2 | 18px | 600 | 1.4 | 区块标题、卡片标题 |
| H3 | 16px | 500 | 1.5 | 小标题、列表标题 |
| Body | 14px | 400 | 1.6 | 正文、表单标签 |
| Caption | 12px | 400 | 1.5 | 辅助说明、时间戳 |
| Badge | 11px | 500 | 1 | 标签、徽标 |

---

## 4. 圆角与阴影

### 4.1 圆角

| Token | 值 | 使用场景 |
|---|---|---|
| radius-sm | 6px | 按钮、输入框、标签 |
| radius-md | 10px | 卡片、列表项 |
| radius-lg | 16px | 弹窗、大卡片 |
| radius-xl | 20px | 登录卡片 |
| radius-full | 999px | 胶囊按钮、头像、状态点 |

### 4.2 阴影

```css
/* 卡片阴影 */
--shadow-sm: 0 1px 3px rgba(43, 107, 245, 0.05);
--shadow-md: 0 4px 12px rgba(43, 107, 245, 0.08);
--shadow-lg: 0 10px 25px rgba(43, 107, 245, 0.12);

/* 弹窗阴影 */
box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
```

---

## 5. 组件样式

### 5.1 按钮

```css
/* 主按钮 */
.btn-primary {
  background: #2B6BF5;
  color: #fff;
  border-radius: 6px;
  padding: 8px 20px;
  font-weight: 500;
  transition: all 0.2s;
}
.btn-primary:hover { background: #1d5ce0; }

/* 次要按钮 */
.btn-secondary {
  background: #fff;
  color: #2B6BF5;
  border: 1px solid #D9D9D9;
  border-radius: 6px;
}

/* 文字按钮 */
.btn-text {
  color: #2B6BF5;
  background: transparent;
}
```

### 5.2 卡片

```css
.card {
  background: #fff;
  border-radius: 10px;
  border: 1px solid #F0F0F0;
  box-shadow: 0 1px 3px rgba(43, 107, 245, 0.05);
  padding: 16px;
}
```

### 5.3 输入框

```css
.input {
  border: 1px solid #D9D9D9;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 14px;
}
.input:focus {
  border-color: #2B6BF5;
  box-shadow: 0 0 0 3px rgba(43, 107, 245, 0.1);
}
```

### 5.4 标签/徽章

```css
/* 等级徽章 S级 */
.badge-level-s {
  background: linear-gradient(135deg, #FFAA00 0%, #FFB84D 100%);
  color: #fff;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 11px;
  font-weight: 600;
}

/* 状态标签 */
.badge-status {
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 11px;
}
```

---

## 6. 布局规范

### 6.1 页面结构

```
┌─────────────────────────────────────┐
│  Topbar (56px)                      │
├──────────┬──────────────────────────┤
│          │                          │
│ Sidebar  │        Main Content      │
│ (250px)  │        (auto)            │
│          │                          │
└──────────┴──────────────────────────┘
```

### 6.2 间距 Token

| Token | 值 | 使用场景 |
|---|---|---|
| space-xs | 4px | 图标与文字间距 |
| space-sm | 8px | 内联元素间距 |
| space-md | 16px | 卡片内边距、表单行距 |
| space-lg | 24px | 区块间距 |
| space-xl | 32px | 页面级间距 |
| space-2xl | 48px | 大区块分隔 |

### 6.3 内容区最大宽度

- 表格/列表页：100%（自适应）
- 表单页：680px（居中）
- 弹窗：520px（标准）、720px（宽版）

---

## 7. 图标规范

- 使用 Lucide 图标库（线条风格）
- 图标尺寸：16px（常规）、20px（按钮内）、24px（空态/导航）
- 图标颜色：跟随文字色或品牌蓝
- 描边宽度：1.5px

---

## 8. 动效规范

```css
/* 标准过渡 */
transition: all 0.2s ease;

/* 按钮点击 */
transition: transform 0.1s ease;
.btn:active { transform: scale(0.98); }

/* 页面切换 */
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
```

---

## 9. 应用到当前项目的调整清单

### 需要同步修改的文件

| 文件 | 修改内容 |
|---|---|
| `public/css/style.css` | 将主色 `--primary: #2563eb` → `#2B6BF5`，同步所有色阶 |
| `public/css/style.css` | 登录页背景色阶微调，向品牌蓝靠拢 |
| `public/index.html` | 登录页 logo 替换为腾讯营销组合标志 |
| `public/js/app.js` | 侧边栏 logo 替换 |
| `public/images/` | 新增 `logo-tencent-ads.png`（品牌标志） |
| `public/images/` | 新增 `favicon.ico` |

### 颜色映射（旧 → 新）

| 旧色值 | 新色值 | 说明 |
|---|---|---|
| `#2563eb` | `#2B6BF5` | 主色 Blue-600 → 品牌蓝 |
| `#3b82f6` | `#4B8CF7` | Blue-500 → 品牌蓝浅一阶 |
| `#1d4ed8` | `#1A5FD9` | Blue-700 → 品牌蓝深一阶 |
| `#1e40af` | `#164BB5` | Blue-800 → 品牌蓝最深 |
| `#06b6d4` | `#7EC8FD` | Cyan → 品牌浅蓝 |
| `#f59e0b` | `#FFAA00` | Amber → 品牌橙 |

---

> 本规范基于腾讯广告品牌视觉体系，所有颜色已用取色工具从 logo 提取，与当前项目 CSS 变量对齐后可直接替换使用。
