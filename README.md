<div align="center">
  <img src="docs/assets/kerminal-icon.png" width="76" alt="Kerminal logo" />
  <h1>Kerminal</h1>
  <p><strong>一个面向多机器、多终端、多文件操作的本地智能终端工作台。</strong></p>
  <p>
    <sub>Terminal · SSH · Docker · RDP · SFTP · Port Forwarding · Network Assist · Agent Run · MCP / Skills</sub>
  </p>
</div>

![Kerminal live workspace](docs/assets/kerminal-hero.png)

Kerminal 不是再造一个终端窗口。它把机器、容器、终端会话、文件传输、端口转发、系统状态、命令片段、工作流和 AI Agent 放进同一个桌面工作区，让你围绕“目标机器”完成连接、操作、观察、协作和复盘。

## 一眼看懂

| 你正在做的事 | 过去通常要打开 | 在 Kerminal 里 |
| --- | --- | --- |
| 同时看多台机器 | 终端、SSH 客户端、远程桌面、串口工具 | 左侧主机树统一管理 Local、SSH、Docker、RDP、Telnet、Serial |
| 改配置、传日志、拉产物 | SFTP 客户端、文件管理器、命令行 scp | 双栏 SFTP 工作台、服务器到服务器跨主机复制、传输队列、进度、失败和取消状态 |
| 临时打通服务或网络 | 手写 `ssh -L/-R/-D`、代理脚本、远端环境变量 | 主机级 SSH 隧道、网络助手、HTTP/SOCKS 代理注入；无外网主机可临时使用本机网络出口 |
| 排查服务器问题 | 监控面板、`top`、`df`、`nvidia-smi` | CPU、内存、磁盘、网络、进程、运行体检、GPU 摘要同屏查看 |
| 让 AI 帮忙处理终端上下文 | 复制输出到聊天窗口 | Agent 直接理解当前会话，通过 Agent Run 调工具、读结果、等待确认并继续 |

## 产品爆点

**从终端变成工作区。**
一个 tab 可以容纳分屏终端、广播命令、命令块、当前机器、右侧工具和 Agent。机器不再只是 hostname，而是带有协议、标签、认证、文件、指标、端口和操作历史的工作对象。

**Docker 是一等目标。**
容器可以像 SSH 主机一样进入侧栏，直接围绕容器打开终端、文件和系统信息。你不用在 `docker exec`、SFTP 和日志窗口之间来回跳。

**RDP 不再是另一个孤立入口。**
远程桌面目标和 Local、SSH、Docker、Telnet、Serial 一起进入主机树，连接管理、分组、标签和工作区入口都用同一套对象模型。

**命令块色条让长终端可导航。**
终端输出会按命令块形成左侧色条，当前命令行和历史命令块都能被快速定位；长日志里你可以回到某条命令的上下文，而不是只靠滚轮和肉眼找分界。

**GPU 状态不是附属信息。**
服务器信息面板能展示 GPU 名称、驱动、显存、占用和温度摘要，适合开发、推理、训练和远程排障场景。

**SSH 隧道不再只是一串参数。**
本机访问主机服务、主机访问本机服务、本机 SOCKS 出口主机、主机使用本机网络，都能在右栏用左右端点和会话列表管理。网络助手可以生成 HTTP/SOCKS 代理地址，注入当前 SSH 终端，也能让同主机后续新终端自动使用；没有外网出口的服务器也能临时借本机网络完成拉包、访问接口或下载依赖。

**服务器之间传文件不用先落本机。**
SFTP 工作台可以把两个 SSH 主机放在左右面板，做远端复制、跨主机复制和 ZIP 上传/下载；冲突预检、覆盖/跳过/改名策略、队列进度和失败状态都在同一处处理。

**AI 有边界。**
Kerminal Agent 可以读取当前工作台上下文，也可以通过工具做事。Agent Run 会把模型判断、工具调用、结构化 observation、等待确认、取消和重试上一步串成一条可见时间线；高风险工具仍受确认链路、策略和审计约束。

## 最新界面快照

以下截图来自当前运行界面采集，用来展示 Kerminal 的核心操作面。

<table>
  <tr>
    <td width="50%">
      <strong>连接管理</strong><br />
      Local、SSH、Docker、RDP、Telnet、Serial 在一个入口里配置。
      <br /><br />
      <img src="docs/assets/kerminal-connect.png" alt="Kerminal connection dialog" />
    </td>
    <td width="50%">
      <strong>Docker 目标</strong><br />
      选择已有 SSH 主机，读取容器列表，把容器加入工作区。
      <br /><br />
      <img src="docs/assets/kerminal-docker.png" alt="Kerminal Docker target dialog" />
    </td>
  </tr>
  <tr>
    <td width="50%">
      <strong>GPU 与系统状态</strong><br />
      CPU、内存、磁盘、网络、进程和 GPU 摘要围绕当前机器展示。
      <br /><br />
      <img src="docs/assets/kerminal-gpu.png" alt="Kerminal GPU and system monitor" />
    </td>
    <td width="50%">
      <strong>SFTP 传输工作台</strong><br />
      本地文件、远端目录和传输队列在同一视图里跟踪。
      <br /><br />
      <img src="docs/assets/kerminal-sftp.png" alt="Kerminal SFTP transfer workbench" />
    </td>
  </tr>
