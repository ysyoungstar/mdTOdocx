# mdTOdocx —— 双向文档转换工具（Word / HTML ⇄ Markdown）

一个纯前端的可视化页面，调用**本机安装的 Pandoc**在 Markdown 与 Word / HTML 之间双向转换：

- **Markdown → Word**：实时预览、模板、目录、图片、批量选项
- **Word / HTML → Markdown**：读入 `.docx` 或 `.html`，输出 Markdown，并把文档里的图片导出到本地文件夹

## 一、功能概览

### 1. Markdown → Word（默认方向）

- 拖拽或选择 `.md` 文件载入，也可直接粘贴；多个文件会按顺序合并
- 右侧实时预览（Pandoc 渲染 HTML，输入停止 0.5 秒后自动刷新）
- 转换选项面板：文档标题/副标题/作者/日期、目录与目录深度、章节编号、标题层级偏移、输入格式、代码高亮样式、图片默认扩展名、每行宽度
- 模板支持：选择自定义 `reference.docx` 控制字体、页边距与样式
- 图片支持：添加本地图片后，点击图片名即可把引用插入正文，转换时图片随请求一起发送
- 一键下载 docx，并显示 Pandoc 的警告/信息、转换耗时、体积与历史记录

### 2. Word / HTML → Markdown（顶栏切到“Word/HTML → MD”）

- 拖拽或选择 `.docx` / `.html` 文件，也可以直接粘贴 HTML 源码
- 生成的 Markdown 可直接编辑、复制或下载为 `.md`
- **图片导出**：docx 内嵌图片会被提取到输出目录的 `media/`，可在页面预览、单张下载，或一键打包成 zip
- 可配置输出风格（markdown / gfm / commonmark / markdown_strict）、换行方式、标题风格，以及 docx 专用的“修订标记处理”“去掉批注”
- 结果可一键渲染预览（用 Pandoc 把生成的 Markdown 渲染成 HTML）

### 3. 通用

- 深色/浅色主题、可拖拽分栏、快捷键（Ctrl+Enter 或 Ctrl+S 转换，Ctrl+O 打开文件）

## 二、环境要求

- Windows 系统，已安装 Pandoc 3.x（`pandoc --version` 可正常输出；需带 `+server` 特性，官方发行版自带）
  - 没有安装或版本不合适？双击 **`setup-pandoc.bat`** 会自动检查并安装到合适版本（见 §九）
- Python 3：用于页面静态服务与**反向转换桥接服务**（`convert-server.py`）
  - 未安装时：页面仍可打开（脚本会改用 `file://` 直接打开），但 **Word / HTML → Markdown 不可用**
- 现代浏览器（Edge / Chrome / Firefox 均可）

## 三、快速开始

0. （可选）双击 `setup-pandoc.bat`：检查 Pandoc 环境，缺失时自动安装
   - `start-server.bat` 检测不到 pandoc 时也会自动执行同样的流程
1. 双击 `start-server.bat`
   - 它会启动 `pandoc server`（端口 3030）、页面静态服务 `serve-pages.py`（端口 8080，响应不带缓存，前端改动刷新即生效）与反向转换桥接（端口 3040），并自动打开浏览器
   - 若浏览器未自动打开，请手动访问 `http://127.0.0.1:8080/`
   - 若自动打开浏览器不可用，请关闭后手动打开index.html文件
2. 在页面里载入或粘贴 Markdown
3. 按需调整右侧选项
4. 点击“转换为 DOCX”，浏览器会下载生成的 Word 文件
5. 结束后可双击 `stop-server.bat` 停止服务

> 说明：页面右上角的状态灯显示 Pandoc 服务是否可用；点击它可以重新检测。

## 四、界面说明

