/**
 * 实时同步自检：模拟两台设备同时在线。
 *   node scripts/sync-selftest.js
 *
 * 断言：
 *  1. 两台设备都能在连接后拿到全量快照
 *  2. 设备 A 转动后，设备 B 会收到 state（步数更新）与 spin（单条记录）广播
 *  3. 设备 B 视角看到的颜色/步数与设备 A 完全一致（公平性的核心）
 */
import { io } from 'socket.io-client';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const check = (cond, msg) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failed++;
};

async function api(path, body, playerId) {
  const res = await fetch(`${BASE}/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(playerId ? { 'x-player-id': playerId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json();
}

function connect(label) {
  return new Promise((resolve, reject) => {
    const socket = io(BASE, { transports: ['websocket', 'polling'], timeout: 8000 });
    const events = { states: [], spins: [] };
    socket.on('state', (s) => events.states.push(s));
    socket.on('spin', (s) => events.spins.push(s));
    socket.on('connect', () => resolve({ label, socket, events }));
    socket.on('connect_error', reject);
    setTimeout(() => reject(new Error(`${label} 连接超时`)), 9000);
  });
}

console.log('\n=== 实时同步自检（两台设备）===');
await api('/reset', { keepPlayers: false });

const devA = await connect('设备A');
const devB = await connect('设备B');
await sleep(500);
check(devA.events.states.length >= 1, '设备 A 连接后收到全量快照');
check(devB.events.states.length >= 1, '设备 B 连接后收到全量快照');

const joinA = await api('/join', { name: '设备A玩家', color: 'red' });
const joinB = await api('/join', { name: '设备B玩家', color: 'blue' });
await sleep(400);
check(joinA.player.token.length >= 20 && joinB.player.token.length >= 20, '两台设备各自登记成功（红 / 蓝）');

// A 先播一次，等冷却过去
await api('/spin', { num: 1, pocket: 1 }, joinA.player.id);
await sleep(1500);

const beforeB = devB.events.states.at(-1);
const stepsBefore = beforeB.players.find((p) => p.id === joinA.player.id)?.steps ?? 0;

const spinA = await api('/spin', { num: 11, pocket: 22 }, joinA.player.id);
check(spinA.state.totalSteps >= 11, `设备 A 上报 11 步成功（该颜色累计 ${spinA.state.totalSteps}）`);

await sleep(700);
const afterB = devB.events.states.at(-1);
const aOnB = afterB.players.find((p) => p.id === joinA.player.id);
check(aOnB && aOnB.steps === stepsBefore + 11, `设备 B 侧同步到 A 的步数 ${stepsBefore} → ${aOnB?.steps}`);
check(aOnB && aOnB.color === 'red', '设备 B 侧看到 A 的颜色 = red');
check(
  devB.events.spins.length >= 1 && devB.events.spins.at(-1).num === 11,
  `设备 B 收到 spin 广播（num=${devB.events.spins.at(-1)?.num}，颜色=${devB.events.spins.at(-1)?.color}）`,
);

const boardB = afterB.players.find((p) => p.id === joinB.player.id);
check(boardB && boardB.steps === 0, '设备 B 自己的棋子不受 A 的转动影响（步数 0）');

const latest = afterB.spins[0];
check(latest.num === 11 && latest.color === 'red', '设备 B 的记录首条 = 设备 A 的这次转动');

console.log('\n=== 离线恢复 ===');
devA.socket.close();
devB.socket.close();
await sleep(300);
const reconnect = await connect('设备C');
await sleep(500);
check(reconnect.events.states.length >= 1, '断线重连后仍能拿到完整快照');
const c = reconnect.events.states.at(-1);
check(c.spins.length >= 1 && c.players.length === 2, `重连快照完整（玩家 ${c.players.length} 位 / 记录 ${c.spins.length} 条）`);
reconnect.socket.close();

await api('/reset', { keepPlayers: false });
console.log(`\n${failed === 0 ? '全部通过 OK' : `${failed} 项失败`}`);
process.exit(failed);
