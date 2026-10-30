# 命运轮盘 · 四色棋子联机版

把原来的单文件 `roulette-wheel.html` 改造成**可本地部署的 Vue 3 项目**，用于线下黄 / 蓝 / 绿 / 红四色棋子的步数判定，并解决公平性问题：

| 公平性要求 | 本项目的实现 |
| --- | --- |
| 每个设备进入页面时要求选择颜色 | `/` 进入页强制「昵称 + 棋子颜色」登记，身份写入浏览器本地存储，刷新不用重选 |
| 玩家产生步数时系统记录颜色 | 服务端逐条记账：颜色、昵称、数字、口袋编号、步数、时间 |
| 所有设备顶部展示当前玩家的颜色与步数 | 顶部常驻公平条：**每位玩家一张牌，显示总步数 + 最近一次步数 +「xx秒前」**，刚动过的牌会亮起，Socket.IO 秒级同步 |
| 专门页面记录这个记录 | `/log` 记录专页：逐条流水 + 四色汇总 + 分布图 + χ² 卡方检验 + CSV 导出 |
| 风格和原页面一致 | 完全沿用原版设计令牌（墨绿绒布 / 金线 / 衬线中文 / Playfair / IBM Plex Mono） |
| 适配手机端 | 沿用原版断点体系（1024 / 880 / 640 / 380px）并新增顶部条折行、表格降列等适配 |

---

## 一、快速开始

```bash
cd roulette-online

# 1) 安装依赖（npm 或 pnpm 均可）
npm install

# 2) 构建前端 + 启动服务（单端口，便于内网穿透）
npm run serve
```

启动后终端会打印可用地址：

```
  命运轮盘 · 多设备联机版
  本机访问   http://localhost:3000
  局域网访问 http://192.168.x.x:3000   ← 手机 / 其他设备
  数据文件   D:\...\roulette-online\data\game-state.json
```

其他设备连同一个 Wi-Fi，打开「局域网访问」那个地址即可。

### 开发模式（改代码即时热更新）

```bash
npm run dev
```

- 后端 `http://localhost:3000`（`node --watch` 自动重启）
- 前端 `http://localhost:5173`（已配好 `/api` 与 `/socket.io` 代理，Vite 监听 `0.0.0.0`，手机可直接开 `http://<本机IP>:5173`）

改完后执行一次 `npm run build`，再用 `npm start` 以单端口对外提供服务。

---

## 二、游戏规则

- 轮盘 37 格：数字 `0` 占 1 格，数字 `1–12` 各占 3 格，与线下轮盘的格位结构一致。
- 棋子颜色与口袋数字的对应：**黄 1–3 · 蓝 4–6 · 绿 7–9 · 红 10–12**，`0` 号格子为绿色。
- **转出的数字 = 前进步数**；转到 `0` 本回合不前进。
- **每次转动只让自己颜色的棋子前进**，其他人的棋子不受影响。
- 一种颜色可以对应多位玩家（例如两人都执红），但**步数各自独立记录**，记录里靠昵称区分。
- 随机数由**转动那台设备**的 `crypto.getRandomValues()` 生成，并采用**拒绝采样**消除取模偏差；服务端只负责校验、记账与广播，不参与随机，也无法篡改结果。

---

## 三、页面与功能

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `/` | 登记 / 身份 | 昵称 + 四色选择；已登记时显示本人颜色、步数、转动次数，可修改昵称与颜色 |
| `/wheel` | 轮盘主页面 | 转动轮盘、结果回显、四色步数总览、公平性机制说明、概率结构、统计验证、实时记录 |
| `/log` | 记录专页 | 逐条流水（序号 / 颜色 / 玩家 / 数字 / 步数 / 累计 / 时间）、四色汇总、数字分布、口袋命中热力、CSV 导出、**历史备份**（重置过的每一局都能回看/导出）、重置当前对局 |

顶部公平条在**所有页面常驻**，分两行：

```
命运轮盘  玩家 4  合计 33 步   ● 小美二号 +12  20秒前        ●已同步  记录  阿明  重置
┌───────────────────────┬───────────────────────┬───────────────────────┐
│ ● 阿明 我             │ ● 小美二号            │ ● 小美                │
│   +3 (3) · 24秒前   3步│   +12 (12) · 20秒前 12步│   +11 (11) · 28秒前 11步│
└───────────────────────┴───────────────────────┴───────────────────────┘
```

