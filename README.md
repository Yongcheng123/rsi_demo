# RSI Demo — 一个真实、可审计、持续运行的递归自我改进循环

> **TL;DR (English).** A minimal but *real* recursive self-improvement (RSI) loop that
> runs itself on GitHub Actions every six hours. The genome is the `agent/` directory
> of this repository: a JavaScript solver **and the prompt that rewrites it**. Each
> generation, a model proposes a new genome; a sealed, network-less arena measures it
> against a frozen baseline on freshly generated hidden inputs; a ratchet accepts it
> only if it is correct and > 5 % faster than the current champion, re-measured in the
> same run. Every generation — accepted or rejected — is a commit, and the dashboard
> at **GitHub Pages** renders the whole history, including every time the improver
> rewrote itself. It will plateau. The shape of that plateau is the result.

**仪表盘：** https://yongcheng123.github.io/rsi_demo/ · **仓库：** https://github.com/Yongcheng123/rsi_demo

---

## 这是什么

大多数"自我改进 AI"的演示只是一个优化器：系统在改进**解**。RSI 的定义性特征是系统在改进
**"改进解的那个东西"**。这个仓库把这条线钉死在六条可验证的判据上：

| # | 判据 | 在这个仓库里对应的机制 |
|---|---|---|
| 1 | 改的是自己的源码，不是外部超参数 | 基因组 = 被 commit 的 `agent/` 目录（`solver.js`、`improver.md`、`notes.md`） |
| 2 | **改进器本身在被改进** | `agent/improver.md` 是模型改写 solver 时读的策略文档，它自己也会被 **L1 代** 重写；`git log -p agent/improver.md` 就是它改写自己的编年史 |
| 3 | 评估它改不了 | 裁判在 `arena/`，solver 在 `node:vm` 沙箱 + `docker --network none` 里跑；输入由种子现场生成，宿主用同一种子重算参考答案 |
| 4 | 接受准则是硬的，能抗噪声 | 冠军在**同一次运行、同一进程**里配对重测；候选必须在隐藏输入上全部正确且 > +5 % |
| 5 | 全程可审计 | 每一代一个 commit，接受与否都记录进 `docs/history.json` |
| 6 | 无人干预持续运行 | `schedule: cron` 每 6 小时一代；`PAUSED` 文件是刹车，`MAX_GENS_PER_DAY` 是限速 |

第 2 条是灵魂。没有它，这只是一个自动调参机器人。

## 架构：仓库是基因组，Actions 是引擎，Pages 是橱窗

```
                 ┌──────────────────────────────────────────────────────────┐
  cron (6h) ───▶ │ ① propose      有 API key · 只读仓库                       │
                 │   读 improver.md / solver.js / notes.md / 上一代报告        │
                 │   L0: 用 improver 改写 solver                              │
                 │   L1: 先改写 improver，再用新 improver 改写 solver          │
                 └───────────────┬──────────────────────────────────────────┘
                                 ▼  artifact: candidate/
                 ┌──────────────────────────────────────────────────────────┐
                 │ ② evaluate     无密钥 · 无网络 · 只读源码 · 密封容器          │
                 │   arena/run.mjs: 静态守卫 → 每个任务一个子进程 →           │
                 │   solver 与冻结基线在同一进程的两个 vm 上下文里逐次调用配对计时  │
                 │   宿主用同一种子重算参考答案校验每一次调用的输出                 │
                 └───────────────┬──────────────────────────────────────────┘
                                 ▼  artifact: scores.json
                 ┌──────────────────────────────────────────────────────────┐
                 │ ③ ratchet      可写仓库 · 不执行任何 agent 代码              │
                 │   正确 && 候选 > 冠军 × 1.05 → 复制 ≤3 个文件进 agent/        │
                 │   无论接受与否：追加 history.json、更新 strategy.json、commit  │
                 └───────────────┬──────────────────────────────────────────┘
                                 ▼
                 ┌──────────────────────────────────────────────────────────┐
                 │ ③b heartbeat   always() · 可写仓库                         │
                 │   这一代没产出？把原因写进 history.json.runs 并 commit        │
                 │   （相同原因折叠计数，最多每 20 小时提交一次）                  │
                 └───────────────┬──────────────────────────────────────────┘
                                 ▼
                 ④ deploy        Pages 从刚推的 commit 重新发布 docs/
```

