/* =============================================================
   preview.js —— 调用 pandoc 生成 HTML 并在 iframe 中预览
   ============================================================= */
(function (ns) {
  'use strict';

  let frame = null;
  let emptyTip = null;
  let debounceTimer = null;
  let requestSeq = 0;      // 请求序号：防止旧结果覆盖新结果
  let autoEnabled = true;

  /** 预览样式：贴近 Word 阅读效果的浅色排版 */
  const PREVIEW_CSS = [
    'html,body{margin:0;padding:0;background:#fff;color:#1d2129;',
    'font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif;font-size:15px;line-height:1.75;}',
    '.pandoc-body{padding:22px 26px;max-width:860px;margin:0 auto;}',
    'h1,h2,h3,h4,h5,h6{line-height:1.35;margin:1.2em 0 .5em;}',
    'h1{font-size:1.7em;border-bottom:1px solid #e5e7eb;padding-bottom:.25em;}',
    'h2{font-size:1.4em;}h3{font-size:1.2em;}',
    'p{margin:.6em 0;}a{color:#2f6feb;}',
    'code{background:#f2f4f7;padding:.15em .35em;border-radius:4px;font-family:Consolas,monospace;font-size:.9em;}',
    'pre{background:#f6f8fa;padding:12px 14px;border-radius:8px;overflow:auto;}',
    'pre code{background:none;padding:0;}',
    'blockquote{margin:.8em 0;padding:.2em 1em;border-left:4px solid #d0d7de;color:#57606a;}',
    'table{border-collapse:collapse;width:100%;margin:1em 0;font-size:.95em;}',
    'th,td{border:1px solid #d0d7de;padding:6px 10px;}',
    'th{background:#f6f8fa;}',
    'img{max-width:100%;}',
    'hr{border:0;border-top:1px solid #e5e7eb;margin:1.5em 0;}'
  ].join('');

  function $(id) { return document.getElementById(id); }

  /** 正则转义，用于把图片路径替换成 data URL */
  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function init() {
    frame = $('preview-frame');
    emptyTip = $('preview-empty');

    const auto = $('preview-auto');
    autoEnabled = auto.checked;
    auto.addEventListener('change', function () {
      autoEnabled = auto.checked;
      if (autoEnabled) schedule();
    });
    $('btn-refresh-preview').addEventListener('click', function () { render(); });
  }

  /** 输入变化时调用（防抖，避免频繁请求） */
  function schedule() {
    if (!autoEnabled || !frame) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(render, ns.CONFIG.previewDebounce);
  }

  /** 立即渲染一次预览 */
  async function render() {
    const text = ns.editor ? ns.editor.getValue() : '';
    if (!text.trim()) {
      showEmpty(true);
      return;
    }

    let payload;
    try {
      payload = ns.options.collectPayload('html');
    } catch (err) {
      showError(err.message);
      return;
    }
    payload.from = payload.from || 'markdown';
    payload.text = text;

    const seq = ++requestSeq;
    try {
      const result = await ns.client.convert(payload, 30000);
      if (seq !== requestSeq) return;   // 已经发起了更新的请求
      writeHtml(withInlineImages(result.output));
    } catch (err) {
      if (seq !== requestSeq) return;
      showError(err.message);
    }
  }

  /** 把图片引用替换为 data URL，让 iframe 能直接显示 */
  function withInlineImages(html) {
    let out = html;
    (ns.assets.images || []).forEach(function (img) {
      const pattern = new RegExp('(src=["\'])' + escapeRegExp(img.name) + '(["\'])', 'g');
      out = out.replace(pattern, '$1' + img.dataUrl + '$2');
    });
    return out;
  }

  /** 写入 iframe（sandbox 未开启脚本，安全渲染） */
  function writeHtml(bodyHtml) {
    emptyTip.hidden = true;
    frame.srcdoc = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
      '<style>' + PREVIEW_CSS + '</style></head><body class="pandoc-body">' +
      bodyHtml + '</body></html>';
  }

  /** 显示空状态 */
  function showEmpty(isEmpty) {
    emptyTip.hidden = !isEmpty;
    if (isEmpty) frame.srcdoc = '';
  }

  /** 在预览区展示错误信息 */
  function showError(message) {
    emptyTip.hidden = true;
    const safe = String(message)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    frame.srcdoc = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><style>' +
      'body{margin:0;padding:24px;font-family:"Segoe UI","Microsoft YaHei",sans-serif;color:#d64545;' +
      'background:#fdecec;}h3{margin:0 0 8px;}pre{white-space:pre-wrap;font-size:13px;line-height:1.6;}' +
      '</style></head><body><h3>预览失败</h3><pre>' + safe + '</pre></body></html>';
  }

  ns.preview = {
    init: init,
    schedule: schedule,
    render: render
  };
})(window.MD2DOCX);