- **每位玩家一张牌**：左上角是昵称（自己那张带「我」标记），左下角是**最近一次**的步数与转出数字加「xx秒前」，右侧大字是**累计总步数**。
- 「xx秒前」每秒自动刷新（刚刚 / 12秒前 / 3分钟前…）；某位玩家刚走完的 8 秒内，他整张牌会发光，其他设备一眼就能看到是谁在动。
- 尚未转动过的玩家显示「尚未转动」。
- 第一行右侧汇总全场：玩家数、合计步数、以及**全场最近一次**是谁走了多少步、多久之前。
- 玩家牌按颜色顺序排列且顺序固定，不会因为步数变化而跳动；人数多时自动换行，手机端两列排布。

其它细节：

- 主页面按 `空格键` 也能转动。
- 同一玩家的两次上报有 1.2 秒防连点间隔，避免误触刷步数。
- 「试验 ×N」只把理论样本并入统计验证（χ²），**不会**改变任何棋子步数，也不写入对局记录。
- 记录专页的 CSV 导出带 BOM，Excel 直接打开不乱码。

---

## 四、内网穿透部署

生产模式下前端由 Node 服务直接托管，**只需要暴露一个端口（默认 3000）**，不需要再单独跑静态服务器。

```bash
npm run build      # 构建前端到 client/dist
npm start          # 单端口启动（默认 0.0.0.0:3000）
```

### 方式 A：frp（推荐，自建服务器）

服务端 `frps.ini`：

```ini
[common]
bind_port = 7000
```

本机 `frpc.ini`：

```ini
[common]
server_addr = <你的公网服务器 IP>
server_port = 7000

[roulette]
type = tcp
local_ip = 127.0.0.1
local_port = 3000
remote_port = 8080
```

穿透后访问 `http://<公网IP>:8080`。若要绑域名并启用 HTTPS，把 `type` 改为 `http` 并配置 `custom_domains`。

### 方式 B：ngrok / cpolar / 花生壳

```bash
ngrok http 3000
# 或
cpolar http 3000
```

> **Socket.IO 兼容性提示**：客户端已配置 `transports: ['websocket', 'polling']`，会优先用 WebSocket，若穿透隧道不支持 WebSocket 会自动降级为长轮询，因此免费版 HTTP 隧道也能正常实时同步（延迟略高）。
> 若某些隧道出现「/socket.io 404」，在隧道配置里把 `/socket.io` 路径一并放行即可。

### 方式 C：只在内网使用

不需要任何穿透，直接用启动时打印的局域网地址即可。

### 方式 D：Cloudflare Tunnel（自定义域名，例如 `n.od8.top`）

本项目**不需要为自定义域名改任何代码或配置**：前端全部使用相对路径（`/api`、`/socket.io`、`/assets`），
Node 服务同时托管页面、API 与 WebSocket，所以只要隧道把域名指向本机的 `3000` 端口即可，
无需设置 `base`、CORS 或再加一个端口。

**第 1 步：让服务跑在生产单端口模式**

```bash
npm run serve          # 等价于 npm run build && npm start，监听 0.0.0.0:3000
```

**第 2 步：把域名指向 3000 端口**

| 隧道类型 | 特征 | 改哪里 |
| --- | --- | --- |
| **面板托管隧道**（Zero Trust 控制台创建，最常见） | 没有 `%USERPROFILE%\.cloudflared\config.yml`，`cloudflared` 靠一段 token 启动 | Cloudflare Zero Trust → Networks → Tunnels → 选隧道 → **Public Hostname** → Add：`Subdomain=n`、`Domain=od8.top`、`Type=HTTP`、`URL=localhost:3000` |
| **本地托管隧道**（`cloudflared tunnel create` 自己写配置） | 存在 `%USERPROFILE%\.cloudflared\config.yml` | 编辑该 `config.yml`（见下） |

```yaml
# %USERPROFILE%\.cloudflared\config.yml   —— 仅本地托管隧道需要
tunnel: <你的隧道 ID>
credentials-file: C:\Users\<用户名>\.cloudflared\<隧道 ID>.json

ingress:
  - hostname: n.od8.top
    service: http://localhost:3000     # ← 关键：指向本项目的 3000 端口
  - service: http_status:404           # 兜底规则必须放最后
```

改完运行 `cloudflared tunnel run <隧道名>`；面板托管隧道则重启 cloudflared 服务或重新执行带 token 的启动命令。

**第 3 步：面板上要确认的几个开关**

