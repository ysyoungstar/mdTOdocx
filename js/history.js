/* =============================================================
   history.js —— 转换历史记录（localStorage 持久化）
   ============================================================= */
(function (ns) {
  'use strict';

  const KEY = ns.CONFIG.historyKey;

  /** 读取历史列表（失败时返回空数组） */
  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  /** 覆盖写入历史列表（自动截断到上限） */
  function save(list) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list.slice(0, ns.CONFIG.maxHistory)));
    } catch (e) {
      /* localStorage 不可用时静默失败 */
    }
  }

  /** 追加一条历史，返回最新列表 */
  function add(entry) {
    const list = read();
    list.unshift(entry);
    save(list);
    return read();
  }

  /** 清空历史 */
  function clear() {
    save([]);
    return [];
  }

  /** 时间戳 → 简短可读文本 */
  function formatTime(ts) {
    const d = new Date(ts);
    const pad = function (n) { return String(n).padStart(2, '0'); };
    return (d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
      pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  ns.history = {
    read: read,
    add: add,
    clear: clear,
    formatTime: formatTime
  };
})(window.MD2DOCX);
