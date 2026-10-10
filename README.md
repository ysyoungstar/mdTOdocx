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
- Python 3：用于页面静态服务与**反向转换桥接服务**（`convert-server.py`）
  - 未安装时：页面仍可打开（脚本会改用 `file://` 直接打开），但 **Word / HTML → Markdown 不可用**
- 现代浏览器（Edge / Chrome / Firefox 均可）

## 三、快速开始

1. 双击 `start-server.bat`
   - 它会启动 `pandoc server`（端口 3030）、页面静态服务（端口 8080）与反向转换桥接（端口 3040），并自动打开浏览器
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
├─ start-server.bat      启动服务并打开页面
├─ stop-server.bat       停止服务
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

## 八、已知限制

- `pandoc server` 运行在 PandocPure 沙箱中：**不能导出 PDF、不支持 Lua/自定义滤镜、不能读取本地磁盘路径**，因此模板与图片都通过 base64 走 `files` 字段
- 反向转换（Word / HTML → Markdown）走本机桥接 `convert-server.py`，它调用本机 pandoc 命令行，因此**必须安装 Python 3**；该服务只监听 `127.0.0.1:3040`，不接受外部访问
- 桥接目前只接受 `docx` 与 `html` 两种输入，输出格式限定在 markdown 家族，选项全部经过白名单校验
- 文档里的宏、脚本与域代码都不会被执行：pandoc 只读取文本与图片内容
- 页面本身不执行任何文档中的脚本：预览使用 `sandbox` 的 iframe 渲染
- 实时预览与转换都依赖本机 pandoc 服务：服务停止时预览区会显示“无法连接 Pandoc 服务”，重新运行 start-server.bat 即可恢复。
- 转换在本机完成，文档内容不会上传到外部服务器
