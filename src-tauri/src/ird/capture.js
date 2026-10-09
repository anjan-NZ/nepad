(() => {
  if (window.__irdCap) return;
  window.__irdCap = true;
  const save = async () => {
    if (!/CommonReportViewer/i.test(location.pathname)) return;
    try {
      const r = await fetch(location.href, { credentials: "include" });
      const blob = await r.blob();
      if (blob.size < 200) return;
      const head = await blob.slice(0, 5).text();
      if (head !== "%PDF-") return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = (window.__irdName || (/^TDS_/.test(window.name) ? window.name : "") || "IRD_report_" + Date.now()) + ".pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {}
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", save);
  else save();
})();
