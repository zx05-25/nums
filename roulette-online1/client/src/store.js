/**
 * 前端全局状态：玩家身份（本地持久化）+ 共享对局状态（Socket.IO 实时同步）
 */
import { computed, reactive, readonly } from 'vue';
import { io } from 'socket.io-client';

const IDENTITY_KEY = 'roulette.identity.v1';
const REQUEST_TIMEOUT = 8000;

/* ---------------- 身份（本机 = 一个玩家） ---------------- */

function readIdentity() {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.id && parsed.token ? parsed : null;
  } catch {
    return null;
  }
}

function writeIdentity(identity) {
  try {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
  } catch {
    /* 隐私模式下写入失败，不影响本次会话 */
  }
}

const emptyGame = () => ({
  roomName: '命运轮盘 · 线下四色棋子',
  updatedAt: null,
  totalSteps: 0,
  spinCount: 0,
  players: [],
  spins: [],
});

const state = reactive({
  identity: readIdentity(),
  game: emptyGame(),
  connected: false,
  loading: true,
  error: '',
  options: null,
  lastSpin: null,
  notice: null,
});

/** 服务端识别不出本机身份（例如服务器换过数据/被重置）时清掉本地身份 */
function invalidateIdentity() {
  if (!state.identity) return false;
  state.identity = null;
  try {
    localStorage.removeItem(IDENTITY_KEY);
  } catch {
    /* ignore */
  }
  setNotice('本机身份已失效，请重新选择棋子颜色', 'warn');
  return true;
}

/* ---------------- 网络请求 ---------------- */

async function request(path, { method = 'GET', body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const res = await fetch(`/api${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(state.identity ? { 'x-player-id': state.identity.id } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `请求失败（${res.status}）`);
      err.status = res.status;
      throw err;
    }
    if (data.state) applyGame(data.state);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function applyGame(next) {
  if (!next) return;
  Object.assign(state.game, next);
}

/* ---------------- Socket.IO 实时同步 ---------------- */

let socket = null;

function connectSocket() {
  if (socket) return socket;
  socket = io({
    path: '/socket.io',
    transports: ['websocket', 'polling'], // 内网穿透不支持 WS 时自动降级为轮询
    reconnectionDelay: 800,
    reconnectionDelayMax: 5000,
    timeout: 12000,
  });
  socket.on('connect', () => {
    state.connected = true;
    socket.emit('request-state');
  });
  socket.on('disconnect', () => {
    state.connected = false;
  });
  socket.on('state', applyGame);
  socket.on('spin', (spin) => {
    state.lastSpin = { ...spin, receivedAt: Date.now() };
  });
  return socket;
}

/* ---------------- 动作 ---------------- */

/** 进入房间：取名 + 选颜色（同色可多人） */
async function join({ name, color }) {
  const data = await request('/join', {
    method: 'POST',
    body: { name, color, token: state.identity?.token, playerId: state.identity?.id },
  });
  state.identity = data.player;
  writeIdentity(data.player);
  return data;
}

/** 修改当前玩家的名称 / 颜色 */
async function updateProfile({ name, color }) {
  const data = await request('/join', {
    method: 'POST',
    body: { name, color, playerId: state.identity.id, token: state.identity.token },
  });
  state.identity = data.player;
  writeIdentity(data.player);
  return data;
}

/** 上报一次转动结果（数字由本机 crypto API 生成） */
async function submitSpin({ num, pocket }) {
  if (!state.identity) throw new Error('请先选择颜色进入房间');
  try {
    return await request('/spin', {
      method: 'POST',
      body: { playerId: state.identity.id, num, pocket },
    });
  } catch (err) {
    if (err.status === 401) invalidateIdentity();
    throw err;
  }
}

async function simulate(times) {
  return request('/simulate', { method: 'POST', body: { playerId: state.identity?.id, times } });
}

async function resetAll(keepPlayers = true) {
  // 服务端会先把当前对局备份到 data/archive/，成功后才清空
  return request('/reset', { method: 'POST', body: { playerId: state.identity?.id, keepPlayers } });
}

/* ---------------- 历史备份 ---------------- */

async function listArchives() {
  const data = await request('/archives');
  return data.archives || [];
}

async function fetchArchive(id) {
  const data = await request(`/archives/${encodeURIComponent(id)}`);
  return data.archive;
}

/** 下载某次备份的 CSV（由服务端生成，文件名带备份 ID） */
async function downloadArchiveCsv(id) {
  const res = await fetch(`/api/archives/${encodeURIComponent(id)}/export.csv`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `导出失败（${res.status}）`);
  }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `roulette-archive-${id}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function deleteArchive(id) {
  const data = await request(`/archives/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return data.archives || [];
}

async function leave() {
  try {
    await request('/leave', { method: 'POST', body: { playerId: state.identity?.id } });
  } catch {
    /* 身份已失效时忽略 */
  }
  state.identity = null;
  try {
    localStorage.removeItem(IDENTITY_KEY);
  } catch {
    /* ignore */
  }
}

function setNotice(message, tone = 'info') {
  state.notice = message ? { message, tone, at: Date.now() } : null;
  if (message) {
    setTimeout(() => {
      if (state.notice && Date.now() - state.notice.at >= 2600) state.notice = null;
    }, 2800);
  }
}

/** 启动：加载常量 + 首次状态 + 建立实时连接 */
async function bootstrap() {
  state.loading = true;
  state.error = '';
  try {
    const options = await request('/options');
    state.options = options;
    try {
      await request('/state');
    } catch (err) {
      // 服务器上已经没有本机身份（换过数据 / 被重置）→ 清掉本地身份，回登记页
      if (err.status === 401) invalidateIdentity();
      else throw err;
    }
  } catch (err) {
    state.error = err.message || '无法连接服务器';
  } finally {
    state.loading = false;
  }
  connectSocket();
}

/* ---------------- 派生数据 ---------------- */

const me = computed(() => {
  if (!state.identity) return null;
  return state.game.players.find((p) => p.id === state.identity.id) || null;
});

const isJoined = computed(() => Boolean(me.value));

/** 当前回合：最近一次转动的颜色与玩家 */
const currentTurn = computed(() => state.game.spins[0] || null);

const leader = computed(() => {
  const players = state.game.players;
  if (!players.length) return null;
  return players.reduce((best, p) => (p.steps > best.steps ? p : best), players[0]);
});

const colorStats = computed(() => {
  const colors = state.options?.colors || [];
  return colors.map((c) => {
    const players = state.game.players.filter((p) => p.color === c.key);
    const spins = state.game.spins.filter((s) => s.color === c.key);
    return {
      ...c,
      players,
      playerCount: players.length,
      steps: players.reduce((sum, p) => sum + p.steps, 0),
      spinCount: players.reduce((sum, p) => sum + p.spinCount, 0),
      recent: spins[0] || null,
      online: players.some((p) => p.online),
    };
  });
});

export const store = {
  state: readonly(state),
  me,
  isJoined,
  currentTurn,
  leader,
  colorStats,
  join,
  updateProfile,
  submitSpin,
  simulate,
  resetAll,
  listArchives,
  fetchArchive,
  downloadArchiveCsv,
  deleteArchive,
  leave,
  setNotice,
  invalidateIdentity,
  bootstrap,
  connectSocket,
  applyGame,
};

export function useStore() {
  return store;
}

export default store;