- 左栏：Markdown 源文件编辑区，底部显示字符数、行数与文件来源
- 中栏：实时预览（“自动”开关可关闭自动刷新，改用手动“刷新”按钮）；右下角状态条会显示“预览更新中”“预览已更新 · 时间 · 耗时”，失败时显示红色错误提示
- 顶栏的 `MD → Word / Word/HTML → MD` 用于切换转换方向：
  - `MD → Word`（默认）：左栏 Markdown，中栏实时预览，右栏是 Word 相关选项
  - `Word/HTML → MD`：左栏是源文件（DOCX / HTML），中栏是结果 Markdown（可切换“文本 / 预览”），下方是导出的图片列表
- 右栏三个标签页：
  - 转换选项：当前方向对应的 Pandoc 参数
  - 模板与图片：选择 `reference.docx` 模板、添加图片资源（仅 `MD → Word` 方向）
  - 日志与历史：本次转换消息、历史记录、错误详情

## 五、目录结构

```
mdTOdocx/
├─ index.html            页面结构
├─ css/
│  ├─ base.css           变量与主题
│  ├─ layout.css         分栏布局与响应式
│  └─ components.css     按钮、表单、列表等组件样式
├─ convert-server.py     反向转换桥接服务（调用本机 pandoc，导出图片）
├─ output/               反向转换的输出目录（每次转换一个子目录）
├─ js/
│  ├─ config.js          全局配置与选项元数据
│  ├─ pandoc-client.js   与 pandoc server 通信（/version、转换、下载）
│  ├─ bridge-client.js   与反向转换桥接通信（/convert）
│  ├─ options.js         选项表单渲染与模板/图片资源管理
│  ├─ preview.js         HTML 预览渲染
│  ├─ editor.js          Markdown 输入区交互
│  ├─ reverse.js         反向转换模块（Word / HTML → Markdown）
│  ├─ history.js         历史记录持久化
│  └─ app.js             入口：状态检测、模式切换、转换流程、日志
├─ assets/sample.md      示例文档
├─ setup-pandoc.bat      环境自检入口（双击：检查 / 自动安装 Pandoc）
├─ setup-pandoc.ps1      Pandoc 检测与安装逻辑（winget 优先，GitHub zip 兜底）
├─ start-server.bat      启动服务并打开页面（缺 pandoc 时自动调用 setup-pandoc.bat）
├─ stop-server.bat       停止服务
├─ LICENSE               许可证（MIT，版权归 ysyoungstar）
└─ README.md             本说明
```

## 六、高级用法

“转换选项 → 高级 → 额外请求字段”可以直接填写 JSON，字段会合并进 Pandoc 请求体。例如：

```
{"wrap":"none","resource-path":["."]}
```

模板与图片必须放在 `files` 字段中，页面已自动处理：模板固定使用 `reference.docx` 这个路径名，图片使用你选择的原始文件名，因此正文里可以写 `![](图片名.png)`。

反向转换（`Word/HTML → MD`）走本机桥接服务 `convert-server.py`，等价于下面的命令行：

```
pandoc input.docx -f docx -t markdown -o output.md --extract-media=.
```

因此输出目录结构与命令行完全一致：

```
output/<原文件名>-<时间戳>/
├─ input.docx     源文件副本（便于复现）
├─ output.md      转换结果（图片引用写作 ./media/xxx.png）
└─ media/         从文档中提取出来的图片
```

“额外命令行参数”会原样追加给 pandoc，例如填 `--reference-links` 可让链接改成引用式写法（出于安全，`-o`、`--output`、`--extract-media` 会被忽略）。

## 七、常见问题

**1. 状态灯显示“服务未启动”**
请确认 `start-server.bat` 窗口中的 `pandoc-server` 子窗口仍在运行，或手动执行：

```
pandoc server -p 3030 -t 60
```

**2. 端口被占用**
修改 `start-server.bat` 顶部的 `PANDOC_PORT`（默认 3030）与 `WEB_PORT`（默认 8080），并同步修改 `js/config.js` 中的 `serverBase`。

**3. 大文档转换超时**
脚本已把 Pandoc 超时设为 60 秒，可在 `start-server.bat` 中把 `PANDOC_TIMEOUT` 调得更大。

