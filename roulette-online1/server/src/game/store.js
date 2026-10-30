/**
 * 游戏状态的唯一事实来源：纯内存状态 + JSON 文件持久化。
 * 所有写操作都通过本模块，写完后触发 onChange 回调（用于广播给全部设备）。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { COLORS, COLOR_NAME_CN, stepsOf, POCKET_COUNT } from './shared.js';

const MAX_SPINS = 2000; // 记录上限，防止文件无限膨胀
const SPIN_COOLDOWN_MS = 1200; // 同一玩家的防连点间隔
const SAVE_DEBOUNCE_MS = 120;

const EMPTY_STATE = () => ({
  version: 2,
  roomName: '命运轮盘 · 线下四色棋子',
  updatedAt: null,
  players: [], // {id,name,color,token,steps,spinCount,lastSpinAt,createdAt}
  spins: [], // {id,seq,playerId,name,color,num,pocket,steps,source,at}
  archives: [], // 历史备份索引；完整内容存放在 data/archive/<id>.json
});

/** 文件安全的时间戳：20260930-221503（用作备份 ID，可安全放进 URL 与文件名） */
function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

export class GameStore {
  /**
   * @param {{ file:string, onSpin?:(payload:object)=>void, onChange?:()=>void }} options
   */
  constructor({ file, onSpin, onChange } = {}) {
    this.file = file;
    this.onSpin = onSpin;
    this.onChange = onChange;
    this.state = this.#load();
    this.seq = this.state.spins.reduce((max, s) => Math.max(max, s.seq || 0), 0);
    this.currentPlayerId = null;
    this.saveTimer = null;
    // 历史备份目录：与数据文件同级的 archive/
    this.archiveDir = path.join(path.dirname(file), 'archive');
    this.#syncArchiveIndex();
  }

  /* ---------------- 持久化 ---------------- */

