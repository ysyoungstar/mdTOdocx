/* =============================================================
   pandoc-client.js —— 与本机 pandoc server 通信的封装
   接口参考：doc/pandoc-server.md（POST / 与 GET /version）
   ============================================================= */
(function (ns) {
  'use strict';

  /** 拼接完整的服务地址 */
  function endpoint(path) {
    return ns.CONFIG.serverBase.replace(/\/+$/, '') + path;
  }

  /** 把任意错误统一成带原始信息的 Error */
  function buildError(message) {
    const err = new Error(message);
    err.isPandocError = true;
    return err;
  }

  /**
   * 探测服务是否可用
   * @returns {Promise<string>} 版本号字符串
   */
  async function checkVersion(timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || 2500);
    try {
      const res = await fetch(endpoint('/version'), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: ctrl.signal
      });
      if (!res.ok) throw buildError('服务返回 HTTP ' + res.status);
      const text = await res.text();
      // JSON 响应形如 "3.12.1"，也可能是纯文本
      try { return String(JSON.parse(text)); } catch (e) { return text.trim(); }
    } catch (err) {
      if (err && err.name === 'AbortError') throw buildError('检测超时');
      if (err instanceof TypeError) throw buildError('未检测到 Pandoc 服务');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 执行一次转换
   * @param {Object} payload 请求体，至少包含 text / from / to
   * @param {number} [timeoutMs] 前端超时（默认 120 秒）
   * @returns {Promise<{output:string, base64:boolean, messages:Array}>}
   */
  async function convert(payload, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || 120000);
    try {
      const res = await fetch(endpoint('/'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Accept: 'application/json'
        },
        body: JSON.stringify(payload),
        signal: ctrl.signal
      });
      const raw = await res.text();
      let data = null;
      try { data = JSON.parse(raw); } catch (e) { data = null; }

      // 服务端转换失败时会返回 { error: "..." }
      if (data && data.error) throw buildError(String(data.error));
      if (!data || typeof data.output !== 'string') {
        throw buildError('无法解析服务响应（HTTP ' + res.status + '）' +
          (raw ? '：' + raw.slice(0, 300) : ''));
      }
      return {
        output: data.output,
        base64: !!data.base64,
        messages: Array.isArray(data.messages) ? data.messages : []
      };
    } catch (err) {
      if (err && err.name === 'AbortError') throw buildError('请求超时：文档过大或服务繁忙');
      if (err instanceof TypeError) throw buildError('无法连接 Pandoc 服务，请先运行 start-server.bat');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /** base64 字符串 → Blob（用于下载 docx） */
  function base64ToBlob(b64, mime) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime || 'application/octet-stream' });
  }

  /** ArrayBuffer → base64（用于上传图片与 reference.docx） */
  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000; // 分块避免参数过多
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  /** 以 Blob 触发下载 */
  function downloadBlob(blob, filename) {
    const link = document.createElement('a');
    const href = URL.createObjectURL(blob);
    link.href = href;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // 释放对象 URL，避免内存泄漏
    setTimeout(function () { URL.revokeObjectURL(href); }, 4000);
  }

  /** 人类可读的体积 */
  function formatBytes(size) {
    if (!size) return '0 B';
    if (size < 1024) return size + ' B';
    if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
    return (size / 1024 / 1024).toFixed(2) + ' MB';
  }

  ns.client = {
    checkVersion: checkVersion,
    convert: convert,
    base64ToBlob: base64ToBlob,
    arrayBufferToBase64: arrayBufferToBase64,
    downloadBlob: downloadBlob,
    formatBytes: formatBytes
  };
})(window.MD2DOCX);
