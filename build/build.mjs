// md(옵시디언) → 학습 뷰어 HTML 변환기
// 사용: npm run build  →  index.html(단독 실행용) + dist/artifact.html(claude.ai 아티팩트 게시용)
import fs from 'node:fs';
import path from 'node:path';
import MarkdownIt from 'markdown-it';
import markPlugin from 'markdown-it-mark';
import cjkFriendly from 'markdown-it-cjk-friendly';

const ROOT = path.resolve(import.meta.dirname, '..');
const SOURCE = path.join(ROOT, 'source/민법2-중간고사.md');
const IMAGES_DIR = path.join(ROOT, 'images');
// 이 제목 줄부터는 미완성이라 변환하지 않는다. 노트를 완성하면 null 로 바꾸거나 다음 미완성 지점으로 옮긴다.
const CUT_AT = '### 다. 채권양도계약이 해제/취소된 경우';
// 위키 링크 [[민법2 - 중간고사#^id]] 가 가리키는 "이 문서"의 옵시디언 파일명
const SELF_NAMES = new Set(['민법2 - 중간고사', '']);
const PAGE_TITLE = '민법2 중간고사 노트';

// ---------- 1. 원문 읽기 · 범위 자르기 · frontmatter ----------
export function loadSource() {
  const raw = fs.readFileSync(SOURCE, 'utf8').replace(/\r\n?/g, '\n');
  let lines = raw.split('\n');
  if (CUT_AT) {
    const cut = lines.findIndex((l) => l.trim() === CUT_AT);
    if (cut < 0) throw new Error(`CUT_AT 제목을 찾지 못했습니다: ${CUT_AT}`);
    lines = lines.slice(0, cut);
    // 잘린 지점 앞에 남은 "내용 없는 제목"(예: '## 여기부터 7강', 반복된 '# 채권양도')과 빈 줄 제거
    while (lines.length && (/^\s*$/.test(lines.at(-1)) || /^ {0,3}#{1,6}\s/.test(lines.at(-1)))) lines.pop();
  }
  const meta = {};
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    for (const l of lines.slice(1, end)) {
      const m = l.match(/^([^:]+):\s*(.*)$/);
      if (m) meta[m[1].trim()] = m[2].trim();
    }
    lines = lines.slice(end + 1);
  }
  const fixed = nestCalloutsInLists(lines);
  return { meta, body: fixed.lines.join('\n'), lineCount: lines.length, nested: fixed.count };
}

// 목록 항목 사이에 들여쓰기 없이 끼워 넣은 콜아웃(>) 뒤에 들여쓴 하위 항목이 이어지면,
// CommonMark 에서는 목록이 끊기고 하위 항목이 "코드 블록"으로 렌더된다.
// 작성 의도대로 콜아웃을 앞 목록 항목 안으로 들여써서 하위 항목이 목록으로 이어지게 한다(텍스트는 그대로).
const LIST_RE = /^( *)([-*+]|\d+[.)])( +|$)/;
const isBlank = (l) => /^\s*$/.test(l);
const isQuote = (l) => /^ {0,3}>/.test(l);
export function nestCalloutsInLists(lines) {
  const out = [...lines];
  let stack = []; // 열려 있는 목록 항목 {m: 표지 들여쓰기, c: 내용 시작 열}
  let count = 0;
  for (let i = 0; i < out.length; i++) {
    const line = out[i];
    if (isBlank(line)) continue;
    const lm = line.match(LIST_RE);
    if (lm) {
      const m = lm[1].length;
      const c = m + lm[2].length + Math.min(Math.max(lm[3].length, 1), 4);
      while (stack.length && stack.at(-1).m >= m) stack.pop();
      stack.push({ m, c });
      continue;
    }
    if (isQuote(line)) {
      // 콜아웃 한 덩어리(>로 시작하는 줄 + 게으른 이어짐 줄)의 끝 찾기
      let j = i + 1;
      while (j < out.length && !isBlank(out[j]) && (isQuote(out[j]) || !(LIST_RE.test(out[j]) || /^ {0,3}(#{1,6}\s|-{3,}\s*$)/.test(out[j])))) j++;
      let k = j;
      while (k < out.length && isBlank(out[k])) k++;
      const next = out[k] ?? '';
      const nextIndent = next.match(/^ */)[0].length;
      const parent = [...stack].reverse().find((s) => s.c <= nextIndent);
      if (stack.length && nextIndent >= 2 && LIST_RE.test(next) && parent) {
        const pad = ' '.repeat(parent.c);
        for (let q = i; q < j; q++) out[q] = pad + out[q];
        while (stack.at(-1) !== parent) stack.pop();
        count++;
      } else {
        stack = [];
      }
      i = j - 1;
      continue;
    }
    const indent = line.match(/^ */)[0].length;
    // 제목·구분선, 또는 빈 줄 뒤 들여쓰지 않은 문단이면 목록 문맥 종료(바로 윗줄에 붙은 줄은 게으른 이어짐)
    if (/^ {0,3}(#{1,6}\s|-{3,}\s*$)/.test(line)) stack = [];
    else if (indent < 2 && isBlank(out[i - 1] ?? '')) stack = [];
  }
  return { lines: out, count };
}

// ---------- 2. 도우미 ----------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
const stripTags = (html) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

const CALLOUT_LABEL = { law: '조문', case: '판례', issue: '쟁점', ex: '사례', test: '답안', ans: '답안' };
const FONT_CLASS = { '#7f7f7f': 'fc-gray', '#a5a5a5': 'fc-light', '#c00000': 'fc-red', '#ff0000': 'fc-red', '#000000': 'fc-ink' };
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };

// ---------- 3. markdown-it + 옵시디언 규칙 ----------
export function createMd(stats) {
  const md = new MarkdownIt({ html: true, breaks: true, linkify: false, typographer: false });
  md.use(cjkFriendly).use(markPlugin);
  // 문단 바로 아래 '---' 는 구분선으로(작성 의도). setext 제목(텍스트\n---)은 쓰지 않는다.
  md.disable('lheading');

  // (a) 콜아웃 · 블록 ID 줄 · 타이트 목록 문단 (block 파싱 직후, inline 파싱 전)
  md.core.ruler.after('block', 'obsidian_blocks', (state) => {
    const T = state.tokens;
    for (let i = 0; i < T.length; i++) {
      const t = T[i];
      // 블록 ID 줄: "^f9bd44" 만 있는 문단 → 보이지 않는 앵커
      if (t.type === 'paragraph_open' && T[i + 1]?.type === 'inline' && /^\^[A-Za-z0-9-]+$/.test(T[i + 1].content.trim())) {
        const id = T[i + 1].content.trim().slice(1);
        const a = new state.Token('html_block', '', 0);
        a.content = `<span class="blockref" id="blk-${esc(id)}"></span>\n`;
        T.splice(i, 3, a);
        stats.blockRefs++;
        continue;
      }
      if (t.type !== 'blockquote_open') continue;
      if (T[i + 1]?.type !== 'paragraph_open' || T[i + 2]?.type !== 'inline') continue;
      const inl = T[i + 2];
      const nl = inl.content.indexOf('\n');
      const first = nl < 0 ? inl.content : inl.content.slice(0, nl);
      const m = first.match(/^\[!([A-Za-z0-9_-]+)(?:\|([^\]]*))?\]([+-]?)[ \t]*(.*)$/);
      if (!m) continue;
      const [, type, mods = '', fold, title] = m;
      // 짝이 되는 blockquote_close 찾기
      let depth = 0;
      let j = i;
      for (; j < T.length; j++) {
        if (T[j].type === 'blockquote_open') depth++;
        else if (T[j].type === 'blockquote_close' && --depth === 0) break;
      }
      const meta = { type: type.toLowerCase(), bare: /\bbare\b/.test(mods), fold, title: title.trim() };
      stats.callouts++;
      t.type = 'callout_open';
      t.meta = meta;
      T[j].type = 'callout_close';
      T[j].meta = meta;
      const rest = nl < 0 ? '' : inl.content.slice(nl + 1);
      const inserted = [];
      if (meta.title || !meta.bare) {
        const o = new state.Token('callout_title_open', '', 1);
        o.meta = meta;
        inserted.push(o);
        if (meta.title) {
          const ti = new state.Token('inline', '', 0);
          ti.content = meta.title;
          ti.children = [];
          ti.map = inl.map;
          inserted.push(ti);
        }
        const c = new state.Token('callout_title_close', '', -1);
        c.meta = meta;
        inserted.push(c);
      }
      const bo = new state.Token('callout_body_open', '', 1);
      inserted.push(bo);
      const bc = new state.Token('callout_body_close', '', -1);
      T.splice(j, 0, bc); // j 는 아직 유효(앞쪽 splice 전)
      if (rest.trim() === '') {
        T.splice(i + 1, 3, ...inserted); // 제목만 있던 첫 문단 제거
      } else {
        inl.content = rest;
        T.splice(i + 1, 0, ...inserted);
      }
    }
    // 타이트 목록의 숨김 문단도 <p class="t"> 로 출력 → 모든 텍스트가 블록 요소 안에 들어가게
    for (const t of T) {
      if ((t.type === 'paragraph_open' || t.type === 'paragraph_close') && t.hidden) {
        t.hidden = false;
        if (t.type === 'paragraph_open') t.attrJoin('class', 't');
      }
    }
  });

  // (a-2) 쟁점(issue) 콜아웃: 줄 맨 앞의 굵은 글씨(**판례** **검토** …)를 라벨 알약으로.
  //      중첩된 판례 콜아웃·인용문·표 안과 콜아웃 제목 줄에는 적용하지 않는다.
  md.core.ruler.after('inline', 'issue_pills', (state) => {
    const stack = [];
    let inTitle = false;
    let tableDepth = 0;
    for (const t of state.tokens) {
      if (t.type === 'callout_open') stack.push(t.meta.type);
      else if (t.type === 'callout_close') stack.pop();
      else if (t.type === 'blockquote_open') stack.push('quote');
      else if (t.type === 'blockquote_close') stack.pop();
      else if (t.type === 'callout_title_open') inTitle = true;
      else if (t.type === 'callout_title_close') inTitle = false;
      else if (t.type === 'table_open') tableDepth++;
      else if (t.type === 'table_close') tableDepth--;
      else if (t.type === 'inline' && !inTitle && !tableDepth && stack[stack.length - 1] === 'issue') markLinePills(t.children || [], stats);
    }
  });

  // (b) 위키 링크 [[..]] · 임베드 ![[..]]
  md.inline.ruler.before('link', 'wikilink', (state, silent) => {
    const src = state.src;
    let pos = state.pos;
    const embed = src.startsWith('![[', pos);
    if (!embed && !src.startsWith('[[', pos)) return false;
    const start = pos + (embed ? 3 : 2);
    const end = src.indexOf(']]', start);
    if (end < 0) return false;
    const inner = src.slice(start, end);
    if (inner.includes('\n') || inner.includes('[[')) return false;
    if (!silent) {
      const [target, alias] = inner.split('|');
      const [file, frag = ''] = target.split('#');
      const tok = state.push(embed ? 'wiki_embed' : 'wiki_link', '', 0);
      tok.meta = { file: file.trim(), frag: frag.trim(), alias: alias?.trim() };
    }
    state.pos = end + 2;
    return true;
  });
  md.renderer.rules.wiki_embed = (tokens, idx) => {
    const { file } = tokens[idx].meta;
    stats.embeds++;
    const ext = file.split('.').pop().toLowerCase();
    const p = path.join(IMAGES_DIR, file);
    if (MIME[ext] && fs.existsSync(p)) {
      stats.embedsFound++;
      const data = fs.readFileSync(p).toString('base64');
      return `<span class="embed"><img src="data:${MIME[ext]};base64,${data}" alt="${esc(file)}" loading="lazy"></span>`;
    }
    return `<span class="embed missing" role="img" aria-label="이미지 ${esc(file)}"><span class="embed-name">${esc(file)}</span></span>`;
  };
  md.renderer.rules.wiki_link = (tokens, idx) => {
    const { file, frag, alias } = tokens[idx].meta;
    const label = esc(alias || (frag ? `${file} › ${frag}` : file));
    if (SELF_NAMES.has(file) && frag.startsWith('^')) {
      return `<a class="wikilink" href="#blk-${esc(frag.slice(1))}" data-jump="blk-${esc(frag.slice(1))}">${label}</a>`;
    }
    if (SELF_NAMES.has(file) && frag) {
      return `<a class="wikilink" href="#" data-jump-heading="${esc(frag)}">${label}</a>`;
    }
    return `<span class="wikilink ext" title="${esc(target(file, frag))}">${label}</span>`;
  };
  const target = (f, h) => (h ? `${f}#${h}` : f);

  // (c) 블록마다 data-b(텍스트 해시) 부여
  const seen = new Map();
  const blockId = (content) => {
    const h = 'b' + fnv(content);
    const n = (seen.get(h) || 0) + 1;
    seen.set(h, n);
    stats.blocks++;
    return n === 1 ? h : `${h}-${n}`;
  };
  const nextInline = (tokens, idx) => (tokens[idx + 1]?.type === 'inline' ? tokens[idx + 1].content : '');
  md.renderer.rules.paragraph_open = (tokens, idx, opts, env, self) => {
    const c = nextInline(tokens, idx);
    if (c.trim()) tokens[idx].attrSet('data-b', blockId(c));
    return self.renderToken(tokens, idx, opts);
  };
  for (const cell of ['th_open', 'td_open']) {
    md.renderer.rules[cell] = (tokens, idx, opts, env, self) => {
      const c = nextInline(tokens, idx);
      if (c.trim()) tokens[idx].attrSet('data-b', blockId(c));
      return self.renderToken(tokens, idx, opts);
    };
  }
  md.renderer.rules.table_open = () => '<div class="table-wrap"><table>\n';
  md.renderer.rules.table_close = () => '</table></div>\n';

  // (d) 제목: 순번 id + 목차 수집
  md.renderer.rules.heading_open = (tokens, idx, opts, env, self) => {
    const c = nextInline(tokens, idx);
    const lv = Number(tokens[idx].tag.slice(1));
    const id = `s${env.headings.length + 1}`;
    const text = stripTags(md.renderInline(c, env)).replace(/\s+/g, ' ').trim();
    env.headings.push({ id, lv, t: text });
    tokens[idx].attrSet('id', id);
    tokens[idx].attrSet('data-b', blockId(c));
    return self.renderToken(tokens, idx, opts);
  };

  // (e) 콜아웃 출력
  md.renderer.rules.callout_open = (tokens, idx) => {
    const m = tokens[idx].meta;
    const cls = `callout c-${esc(m.type)}${m.bare ? ' bare' : ''}${m.title ? '' : ' untitled'}`;
    const attrs = `class="${cls}" data-callout="${esc(m.type)}" data-label="${esc(CALLOUT_LABEL[m.type] || m.type)}"`;
    if (m.fold) return `<details ${attrs}${m.fold === '+' ? ' open' : ''}>\n`;
    return `<div ${attrs}>\n`;
  };
  md.renderer.rules.callout_close = (tokens, idx) => (tokens[idx].meta.fold ? '</details>\n' : '</div>\n');
  md.renderer.rules.callout_title_open = (tokens, idx) => {
    const m = tokens[idx].meta;
    const tag = m.fold ? 'summary' : 'div';
    const inner = m.title ? `<span class="ct" data-b="${blockId(m.title)}">` : '';
    return `<${tag} class="callout-title">${inner}`;
  };
  md.renderer.rules.callout_title_close = (tokens, idx) => {
    const m = tokens[idx].meta;
    return `${m.title ? '</span>' : ''}</${m.fold ? 'summary' : 'div'}>\n`;
  };
  md.renderer.rules.callout_body_open = () => '<div class="callout-body">\n';
  md.renderer.rules.callout_body_close = () => '</div>\n';

  // (f) 원문 HTML 블록 감시(텍스트가 블록 밖에 놓이는지 확인용)
  const htmlBlock = md.renderer.rules.html_block;
  md.renderer.rules.html_block = (tokens, idx, ...rest) => {
    if (!tokens[idx].content.startsWith('<span class="blockref"')) stats.htmlBlocks.push(tokens[idx].content.slice(0, 80));
    return htmlBlock(tokens, idx, ...rest);
  };
  return md;
}

// 문단 첫머리 또는 줄바꿈 바로 뒤에 오는 **굵은 글씨**(20자 이하)에 class="pill"
function markLinePills(children, stats) {
  let lineStart = true;
  for (let k = 0; k < children.length; k++) {
    const t = children[k];
    if (t.type === 'softbreak' || t.type === 'hardbreak') {
      lineStart = true;
      continue;
    }
    if (t.type === 'text' && !t.content.trim()) continue;
    if (lineStart && t.type === 'strong_open') {
      let depth = 0;
      let text = '';
      for (let m = k; m < children.length; m++) {
        const u = children[m];
        if (u.type === 'strong_open') depth++;
        else if (u.type === 'strong_close') {
          if (--depth === 0) break;
        } else if (u.type === 'text' || u.type === 'code_inline') text += u.content;
      }
      if (text.trim() && text.trim().length <= 20) {
        t.attrJoin('class', 'pill');
        stats.pills++;
      }
    }
    lineStart = false;
  }
}

// ---------- 4. 렌더 ----------
export function renderDocument() {
  const { meta, body, lineCount } = loadSource();
  const stats = { callouts: 0, embeds: 0, embedsFound: 0, blocks: 0, blockRefs: 0, pills: 0, htmlBlocks: [] };
  const md = createMd(stats);
  const env = { headings: [] };
  let html = md.render(body, env);
  // <font color> → 테마 대응 span
  html = html
    .replace(/<font\s+color="?(#[0-9a-fA-F]{3,6})"?\s*>/g, (_, c) => {
      const cls = FONT_CLASS[c.toLowerCase()];
      return cls ? `<span class="fc ${cls}">` : `<span class="fc" style="color:${c}">`;
    })
    .replace(/<\/font>/g, '</span>');
  return { meta, html, headings: env.headings, stats, lineCount };
}

function build() {
  const { meta, html, headings, stats, lineCount } = renderDocument();
  const css = fs.readFileSync(path.join(ROOT, 'src/app.css'), 'utf8');
  const js = fs.readFileSync(path.join(ROOT, 'src/app.js'), 'utf8');
  const template = fs.readFileSync(path.join(ROOT, 'src/template.html'), 'utf8');
  const data = { title: PAGE_TITLE, meta, toc: headings, docKey: 'minbeop2-midterm' };
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const metaChips = Object.entries(meta)
    .map(([k, v]) => `<span class="meta-chip"><span class="meta-k">${esc(k)}</span>${esc(v)}</span>`)
    .join('');
  const fill = (s) =>
    s
      .replaceAll('{{TITLE}}', () => esc(PAGE_TITLE))
      .replaceAll('{{DOC_TITLE}}', () => esc(PAGE_TITLE))
      .replace('{{META}}', () => metaChips)
      .replace('{{CSS}}', () => css)
      .replace('{{DATA}}', () => json)
      .replace('{{CONTENT}}', () => html)
      .replace('{{JS}}', () => js.replace(/<\/script/gi, '<\\/script'));
  const [head, bodyPart] = template.split('<!--BODY-->');
  const headHtml = fill(head).trim();
  const bodyHtml = fill(bodyPart).trim();
  const standalone =
    '<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n' +
    headHtml +
    '\n</head>\n<body>\n' +
    bodyHtml +
    '\n</body>\n</html>\n';
  const artifact = headHtml + '\n' + bodyHtml + '\n';
  fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'index.html'), standalone);
  fs.writeFileSync(path.join(ROOT, 'dist/artifact.html'), artifact);
  const lv = headings.reduce((a, h) => ((a['H' + h.lv] = (a['H' + h.lv] || 0) + 1), a), {});
  console.log(`원문 ${lineCount}줄(frontmatter 제외) 변환`);
  console.log(`제목 ${headings.length}개`, lv, `| 콜아웃 ${stats.callouts} | 블록 ${stats.blocks} | 이미지 ${stats.embeds}(파일 있음 ${stats.embedsFound}) | 블록ID ${stats.blockRefs} | 쟁점 라벨 알약 ${stats.pills}`);
  if (stats.htmlBlocks.length) console.log('주의: 원문 HTML 블록', stats.htmlBlocks);
  console.log(`index.html ${(standalone.length / 1024).toFixed(0)}KB, dist/artifact.html ${(artifact.length / 1024).toFixed(0)}KB`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) build();