  #load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      const base = EMPTY_STATE();
      return {
        ...base,
        ...parsed,
        players: Array.isArray(parsed.players) ? parsed.players : [],
        spins: Array.isArray(parsed.spins) ? parsed.spins : [],
        archives: Array.isArray(parsed.archives) ? parsed.archives : [],
      };
    } catch {
      return EMPTY_STATE();
    }
  }

  #scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, SAVE_DEBOUNCE_MS);
    if (typeof this.saveTimer.unref === 'function') this.saveTimer.unref();
  }

  saveNow() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('[store] 保存失败:', err.message);
    }
  }

  #commit() {
    this.state.updatedAt = new Date().toISOString();
    this.#scheduleSave();
    if (this.onChange) this.onChange();
  }

  /* ---------------- 读取 ---------------- */

  /** 对外快照：不暴露 token */
  snapshot() {
    const simCounts = this.state.simCounts || new Array(POCKET_COUNT).fill(0);
    const simTracks = this.state.simTracks || {};
    const players = [...this.state.players].sort(
      (a, b) =>
        COLORS.indexOf(a.color) - COLORS.indexOf(b.color) ||
        b.steps - a.steps ||
        a.createdAt.localeCompare(b.createdAt),
    );
    const totalSteps = players.reduce((sum, p) => sum + p.steps, 0);
    return {
      roomName: this.state.roomName,
      updatedAt: this.state.updatedAt,
      totalSteps,
      spinCount: this.state.spins.length,
      simSamples: this.state.simSamples || 0,
      simCounts: [...simCounts],
      simLog: (this.state.simLog || []).slice(0, 30),
      mySimCount: simTracks[this.currentPlayerId] || 0,
      // 历史备份只下发摘要，展开某次备份时再单独拉完整内容
      archives: (this.state.archives || []).map((a) => ({
        ...a,
        players: a.players.map((p) => ({ ...p })),
      })),
      players: players.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        steps: p.steps,
        spinCount: p.spinCount,
        simCount: simTracks[p.id] || 0,
        lastSpinAt: p.lastSpinAt,
        lastSpinNum: p.lastSpinNum ?? null,
        lastSpinSteps: p.lastSpinSteps ?? null,
        lastSpinPocket: p.lastSpinPocket ?? null,
        online: p.online !== false,
      })),
      spins: this.state.spins.slice(0, 200),
    };
  }

  /** 广播快照时带上「谁发起的请求」，用于计算该设备自己的试验次数 */
  snapshotFor(playerId) {
    this.currentPlayerId = playerId || null;
    try {
      return this.snapshot();
    } finally {
      this.currentPlayerId = null;
    }
  }

  getPlayer(id) {
    return this.state.players.find((p) => p.id === id) || null;
  }

  /* ---------------- 写入 ---------------- */

  getPlayerByToken(token) {
    if (!token) return null;
    return this.state.players.find((p) => p.token === token) || null;
  }

  /**
   * 玩家进入房间：取名 + 选颜色。
   * 同一种颜色允许对应多个玩家（线下多人共色场景）。
   */
  join({ name, color, token, playerId }) {
    const cleanName = String(name || '').trim().slice(0, 12);
    if (!cleanName) throw httpError(400, '请填写玩家名称');
    if (!COLORS.includes(color)) throw httpError(400, '请选择一个棋子颜色');

    // 同一设备重新进入：优先按本地身份恢复，避免重复占位
    const existing =
      this.getPlayer(playerId) || this.getPlayerByToken(token) || null;
    if (existing) {
      existing.name = cleanName;
      existing.color = color;
      existing.online = true;
      this.#commit();
      return { player: existing, resumed: true };
    }

    const player = {
      id: crypto.randomUUID(),
      name: cleanName,
      color,
      token: crypto.randomBytes(18).toString('hex'),
      steps: 0,
      spinCount: 0,
      lastSpinAt: null,
      lastSpinNum: null, // 最近一次转出的数字
      lastSpinSteps: null, // 最近一次前进的步数（0 表示转到 0、本回合不前进）
      lastSpinPocket: null,
      createdAt: new Date().toISOString(),
      online: true,
    };
    this.state.players.push(player);
    this.#commit();
    return { player, resumed: false };
  }

  /** 返回给该玩家的私有凭据（含 token，仅本人可见） */
  credentials(player) {
    return { id: player.id, name: player.name, color: player.color, token: player.token };
  }

  /**
   * 记录一次转动结果。服务端不产生随机数（随机数由转动设备的 crypto API 生成），
   * 只负责校验、记账与广播。
   * @param {{playerId:string, num:number, pocket?:number, source?:'manual'|'sim'}} input
   */
  spin({ playerId, num, pocket, source = 'manual' }) {
    const player = this.getPlayer(playerId);
    if (!player) throw httpError(404, '玩家身份不存在，请重新进入并选择颜色');

    const n = Number(num);
    if (!Number.isInteger(n) || n < 0 || n > 12) throw httpError(400, '无效的轮盘数字');

    if (source === 'manual' && player.lastSpinAt) {
      const gap = Date.now() - new Date(player.lastSpinAt).getTime();
      if (gap < SPIN_COOLDOWN_MS) {
        throw httpError(429, `请稍候 ${Math.ceil((SPIN_COOLDOWN_MS - gap) / 1000)} 秒后再转动`);
      }
    }

    const steps = stepsOf(n);
    const at = new Date().toISOString();
    player.steps += steps;
    player.spinCount += 1;
    player.lastSpinAt = at;
    player.lastSpinNum = n; // 顶部公平条要展示「最近一次转出的数字与步数」
    player.lastSpinSteps = steps;
    player.lastSpinPocket = Number.isInteger(pocket) ? pocket : null;

    const spin = {
      id: crypto.randomUUID(),
      seq: ++this.seq,
      playerId: player.id,
      name: player.name,
      color: player.color,
      num: n,
      pocket: Number.isInteger(pocket) ? pocket : null,
      steps,
      source,
      at,
    };
    this.state.spins.unshift(spin);
    if (this.state.spins.length > MAX_SPINS) this.state.spins.length = MAX_SPINS;

    this.#commit();
    if (this.onSpin) this.onSpin({ spin, player: this.credentials(player) });
    return { spin, player: this.credentials(player) };
  }

  /** 批量试验：只进入统计样本，不改变任何棋子步数 */
  simulate(playerId, times) {
    const count = Math.max(1, Math.min(50000, Math.floor(Number(times) || 0)));
    const player = this.getPlayer(playerId);
    const counter = new Array(POCKET_COUNT).fill(0);
    const rand = globalThis.crypto?.getRandomValues
      ? (() => {
          const buf = new Uint32Array(1);
          const LIMIT = 0x100000000 - (0x100000000 % POCKET_COUNT);
          return () => {
            do {
              globalThis.crypto.getRandomValues(buf);
            } while (buf[0] >= LIMIT);
            return buf[0] % POCKET_COUNT;
          };
        })()
      : () => Math.floor(Math.random() * POCKET_COUNT);

    for (let i = 0; i < count; i++) counter[rand()] += 1;

    this.state.simSamples = (this.state.simSamples || 0) + count;
    this.state.simCounts = this.state.simCounts || new Array(POCKET_COUNT).fill(0);
    for (let i = 0; i < POCKET_COUNT; i++) this.state.simCounts[i] += counter[i];

    const track = (this.state.simTracks = this.state.simTracks || {});
    if (player) track[player.id] = (track[player.id] || 0) + count;

    this.state.simLog = this.state.simLog || [];
    this.state.simLog.unshift({
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      name: player?.name || '未登记设备',
      color: player?.color || null,
      times: count,
    });
    if (this.state.simLog.length > 100) this.state.simLog.length = 100;

    this.#commit();
    return { times: count, total: this.state.simSamples };
  }

  /**
   * 启动时让内存索引与磁盘上的备份文件保持一致：
   * 以 state.json 里的索引顺序为准（新→旧），补上磁盘上存在但索引缺失的文件，
   * 丢弃索引里存在但文件已被手工删除的条目。
   */
  #syncArchiveIndex() {
    let files = [];
    try {
      files = fs.readdirSync(this.archiveDir).filter((f) => f.endsWith('.json'));
      // 旧版本备份文件名里带空格（URL 不安全），这里自动改名迁移
      for (const f of [...files]) {
        if (!/\s/.test(f)) continue;
        const clean = f.replace(/\s+/g, '_');
        try {
          fs.renameSync(path.join(this.archiveDir, f), path.join(this.archiveDir, clean));
          files = files.filter((x) => x !== f).concat(clean);
          console.log(`[store] 备份文件名已规范化：${f} → ${clean}`);
        } catch (err) {
          console.warn(`[store] 备份改名失败 ${f}: ${err.message}`);
        }
      }
    } catch {
      files = [];
    }
    const fileIds = new Set(files.map((f) => f.replace(/\.json$/, '')));
    const kept = (this.state.archives || []).filter((a) => fileIds.has(a.id));

    for (const f of files) {
      const id = f.replace(/\.json$/, '');
      if (kept.some((a) => a.id === id)) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(this.archiveDir, f), 'utf8'));
        kept.push(this.#archiveMeta(raw, id));
      } catch (err) {
        console.warn(`[store] 跳过损坏的备份文件 ${f}: ${err.message}`);
      }
    }
    kept.sort((a, b) => (b.archivedAt || '').localeCompare(a.archivedAt || ''));
    this.state.archives = kept;
  }

  /** 从完整备份内容里提取列表用的摘要 */
  #archiveMeta(raw, id) {
    const players = raw.players || [];
    const spins = raw.spins || [];
    const times = spins.map((s) => s.at).filter(Boolean).sort();
    return {
      id: raw.id || id,
      session: raw.session ?? null,
      name: raw.name || '对局',
      archivedAt: raw.archivedAt || times.at(-1) || null,
      startedAt: raw.startedAt || times[0] || null,
      endedAt: raw.endedAt || times.at(-1) || null,
      spinCount: spins.length,
      totalSteps: players.reduce((sum, p) => sum + (p.steps || 0), 0),
      simSamples: raw.simSamples || 0,
      playerCount: players.length,
      players: players.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        steps: p.steps || 0,
        spinCount: p.spinCount || 0,
      })),
    };
  }

  /**
   * 把当前对局写入历史备份文件。
   * 先写文件、成功后再登记索引，确保不会出现「索引有、文件无」的假备份。
   * 只有真正产生过转动记录的对局才会被备份，避免连点重置堆出一堆空备份。
   * @returns {object|null} 摘要；无数据可备份时返回 null
   */
  archiveNow({ name } = {}) {
    const spins = this.state.spins;
    const players = this.state.players;
    if (!spins.length) return null;

    // 每局开始时间：现存最早的记录；记录被裁剪过则退回玩家创建时间
    const allTimes = spins.map((s) => s.at).filter(Boolean).sort();
    const startedAt = allTimes[0] || players.map((p) => p.createdAt).filter(Boolean).sort()[0] || null;
    const endedAt = allTimes.at(-1) || new Date().toISOString();
    const nextSession =
      (this.state.archives || []).reduce((max, a) => Math.max(max, a.session || 0), 0) + 1;
    const archivedAt = new Date().toISOString();
    const id = `${stamp()}-${crypto.randomBytes(3).toString('hex')}`;
    const label = `第 ${nextSession} 局`;

    const payload = {
      version: 2,
      id,
      session: nextSession,
      name: name || label,
      archivedAt,
      startedAt,
      endedAt,
      roomName: this.state.roomName,
      simSamples: this.state.simSamples || 0,
      simCounts: this.state.simCounts || [],
      players: players.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        steps: p.steps,
        spinCount: p.spinCount,
        lastSpinAt: p.lastSpinAt,
        createdAt: p.createdAt,
      })),
      spins,
    };

    fs.mkdirSync(this.archiveDir, { recursive: true });
    const target = path.join(this.archiveDir, `${id}.json`);
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(tmp, target); // 原子落盘，避免写一半留下坏文件

    const meta = this.#archiveMeta(payload, id);
    this.state.archives.unshift(meta);
    this.#commit();
    console.log(
      `[store] 已备份「${meta.name}」：${meta.spinCount} 条记录 / ${meta.totalSteps} 步 → ${target}`,
    );
    return meta;
  }

  /** 备份列表（新→旧，仅摘要） */
  listArchives() {
    return this.state.archives || [];
  }

  /** 读取某次备份的完整内容 */
  getArchive(id) {
    const meta = (this.state.archives || []).find((a) => a.id === id);
    if (!meta) throw httpError(404, '该备份不存在');
    try {
      return JSON.parse(fs.readFileSync(path.join(this.archiveDir, `${id}.json`), 'utf8'));
    } catch {
      throw httpError(404, '备份文件已丢失，请检查 data/archive 目录');
    }
  }

  /** 备份导出为 CSV 文本 */
  archiveCsv(id) {
    const raw = this.getArchive(id);
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      ['对局', raw.name, '备份时间', raw.archivedAt].map(esc).join(','),
      ['开始时间', raw.startedAt, '结束时间', raw.endedAt].map(esc).join(','),
      [
        '记录条数',
        (raw.spins || []).length,
        '合计步数',
        (raw.players || []).reduce((s, p) => s + (p.steps || 0), 0),
      ]
        .map(esc)
        .join(','),
      '',
      ['序号', '时间', '玩家', '颜色', '转出数字', '口袋编号', '本步数', '类型'].map(esc).join(','),
    ];
    for (const s of [...(raw.spins || [])].reverse()) {
      lines.push(
        [
          s.seq,
          s.at,
          s.name,
          COLOR_NAME_CN[s.color] || s.color,
          s.num,
          Number.isInteger(s.pocket) ? s.pocket : '',
          s.steps,
          s.source === 'sim' ? '试验' : '实转',
        ]
          .map(esc)
          .join(','),
      );
    }
    lines.push('', ['玩家', '颜色', '累计步数', '转动次数'].map(esc).join(','));
    for (const p of raw.players || []) {
      lines.push([p.name, COLOR_NAME_CN[p.color] || p.color, p.steps, p.spinCount].map(esc).join(','));
    }
    return `\ufeff${lines.join('\r\n')}`;
  }

  /** 删除某次备份（含磁盘文件） */
  deleteArchive(id) {
    const idx = (this.state.archives || []).findIndex((a) => a.id === id);
    if (idx < 0) throw httpError(404, '该备份不存在');
    try {
      fs.rmSync(path.join(this.archiveDir, `${id}.json`));
    } catch {
      /* 文件已不在也允许移除索引 */
    }
    const [removed] = this.state.archives.splice(idx, 1);
    this.#commit();
    return removed;
  }

  /**
   * 重置：先把当前对局备份到 data/archive/，再清空。
   * 备份失败会抛错并放弃重置——宁可不重置，也不能把数据弄丢。
   */
  reset({ keepPlayers = true } = {}) {
    const archived = this.archiveNow();

    this.state.spins = [];
    this.state.simSamples = 0;
    this.state.simCounts = new Array(POCKET_COUNT).fill(0);
    this.state.simTracks = {};
    this.state.simLog = [];
    this.seq = 0;
    if (keepPlayers) {
      for (const p of this.state.players) {
        p.steps = 0;
        p.spinCount = 0;
        p.lastSpinAt = null;
      }
    } else {
      this.state.players = [];
    }
    this.#commit();
    return { archived, state: this.snapshot() };
  }

  /** 玩家主动离场 */
  leave(playerId) {
    const before = this.state.players.length;
    this.state.players = this.state.players.filter((p) => p.id !== playerId);
    if (this.state.players.length === before) return false;
    delete this.state.simTracks?.[playerId];
    this.#commit();
    return true;
  }

  /** 手动修正某个玩家的步数（线下记错时补救） */
  adjust(playerId, steps) {
    const player = this.getPlayer(playerId);
    if (!player) throw httpError(404, '玩家不存在');
    const value = Math.max(0, Math.floor(Number(steps) || 0));
    player.steps = value;
    this.#commit();
    return this.credentials(player);
  }
}

export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
