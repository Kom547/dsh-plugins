# dsh-plugins

DeepSeek Harness（DSH）0.2.x 桌面端的一组本地插件，Host 半边跑在 DSH 进程里，Client 半边挂进会话底栏。

| 插件 | 作用 |
|---|---|
| [dsh-usage-balance](dsh-usage-balance/) | 输入框下方底栏显示 DeepSeek 账户余额（充值 + 赠送），`↻` 手动刷新，失败时带原因码 |
| [dsh-turn-timer](dsh-turn-timer/) | 每轮对话结束后在底栏显示上一轮耗时（`⏱ 本轮耗时 40 秒`） |

两个插件都只读会话事件、不写日志、不新增服务；`dsh-turn-timer` 的耗时来自 `turnTimer` 会话投影，`dsh-usage-balance` 的余额来自既有的 `accountController` Remote。

## 安装

在 `~/.dsh/profiles/<profile>/cordis.patch.yml` 末尾追加（路径换成你的克隆位置）：

```yaml
- insert:
    - id: usage-balance
      name: "/absolute/path/to/dsh-plugins/dsh-usage-balance/index.js"
- insert:
    - id: turn-timer
      name: "/absolute/path/to/dsh-plugins/dsh-turn-timer/index.js"
```

保存后重载窗口（`Cmd+R`）生效。Client 半边的模块清单由 host 的 `dsh.client` 声明生成，所以不需要额外注册。

`dsh-usage-balance` 另带一份 `cordis.patch.yml` 和 `dsh.bundle` 清单，也可以把仓库目录作为 `file:` 依赖装进 profile，再用自带的 bundle patch 挂载。

## 开发

```bash
cd dsh-turn-timer && node selftest.mjs   # 39 条断言，不需要 DSH 进程也不需要浏览器
```

`dsh-turn-timer` 有三条不能退让的约束（client 必须导出 `inject`、host 不能有顶层 `inject`、投影必须有 `wire.viewSchema` + `wire.view`），退让任意一条都会让整个 web boot 失败——细节见它的 README。

## 兼容性

在 DSH 0.2.2-rc.1（macOS arm64）上验证。插件读的是 DSH 的 bundle 内部契约（`ctx.slots`、`sessionProjections`、`conversation.composer.dock`），DSH 升级后可能需要跟进。

## License

MIT，见 [LICENSE](LICENSE)。