三条不可破的规则：**agent 写的代码永远不在持有密钥或写权限的 job 里执行**；ratchet 只做算术和文件复制；
候选永远不会作为 workflow 源码被 checkout（cron 永远从 `main` 的 workflow 启动）。

## 一代之内发生了什么

1. `scripts/budget.mjs` 检查 `PAUSED` 文件和 24 小时内的代数 / 花费，超了就整代跳过。
2. `scripts/propose.mjs` 按 `agent/strategy.json` 里的 `p_meta` 决定这一代是 **L0**（改 solver）还是
   **L1**（先改 improver 再改 solver）。连续被拒 3 次强制 L1——**对象层停滞就升到元层**。
   模型的输出如果过不了静态守卫，允许一轮修复；仍不过就作为"守卫违规"记录。
3. `arena/run.mjs` 对每个任务启动一个子进程（`arena/worker.mjs`）：
   - 静态守卫（acorn）：禁止字符串字面量、`class`、getter/setter、`this`、`typeof`、`import`、
     模块级状态、给顶层函数/全局挂属性……详见 [`arena/SPEC.md`](arena/SPEC.md)。
   - 两个全新的 `vm` 上下文（solver、基线），只含 ECMAScript 内建对象，禁用 `eval`/`new Function`，
     **不注入任何宿主函数**（任何宿主函数都会泄漏宿主的 `Function` 构造器）。
   - 输入在沙箱内由种子生成；宿主用同一种子重生成，跑参考实现，逐次比对哈希。solver 永远见不到重复内容，
     因此硬编码、记忆化、惰性求值都没有意义。
   - 宿主用 `performance.now()` 逐次计时，两侧交替调用相同输入，每批 24 次 × 5 批 × 2 个 split；
     加速比 = 配对比值的中位数。
   - 正确性是硬门控：任何错误输出、异常、修改输入、稀疏/访问器输出、超时 → 整体 0 分。
4. `scripts/ratchet.mjs` 决定、应用、记录，然后 `git commit && git push`。
5. Pages 重新部署 `docs/`。

## 它会作弊——这是特性

模型迟早会试：硬编码答案、往输入里写状态、用 getter 把计算推到计时之后、改基线、把测试改简单。
这个仓库不假装这不会发生，而是让每一种已知手法**要么结构上不可能，要么被检测并公开记录**：

| 手法 | 对策 |
|---|---|
| 改评估器 / 基线 / 测试 | ratchet 只复制 `agent/` 下的三个文件；其他路径在结构上不可达 |
| 硬编码 / 记忆化 | 每次调用的输入都是现场从种子生成的新内容；宿主重算参考答案逐次校验 |
| 惰性输出（getter / Proxy / 稀疏数组） | 守卫禁 getter、class、`Object`、`Proxy`、`this`、`typeof`、字符串字面量；宿主用属性描述符抽样检查输出 |
| 原地修改输入 | 调用后比对输入哈希与纯净重生成 |
| 篡改计时 / 全局对象 | 时钟在宿主；沙箱无宿主函数；`Math.x = …` 一类写入被守卫拒绝 |
| 死循环 / 内存炸弹 | 每任务独立子进程 + 超时 + 内存上限；容器 `--pids-limit` |
| 逃逸到宿主进程 | 上下文里没有 `process`；CI 上再套 `--network none --read-only --cap-drop ALL` |

