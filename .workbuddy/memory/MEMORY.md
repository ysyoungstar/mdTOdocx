# mdTOdocx — 项目长期备忘

## 架构
纯前端页面 + 三个本机服务（全部只监听 IPv4 回环）：
- `pandoc server` :3030 —— Markdown ⇄ DOCX/HTML 转换（PandocPure 沙箱，不能读本地磁盘）
- `serve-pages.py` :8080 —— 静态页面服务，强制 `Cache-Control: no-store`
- `convert-server.py` :3040 —— 反向转换桥接（调用本机 pandoc 命令行，可写盘导出图片）

启动/停止：`start-server.bat` / `stop-server.bat`。
前端模块（无构建，按顺序挂到 `window.MD2DOCX`）：
config → pandoc-client → bridge-client → history → options → preview → editor → reverse → app。

## 约定
- **改动前端文件后递增缓存号**：`index.html` 中 `css/*.css?v=N`、`js/*.js?v=N` 的 N 要 +1（当前 v=4）。
- 转换方向状态在 `body[data-mode]`；面板用 `data-pane-mode` 标记归属；
  模式切换按钮只能用 `data-target`，**绝不能加 `data-pane-mode`**（否则按钮会把自己隐藏）。
- 样式类：常规选项组的 hint 用 `field-hint`，反向表单用 `hint`。

## 踩坑记录
- **pandoc server 的 POST 响应格式取决于 `Accept` 头**：带 `Accept: application/json` 才返回
  `{output, base64, messages}`；不带则该头会直接返回转换结果的原始二进制。
  手写 curl / urllib 测试时务必带上，否则会误判成「服务坏了」。
- `<option>` 的 `value=''`（如「图片默认扩展名 → 自动」）是合法默认值，`createField` 里
  `control.value = field.default || ''` 对 select 是对的，不要误改。

## 测试方式
项目没有自动化测试。已验证可用的做法：
用本机 Chrome（`--headless=new --remote-debugging-port=NNNN`）+ **Node 22 自带的全局 `WebSocket`**
直连 CDP，无需安装 Playwright / agent-browser：
- `Runtime.evaluate` 执行 `element.click()` 驱动按钮
- `DOM.setFileInputFiles` 给 `<input type=file>` 塞真实文件
- `Browser.setDownloadBehavior` 指定下载目录，验证真实产出文件
- 监听 `Runtime.exceptionThrown` / `Runtime.consoleAPICalled` 抓 JS 报错
