import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import os from 'node:os';
import express from 'express';
import { Server as SocketServer } from 'socket.io';

import { GameStore } from './game/store.js';
import { createApiRouter } from './routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..'); // 项目根目录 roulette-online/
const CLIENT_DIST = path.join(ROOT, 'client', 'dist');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_FILE =
  process.env.DATA_FILE || path.join(ROOT, 'data', 'game-state.json');

let io = null;
const store = new GameStore({
  file: DATA_FILE,
  onChange: () => broadcastState(),
  onSpin: ({ spin }) => {
    if (io) io.emit('spin', spin);
  },
});

const broadcastState = () => {
  if (io) io.emit('state', store.snapshot());
};

const app = express();
app.disable('x-powered-by');
// 信任反向代理（内网穿透）传递的转发头，便于记录真实来源
app.set('trust proxy', true);
app.use(express.json({ limit: '256kb' }));
app.use('/api', createApiRouter(store));

// 统一错误兜底：JSON 解析失败、请求体超限等都不能让进程退出
app.use((err, _req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error('[server]', err);
  if (res.headersSent) return;
  res.status(status).json({ error: status === 400 ? '请求格式不正确' : err.message || '服务器内部错误' });
});

// 生产模式：直接托管构建后的前端，一个端口即可对内网穿透
const hasBuild = fs.existsSync(path.join(CLIENT_DIST, 'index.html'));
if (hasBuild) {
  app.use(
    express.static(CLIENT_DIST, {
      setHeaders(res, filePath) {
        if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
        else if (/[/\\]assets[/\\]/.test(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );
  // 其余路径回退到 SPA（history 路由），但放行 Cloudflare 自己的 /cdn-cgi/ 路径：
  // Cloudflare 会往页面注入 /cdn-cgi/challenge-platform/... 脚本，若被 SPA 回退接管会返回 HTML 导致脚本报错
  app.get(/^(?!\/api|\/socket\.io|\/cdn-cgi\/).*/, (_req, res) => {
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res
      .status(200)
      .type('html')
      .send(
        '<pre style="font:14px/1.8 ui-monospace,Consolas,monospace;padding:24px">' +
          '尚未构建前端。\n\n开发模式：npm run dev  （前端 http://localhost:5173）\n' +
          '生产模式：npm run serve（构建并启动单一端口 http://localhost:' +
          PORT +
          '）</pre>',
      );
  });
}

const server = http.createServer(app);
io = new SocketServer(server, {
  cors: { origin: true, credentials: true },
  pingInterval: 20000,
  pingTimeout: 25000,
});

io.on('connection', (socket) => {
  socket.emit('state', store.snapshot());
  socket.on('request-state', () => socket.emit('state', store.snapshot()));
});

server.listen(PORT, HOST, () => {
  const lines = [
    '',
    '  命运轮盘 · 多设备联机版',
    `  本机访问   http://localhost:${PORT}${hasBuild ? '' : '  (未构建：仅 API + Socket.IO)'}`,
  ];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) {
        lines.push(`  局域网访问 http://${net.address}:${PORT}   ← 手机 / 其他设备`);
      }
    }
  }
  lines.push(`  数据文件   ${DATA_FILE}`, '');
  console.log(lines.join('\n'));
});

const shutdown = () => {
  store.saveNow();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// 任何未捕获异常都不应让聚会现场的服务直接消失
process.on('uncaughtException', (err) => {
  console.error('[uncaught]', err);
  store.saveNow();
});
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});
