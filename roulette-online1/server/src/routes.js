import { Router } from 'express';
import { COLORS, COLOR_META, NUMBER_COLOR, expectedProb, groupColorOf } from './game/shared.js';
import { httpError } from './game/store.js';

/** 颜色 / 轮盘常量，供前端渲染图例与配色 */
export function optionsPayload() {
  const colors = COLORS.map((key) => ({
    ...COLOR_META[key],
    expectedNumbers: Object.keys(NUMBER_COLOR)
      .map(Number)
      .filter((n) => n !== 0 && groupColorOf(n) === key),
  }));
  const probs = [];
  for (let n = 0; n <= 12; n++) {
    probs.push({ num: n, prob: expectedProb(n), pockets: n === 0 ? 1 : 3 });
  }
  return { colors, probs, pocketCount: 37 };
}

export function createApiRouter(store) {
  const api = Router();

  const wrap = (handler) => (req, res) => {
    try {
      handler(req, res);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('[api]', err);
      res.status(status).json({ error: err.message || '服务器内部错误' });
    }
  };

  const requirePlayer = (req) => {
    const playerId = req.get('x-player-id') || req.body?.playerId || req.query?.playerId;
    const player = store.getPlayer(playerId);
    if (!player) throw httpError(401, '身份已失效，请重新进入并选择颜色');
    return player;
  };

  api.get('/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  api.get('/options', (_req, res) => res.json(optionsPayload()));

  api.get('/state', (req, res) =>
    res.json(store.snapshotFor(req.get('x-player-id') || req.query?.playerId)),
  );

  api.post(
    '/join',
    wrap((req, res) => {
      const { name, color, token, playerId } = req.body || {};
      const { player, resumed } = store.join({ name, color, token, playerId });
      res.json({
        resumed,
        player: store.credentials(player),
        state: store.snapshotFor(player.id),
      });
    }),
  );

  api.post(
    '/spin',
    wrap((req, res) => {
      const player = requirePlayer(req);
      const { num, pocket } = req.body || {};
      const result = store.spin({ playerId: player.id, num, pocket, source: 'manual' });
      res.json({ ...result, state: store.snapshotFor(player.id) });
    }),
  );

  api.post(
    '/simulate',
    wrap((req, res) => {
      const player = requirePlayer(req);
      const { times } = req.body || {};
      const result = store.simulate(player.id, times);
      res.json({ ...result, state: store.snapshotFor(player.id) });
    }),
  );

  // 重置 = 先把当前对局备份到 data/archive/，成功后再清空（不强制身份，局域网内可信）
  api.post(
    '/reset',
    wrap((req, res) => {
      const keepPlayers = req.body?.keepPlayers !== false;
      const { archived } = store.reset({ keepPlayers });
      res.json({
        ok: true,
        archived,
        state: store.snapshotFor(req.get('x-player-id')),
      });
    }),
  );

  /* ---------------- 历史备份 ---------------- */

  api.get('/archives', (_req, res) => res.json({ archives: store.listArchives() }));

  api.get(
    '/archives/:id',
    wrap((req, res) => {
      res.json({ archive: store.getArchive(req.params.id) });
    }),
  );

  api.get(
    '/archives/:id/export.csv',
    wrap((req, res) => {
      const csv = store.archiveCsv(req.params.id);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="roulette-archive-${req.params.id}.csv"`,
      );
      res.send(csv);
    }),
  );

  api.delete(
    '/archives/:id',
    wrap((req, res) => {
      const removed = store.deleteArchive(req.params.id);
      res.json({ ok: true, removed, archives: store.listArchives() });
    }),
  );

  api.post(
    '/leave',
    wrap((req, res) => {
      const player = requirePlayer(req);
      store.leave(player.id);
      res.json({ ok: true, state: store.snapshot() });
    }),
  );

  return api;
}