**4. 图片在 Word 里没显示**
请确认正文中的文件名与“模板与图片”列表中显示的完全一致（点击列表项会自动插入正确的引用）。

**5. 勾选了“生成目录”，打开 Word 却是空目录**
Pandoc 写入的是 Word 的目录域（TOC field），需要 Word 计算后才会显示条目。请在目录处右键选择“更新域”，或按 `Ctrl+A` 后按 `F9` 更新全部域，目录条目就会显示出来。

**6. 启动后访问 `http://127.0.0.1:3030` 显示 404**
这是正常现象：3030 是 Pandoc 转换服务，其根路径只接受 POST 请求，仅供页面内部调用，不能用浏览器直接打开。请访问页面地址 `http://127.0.0.1:8080/`。

**7. 用 `localhost` 打不开页面，提示连接被拒绝**
服务只监听 IPv4 回环地址 `127.0.0.1`。部分系统上 `localhost` 会优先解析到 IPv6 的 `::1` 从而连不上，请改用 `http://127.0.0.1:8080/`。

**8. 反向转换提示“无法连接桥接服务”**
说明 3040 端口的桥接服务没有运行。请重新运行 `start-server.bat`，确认 `md2docx-bridge` 窗口存在；也可以在项目目录手动执行 `python convert-server.py --port 3040`。

**9. 导出的图片在哪里？**
每次转换都会在 `output/` 下新建一个 `<原文件名>-<时间戳>/` 目录，图片位于其中的 `media/` 子目录，页面底部会显示完整路径（可点“复制输出路径”）。也可以直接在页面里预览、单张下载，或点“下载图片包 (zip)”。

**10. 大文件转换很慢或失败**
docx 需要先转成 base64 再传给桥接服务，请求体大约增大约三分之一。页面默认限制 30 MB（可在 `js/config.js` 的 `maxUploadMB` 调整），桥接的单次转换超时默认 180 秒（可在 `start-server.bat` 的 `BRIDGE_TIMEOUT` 调整）。超大文档建议直接用命令行 pandoc。

**11. 点“复制”提示剪贴板不可用**
自动复制依赖安全上下文，请使用 `http://127.0.0.1:8080/` 打开页面（而不是 `file://`）。此时点“复制”会自动选中全部文本，按 Ctrl+C 即可。

**12. 改了前端文件（JS/CSS）后页面没变化、按钮点了没反应**
页面静态服务已由 `serve-pages.py` 提供，它对所有响应发送 `Cache-Control: no-store`，正常情况下刷新即生效。若仍看到旧行为，按顺序检查：

- 确认本次是通过 `start-server.bat` 启动的服务（若之前用过 `python -m http.server`，请先跑一次 `stop-server.bat` 再重启）
- 按 `Ctrl+Shift+R` 强刷；仍无效则在 F12 → Network 勾选 `Disable cache` 后刷新
- 仍无效可递增 `index.html` 中 `css/*.css?v=3`、`js/*.js?v=3` 的版本号，用于绕过中间层缓存

**13. 顶栏的模式按钮点了没反应，或两个按钮都不高亮**
这是浏览器仍在使用旧版 `js/app.js` 的典型表现（旧代码读取的属性名与新页面不一致），按上一条处理缓存即可恢复。

**14. 提示 pandoc 未安装，或版本不合适**
双击 `setup-pandoc.bat` 即可自动检查并按需安装（`start-server.bat` 检测不到时也会自动调用）。只想先看看会做什么，可加 `-DryRun`，它不做任何修改：

```
setup-pandoc.bat -DryRun
```

**15. 公司网络受限，winget 装不上 Pandoc**
改用官方 zip 方式（解压到用户目录，不需要管理员权限）：

```
setup-pandoc.bat -Method zip
```

也可以手动安装：`winget install -e --id JohnMacFarlane.Pandoc`，或到 https://pandoc.org/installing.html 下载官方 MSI。


