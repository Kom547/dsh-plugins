# 底栏用量与余额插件

在当前会话的输入框下方底栏（composer dock）显示两件事：

- **余额** — 已登录 DeepSeek 账户的充值余额（有赠送时显示 `充值 + 赠送`），右侧 `↻` 手动刷新；
  悬停看拆分与本次读取时间。

会话用量与缓存命中率**不在本插件里**：底栏内置的统计 pill 已经在同一行显示
它们（`73.4M tok · 缓存命中 99%`），再画一份是重复。所以本条目只做余额，
两者并排即可同时看到「用量 + 余额」。

余额按以下时机重读：挂载、每 2 分钟、窗口离开 5 秒以上后返回、点击 `↻`。

### 失败分级

读取失败时标签直接带原因码（便于截图定位）：

| 原因码 | 含义 |
|---|---|
| `unavailable · rpc …` | Remote 调用被拒（传输/校验层），后面跟错误码 |
| `unavailable · platform …` | Host 调通 Platform，但 Platform 回 `failed` |
| `unavailable · call …` | 调用抛异常，后面跟异常名与消息 |
| `余额不可用 · no-wallet` | 返回 `ready` 但钱包数组为空 |
| `未登录` | Host 明确回 `null`（没有账户凭据） |

## 文件

| 文件 | 作用 |
|---|---|
| `package.json` | 包清单。`dsh.bundle.patch` 声明补丁；`dsh.client` 声明浏览器半边（`platform: web`、依赖 `dsh-client-ui-conversation`），`./client` 导出浏览器模块。 |
| `cordis.patch.yml` | 包自带补丁，插入 `usage-balance` 一行（供 bundle 方式安装时使用）。 |
| `index.js` | Host 半边。不注册任何资源——用量来自会话投影，余额来自既有的 `accountController` Remote。 |
| `client.js` | 浏览器半边。通过 `ctx.slots.register` 注册到 `conversation.composer.dock`，条目包在 `Guard` 错误边界里。 |

## 数据来源

- 用量：`tokenUsage` 会话投影（`@deepseek-ai/dsh-token-meter`）的 `totals`。
- 余额：`ctx.remote.account.getBalance()`，由 `@deepseek-ai/dsh-api-account-controller`
  暴露；Host 侧用 `~/.dsh/.credentials.yaml` 中的凭据调 Platform。

整个过程只读取，不写入会话日志，也不新增会话事件类型。

### 为什么不用 `useAccount`

账户面板插件（`dsh-client-ui-settings-account`）的 `apply` 首行是
`if (!("dshDesktop" in globalThis)) return;`，而桌面 preload 只在
`dsh-app://app` 这个 origin 下才 `exposeInMainWorld("dshDesktop", …)`。
本页是 `http://127.0.0.1:<port>`，所以该插件整体不启用：它提供的
`useAccount` 这个 slot prop 并不存在（账户设置面板本身也不会显示）。

因此本插件只依赖 `remote.account` 这个 Remote（Host 侧始终可用），登录态由
返回值形状推断：

| 返回值 | 含义 | 显示 |
|---|---|---|
| `null` | Host 侧没有账户凭据 | 未登录 |
| `{ status: 'ready', … }` | 读到钱包 | 金额 |
| `{ status: 'failed' }` / `!ok` / 抛错 | 读取失败 | 余额不可用 |

`!result.ok`（调用被拒）刻意归为「读取失败」而不是「未登录」——只有 Host
明确回 `null` 才代表未登录。

## 与原生底栏对齐

排版直接照搬内置统计 pill（`dsh-client-ui-chat` 的 `StatsPills.module.css`）：

| 项 | 值 |
|---|---|
| 字号 | `calc(var(--dsh-content-font-size-secondary, 13px) - 1px)` |
| 行高 | `calc(20px + var(--dsh-content-font-delta-secondary, 0px))` |
| 内边距 / 圆角 | `1px 8px` / `999px` |
| 文字色 | `var(--dsw-alias-label-tertiary)` |
| 分隔符 | `var(--dsw-alias-separator-primary)` |
| 图标 | 14×14，`currentColor` 描边 |
| 数字 | `font-variant-numeric: tabular-nums` |

关键是**字号挂在 pill 自己身上**：底栏那一行本身不设字号，每个 pill 自带。
之前把条目精简成只显示余额时，字号随旧的容器样式一起被删掉，于是继承了输入框
的正文尺寸，看起来比原生大一号。`render-check.mjs` 里有 5 条断言锁住这些值。

## 校验

三个只读脚本，都不需要浏览器：