守卫是绊线，沙箱是边界。仪表盘上有一栏"拒绝日志"，专门陈列守卫违规和正确性失败——那是 reward hacking 的一手记录。

## 噪声

CI runner 是共享机器。这里的所有对策都指向一个原则：**永远比较同一时刻、同一核心上的配对测量。**

- 基线和 solver 在同一进程的两个上下文里，**逐次交替**调用相同输入。
- 5 批 × 24 次调用，批内取中位数，批间比值再取中位数。
- 冠军每一代都在同一次运行里重测，接受与否比较的是"本次实测"，不是历史数字。
- 每次运行记录批间比值的最大偏差（仪表盘"本次测量噪声"）。本机上相同代码测得的分数偏差约 0.3 %。

## 诚实预期：它会平台期

变异器的能力上限就是前沿模型的能力，那是固定的；任务的天花板也是固定的。所以这不是智能爆炸——
你会得到一条**递减**的 Δ 曲线。这正是应该拿出去的东西：一个真实的递归闭环，跑了 N 代，这是收益衰减曲线，
这是三个成因（适应度天花板、评估噪声固化、搜索空间膨胀）的分解。仪表盘上的"每代改进幅度"图就是为此而设。

想推迟平台期：v2 可以加自生成课程（模型也提新任务，准入条件是"参考解能过 && 当前冠军过不了"）。

## 两个隐蔽的坑

**① 平台期会杀死 cron。** GitHub 会在公开仓库**连续 60 天无 commit 后禁用 scheduled workflow**。
如果只在成功时 commit，进入平台期 → 没有 commit → cron 被关 → "持续 RSI" 悄无声息地死掉。
所以 ratchet **每一代都 commit**，失败也是数据。

**② 流水线挂了比平台期更隐蔽。** ①③ 之间任何一环出错（密钥没配、API 故障、runner OOM），
运行根本走不到 ratchet——没有 commit，没有 history 记录，仪表盘还在展示上一次成功的代际，
而 60 天的钟照常在走。**这个坑我踩了**：第一次部署后 `ANTHROPIC_API_KEY` 没设，26 次定时运行
连续失败了 7 天，而仪表盘对此一无所知。

修法是两条：
- `scripts/budget.mjs` 做**预检**——缺密钥是一次干净的 skip，不是崩溃。确定性的配置错误
  连续报 26 次红叉，信息量并不比报 1 次多，反而会淹没真正的回归。
- `scripts/heartbeat.mjs` 在 `always()` 的 job 里跑：**没有产出代际的运行也要落地**。
  相同原因折叠成一条并计数，最多每 20 小时提交一次——既让仓库保持活跃，又不刷屏。
  仪表盘顶部因此会出现红色横幅和"循环健康"一栏，坏掉的循环再也藏不住。

## 部署

```bash
# 1. 密钥（只有 ① propose 能读到）
gh secret set ANTHROPIC_API_KEY --repo Yongcheng123/rsi_demo

# 2. 可选变量
gh variable set MAX_GENS_PER_DAY --body 4 --repo Yongcheng123/rsi_demo
gh variable set MAX_COST_USD_PER_DAY --body 5 --repo Yongcheng123/rsi_demo
gh variable set RSI_MODEL --body claude-opus-5 --repo Yongcheng123/rsi_demo   # 或 claude-sonnet-5
gh variable set RSI_EFFORT --body high --repo Yongcheng123/rsi_demo

# 3. Pages 用 Actions 部署（Settings → Pages → Source: GitHub Actions），或：
gh api -X POST repos/Yongcheng123/rsi_demo/pages -f build_type=workflow

# 4. 手动触发第一代
gh workflow run evolve.yml --repo Yongcheng123/rsi_demo -f type=L0
```

刹车：在仓库根目录提交一个 `PAUSED` 文件。删掉它就恢复。

## 成本

