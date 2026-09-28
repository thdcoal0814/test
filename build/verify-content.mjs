// 원문 보존 검사: 변환 범위의 md 각 줄에서 문법 기호만 걷어 낸 텍스트가
// 렌더된 HTML 본문 텍스트 안에 빠짐없이 들어 있는지 확인한다.
import { loadSource, renderDocument } from './build.mjs';

const { body } = loadSource();
const { html, headings, stats } = renderDocument();

const decode = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
// 비교할 때는 강조 기호처럼 원문에 짝이 안 맞게 남을 수 있는 문자와 공백(태그 경계에서 생기는 차이)을 무시한다
const norm = (s) => s.replace(/[*`=_]/g, '').replace(/\s+/g, '');

const renderedText = norm(decode(html.replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, ' ')));

function cleanLine(line) {
  let s = line;
  s = s.replace(/^\s*(>\s?)+/, ''); // 인용·콜아웃 표시
  s = s.replace(/^\s*\[![A-Za-z0-9_-]+(\|[^\]]*)?\][+-]?/, ''); // 콜아웃 종류
  s = s.replace(/^\s{0,3}#{1,6}\s+/, ''); // 제목
  s = s.replace(/^\s*([-*+]|\d+[.)])\s+/, ''); // 목록 표시
  s = s.replace(/!\[\[([^\]|]+)(\|[^\]]*)?\]\]/g, '$1'); // 이미지 임베드 → 파일명
  s = s.replace(/\[\[([^\]|]*)\|([^\]]+)\]\]/g, '$2'); // 위키 링크 별칭
  s = s.replace(/\[\[([^\]]+)\]\]/g, '$1');
  s = s.replace(/<[^>]+>/g, ' '); // 인라인 HTML
  s = s.replace(/\\([\\`*_{}[\]()#+\-.!|])/g, '$1');
  return decode(s);
}

const missing = [];
let checked = 0;
const lines = body.split('\n');
lines.forEach((raw, i) => {
  const stripped = raw.replace(/^\s*(>\s?)+/, '');
  if (!stripped.trim()) return;
  if (/^\s*(-{3,}|\*{3,})\s*$/.test(stripped)) return; // 구분선
  if (/^\s*\^[A-Za-z0-9-]+\s*$/.test(stripped)) return; // 블록 ID(보이지 않는 앵커)
  if (/^\s*\|?\s*:?-{3,}/.test(stripped) && /^[\s|:-]+$/.test(stripped)) return; // 표 구분줄
  const parts = /^\s*\|/.test(stripped) ? stripped.split('|') : [stripped];
  for (const p of parts) {
    const t = norm(cleanLine(p));
    if (!t) continue;
    checked++;
    if (!renderedText.includes(t)) missing.push({ line: i + 1, text: cleanLine(p).trim().slice(0, 120) });
  }
});

const expect = (label, got, want) => {
  const ok = got === want;
  console.log(`${ok ? '✓' : '✗'} ${label}: ${got}${ok ? '' : ` (기대값 ${want})`}`);
  return ok;
};
const srcCount = (re) => lines.filter((l) => re.test(l)).length;
let ok = true;
ok = expect('제목 수', headings.length, srcCount(/^ {0,3}#{1,6}\s/)) && ok;
ok = expect('콜아웃 수', stats.callouts, srcCount(/^\s*(>\s?)+\[![A-Za-z]/)) && ok;
ok = expect('이미지 수', stats.embeds, (body.match(/!\[\[[^\]]+\]\]/g) || []).length) && ok;
ok = expect('코드 블록으로 잘못 렌더된 곳', (html.match(/<pre>/g) || []).length, 0) && ok;
ok = expect('미완성 구간(해제/취소된 경우) 포함 여부', renderedText.includes('채권양도계약이 해제/취소된 경우'), false) && ok;
const lastLine = norm(cleanLine(lines.filter((l) => l.trim()).at(-1)));
ok = expect('범위 마지막 줄 포함 여부', renderedText.includes(lastLine), true) && ok;
console.log(`검사한 텍스트 조각 ${checked}개, 누락 ${missing.length}개`);
for (const m of missing.slice(0, 30)) console.log(`  ✗ ${m.line}행: ${m.text}`);
if (missing.length || !ok) process.exit(1);