```bash
node tools/check-bundle.mjs     # 包清单与包内 patch 形态
node tools/check-install.mjs    # profile 里那行是否指向真实存在的文件
node tools/render-check.mjs     # 仿 React 真实渲染 dock 组件，覆盖四种余额形态
node tools/boundary-check.mjs   # 错误边界能否兜住首屏异常
```

`render-check.mjs` 里的 React 替身刻意保留了 hook cell 跨渲染持久化与依赖数组
比较语义——否则会把「每次渲染都重读余额」这类缺陷掩盖掉。它同时验证：
一次挂载只发一次 Remote 读、无用量时整个条目渲染为 `null`、卸载后无残留
cleanup，以及**引擎 prop 契约**（见下）。

### 踩过的坑：`props.locale` 是命名空间，不是服务

dock 引擎会把条目的 locale **命名空间字符串**放进 `props.locale`。如果把
locale *服务对象* 用同名 prop 转发进组件，就会把它覆盖掉，组件里
`locale.subscribe(...)` 变成对字符串取方法 —— 首屏必然抛错，整条目空白。
所以本插件把服务走 `localeRuntime` 这个独立名字。

`render-check.mjs` 开头的「dock prop contract」断言就是为了钉住这一点：
它模拟引擎传入 `locale: 'usageBalance'`（字符串），要求服务出现在
`localeRuntime` 上。把冲突改回去，这四条断言会立刻失败。

### 错误边界

条目注册在 `Guard`（一个 class 错误边界）内部。dock owner 把所有条目渲染在
同一棵子树里，未捕获的首屏异常会让整条 dock 空白且没有可见线索；有了边界
就退化成「用量 / 余额不可用」这一小块。异常本身仍然由框架按
`slot entry crashed in '<slot>'` 报到控制台。

## 当前安装方式

`~/.dsh/profiles/desktop/cordis.patch.yml` 末尾追加了一行指向本目录 `index.js`
绝对路径的 loader 行（patch 文件在 line 29-36）。这种方式：

- 不改 profile 的 `package.json`，不装依赖，不建 `node_modules` 软链；
- 加载器会把绝对路径规范化为 `file://` URL，浏览器半边通过包清单的
  `dsh.client` + `./client` 导出被发现，入口 id 即包名 `@local/dsh-usage-balance`。

## 回滚

删掉 profile 里那 8 行（`# Session usage and account balance` 注释块至 `name:` 行），
或直接恢复同目录备份：

```bash
cp ~/.dsh/profiles/desktop/cordis.patch.yml.bak-before-usage-balance \
   ~/.dsh/profiles/desktop/cordis.patch.yml
```

然后重启应用。删掉 profile 里的行之后，本目录可以整体删除。

## 故障自诊断

条目注册在 `Guard` 错误边界里，且组件内部还有一层 try/catch：任何渲染期异常都
不会让底栏空白，而是退化成一行文字，**并把异常原文直接印在文字里**（悬停可见
完整报文与前几帧堆栈）。所以"不可用"后面跟着的那串英文就是真实原因。

### 踩过的坑：`inject` 必须声明 `remote` 本身

首次运行的报文是 `cannot get property "remote" without inject`。Cordis 的上下文
代理按**服务键**判定访问权限（`cordis/lib/index.js` 里 `if (prop in fiber.inject)`），
而 `remote.account` 是另一个键——只声明点号叶子并不能放行 `ctx.remote`。
所以 `inject` 要同时写 `remote` 和 `remote.account`（官方账户插件也是这么写的）。

### 已排除的渲染期风险

渲染期抛错会让整条目失效，所以以下三处都刻意不用：

1. **`Intl` / `toLocale*`** —— 语言标签不被接受时会抛 `RangeError`，而这段代码
   跑在 render 里。金额与千分位改为手写格式化，时间改为 `HH:MM` 手工拼接。
2. **`props.locale`** —— 引擎在这个 prop 上放的是 locale **命名空间字符串**；
   把 locale 服务用同名 prop 传进去会覆盖它，导致对字符串取 `.subscribe`。
   现在组件完全不碰 locale 服务，文案只用引擎提供的 `t`。
3. **不读会话投影** —— 条目不再依赖 `useProjection`，少一个失败面。

## 已知边界

- **改动 `client.js` 需要重启应用**：浏览器半边的产物版本号由文件 mtime/ctime/size
  决定，Host 会据此换 URL，但新 bundle 要下次启动才进组合。
- 未登录 / 读取失败时余额显示「未登录」「余额不可用」，用量的显示不受影响。
- 余额每次读取都是一次 Platform 请求，因此刷新有节流与重叠保护，不做高频轮询。
- 账户的登录/登出入口在 Web origin 下不可用（见上），换账号需要在桌面
  `dsh-app://app` 界面里完成，或直接改 `~/.dsh/.credentials.yaml`。