公开仓库的 Actions 分钟数免费。每代 1 次（L0）或 2 次（L1）模型调用，约 30–60k 输入 / 5–15k 输出 token；
`claude-opus-5`（$5 / $25 每 MTok）约 **$0.3–0.7 一代**，每天 4 代 ≈ **$1.5–3**。换 `claude-sonnet-5`
约 1/3——但变异器的质量直接就是 RSI 的天花板，这个权衡很实在。仪表盘累计显示花费。

（各代间隔 6 小时，prompt cache 在这里没有复用价值，所以没有用。）

## 本地运行 —— 看整条循环跑

一条命令跑完 propose → evaluate → ratchet，和 CI 用的是同一批脚本、同样的顺序；
CI 额外提供的只是 job 之间的权限隔离和密封容器。

```bash
npm ci
npm run watch                       # 另开一个终端：http://localhost:8787/.tmp/local/docs/
npm run loop -- --gens 3 --mock     # 不需要密钥，把每个阶段都走一遍
```

仪表盘每 3 秒自动刷新（线上 60 秒），所以你可以看着分数曲线一代一代长出来：

```
┌ gen 1
│ ① propose    30ms  L0  solver 2.8 KB
│    ↳ MOCK: replaced the quadratic dedupe with a Set-based O(n) pass.
│      dedupe   · champion 0.99×/1.00× · candidate 7.49×/21.8× (3.9ms→180µs)
│ ② evaluate  10.8s  candidate 1.439× vs champion 0.983×
│ ③ ratchet    29ms  ACCEPT +46.4%
└ champion 1.439×  ·  stall 0  ·  p_meta 0.2
```

真正调模型（密钥只存在于你自己的 shell，仓库里不写任何东西）：

```bash
export ANTHROPIC_API_KEY=sk-ant-…
npm run loop -- --gens 3            # 每代 1–2 次调用，约 $0.3–0.7
```

| 选项 | 作用 |
|---|---|
| *(默认)* | **沙箱** `.tmp/local/`：复制一份 `agent/` 和 `docs/`，git 追踪的文件一个都不碰 |
| `--keep` | 接着上次的沙箱继续跑，而不是重置 |
| `--live` | 写真实的 `agent/` 和 `docs/history.json`（`git checkout agent docs` 可撤销） |
| `--quick` | 竞技场单批次、少调用，一代约 10 秒（数字噪声大，只用来看流程） |
| `--gens N` | 连跑 N 代 |
| `--type L0\|L1` | 强制对象层 / 元层，默认 `auto`（按 `p_meta` 抽，连续被拒 3 次强制 L1） |

单独跑某一环：

```bash
node arena/run.mjs --solver champion=agent/solver.js --noise     # 完整测量 + 基线自比噪声
node scripts/budget.mjs                                          # 预检：会告诉你缺什么
node scripts/ratchet.mjs --scores … --candidate … --dry-run      # 只判定，不落盘
```


## 目录

```
agent/                 ← 基因组（唯一可变区域）
  solver.js            对象层：8 个纯函数
  improver.md          ★ 元层：改写 solver 的策略；L1 代重写它
  notes.md             agent 的跨代记忆
  strategy.json        机械更新的状态：stall、p_meta
arena/                 ← 裁判（受保护）
  SPEC.md              给 agent 看的合同：函数契约、输入规模、评分、沙箱规则
  baseline.js          冻结的第 0 代 solver，所有加速比的分母
  reference.mjs        正确性 oracle，只在宿主进程跑
  gen.js               种子输入生成器（宿主与沙箱共用同一份代码）
  guard.mjs            acorn 静态守卫
  worker.mjs           单任务评估：沙箱、配对计时、校验
  run.mjs              编排、汇总、评分
scripts/
  propose.mjs          ① 调模型（L0 / L1，一轮修复，--mock）
  protocol.md          L0 的固定系统提示（输出协议）
  meta-prompt.md       L1 的固定系统提示——递归的固定点
  ratchet.mjs          ③ 决定 / 应用 / 记录
  heartbeat.mjs        ③b 记录没有产出代际的运行（跳过 / 故障）
  budget.mjs           预检：密钥、刹车、限速
  loop.mjs             本地驱动器：在沙箱里把三个阶段连跑 N 代
  env.mjs              加载 .env.local（gitignore，本地凭证）
docs/
  index.html           仪表盘（原生 SVG，零依赖，自动轮询）
  history.json         每一代的完整记录 + 没产出代际的运行
  _headers             Cloudflare Pages 缓存策略：history.json 不缓存
wrangler.toml          Cloudflare Pages 配置（只发布 docs/）
.github/workflows/
  evolve.yml           主循环：propose → evaluate → ratchet → heartbeat → deploy
  pages.yml            人工改 docs/ 时重新发布（GitHub Pages）
  cloudflare.yml       docs/ 变化时发布到 Cloudflare Pages（没配 secret 则跳过）
  smoke.yml            守卫 + 快速竞技场 + mock 流水线
```