- **SSL/TLS 模式**用 `Full` 或 `Full (strict)`，**不要用 `Flexible`**（会形成重定向循环）。
- WebSocket 由 Cloudflare 默认支持，无需额外配置；本项目优先用 WebSocket，不可用时自动降级长轮询。
- 若一直停在 Cloudflare 验证页，检查该主机是否启用了 **Security Challenge / Under Attack** 或 **Access** 策略。
- 免费版单请求上限 100MB、默认超时 100 秒，本项目全是小 JSON，不会触及。

**第 4 步：一条命令自检整条链路**

```powershell
powershell -File scripts\tunnel-check.ps1 -Domain n.od8.top -LocalPort 3000
```

依次检查：本地服务与端口 → `cloudflared` 进程与配置文件 → 本机 DNS 与公共 DNS 解析 →
域名返回码与页面内容 → 静态资源 / API / Socket.IO 握手 / WebSocket 升级，并给出对应修复建议。

> **本机 DNS 解析不了域名时**（很常见：宽带 DNS 缓存了隧道创建之前的 NXDOMAIN 结果）：
>
> ```powershell
> ipconfig /flushdns
> ```
>
> 仍不生效就把网卡 DNS 改成 `223.5.5.5` / `119.29.29.29`；或在
> `C:\Windows\System32\drivers\etc\hosts` 里临时加一行应急（Cloudflare IP 会变）：
>
> ```
> 104.21.14.155 n.od8.top
> ```
>
> 换手机流量访问同一域名若正常，就说明问题只在本地 DNS。

### 常用环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 服务端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DATA_FILE` | `<项目>/data/game-state.json` | 数据文件路径 |

```bash
# Windows PowerShell
$env:PORT=8080; npm start
# Linux / macOS
PORT=8080 npm start
```

---

## 五、目录结构

```
roulette-online/
├─ package.json               # 根工作区脚本（dev / build / start / serve）
├─ server/                    # Express + Socket.IO 后端
│  └─ src/
│     ├─ index.js             # 启动、静态托管、SPA 回退、Socket.IO 广播
│     ├─ routes.js            # REST API
│     └─ game/
│        ├─ shared.js         # 颜色 / 口袋 / 概率等公共定义
│        └─ store.js          # 状态、记账、历史备份（JSON 文件持久化）
├─ client/                    # Vue 3 + Vite 前端
│  ├─ index.html
│  └─ src/
│     ├─ main.js  App.vue  router.js
│     ├─ store.js             # 身份（localStorage）+ 实时状态（Socket.IO）
│     ├─ constants.js         # 颜色、概率、格式化
│     ├─ wheel.js             # 轮盘 SVG 构建 + 真随机（crypto + 拒绝采样）
│     ├─ components/FairnessBar.vue    # 顶部公平条
│     ├─ views/HomeView.vue            # 登记 / 选颜色
│     ├─ views/WheelView.vue           # 轮盘主页面
│     ├─ views/LogView.vue             # 记录专页 + 历史备份
│     └─ styles/                       # 设计令牌 + 全局样式 + 本地字体
├─ data/game-state.json       # 当前对局数据（自动生成）
├─ data/archive/<id>.json     # 历史备份，每次重置自动生成一局一份
├─ docs/                      # 自检截图
└─ scripts/                   # 自检与维护脚本
```

---

## 六、数据与维护

### 重置 = 先备份，再清空

**「重置」不会删除任何数据。** 每次重置都会先把当前对局完整写入一份独立备份，然后才清空页面上的记录：

```
data/
├─ game-state.json              # 当前对局（玩家、步数、最近记录、备份索引）
└─ archive/
   ├─ 20260930-221503-1a2b3c.json   # 第 1 局（含全部记录与当时步数）
   ├─ 20260930-224810-9f8e7d.json   # 第 2 局
   └─ ...
```

- 备份内容：该局全部逐条记录（颜色 / 昵称 / 数字 / 口袋 / 步数 / 时间）+ 每位玩家当时的累计步数 + 起止时间 + 样本数。
- 只有**真正产生过转动记录**的对局才会生成备份，连点重置不会堆出一堆空文件。
- 写入方式为「先写临时文件再改名」，并且**备份成功后才清空**；若备份失败会直接报错并放弃重置，绝不会把数据弄丢。
- 恢复/查看：记录专页的「历史备份」面板可展开任意一局回看、导出 CSV、单局删除。
- 备份索引与磁盘目录会自动对齐：手工删掉某个文件，重启后索引里对应的条目也会消失；旧版文件名（含空格）会自动规范化。

### 命令行维护

