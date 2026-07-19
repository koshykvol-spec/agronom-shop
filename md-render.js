// Мінімальний Markdown рендер для сторінок товарів
window.mdRender = function(md, elId) {
  var el = document.getElementById(elId);
  if (!el || !md) return;
  function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function inl(t) {
    return esc(t)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>');
  }
  var lines = md.split(/\r?\n/);
  var html = '', i = 0;
  while (i < lines.length) {
    var raw = lines[i];
    var b = raw.trim();
    if (!b) { i++; continue; }
    if (/^### /.test(b)) { html += '<h3>' + esc(b.slice(4)) + '</h3>'; i++; continue; }
    if (/^## /.test(b))  { html += '<h2>' + esc(b.slice(3)) + '</h2>'; i++; continue; }
    if (/^# /.test(b))   { html += '<h1>' + esc(b.slice(2)) + '</h1>'; i++; continue; }
    if (/^- /.test(b)) {
      var ulItems = [];
      while (i < lines.length && /^- /.test(lines[i].trim())) {
        ulItems.push('<li>' + inl(lines[i].trim().replace(/^-\s*/, '')) + '</li>');
        i++;
      }
      html += '<ul>' + ulItems.join('') + '</ul>';
      continue;
    }
    if (/^\d+\.\s/.test(b)) {
      var olItems = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        olItems.push('<li>' + inl(lines[i].trim().replace(/^\d+\.\s*/, '')) + '</li>');
        i++;
      }
      html += '<ol>' + olItems.join('') + '</ol>';
      continue;
    }
    html += '<p>' + inl(b) + '</p>';
    i++;
  }
  el.innerHTML = html;
};