## 换一个模型提供方

模型调用只在 `scripts/propose.mjs` 的 `ask()` 里。竞技场、静态守卫、棘轮、仪表盘都只认
"一个字符串形式的 solver"，所以提供方是个实现细节。

```bash
# 默认：Anthropic
RSI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-…
RSI_MODEL=claude-opus-5        # 可选，这是默认值

# 任何 OpenAI 兼容 endpoint：OpenAI / DeepSeek / Groq / OpenRouter / LiteLLM 代理 / 本地 Ollama
RSI_PROVIDER=openai
OPENAI_BASE_URL=https://api.deepseek.com/v1     # 带不带 /v1 后缀都行
OPENAI_API_KEY=sk-…                             # 本地 endpoint 可以不填
RSI_MODEL=deepseek-chat
```

本地跑的话把这些写进 `.env.local`（**已 gitignore，这个仓库是公开的**），脚本会自动加载，
真实环境变量优先级更高。CI 用 GitHub Secrets，不受影响。

CI 里切换提供方靠仓库变量，只需要配对应的那一个 secret：

```bash
gh variable set RSI_PROVIDER         --body openai    --repo <owner>/<repo>
gh variable set OPENAI_BASE_URL      --body https://… --repo <owner>/<repo>
gh variable set RSI_MODEL            --body <model>   --repo <owner>/<repo>
gh variable set RSI_REASONING_EFFORT --body low       --repo <owner>/<repo>   # 推理模型建议
gh variable set RSI_MAX_TOKENS       --body 64000     --repo <owner>/<repo>
gh secret   set OPENAI_API_KEY                        --repo <owner>/<repo>
```

`① propose` 的 job 超时设成了 45 分钟：慢的推理模型单次调用可能十几分钟，加上一轮修复就翻倍。

OpenAI 那条路是**原生 fetch + 流式**，不加依赖。流式不是为了好看：非流式时服务端要等生成完
才发响应头，而 undici 的 `headersTimeout` 是写死的 300 秒（`AbortSignal` 覆盖不了它），
推理模型写一个 4 KB 的 solver 轻松超时。流式下响应头立刻到，只有真正卡死的流才会超时。

### 推理模型要注意 token 预算

`RSI_MAX_TOKENS`（默认 32000）对很多提供方来说**把推理 token 也算在内**。实测
`minimax-m3`：第一次调用产出 95,629 字符，其中 95,621 是 reasoning，正文只剩 8 个字符就撞上限了。
如果日志里看到 `output hit the token cap`，把它调大：

```bash
RSI_MAX_TOKENS=64000
```

`propose.mjs` 有一轮修复机制，第一次跑飞了还能救回来，但那一次的 token 是白烧的。

