# 商达撮合系统

商家与达人（KOL/网红）智能撮合平台，实现商家需求发布、达人申请对接、智能匹配撮合的全流程管理。

## 功能特性

- 📊 **数据看板** - 实时展示平台核心数据指标
- 📋 **需求大厅** - 浏览所有商家发布的合作需求
- 📝 **需求发布** - 商家发布推广合作需求（支持类目/平台/预算/粉丝要求等多维度筛选）
- 🏪 **商家管理** - 商家信息的增删改查
- ⭐ **达人库** - 达人信息管理，按平台/类目筛选
- 🎯 **撮合记录** - 记录所有成功匹配的商家与达人合作

## 业务流程

1. 商家注册 → 发布需求（含预算、类目、平台、粉丝要求等）
2. 达人浏览需求 → 提交申请（含报价和合作意向）
3. 商家审核申请 → 通过/拒绝
4. 通过后自动生成撮合记录

## 技术栈

- **后端**: Node.js + Express
- **数据库**: SQLite (better-sqlite3)
- **前端**: 原生 HTML/CSS/JS (SPA 架构)

## 快速启动

```bash
cd merchant-match-system
npm install
npm start
```

访问 http://localhost:3000

## API 接口

| 模块 | 路径 | 说明 |
|------|------|------|
| 商家 | GET/POST /api/merchants | 列表/创建 |
| 达人 | GET/POST /api/influencers | 列表/创建 |
| 需求 | GET/POST /api/demands | 列表/创建 |
| 申请 | POST /api/applications | 达人申请 |
| 审核 | PATCH /api/applications/:id/review | 审核申请 |
| 撮合 | GET /api/matches | 撮合记录 |
| 统计 | GET /api/stats | 数据统计 |
