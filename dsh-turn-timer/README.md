# dsh-turn-timer — 每轮对话耗时

在一轮对话结束后，底栏（composer dock）多出一枚 pill：

```
⏱ 本轮耗时 40 秒
```

上一轮的耗时从 `turn/start` 到 `turn/end`，等下一轮开始时清空；新一轮运行中不显示，
跑完直接换成新读数。

## ⚠️ 曾经出过的事故（务必先读）

第一版把这个应用**整个打崩**了：重启后所有插件和设置都不见了。

- 现象：`crash-…-web-boot.log` 里 `Error: web boot: 1 entry did not activate` /
  `@local/dsh-turn-timer: failed`。
- 真因：**`client.js` 没有导出 `inject`**。cordis 客户端对每个服务访问都做门禁
  （`cannot get property "slots" without inject`），client entry 直接 failed。
- 放大机制：client boot 的 `IZ()` 会遍历**每一个** client entry，只要有一个 fiber
  不是 `active` 就抛错；桌面端把这个错误当成致命错误，于是整个 web boot 失败。
  失败后应用写入了一份兜底 profile（只有 4 条配置、`ui-settings.enabled: false`），
  这就是“插件和设置都被 ban 了”的来源——不是被禁用，是被回退到了最小集合。
- 还有两个当时没暴露但同样是错的点：host 半边的顶层 `inject`（服务缺席会让插件
  pending 甚至 failed），以及**没写 `wire`**（客户端根本读不到投影）。

现在这三处都已修，并各自有断言锁住。**改动这个插件时不要删掉它们。**

## 怎么做的（两半，都是最小的做法）

| 半边 | 文件 | 做的事 |
|---|---|---|
| Host | `index.js` | 注册会话投影 `turnTimer`：`turn/start` 记下开始时间，`turn/end` 算出耗时。 |
| Client | `client.js` | 在 `conversation.composer.dock` 注册一条，用 `useProjection('turnTimer')` 读投影并渲染。 |

没有新服务、没有轮询、不写会话日志、不新增事件类型。耗时由 DSH 自己的投影 seam
推送和持久化。

### 三条不可退让的约束

1. **client 必须 `exports.inject = ['slots','locale']`** —— 少一个就 failed。
2. **host 不能有顶层 `inject`** —— 投影注册走 `ctx.inject(['sessionProjections'], …)`
   子插件，主 fiber 立即激活；服务缺席只是没有 pill，不会拖垮 boot。
3. **投影必须有 `wire.viewSchema` + `wire.view`** —— 否则 `useProjection` 永远拿不到值。

## 为什么起止点这样选

- **起点是 `turn/start` 而不是提示词时间**：投递到 agent 之间的排队不算「这一轮花的时间」。
- **结束点就是 `turn/end`**：工具调用、重试、思考都在这中间。
- **开始时间放在 state 里**（`startedAt`），不塞进客户端视图：客户端读的还是 3 个字段
  `{ turn, lastMs, at }`，`wire.view` 只投影这 3 个。

`user/message` 只认 `source.kind === 'user'`——同一个事件类型也承载
`runtime-context` 消息，那些不算用户提示。

## 跨会话正确性（stateVersion 2）

投影注册表为每个 Session 各存一份 cell，但 `init`/`apply` 都经过**同一个 unit 对象**：
子 agent、后台会话的轮次会和主会话交错穿过 `apply`。第一版把开始时间放在模块变量里，
实测会被串扰——

```
主 turn/start(t=1s) → 子会话整轮(t=10s→20s) → 主 turn/end(t=50s)
第一版：主会话读数 = null（子会话的 turn/end 把 openTurn 清零了）
现在：  主会话读数 = 49s，子会话读数 = 10s
```

现在开始时间放在 `state.startedAt`，由注册表按 Session 隔离，模块里没有任何可变状态。
`stateVersion` 因此从 1 提到 2：v1 的 checkpoint 行没有 `startedAt`，加载时按版本不匹配
丢弃、从 `init` 重折（缓存层 `restore` 的 baseSeq 恒为 0，不会触发跨 seq 报错）。

`wire.summary: false`：底栏读数只属于当前会话，不该进会话列表的 summary 折点，否则列表
每一行都会折一遍这个 unit。

## 校验

```bash
node selftest.mjs   # 39 条断言：折叠行为 + 真实客户端模块的注册/渲染/inject 门禁
node realdata.mjs   # 用 ~/.dsh/sessions 里的真实日志回放折叠（只读）
```

`selftest.mjs` 不需要 DSH 进程也不需要浏览器：它在 `vm` 里按
`window.__ModuleLoader__.load` 的方式加载 `client.js`，用替身 `useProjection`
渲染真实组件。其中三条是防止事故复发的：

- `the host half declares no top-level inject`
- `the host half cannot throw when the registry is absent`
- `registration needs no undeclared service`（用 Proxy 复刻 cordis 的 inject 门禁）

另有一条 `a turn interleaved with another Session keeps both readings` 锁住 stateVersion 2
的跨会话行为，别把它退回到模块变量。

`realdata.mjs` 只读。本机现有会话都只有头部、没有事件，所以它目前只能验证
「空会话读数为空」；一旦有带完整轮次的日志，它会逐事件回放并与日志里
`turn/start`→`turn/end` 的差值对账。

### 真正跑一遍（不改动自己的 profile）

```bash
mkdir -p /tmp/dsh-check/profiles
cp -R ~/.dsh/profiles/desktop /tmp/dsh-check/profiles/verify
DSH_HOME=/tmp/dsh-check \
  "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  --profile verify --no-open --port 0
```

打印出 `dsh web: http://127.0.0.1:…` 且**没有** `startup failed` / `did not activate`
就说明 host 侧全部激活；再用浏览器打开那个 URL，页面若正常渲染（没有
“Failed to load plugins”）就说明**所有 client entry（含本插件）都是 active**。
这两步是修复期间用来确认的，建议每次改完都跑一次。

## 安装与回滚

`~/.dsh/profiles/desktop/cordis.patch.yml` 末尾有 3 行（指向本目录 `index.js`）。
回滚：删掉那 3 行后重启应用，本目录可整体删除。

安装前的 patch 备份在 `cordis.patch.yml.bak-before-turn-timer`；事故后的坏文件
留档在 `~/.dsh/profiles/desktop/cordis.patch.yml.broken-1052`。

**改 `client.js` 需要重启应用**才能生效。

## 已知边界

- 只显示**已经结束**的轮次。中途被取消的轮次也会记录耗时（`turn/end` 照常写）。
- 还没跑完任何一轮时 pill 不显示。
- 没有「按轮次的历史列表」——那需要自己存数据，这里刻意不做。
- 本机会话缓存目前没有可用的完整轮次日志，所以 `realdata.mjs` 的“真实回放”部分
  尚未被真实数据覆盖到，只有合成事件和空会话两条路径被验证。
