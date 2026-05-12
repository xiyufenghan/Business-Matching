/**
 * 一次性补丁：把 admin 超管账号标准化
 *
 * 目的：确保各端 admins 表中的 admin 账号信息完全一致：
 *   id = 'a_super'
 *   username = 'admin'
 *   password = 'admin123'
 *   name = '超级管理员'
 *   is_super = 1
 *   admin_role = '超管'
 *   status = 'active'
 *
 * 用法：node db/normalize-admin.js
 *
 * 幂等：可重复执行，已正确则只输出"已是目标状态"
 */
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'merchant_match.db');
const db = new Database(DB_PATH);

const TARGET = {
  id: 'a_super',
  username: 'admin',
  password: 'admin123',
  name: '超级管理员',
  is_super: 1,
  admin_role: '超管',
  status: 'active',
};

try {
  const existing = db.prepare("SELECT * FROM admins WHERE username = ?").get(TARGET.username);

  if (!existing) {
    db.prepare(`INSERT INTO admins (id, username, password, name, is_super, admin_role, phone, email, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(TARGET.id, TARGET.username, TARGET.password, TARGET.name, TARGET.is_super, TARGET.admin_role, '', '', TARGET.status);
    console.log('[normalize-admin] 已创建：', TARGET);
  } else {
    // 检查是否需要更新
    const needFix = (
      existing.id !== TARGET.id ||
      existing.name !== TARGET.name ||
      existing.is_super !== TARGET.is_super ||
      existing.admin_role !== TARGET.admin_role ||
      existing.status !== TARGET.status
    );

    if (!needFix) {
      console.log('[normalize-admin] admin 已是目标状态，无需修改');
      console.log('  当前：', { id: existing.id, name: existing.name, admin_role: existing.admin_role });
    } else {
      console.log('[normalize-admin] 当前状态：', {
        id: existing.id, name: existing.name, is_super: existing.is_super, admin_role: existing.admin_role,
      });

      // 注意：如果 id 不一致，需要级联更新所有外键引用
      // 外键引用 admins.id 的表：
      //   merchants.sales_owner_id, merchants.invited_by
      //   influencers.sales_owner_id, influencers.operator_id, influencers.invited_by
      //   demands.operator_id, demands.admin_publisher_id
      //   influencer_demands.operator_id
      //   merchant_recruitments.operator_id
      //   matchmaking.operator_id
      // 由于业务表都已清空，这些引用都为空，所以可以安全直接改 id
      const oldId = existing.id;
      const tx = db.transaction(() => {
        db.prepare(`UPDATE admins SET id=?, name=?, is_super=?, admin_role=?, status=?, password=? WHERE username=?`)
          .run(TARGET.id, TARGET.name, TARGET.is_super, TARGET.admin_role, TARGET.status, TARGET.password, TARGET.username);

        // 若 id 变了，则更新所有可能的外键引用（即使业务表清空，做一次防御性更新无副作用）
        if (oldId !== TARGET.id) {
          const refMap = [
            ['merchants', 'sales_owner_id'],
            ['merchants', 'invited_by'],
            ['influencers', 'sales_owner_id'],
            ['influencers', 'operator_id'],
            ['influencers', 'invited_by'],
            ['demands', 'operator_id'],
            ['demands', 'admin_publisher_id'],
            ['influencer_demands', 'operator_id'],
            ['merchant_recruitments', 'operator_id'],
            ['matchmaking', 'operator_id'],
            ['sessions', 'user_id'],
          ];
          for (const [tbl, col] of refMap) {
            try {
              const r = db.prepare(`UPDATE ${tbl} SET ${col}=? WHERE ${col}=?`).run(TARGET.id, oldId);
              if (r.changes > 0) console.log(`  → ${tbl}.${col}: 更新 ${r.changes} 条外键引用`);
            } catch (e) { /* 表/列不存在则忽略 */ }
          }
        }
      });
      tx();
      console.log('[normalize-admin] 已修正为：', TARGET);
    }
  }
} catch (err) {
  console.error('[normalize-admin] 失败：', err);
  process.exit(1);
} finally {
  db.close();
}
