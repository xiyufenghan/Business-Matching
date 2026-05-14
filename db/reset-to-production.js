/**
 * 生产数据重置脚本
 *
 * 作用：清空所有业务数据（商家/达人/需求/合作/订单/撮合/收藏/通知/会话），
 *      仅保留 admin 超管账号（a_super, username=admin, password=admin123）。
 *      不 DROP 表，仅 DELETE 数据，避免破坏表结构和字段迁移。
 *
 * 使用：
 *   node db/reset-to-production.js
 *
 * 安全：
 *   - 执行前自动备份到 merchant_match.db.bak.<YYYYMMDDHHmmss>
 *   - 交互式确认（按 y 才继续）
 */
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const DB_PATH = path.join(__dirname, 'merchant_match.db');

function ts() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function backup() {
  if (!fs.existsSync(DB_PATH)) {
    console.log('[reset] 数据库文件不存在，跳过备份');
    return null;
  }
  const bakPath = DB_PATH + '.bak.' + ts();
  fs.copyFileSync(DB_PATH, bakPath);
  console.log('[reset] 已备份至：' + bakPath);
  return bakPath;
}

function prompt(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(q, ans => { rl.close(); resolve(ans); }));
}

async function main() {
  // V5 安全守卫：必须显式设置环境变量才能运行（防止 systemd/cron 误触发）
  if (process.env.BIZMATCH_ALLOW_RESET !== 'YES_I_KNOW') {
    console.error('\n❌ 拒绝执行：此脚本会清空所有业务数据。');
    console.error('   如需运行，请设置环境变量后再执行：');
    console.error('   BIZMATCH_ALLOW_RESET=YES_I_KNOW node db/reset-to-production.js\n');
    process.exit(1);
  }

  console.log('\n======================================');
  console.log('  商达撮合系统 · 生产数据重置');
  console.log('======================================\n');
  console.log('本脚本将清空所有业务数据，仅保留 admin 超管账号：');
  console.log('  - 所有商家、达人、管理员（除 admin 超管）');
  console.log('  - 所有需求（商家需求/达人需求/招募）');
  console.log('  - 所有合作、撮合、订单、订单历史');
  console.log('  - 所有收藏、通知、会话、设置（保留 webhook key）\n');

  // 允许非交互模式：传入 --yes 或 -y
  const argv = process.argv.slice(2);
  const nonInteractive = argv.includes('--yes') || argv.includes('-y');
  if (!nonInteractive) {
    const ans = await prompt('确定继续？（输入 yes 回车）：');
    if (ans.trim().toLowerCase() !== 'yes') {
      console.log('[reset] 已取消。');
      return;
    }
  }

  const bakPath = backup();

  const db = new Database(DB_PATH);

  // 按外键依赖顺序清空（子表 → 父表）
  const deleteOrder = [
    'matchmaking_history',
    'favorites',
    'notifications',
    'sessions',
    'matchmaking',
    'cooperation',
    'orders',
    'demands',
    'book_demands',
    'course_demands',
    'influencer_demands',
    'merchant_recruitments',
    'merchants',
    'influencers',
    // admins 保留超管
  ];

  try {
    db.transaction(() => {
      for (const t of deleteOrder) {
        try {
          const before = db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get().c;
          db.prepare(`DELETE FROM ${t}`).run();
          console.log(`[reset] ${t}: 清空 ${before} 条`);
        } catch (e) {
          // 表可能不存在，忽略
          console.log(`[reset] ${t}: 跳过（${e.message}）`);
        }
      }

      // 仅保留 admin 超管（username='admin'），其他管理员删除
      try {
        const admBefore = db.prepare('SELECT COUNT(*) as c FROM admins').get().c;
        const kept = db.prepare("SELECT COUNT(*) as c FROM admins WHERE username = 'admin'").get().c;
        db.prepare("DELETE FROM admins WHERE username != 'admin'").run();
        console.log(`[reset] admins: 清空 ${admBefore - kept} 条，保留 ${kept} 条（admin 超管）`);

        // 如果连 admin 账号都没有，补一个
        const adminRow = db.prepare("SELECT id FROM admins WHERE username='admin'").get();
        if (!adminRow) {
          db.prepare(`INSERT INTO admins (id, username, password, name, is_super, admin_role, phone, email, status)
            VALUES (?, ?, ?, ?, 1, '超管', ?, ?, 'active')`)
            .run('a_super', 'admin', 'admin123', '超级管理员', '', '');
          console.log('[reset] admins: 重建 admin 超管账号（admin / admin123）');
        }
      } catch (e) {
        console.error('[reset] 处理 admins 出错：', e.message);
      }

      // settings 表：只清空"业务相关"的 key，保留 webhook 配置
      try {
        db.prepare("DELETE FROM settings WHERE key NOT IN ('wework_webhook_url')").run();
      } catch (e) {}
    })();

    console.log('\n======================================');
    console.log('[reset] 完成。数据库已重置为生产初始状态。');
    console.log('  超管登录：admin / admin123');
    console.log('  备份文件：' + (bakPath || '（无）'));
    console.log('======================================\n');
  } catch (err) {
    console.error('[reset] 失败：', err);
    console.error('请用备份文件恢复：cp ' + bakPath + ' ' + DB_PATH);
    process.exit(1);
  } finally {
    db.close();
  }
}

main();