## 八、已知限制

- `pandoc server` 运行在 PandocPure 沙箱中：**不能导出 PDF、不支持 Lua/自定义滤镜、不能读取本地磁盘路径**，因此模板与图片都通过 base64 走 `files` 字段
- 反向转换（Word / HTML → Markdown）走本机桥接 `convert-server.py`，它调用本机 pandoc 命令行，因此**必须安装 Python 3**；该服务只监听 `127.0.0.1:3040`，不接受外部访问
- 桥接目前只接受 `docx` 与 `html` 两种输入，输出格式限定在 markdown 家族，选项全部经过白名单校验
- 文档里的宏、脚本与域代码都不会被执行：pandoc 只读取文本与图片内容
- 页面本身不执行任何文档中的脚本：预览使用 `sandbox` 的 iframe 渲染
- 实时预览与转换都依赖本机 pandoc 服务：服务停止时预览区会显示“无法连接 Pandoc 服务”，重新运行 start-server.bat 即可恢复。
- 转换在本机完成，文档内容不会上传到外部服务器

## 九、环境自检与自动安装 Pandoc

项目自带两个脚本，把“装 Pandoc”这一步自动化：

- **`setup-pandoc.bat`**：双击即用，检查本机 Pandoc 是否满足要求，不满足就自动安装
- **`setup-pandoc.ps1`**：实际逻辑（由 bat 调用，也可直接用 PowerShell 运行）

判定标准（三项都满足才算“就绪”）：

1. 能找到 `pandoc.exe`（PATH 或常见安装目录）
2. 版本 ≥ `-MinVersion`（默认 3.0）
3. 带 `+server` 特性，且 `pandoc server --help` 可以执行

安装方式（自动选择）：

- 优先使用 **winget**：`winget install -e --id JohnMacFarlane.Pandoc --silent`
- winget 不可用或失败时**回退**为：从 GitHub 官方 Release 下载 `pandoc-<版本>-windows-x86_64.zip`，解压到 `%LOCALAPPDATA%\Pandoc`，并把该目录幂等追加到**用户 PATH**（不需要管理员权限，也不改动系统 PATH）

常用参数：

```
setup-pandoc.bat                            检查，需要时安装
setup-pandoc.bat -DryRun                    只检查并打印将要执行的操作，不做任何修改
setup-pandoc.bat -MinVersion 3.1            提高最低版本要求
setup-pandoc.bat -RequiredVersion 3.12.1    指定精确版本
setup-pandoc.bat -Method zip                强制使用 GitHub zip 方式
setup-pandoc.bat -Force                     即使当前可用也重装为最新版
```

退出码：`0` 表示 Pandoc 已就绪，`1` 表示失败（窗口会保留错误信息）。
`start-server.bat` 在检测不到 pandoc 时，会自动执行等价于 `setup-pandoc.bat -MinVersion 3.0` 的流程，刷新当前会话的 PATH 后再继续启动。

## 十、许可证

本项目采用 **MIT 许可证**，完整文本见根目录 `LICENSE`。

- **版权（Copyright）归 ysyoungstar 所有**，作者保留全部权利
- 任何人都可以**免费使用、复制、修改、合并、发布、再分发、再授权，包括商业用途**
- 唯一的义务：在软件的所有副本或实质性部分中**保留 `LICENSE` 中的版权声明与许可声明**
- 软件按“现状（AS IS）”提供，不附带任何明示或暗示的担保

第三方组件说明：

- **Pandoc**（https://pandoc.org）采用 GPL-2.0-or-later。本项目只在运行时通过命令行调用本机已安装的 Pandoc，既不修改也不打包分发其源码或二进制，因此本仓库可按 MIT 授权；若你自行分发 Pandoc 安装包，需单独遵守其 GPL 条款
- **Python 标准库**用于 `serve-pages.py` 与 `convert-server.py`，采用 PSF 许可证
