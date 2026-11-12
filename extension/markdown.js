// 아주 작은 마크다운 렌더러 (제목, 목록, 굵게, 기울임, 인라인 코드, 링크). HTML은 먼저 이스케이프한다.
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function inlineMd(s) {
  s = escapeHtml(s);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s;
}
function renderMarkdown(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  const stack = []; // 열린 목록: {type, indent}
  const closeLists = (indent) => {
    while (stack.length && stack[stack.length - 1].indent >= indent) out.push(`</li></${stack.pop().type}>`);
  };
  let para = [];
  let blank = false; // 바로 앞 줄이 빈 줄이었는지
  const flushPara = () => { if (para.length) { out.push(`<p>${inlineMd(para.join(" "))}</p>`); para = []; } };
  for (const raw of lines) {
    const line = raw.replace(/\t/g, "  ");
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (!line.trim()) { flushPara(); blank = true; continue; }
    const afterBlank = blank;
    blank = false;
    // 빈 줄 뒤에 들여쓰기 없는 일반 줄이 오면 목록이 끝난 것 (목록 뒤 문단이 마지막 항목에 붙지 않게)
    if (afterBlank && !li && !h && !/^\s/.test(line)) closeLists(0);
    if (h) { flushPara(); closeLists(0); const n = Math.min(h[1].length + 1, 3); out.push(`<h${n}>${inlineMd(h[2])}</h${n}>`); continue; }
    if (li) {
      flushPara();
      const indent = li[1].length, type = /\d/.test(li[2]) ? "ol" : "ul";
      const top = stack[stack.length - 1];
      if (!top || indent > top.indent) { out.push(`<${type}><li>`); stack.push({ type, indent }); }
      else { closeLists(indent + 1); const t = stack[stack.length - 1];
        if (t && t.indent === indent && t.type === type) out.push("</li><li>");
        else { closeLists(indent); out.push(`<${type}><li>`); stack.push({ type, indent }); } }
      out.push(inlineMd(li[3]));
      continue;
    }
    if (stack.length) { out.push(" " + inlineMd(line.trim())); continue; }
    para.push(line.trim());
  }
  flushPara(); closeLists(0);
  return out.join("");
}
