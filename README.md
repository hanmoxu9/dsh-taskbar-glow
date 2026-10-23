# 任务栏发光提示（dsh-taskbar-glow）

DSH 在后台跑的时候，你切去干别的；一轮跑完了、或者弹出审批 / 提问等你处理，
这个插件会让 **Windows 任务栏上的 DSH 图标闪烁**（系统原生的 FlashWindowEx），
把注意力叫回来。

## 安装

要求：**DSH 桌面版 + Windows**。插件没有任何 npm 依赖，也不用编译，一个目录拷过去就能用。

拿到目录（解压后）二选一：

1. **插件页**：侧栏「插件」→ 添加插件 → 填这个目录的绝对路径（也接受 npm 包名或 GitHub 地址）→ 安装。
2. **命令行**：`dsh plugin --profile desktop add link:<目录的绝对路径>`

装好后**重启一次 DSH**（浏览器半区在启动时扫描插件包），之后
「插件 → dsh-taskbar-glow → taskbar-glow → 配置」里就是设置页。

卸载：插件页里点卸载；或 `dsh plugin --profile desktop remove dsh-taskbar-glow`。

## 怎么分享

三种形式，按需要选：

- **发目录 / zip**：把整个 `dsh-taskbar-glow/` 目录（或打好的 zip）发给对方，对方解压后按上面第 1 种方式装。最快，不需要任何账号。
- **放到 GitHub**：把目录推成一个仓库，对方用「添加插件」填仓库地址（或 `dsh plugin --profile desktop add github:<user>/<repo>`）。适合要长期更新的插件。
- **发到 npm**：先做三件事——把 `package.json` 里的 `"private": true` 删掉、把 `name` 改成你自己的作用域（比如 `@your-name/dsh-taskbar-glow`，避免和别人的重名）、补上 `repository`；然后 `npm publish`。对方用「添加插件」填包名即可。`files` 已经把要发布的文件列全了（`index.js`、`client.js`、patch、locale、icon、README、LICENSE）。

> 发给别人前建议改一下 `version`；装过旧版的机器需要**重启 DSH** 才会换成新的 JS。

## 什么时候会闪

| 触发 | 说明 |
| --- | --- |
| 一轮对话跑完 | 根 agent 从 `running` 回到 `idle`。subagent 收工不闪，避免提前打扰。 |
| 等你点审批 | `approval/request`：工具要「允许 / 拒绝」。 |
| 等你回答问题 | `user-questions/request`：AI 用 `ask_user_question` 提问。 |

**DSH 窗口在前台时不闪**——你正看着屏幕，不用打扰。窗口最小化、被别的窗口
盖住、在别的虚拟桌面时都会闪；点回 DSH（窗口被激活）闪烁自动停止。

## 怎么试

三种方式，任选：

1. **输入框命令**：在对话输入框里敲 `/flash` 回车。它会先回一句「几秒后闪烁」，
   你这时切到别的窗口（浏览器、编辑器都行），到点就能看到任务栏图标闪烁。
2. **浏览器打开测试链接**：<http://127.0.0.1:1139/taskbar-glow/flash>。
   浏览器会抢走焦点，几秒后 DSH 的任务栏图标闪起来。
3. **等下一轮跑完**：切到别的窗口，让 DSH 干完活即可。

延迟秒数就是配置里的 `testDelaySeconds`（默认 5 秒），专门留出切换窗口的时间。

## 体检 / 排查

- <http://127.0.0.1:1139/taskbar-glow/status>：返回 JSON，能看到
  `native.available`（原生库是否就绪）、`window`（找到的 DSH 窗口）、
  `foregroundIsDsh`（此刻是否在前台）、`lastFlash`（最近一次闪烁）。
- 日志：`~/.dsh/taskbar-glow/taskbar-glow.log`（超过 256KB 自动清空重写）。
  每次触发都会记一行 `flash reason=…` 或 `skip (…): …`，没闪时先看这里：
  - `skip (…): DSH is in the foreground` —— 窗口在前台，本来就不该闪；
  - `skip (…): no DSH window found` —— 没认到窗口，把 status 页面里的
    `parentPid` 和 `window` 发出来看看；
  - `native unavailable` —— koffi 没加载到（非桌面版、非 Windows 会这样）。