更糟的情况是**推理死循环**：模型在草稿纸上转圈，永远不开始写答案。实测 `minimax-m3` 面对
完整的 L0 提示（13 KB：spec + solver + 历史 + improver）时，产出 171,345 个推理字符、
**8 个正文字符**，然后上游自己断流报错——约 10 分钟、17 万 token，一无所获。把
`RSI_MAX_TOKENS` 从 32k 提到 64k 只会让它转得更久。

所以有一道熔断：推理字符超过 `RSI_MAX_REASONING_CHARS`（默认 120000）而正文还不足 200 字符时，
立刻中止并说明原因。这是省钱，也是给出诊断——它区分了"模型在慢慢想"和"模型不会做这个任务"。
（熔断只在正文尚未开始时开火，所以一个"想得久但终会作答"的模型不会被误杀。）

**对这类模型，先试 `RSI_REASONING_EFFORT=low`。** 同一个 `minimax-m3`，默认强度下转 171k 字符
一无所获；`low` 之下转了 115k 字符后跳出草稿纸，一次调用产出合规 solver，还写对了
size-k 最小堆和 patience sorting。这不是它变聪明了，是它不再把预算全花在自我怀疑上。

> **变异器的质量直接就是这个 RSI 循环的天花板。** 换便宜模型不只是省钱——它决定曲线能爬到哪、
> 平台期在哪出现。仪表盘的代际表里记录了每一代用的是哪个模型，混用时不会算糊涂账。

## 部署到 Cloudflare Pages（可选）

仪表盘是两个静态文件，放哪都行。Cloudflare Pages：

```bash
npx wrangler login          # 浏览器授权一次
npm run deploy:cf           # → https://rsi-demo.pages.dev
```

想让机器人每次提交后自动发布，在仓库里加两个 secret，`.github/workflows/cloudflare.yml`
就会接管（没配 secret 时它会干净跳过，不会让每次 push 变红）：

```bash
gh secret set CLOUDFLARE_API_TOKEN   --repo Yongcheng123/rsi_demo
gh secret set CLOUDFLARE_ACCOUNT_ID  --repo Yongcheng123/rsi_demo
```

`docs/_headers` 把 `history.json` 设成 `no-store`——仪表盘在轮询它，CDN 缓存会让页面看起来卡住。
GitHub Pages 的部署是独立的，两个可以并存，也可以删掉任一个。

### 为什么竞技场不能搬到 Workers

只有仪表盘能上 Cloudflare。竞技场的根本动作是**把 agent 写出来的 solver 当作源码文本执行**，
而 Workers isolate 做不到这件事。对着 workerd（`wrangler dev`）实测，三条路全封死：

| 调用 | 结果 |
|---|---|
| `eval('1')` | `EvalError: Code generation from strings disallowed` |
| `new Function('return 1')` | `EvalError: Code generation from strings disallowed` |
| `vm.runInContext(src, ctx)` | `The runInThisContext method is not implemented` |

`node:vm` 在 `nodejs_compat` 下能 import，但是个空壳。这不是配置问题——**禁止从字符串生成代码正是
Workers 安全模型的一部分**，而这恰好是本项目必须做的事。所以 ② evaluate 需要真正的 VM 或容器，
留在 GitHub Actions（那里还能套 `docker --network none`）。

（顺带一提：我原以为拦路的是 Workers 冻结时钟——毕竟评分靠计时。实测本地 workerd 里
`Date.now()` 和 `performance.now()` 在同步计算中照常走。真正的拦路虎是代码生成，不是时钟。）

## 已知局限（非目标）

- 递归到 L1 为止：重写 improver 的 `scripts/meta-prompt.md` 是固定的。任何有限系统都有一个固定点；这里把它明确写出来。
- 静态守卫是近似的（无完整作用域分析）；它的任务是让作弊**变得显眼**，真正的边界是沙箱和容器。
- 评分是单机相对比值，不是绝对性能声明。
- 任务集是固定的 8 个函数，天花板可预期；这是刻意的——先把闭环做真，再谈开放性。

MIT © 2026 Yongcheng123