```bash
# 备份当前对局并清空（保留玩家和颜色）
node scripts/reset-data.js

# 备份后全新一局（连玩家一起清空）
node scripts/reset-data.js --all

# 查看所有历史备份
node scripts/reset-data.js --list

# 只删除当前数据文件（历史备份保留）
node scripts/reset-data.js --delete

# 永久删除全部历史备份（危险，必须显式确认）
node scripts/reset-data.js --purge-archives --yes
```

服务器正在运行时，脚本会走 HTTP 接口重置，内存状态与所有在线设备立即同步；服务器没开时直接改数据文件，同样会先写备份。

### 页面上也有入口

- 顶部公平条「重置」按钮
- 记录专页「重置当前对局（自动备份）」按钮

两者的确认框都会明确提示「会先备份到 data/archive/」，完成后提示备份了第几局、多少条记录。

> 提示：重置会立即通过 Socket.IO 广播给所有设备，所有屏幕同步归零；但备份数据完好保存在服务器上。

---

## 七、接口一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/options` | 颜色定义、数字概率等常量 |
| `GET` | `/api/state` | 当前对局快照（玩家含 `steps` / `lastSpinNum` / `lastSpinSteps` / `lastSpinAt`、最近 200 条记录、备份索引、试验样本） |
| `POST` | `/api/join` | 登记 / 恢复身份：`{ name, color, playerId?, token? }` |
| `POST` | `/api/spin` | 上报一次转动：`{ num, pocket }`，需请求头 `x-player-id` |
| `POST` | `/api/simulate` | 批量理论抽样：`{ times }`（不影响步数） |
| `POST` | `/api/reset` | **备份后**清空当前对局：`{ keepPlayers }`，返回 `{ archived, state }` |
| `GET` | `/api/archives` | 历史备份列表（仅摘要） |
| `GET` | `/api/archives/:id` | 某局备份的完整内容 |
| `GET` | `/api/archives/:id/export.csv` | 导出某局为 CSV（带对局信息表头与玩家汇总） |
| `DELETE` | `/api/archives/:id` | 删除某局备份（同时删除磁盘文件） |
| `POST` | `/api/leave` | 该设备离场（从名单移除） |

Socket.IO 事件：`state`（全量快照广播）、`spin`（单条实时记录）、`request-state`（客户端主动拉取）。

---

## 八、自检

项目自带三套自检脚本，改完代码可以随时跑一遍（前两套需要服务器已在 3000 端口运行）：

```powershell
# 1) 接口端到端自检（40 项断言：登记/同色多人/重进恢复/记账/防连点/非法输入/持久化…）
powershell -File scripts\api-selftest.ps1

# 2) 实时同步自检（模拟两台设备，验证步数与颜色广播、互不影响、断线重连）
node scripts\sync-selftest.js

# 3) 可视化自检（自动造一局演示数据并截图到 docs/）
powershell -File scripts\visual-check.ps1 -KeepData

# 4) 自定义域名 / 隧道链路自检
powershell -File scripts\tunnel-check.ps1 -Domain n.od8.top -LocalPort 3000
```

`docs/` 下已包含各断点的效果截图：`wheel-desktop.png`、`wheel-mobile.png`、`log-desktop.png`、`log-mobile.png`、`home-desktop.png`、`home-mobile.png`。

---

## 九、常见问题

**手机上打不开局域网地址？**
确认手机与电脑在同一网段，并放行 Windows 防火墙的 3000 端口：

```powershell
New-NetFirewallRule -DisplayName "Roulette 3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
```

**刷新后步数没了？**
步数存在服务端而非浏览器，刷新只会重新拉取；若确实归零，说明有人点了「重置」，或运行了 `scripts/reset-data.js`。

**换设备后要重新选颜色吗？**
要。颜色与昵称是「每台设备一份」的身份，存在各自浏览器的 localStorage 里；同一种颜色允许多人，因此重选同色也不会冲突。

**想改成「一次转动四个棋子一起走」？**
改动集中在 `server/src/game/store.js` 的 `spin()`：把只累加 `player.steps` 改成按 `NUMBER_COLOR` 同时累加四个颜色即可；前端 `WheelView.vue` 的 `board` 计算属性无需改动。

---

## 十、技术栈

- 前端：Vue 3（`<script setup>` + Composition API）、Vue Router 4、Vite 6、Socket.IO Client
- 后端：Node.js（ESM）、Express 4、Socket.IO 4
- 存储：JSON 文件（原子写入 + 防抖落盘），无需数据库
- 字体：构建期已把 Playfair Display / IBM Plex Mono 的拉丁子集本地化（约 190KB），**离线可用**；中文使用系统自带宋体类衬线
