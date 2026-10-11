/* =============================================================
   preview.js —— 调用 pandoc 把 Markdown 渲染成 HTML 并显示在 iframe 中
   ============================================================= */
(function (ns) {
  'use strict';

  let frame = null;
  let emptyTip = null;
  let statusEl = null;
  let debounceTimer = null;
  let requestSeq = 0;      // 请求序号：防止旧结果覆盖新结果
  let autoEnabled = true;

  /**
   * 预览配色表：与页面主题（base.css 的 data-theme）保持一致，
   * 让 iframe 里的渲染效果跟随浅色 / 深色主题。
   */
  const PREVIEW_THEME = {
    light: {
      bg: '#ffffff', fg: '#1d2129', border: '#e5e7eb', borderStrong: '#d0d7de',
      codeBg: '#f2f4f7', preBg: '#f6f8fa', quoteFg: '#57606a', link: '#2f6feb',
      thBg: '#f6f8fa', errBg: '#fdecec', errFg: '#d64545'
    },
    dark: {
      bg: '#1b1f24', fg: '#e6e9ef', border: '#333a44', borderStrong: '#3d4550',
      codeBg: '#262c34', preBg: '#20262e', quoteFg: '#9aa4b2', link: '#7aa5ff',
      thBg: '#242a33', errBg: '#3a2222', errFg: '#f07171'
    }
  };

  /** 当前页面主题名：'light' 或 'dark' */
  function currentThemeName() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  /** 依据主题生成预览 CSS（占位符拼装，避免维护两份重复选择器） */
  function buildPreviewCss(themeName) {
    const t = PREVIEW_THEME[themeName === 'dark' ? 'dark' : 'light'];
    return [
      'html,body{margin:0;padding:0;background:' + t.bg + ';color:' + t.fg + ';',
      'font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif;font-size:15px;line-height:1.75;}',
      '.pandoc-body{padding:22px 26px 46px;max-width:860px;margin:0 auto;}',
      'h1,h2,h3,h4,h5,h6{line-height:1.35;margin:1.2em 0 .5em;}',
      'h1{font-size:1.7em;border-bottom:1px solid ' + t.border + ';padding-bottom:.25em;}',
      'h2{font-size:1.4em;}h3{font-size:1.2em;}',
      'p{margin:.6em 0;}a{color:' + t.link + ';}',
      'code{background:' + t.codeBg + ';padding:.15em .35em;border-radius:4px;' +
        'font-family:Consolas,monospace;font-size:.9em;}',
      'pre{background:' + t.preBg + ';padding:12px 14px;border-radius:8px;overflow:auto;}',
      'pre code{background:none;padding:0;}',
      'blockquote{margin:.8em 0;padding:.2em 1em;border-left:4px solid ' +
        t.borderStrong + ';color:' + t.quoteFg + ';}',
      'table{border-collapse:collapse;width:100%;margin:1em 0;font-size:.95em;}',
      'th,td{border:1px solid ' + t.borderStrong + ';padding:6px 10px;}',
      'th{background:' + t.thBg + ';}',
      'img{max-width:100%;}',
      'hr{border:0;border-top:1px solid ' + t.border + ';margin:1.5em 0;}',
      '#TOC{margin:1em 0;padding:.4em 1em;border:1px dashed ' + t.borderStrong + ';border-radius:8px;}',
      '#TOC ul{margin:.3em 0;}'
    ].join('');
  }

  /** 当前主题对应的预览 CSS 文本 */
  function currentCss() {
    return buildPreviewCss(currentThemeName());
  }

  function $(id) { return document.getElementById(id); }

  /** 正则转义，用于把图片路径替换成 data URL */
  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /** 更新右下角状态提示 */
  function setStatus(text, kind) {
    if (!statusEl) return;
    statusEl.textContent = text;
    if (kind) statusEl.dataset.kind = kind;
    else statusEl.removeAttribute('data-kind');
  }

  /** 当前时间 HH:MM:SS */
  function clockText() {
    const d = new Date();
    const pad = function (n) { return String(n).padStart(2, '0'); };
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  function init() {
    frame = $('preview-frame');
    emptyTip = $('preview-empty');
    statusEl = $('preview-status');

    const auto = $('preview-auto');
    autoEnabled = auto.checked;
    auto.addEventListener('change', function () {
      autoEnabled = auto.checked;
      if (autoEnabled) {
        setStatus('自动预览已开启，正在更新…');
        schedule();
      } else {
        setStatus('自动预览已关闭，可点“刷新”手动更新');
      }
    });

    $('btn-refresh-preview').addEventListener('click', function () { render(); });
  }

  /** 输入变化时调用（防抖，避免频繁请求） */
  function schedule() {
    if (!autoEnabled || !frame) return;
    clearTimeout(debounceTimer);
    setStatus('输入已变化，准备预览…');
    debounceTimer = setTimeout(render, ns.CONFIG.previewDebounce);
  }

  /** 立即渲染一次预览 */
  async function render() {
    const text = ns.editor ? ns.editor.getValue() : '';
    if (!text.trim()) {
      showEmpty(true);
      setStatus('等待输入内容');
      return;
    }

    let payload;
    try {
      payload = ns.options.collectPayload('html');
    } catch (err) {
      showError(err.message);
      setStatus('预览失败：' + err.message, 'error');
      return;
    }
    payload.from = payload.from || 'markdown';
    payload.text = text;
    // standalone 模式才会生成目录（#TOC）与完整文档结构
    payload.standalone = true;

    // HTML 预览不需要 Word 模板，去掉可减小请求体；图片必须保留，否则会被替换成文字
    delete payload['reference-doc'];
    if (payload.files) {
      delete payload.files['reference.docx'];
      if (!Object.keys(payload.files).length) delete payload.files;
    }

    const seq = ++requestSeq;
    const started = performance.now();
    setStatus('预览更新中…');

    try {
      const result = await ns.client.convert(payload, 30000);
      if (seq !== requestSeq) return;   // 已有更新的请求，丢弃本次结果
      const parts = splitStandalone(result.output);
      writeHtml(withInlineImages(parts.body), parts.styles);
      setStatus('预览已更新 · ' + clockText() + ' · ' +
        Math.round(performance.now() - started) + ' ms', 'ok');
    } catch (err) {
      if (seq !== requestSeq) return;
      showError(err.message);
      setStatus('预览失败：' + String(err.message).split('\n')[0], 'error');
    }
  }

  /** 从 standalone HTML 中拆出 head 样式与 body 内容（解析失败时原样返回） */
  function splitStandalone(html) {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const styles = Array.prototype.map.call(
        doc.querySelectorAll('head style'),
        function (node) { return node.outerHTML; }
      ).join('');
      const body = doc.body ? doc.body.innerHTML : html;
      return { styles: styles, body: body };
    } catch (e) {
      return { styles: '', body: html };
    }
  }

    /** 把图片引用替换为 data URL，让 iframe 能直接显示 */
  function withInlineImages(html) {
    let out = html;

    // pandoc 输出会把中文、空格等字符写成百分号编码的 src，这里先解码，便于与图片原名比对
    out = out.replace(/(<img[^>]*\ssrc=")([^"]*)(")/gi, function (whole, head, src, tail) {
      try { return head + decodeURIComponent(src) + tail; } catch (e) { return whole; }
    });

    // 兼容 src="./名字" 这类带相对目录前缀的写法
    out = out.replace(/(<img[^>]*\ssrc=")\.\//gi, '$1');
    (ns.assets.images || []).forEach(function (img) {
      const pattern = new RegExp('(src=["\'])' + escapeRegExp(img.name) + '(["\'])', 'g');
      out = out.replace(pattern, '$1' + img.dataUrl + '$2');
    });
    return out;
  }

  /** 写入 iframe（sandbox 未开启脚本，安全渲染） */
  function writeHtml(bodyHtml, extraStyles) {
    if (emptyTip) emptyTip.hidden = true;
    frame.srcdoc = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
      (extraStyles || '') +
      '<style>' + currentCss() + '</style></head><body class="pandoc-body">' +
      bodyHtml + '</body></html>';
  }

  /** 显示 / 隐藏空状态 */
  function showEmpty(isEmpty) {
    if (emptyTip) emptyTip.hidden = !isEmpty;
    if (isEmpty && frame) frame.srcdoc = '';
  }

  /** 在预览区展示错误信息（配色跟随当前主题） */
  function showError(message) {
    if (emptyTip) emptyTip.hidden = true;
    const t = PREVIEW_THEME[currentThemeName()];
    const safe = String(message)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    frame.srcdoc = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><style>' +
      'body{margin:0;padding:24px;font-family:"Segoe UI","Microsoft YaHei",sans-serif;color:' +
      t.errFg + ';background:' + t.errBg + ';}h3{margin:0 0 8px;}' +
      'pre{white-space:pre-wrap;font-size:13px;line-height:1.6;}' +
      '</style></head><body><h3>预览失败</h3><pre>' + safe + '</pre></body></html>';
  }

  /** 主题切换后重绘预览（仅在已有渲染内容时重绘） */
  function refreshTheme() {
    if (!frame || !frame.srcdoc) return;
    render();
  }

  ns.preview = {
    init: init,
    schedule: schedule,
    render: render,
    refreshTheme: refreshTheme,
    // 供反向转换面板复用同一套预览样式，保证观感一致
    currentCss: currentCss
  };
})(window.MD2DOCX);