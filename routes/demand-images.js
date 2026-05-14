/**
 * 商家需求图片管理（V5）
 * - 与 Excel 批量导入解耦：图片不在 Excel 里，导入完成后单独管理
 * - 单条需求最多 3 张图片，单张 ≤ 500KB，仅支持 PNG / JPG
 * - 仅商家需求（book_demands / course_demands）支持，达人需求不需要
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// 上传目录：uploads/demands/<demand_id>/
const UPLOAD_BASE = path.join(__dirname, '..', 'uploads', 'demands');
if (!fs.existsSync(UPLOAD_BASE)) fs.mkdirSync(UPLOAD_BASE, { recursive: true });

const MAX_IMAGES = 3;
const MAX_SIZE = 500 * 1024; // 500KB
const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg']);
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg']);

// 内存存储 → 校验后再写盘（避免上传到一半校验失败留垃圾）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return cb(new Error('仅支持 PNG / JPG 格式'));
    if (!ALLOWED_MIME.has(file.mimetype)) return cb(new Error('文件类型不正确'));
    cb(null, true);
  }
});

// type → table 映射
function getTable(type) {
  if (type === 'book') return 'book_demands';
  if (type === 'course') return 'course_demands';
  return null;
}

// 权限：admin 可全部，merchant 只能管自己的需求
function checkPermission(req, demand) {
  if (!req.user) return false;
  if (req.user.role === 'admin') return true;
  if (req.user.role === 'merchant' && demand.merchant_id === req.user.id) return true;
  return false;
}

// 从 DB 解析 images 字段（JSON 数组）
function parseImages(raw) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

// ========== GET: 查询某条需求的图片列表 ==========
router.get('/:type/:id/images', (req, res) => {
  try {
    const { type, id } = req.params;
    const table = getTable(type);
    if (!table) return res.status(400).json({ success: false, error: 'type 必须是 book 或 course' });

    const demand = req.db.prepare(`SELECT id, merchant_id, images FROM ${table} WHERE id = ?`).get(id);
    if (!demand) return res.status(404).json({ success: false, error: '需求不存在' });
    if (!checkPermission(req, demand)) return res.status(403).json({ success: false, error: '无权限' });

    const images = parseImages(demand.images);
    res.json({ success: true, data: { images, max: MAX_IMAGES } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== POST: 上传图片（单次最多 3 张，受总数限制） ==========
router.post('/:type/:id/images', upload.array('files', MAX_IMAGES), (req, res) => {
  try {
    const { type, id } = req.params;
    const table = getTable(type);
    if (!table) return res.status(400).json({ success: false, error: 'type 必须是 book 或 course' });

    const demand = req.db.prepare(`SELECT id, merchant_id, images FROM ${table} WHERE id = ?`).get(id);
    if (!demand) return res.status(404).json({ success: false, error: '需求不存在' });
    if (!checkPermission(req, demand)) return res.status(403).json({ success: false, error: '无权限' });

    const files = req.files || [];
    if (files.length === 0) return res.status(400).json({ success: false, error: '请选择图片文件' });

    const existing = parseImages(demand.images);
    if (existing.length + files.length > MAX_IMAGES) {
      return res.status(400).json({
        success: false,
        error: `已有 ${existing.length} 张，本次上传 ${files.length} 张，超过单条需求最多 ${MAX_IMAGES} 张限制`
      });
    }

    // 创建子目录
    const dir = path.join(UPLOAD_BASE, id);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const newPaths = [];
    for (const f of files) {
      // 二次校验大小（multer 之外保险一道）
      if (f.size > MAX_SIZE) {
        return res.status(400).json({ success: false, error: `文件「${f.originalname}」超过 500KB 限制` });
      }
      const ext = path.extname(f.originalname).toLowerCase();
      const filename = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
      const abs = path.join(dir, filename);
      fs.writeFileSync(abs, f.buffer);
      // 落库相对路径，前端可直接 src="/uploads/demands/<id>/<filename>"
      newPaths.push(`uploads/demands/${id}/${filename}`);
    }

    const merged = [...existing, ...newPaths];
    req.db.prepare(`UPDATE ${table} SET images = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(JSON.stringify(merged), id);

    res.json({ success: true, data: { images: merged }, message: `成功上传 ${files.length} 张图片` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== DELETE: 删除某张图片（按 index） ==========
router.delete('/:type/:id/images/:idx', (req, res) => {
  try {
    const { type, id, idx } = req.params;
    const index = parseInt(idx, 10);
    const table = getTable(type);
    if (!table) return res.status(400).json({ success: false, error: 'type 必须是 book 或 course' });

    const demand = req.db.prepare(`SELECT id, merchant_id, images FROM ${table} WHERE id = ?`).get(id);
    if (!demand) return res.status(404).json({ success: false, error: '需求不存在' });
    if (!checkPermission(req, demand)) return res.status(403).json({ success: false, error: '无权限' });

    const images = parseImages(demand.images);
    if (Number.isNaN(index) || index < 0 || index >= images.length) {
      return res.status(400).json({ success: false, error: '索引无效' });
    }

    const removed = images.splice(index, 1)[0];
    // 删除磁盘文件
    try {
      const abs = path.join(__dirname, '..', removed);
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
    } catch (e) { /* 文件不存在不影响 DB 更新 */ }

    req.db.prepare(`UPDATE ${table} SET images = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(JSON.stringify(images), id);

    res.json({ success: true, data: { images }, message: '已删除' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== 工具函数：删除需求时清理整个图片目录（供 demands 路由调用） ==========
function cleanupDemandImages(demandId) {
  try {
    const dir = path.join(UPLOAD_BASE, demandId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch (e) { /* 静默失败不影响删除流程 */ }
}

module.exports = { router, cleanupDemandImages };