## 配置界面

有。打开 **设置 → 插件** → `dsh-taskbar-glow` 这个包 → 展开 `taskbar-glow` 行 →
点右侧的 **配置**，里面就是全部开关：

- 什么时候提醒：总开关、一轮跑完、工具审批、AI 提问；
- 提醒方式：窗口在前台时不打扰、闪烁持续秒数（0 = 闪到切回前台）；
- 测试：延迟秒数 + **测试闪烁** 按钮；
- 诊断：是否写日志；页面底部显示原生调用是否就绪、配置文件位置。

改一项**立即生效**，并写入 `~/.dsh/taskbar-glow/config.json`，重启后仍然有效。
界面里保存的值优先于 bundle 里的默认配置。

> 第一次装上这个页面需要**重启一次 DSH**（浏览器半区在启动时扫描插件包），
> 之后改配置、测试都不需要重启。

## 配置（直接改文件）

也可以改 `~/.dsh/profiles/desktop/cordis.patch.yml` 里 `taskbar-glow` 这条的
`config`（会被界面里保存的值覆盖）：

```yaml
- insert:
    - id: taskbar-glow
      name: dsh-taskbar-glow
      config:
        enabled: true            # 总开关
        onTurnEnd: true          # 一轮跑完时闪
        onApproval: true         # 等审批时闪
        onQuestion: true         # 等你回答时闪
        skipWhenFocused: true    # 窗口在前台时不闪
        testDelaySeconds: 5      # /flash 与测试链接的延迟
        stopAfterSeconds: 0      # 0 = 闪到窗口回到前台；也可以设成 15 之类
        log: true                # 写诊断日志
```

## 原理与限制
- 只在 **DSH 桌面版 + Windows** 下有效。Host 进程是 Electron 主进程 fork 出来的，
  所以插件用 `process.ppid` 就能定位到主窗口，再用 `FlashWindowEx`
  （`FLASHW_ALL | FLASHW_TIMERNOFG`）让系统闪任务栏按钮。
- 原生调用走桌面版运行时自带的 **koffi**（LibreOfficeKit 用的那个），
  不需要编译、不需要额外依赖；加载不到时插件安静降级，不影响 DSH。
- 闪烁是 Windows 的任务栏提示，**不是**自绘的发光动画：如果系统设置里关掉了
  「在任务栏上显示闪烁」（设置 → 个性化 → 任务栏），或者用了会吞掉闪烁的
  第三方任务栏工具，可能看不到效果。
- 同一秒内多个事件（比如「跑完」紧接着「要审批」）会合并成一次闪烁。
- 非 Windows / 非桌面版（`dsh web` 用浏览器打开）下插件正常加载但不会触发，
  `status` 页面会显示 `native.available: false`。

## 已验证

- 在 DSH 0.2.1 桌面版 + Windows 11 上实测：DSH 在后台时，任务栏图标会按约 0.5 秒
  的节奏反复亮起，直到把 DSH 切回前台；抓屏对比确认变化只落在 DSH 的图标上
  （约 57px 宽的一小块）。
- 窗口在前台时会跳过（日志记 `skip (…): DSH is in the foreground`）；
  一轮跑完触发的 `flash reason=turn-end` 已在真实会话里出现过。
- 测试链接与 `/flash` 命令都走同一条原生调用。

## 文件

```
index.js           Host：闪烁逻辑、事件、/taskbar-glow/* 接口、配置持久化
client.js          浏览器半区：插件页里的配置表单
cordis.patch.yml   bundle patch：默认配置
locale/zh.json     插件页里的标题与描述（中文）
locale/en.json     同上（英文）
icon.svg           插件页里的图标
LICENSE            MIT
```

安装后这个目录会被软链到 `~/.dsh/profiles/desktop/node_modules/dsh-taskbar-glow`。
改完 JS 需要重启 DSH；改配置（界面或 `cordis.patch.yml`）会自动重载。