</table>

**设置与个性化。** 深色、浅色、跟随系统、界面密度、终端外观、AI 模型、MCP/Skills、SFTP 和快捷键集中调整。

![Kerminal settings](docs/assets/kerminal-settings.png)

## 能力地图

| 能力 | 用户得到什么 |
| --- | --- |
| 多协议主机 | Local、SSH、Docker/Podman 容器目标、RDP、Telnet、Serial；支持分组、标签、密码/私钥/agent、代理、跳板机和配置检查 |
| 终端工作台 | 多标签、多分屏、左右/上下布局、关闭分屏、批量发送、命令块色条导航、命令块折叠、命令块复制、搜索、右键菜单、断开重连和输出保护 |
| 智能输入 | 本地历史、远端命令、远端路径、Git ref、灰色补全提示、命令片段、变量填参和可复用 workflow |
| 文件操作 | SFTP 双栏浏览、上传下载、目录传输、远端复制、服务器到服务器跨主机复制、ZIP 上传/下载、冲突预检、`overwrite` / `skip` / `rename` 策略、传输队列、远程文本预览和远程工作区编辑 |
| 网络与隧道 | SSH local/remote/dynamic forwarding、主机网络助手、本机受管 HTTP CONNECT proxy、远端 SOCKS、无外网主机使用本机网络出口、当前终端注入、后续新终端自动注入和用户级配置脚本 |
| 机器观测 | CPU、核心占用、内存、Swap、磁盘、网络接口、进程、运行体检、诊断包、GPU 名称/驱动/显存/占用/温度 |
| 容器操作 | Docker/Podman 容器列表、容器目标入侧栏、容器终端、容器文件和容器维度系统信息 |
| AI 协作 | Kerminal Agent、Agent Run 时间线、当前终端解析、最近主机解析、受控工具调用、审批后续跑、取消/重试、AI 审计、MCP/Skills 和模型配置 |
| 本地数据 | 工作区、会话、历史、审计、主机和设置本地持久化；SSH 密码和内联私钥按主机记录保存，编辑主机时可直接查看 |
| 个性化 | 深色、浅色、跟随系统、界面密度、透明材质、背景图、终端字体和配色、快捷键、SFTP 性能、AI 与 MCP 设置 |

## 典型使用路径

1. 在左侧添加 SSH 主机、Docker 容器、Serial/Telnet 设备或 RDP 目标。
2. 打开一个工作区 tab，用分屏同时看日志、跑命令和观察另一个目标。
3. 通过 SFTP 工作台上传配置、下载日志、处理冲突，也可以在两台服务器之间直接桥接传文件。
4. 用 SSH 隧道把本机服务暴露给主机，或让无外网/内网主机通过网络助手临时使用本机网络出口。
5. 在系统面板查看 CPU、内存、磁盘、网络、进程和 GPU 状态。
6. 让 Agent 基于当前上下文提出下一步，必要时通过受控工具执行操作；确认后 Agent Run 会继续读结果和推进后续步骤。
7. 在审计和日志里回看 AI 做过什么、命令做过什么、文件传输和隧道会话发生了什么。

## 本地边界

Kerminal 是本地桌面应用，默认把工作区状态、会话、主机、文件传输、AI 审计和设置保存在本机。当前 SSH 密码和内联私钥随远程主机记录明文保存和展示，用于 SSH、SFTP、Docker 容器、端口转发、命令建议和 AI remote host 路径复用同一份认证信息。生产主机、破坏性命令、远程写操作、文件删除和外部发布仍需要通过 Kerminal 的风险确认与审计链路。

## 适合谁

- 经常同时操作本机、跳板机、云服务器、GPU 机器、容器、开发板和串口设备的人。
- 希望把终端、文件、监控、脚本和 AI 协作收进一个本地工作台的人。
- 不想让 AI 获得无限 shell 权限，但又希望它能真正参与排障和开发流程的人。

## 设计取向

Kerminal 追求的是克制、密度和可控。界面不靠大面积装饰吸引注意力，而是把高频操作留在手边：主机在左，工作区在中间，工具和 Agent 在右。复杂环境会变多，但你的上下文不该变散。

## 开源协议

Kerminal 源代码以 GNU Affero General Public License v3.0 only（AGPL-3.0-only）授权，详见 [LICENSE](LICENSE)。

Kerminal 名称、Logo、图标、截图和其它品牌资产不随 AGPL 授权，未经许可不得用于表示官方版本、官方背书或造成来源混淆；详见 [TRADEMARKS.md](TRADEMARKS.md)。
