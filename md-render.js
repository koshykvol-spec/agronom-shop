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
  el.innerHTML = md.split(/\n\n+/).map(function(block) {
    var b = block.trim();
    if (!b) return '';
    if (/^### /.test(b)) return '<h3>' + esc(b.slice(4)) + '</h3>';
    if (/^## /.test(b))  return '<h2>' + esc(b.slice(3)) + '</h2>';
    if (/^# /.test(b))   return '<h1>' + esc(b.slice(2)) + '</h1>';
    if (/^- /m.test(b))  return '<ul>' + b.split('\n').filter(function(l){return l.trim();}).map(function(l){return '<li>' + inl(l.replace(/^-\s*/,'')) + '</li>';}).join('') + '</ul>';
    if (/^\d+\. /m.test(b)) return '<ol>' + b.split('\n').filter(function(l){return l.trim();}).map(function(l){return '<li>' + inl(l.replace(/^\d+\.\s*/,'')) + '</li>';}).join('') + '</ol>';
    return '<p>' + b.split('\n').map(inl).join('<br>') + '</p>';
  }).join('');
};
