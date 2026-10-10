/* =============================================================
   bridge-client.js —— 与本机桥接服务（convert-server.py）通信
   用途：HTML / DOCX → Markdown，并把 docx 内嵌图片导出到本地
   接口：GET /version、POST /convert
   ============================================================= */
(function (ns) {
  'use strict';

  /** 拼接完整的桥接服务地址 */
  function endpoint(path) {
    return ns.CONFIG.bridgeBase.replace(/\/+$/, '') + path;
  }

  /** 统一错误对象 */
  function buildError(message) {
    const err = new Error(message);
    err.isBridgeError = true;
    return err;
  }

  /**
   * 探测桥接服务是否可用
   * @param {number} [timeoutMs]
   * @returns {Promise<{bridge:string, pandoc:string}>}
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
      if (!res.ok) throw buildError('桥接服务返回 HTTP ' + res.status);
      const data = await res.json();
      return { bridge: String(data.bridge || ''), pandoc: String(data.pandoc || '') };
    } catch (err) {
      if (err && err.name === 'AbortError') throw buildError('桥接服务检测超时');
      if (err instanceof TypeError) throw buildError('未检测到桥接服务');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 执行一次反向转换
   * @param {{source:string, data:string, filename?:string, to?:string, options?:Object}} payload
   *        source 为 docx 时 data 是 base64；为 html 时 data 是源码文本
   * @param {number} [timeoutMs] 前端超时（默认 300 秒，docx 解析较慢）
   * @returns {Promise<{output:string, mediaFiles:Array, zipBase64:string, outDir:string, messages:Array, ms:number}>}
   */
  async function convert(payload, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || 300000);
    try {
      const res = await fetch(endpoint('/convert'), {
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

      if (!data) {
        throw buildError('无法解析桥接服务响应（HTTP ' + res.status + '）' +
          (raw ? '：' + raw.slice(0, 200) : ''));
      }
      // 服务端业务错误统一返回 { ok:false, error }
      if (data.ok === false || data.error) throw buildError(String(data.error || '转换失败'));
      if (typeof data.output !== 'string') throw buildError('桥接服务未返回转换结果');

      return {
        output: data.output,
        mediaFiles: Array.isArray(data.mediaFiles) ? data.mediaFiles : [],
        zipBase64: typeof data.zipBase64 === 'string' ? data.zipBase64 : '',
        outDir: String(data.outDir || ''),
        messages: Array.isArray(data.messages) ? data.messages : [],
        ms: Number(data.ms) || 0
      };
    } catch (err) {
      if (err && err.name === 'AbortError') throw buildError('请求超时：文档过大或转换耗时过长');
      if (err instanceof TypeError) throw buildError('无法连接桥接服务，请先运行 start-server.bat');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 读取本地文件为 base64（docx 等二进制文件用） */
  function readFileAsBase64(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        try { resolve(ns.client.arrayBufferToBase64(reader.result)); }
        catch (e) { reject(new Error('文件编码失败：' + file.name)); }
      };
      reader.onerror = function () { reject(new Error('读取失败：' + file.name)); };
      reader.readAsArrayBuffer(file);
    });
  }

  /** 下载由服务端打包好的 zip（图片合集） */
  function downloadZip(base64, filename) {
    ns.client.downloadBlob(ns.client.base64ToBlob(base64, 'application/zip'), filename);
  }

  ns.bridge = {
    checkVersion: checkVersion,
    convert: convert,
    readFileAsBase64: readFileAsBase64,
    downloadZip: downloadZip
  };
})(window.MD2DOCX);
