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

## 本地运行

```bash
npm ci
node arena/run.mjs --solver champion=agent/solver.js --quick        # 30 秒内跑通竞技场
node arena/run.mjs --solver champion=agent/solver.js --noise        # 完整测量 + 基线自比噪声
node scripts/propose.mjs --out .tmp/candidate --mock                # 不调模型，产出一个假候选
node arena/run.mjs --solver champion=agent/solver.js --solver candidate=.tmp/candidate/solver.js --out .tmp/scores.json
node scripts/ratchet.mjs --scores .tmp/scores.json --candidate .tmp/candidate --dry-run
node scripts/budget.mjs                                              # 预检：会告诉你缺什么
ANTHROPIC_API_KEY=… node scripts/propose.mjs --out .tmp/candidate --type L0   # 真的问一次模型
npm run serve                                                        # http://localhost:8787 看仪表盘
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
docs/
  index.html           仪表盘（原生 SVG，零依赖）
  history.json         每一代的完整记录
.github/workflows/
  evolve.yml           主循环：propose → evaluate → ratchet → heartbeat → deploy
  pages.yml            人工改 docs/ 时重新发布
  smoke.yml            守卫 + 快速竞技场 + mock 流水线
```

## 已知局限（非目标）

- 递归到 L1 为止：重写 improver 的 `scripts/meta-prompt.md` 是固定的。任何有限系统都有一个固定点；这里把它明确写出来。
- 静态守卫是近似的（无完整作用域分析）；它的任务是让作弊**变得显眼**，真正的边界是沙箱和容器。
- 评分是单机相对比值，不是绝对性能声明。
- 任务集是固定的 8 个函数，天花板可预期；这是刻意的——先把闭环做真，再谈开放性。

MIT © 2026 Yongcheng123
