/**
 * 重置对局数据 —— 「重置」不会真的丢数据，每次都会先把当前对局完整备份下来。
 *
 *   node scripts/reset-data.js                   备份当前对局后清空（保留玩家与颜色）
 *   node scripts/reset-data.js --all             备份后全新一局（连玩家一起清空）
 *   node scripts/reset-data.js --list            列出所有历史备份
 *   node scripts/reset-data.js --delete          删除当前数据文件（备份目录保留）
 *   node scripts/reset-data.js --purge-archives --yes   连历史备份一起永久删除
 *
 * 服务器正在运行时通过 HTTP 接口重置，内存状态与所有在线设备会立即同步；
 * 服务器没开时直接改数据文件，并在这里完成同样的「先备份、后清空」。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FILE = process.env.DATA_FILE || path.join(ROOT, 'data', 'game-state.json');
const ARCHIVE_DIR = path.join(path.dirname(FILE), 'archive');
const PORT = process.env.PORT || 3000;
const BASE = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;
const args = process.argv.slice(2);
const all = args.includes('--all');

/** 文件安全的时间戳：20260930-221503（用作备份 ID） */
const stamp = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
};

/** 把当前对局写入 data/archive/<id>.json，返回摘要（没有转动记录时不备份） */
function archiveCurrent(state) {
  const spins = state.spins || [];
  const players = state.players || [];
  if (!spins.length) return null;

  const times = spins.map((s) => s.at).filter(Boolean).sort();
  const nextSession = (state.archives || []).reduce((max, a) => Math.max(max, a.session || 0), 0) + 1;
  const id = `${stamp()}-${crypto.randomBytes(3).toString('hex')}`;
  const playersSnapshot = players.map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    steps: p.steps,
    spinCount: p.spinCount,
    lastSpinAt: p.lastSpinAt,
    createdAt: p.createdAt,
  }));
  const payload = {
    version: 2,
    id,
    session: nextSession,
    name: `第 ${nextSession} 局`,
    archivedAt: new Date().toISOString(),
    startedAt: times[0] || players.map((p) => p.createdAt).filter(Boolean).sort()[0] || null,
    endedAt: times.at(-1) || new Date().toISOString(),
    roomName: state.roomName,
    simSamples: state.simSamples || 0,
    simCounts: state.simCounts || [],
    players: playersSnapshot,
    spins,
  };

  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  const target = path.join(ARCHIVE_DIR, `${id}.json`);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp, target);

  const meta = {
    id,
    session: nextSession,
    name: payload.name,
    archivedAt: payload.archivedAt,
    startedAt: payload.startedAt,
    endedAt: payload.endedAt,
    spinCount: spins.length,
    totalSteps: playersSnapshot.reduce((s, p) => s + (p.steps || 0), 0),
    simSamples: payload.simSamples,
    playerCount: playersSnapshot.length,
    players: playersSnapshot.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      steps: p.steps || 0,
      spinCount: p.spinCount || 0,
    })),
  };
  state.archives = [meta, ...(state.archives || [])];
  return { meta, target };
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return null;
  }
}

/* ---------------- 子命令 ---------------- */

if (args.includes('--list')) {
  const list = readState()?.archives || [];
  if (!list.length) {
    console.log('还没有任何历史备份。');
  } else {
    console.log(`共 ${list.length} 局历史备份（${ARCHIVE_DIR}）：\n`);
    for (const a of list) {
      console.log(
        `  ${String(a.name).padEnd(8)} ${(a.archivedAt || '').slice(0, 19).replace('T', ' ')}  ` +
          `${String(a.spinCount).padStart(4)} 条 · ${String(a.totalSteps).padStart(5)} 步 · ` +
          `${a.playerCount} 人   ${a.id}`,
      );
    }
    console.log('\n单局详情：GET /api/archives/<id>   导出：GET /api/archives/<id>/export.csv');
  }
  process.exit(0);
}

if (args.includes('--purge-archives')) {
  if (!args.includes('--yes')) {
    console.log('这会永久删除 data/archive/ 下的全部备份，确认请在命令后追加 --yes：');
    console.log('  node scripts/reset-data.js --purge-archives --yes');
    process.exit(1);
  }
  let n = 0;
  try {
    for (const f of fs.readdirSync(ARCHIVE_DIR)) {
      if (f.endsWith('.json')) {
        fs.rmSync(path.join(ARCHIVE_DIR, f));
        n++;
      }
    }
  } catch {
    console.log('备份目录不存在，无需清理。');
  }
  const state = readState();
  if (state) {
    state.archives = [];
    fs.writeFileSync(FILE, JSON.stringify(state, null, 2), 'utf8');
  }
  console.log(`已永久删除 ${n} 个备份文件。`);
  console.log('注意：若服务器正在运行，请重启一次（npm start），让内存中的备份索引同步清空。');
  process.exit(0);
}

if (args.includes('--delete')) {
  fs.rmSync(FILE, { force: true });
  console.log(`已删除数据文件：${FILE}`);
  console.log(`历史备份仍保留在：${ARCHIVE_DIR}`);
  process.exit(0);
}

/* ---------------- 重置（优先走接口） ---------------- */

async function viaApi() {
  const res = await fetch(`${BASE}/api/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keepPlayers: !all }),
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { archived, state } = await res.json();
  console.log(`已在运行中的服务器上重置（${BASE}）`);
  if (archived) {
    console.log(
      `已备份「${archived.name}」：${archived.spinCount} 条记录 · ${archived.totalSteps} 步 · ` +
        `${archived.playerCount} 人 → ${path.join(ARCHIVE_DIR, `${archived.id}.json`)}`,
    );
  } else {
    console.log('当前没有可备份的记录（对局本来就是空的）');
  }
  console.log(
    all
      ? '结果：当前对局已清空（玩家与颜色也一并清空）'
      : `结果：当前对局已清空，保留 ${(state?.players || []).length} 位玩家及其颜色`,
  );
  console.log(`历史备份共 ${(state?.archives || []).length} 局，可用 --list 查看。`);
  console.log('所有在线设备会在瞬间同步刷新。');
}

function viaFile() {
  const state = readState();
  if (!state) {
    console.log(`数据文件不存在（本来就是空的）：${FILE}`);
    return;
  }
  console.log('服务器未运行 → 直接改数据文件');
  const result = archiveCurrent(state);
  if (result) {
    console.log(
      `已备份「${result.meta.name}」：${result.meta.spinCount} 条记录 · ${result.meta.totalSteps} 步 · ` +
        `${result.meta.playerCount} 人 → ${result.target}`,
    );
  } else {
    console.log('当前没有可备份的记录');
  }

  state.spins = [];
  state.simSamples = 0;
  state.simCounts = new Array(37).fill(0);
  state.simTracks = {};
  state.simLog = [];
  state.updatedAt = new Date().toISOString();
  if (all) {
    state.players = [];
    console.log('结果：记录 + 玩家 + 步数全部清空（备份已保存）');
  } else {
    for (const p of state.players || []) {
      p.steps = 0;
      p.spinCount = 0;
      p.lastSpinAt = null;
    }
    console.log(`结果：记录 + 步数清空（保留 ${(state.players || []).length} 位玩家，备份已保存）`);
  }
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2), 'utf8');
  console.log(`数据文件：${FILE}`);
  console.log(`历史备份共 ${(state.archives || []).length} 局，可用 --list 查看。`);
}

try {
  await viaApi();
} catch {
  viaFile();
}
