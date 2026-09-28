(function () {
  'use strict';

  // ================= 기본 =================
  const DATA = JSON.parse(document.getElementById('docData').textContent);
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const app = $('#app');
  const contentEl = $('#content');
  const docEl = $('#doc');
  const inkSvg = $('#ink');
  const pickEl = $('#pick');
  const marginEl = $('#margin');
  const focusEl = $('#focusView');
  const popEl = $('#popover');
  const selMenu = $('#selMenu');
  const menuEl = $('#menu');
  const toastEl = $('#toast');
  const crumbsEl = $('#crumbs');
  const tocTree = $('#tocTree');
  const SVGNS = 'http://www.w3.org/2000/svg';
  const COLORS = ['y', 'g', 'b', 'p', 'o'];
  const COLOR_NAME = { y: '노랑', g: '초록', b: '파랑', p: '분홍', o: '주황' };
  const KINDS = ['hl', 'bl', 'memo', 'ink', 'prog'];
  const DAY = 86400000;

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const escHTML = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const isLive = (it) => !!it && !it.del;
  const isRendered = (el) => !!el && el.getClientRects().length > 0;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function debounce(fn, ms) {
    let t = 0;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  }
  function readJSON(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || 'null') || {};
    } catch (e) {
      return {};
    }
  }

  // ================= 화면 설정(기기별) =================
  const UI_KEY = DATA.docKey + ':ui';
  const ui = Object.assign(
    { toc: null, speed: 1, blanks: false, showInk: true, finger: false, theme: 'auto', penColor: 'k', penWidth: 2.6, hlColor: 'y', hinted: false, memoOpen: true },
    readJSON(UI_KEY)
  );
  const saveUI = () => {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify(ui));
    } catch (e) {
      /* 저장 불가 환경 */
    }
  };

  // ================= 블록 · 목차 구조 =================
  const blockEls = $$('[data-b]', contentEl);
  const blockIdx = new Map(blockEls.map((el, i) => [el.dataset.b, i]));
  const byId = (b) => {
    const i = blockIdx.get(b);
    return i == null ? null : blockEls[i];
  };
  const textCache = new Map();
  function blockText(b) {
    let t = textCache.get(b);
    if (t == null) {
      const el = byId(b);
      t = el ? el.textContent : '';
      textCache.set(b, t);
    }
    return t;
  }

  const toc = DATA.toc;
  {
    const stack = [];
    toc.forEach((h, i) => {
      h.i = i;
      h.el = document.getElementById(h.id);
      h.children = [];
      while (stack.length && stack[stack.length - 1].lv >= h.lv) stack.pop();
      h.parent = stack[stack.length - 1] || null;
      if (h.parent) h.parent.children.push(h);
      stack.push(h);
    });
  }
  const headingByEl = new Map(toc.map((h) => [h.el, h]));
  const blockSec = [];
  {
    let cur = null;
    blockEls.forEach((el, i) => {
      const h = headingByEl.get(el);
      if (h) cur = h;
      blockSec[i] = cur;
    });
  }
  const secOf = (b) => {
    const i = blockIdx.get(b);
    return i == null ? null : blockSec[i];
  };
  function pathOf(h) {
    const p = [];
    for (let x = h; x; x = x.parent) p.unshift(x);
    return p;
  }
  function ancestorUpTo(h, lv) {
    let r = null;
    for (const x of pathOf(h)) if (x.lv <= lv) r = x;
    return r;
  }

  // ================= 상태 =================
  let mode = 'read';
  let readTool = null; // null | 'hl' | 'erase' | 'memo'
  let blankTool = 'blank'; // 'blank' | 'unblank'
  let inkTool = 'pen'; // 'pen' | 'erase'
  let blanksHidden = false;
  const revealed = new Set(); // 연 빈칸의 그룹 id (세션 한정)
  const store = { hl: {}, bl: {}, memo: {}, ink: {}, prog: {} };
  const orphans = new Set(); // 원문에서 위치를 찾지 못한 항목 "kind:id"
  const liveItems = (kind) => Object.values(store[kind]).filter(isLive);

  // ================= 단어 경계 · 위치 계산 =================
  const BOUND = /[\s,.;:!?·…'"“”‘’()[\]{}<>「」『』《》〈〉/⇒→←↔=~|※∵∴]/;
  const isB = (ch) => ch === undefined || BOUND.test(ch);
  const isSpace = (ch) => ch !== undefined && /\s/.test(ch);

  function wordAt(text, o) {
    o = clamp(o, 0, text.length);
    let s;
    let e;
    if (!isB(text[o])) {
      s = o;
      e = o + 1;
    } else if (o > 0 && !isB(text[o - 1])) {
      s = o - 1;
      e = o;
    } else {
      if (text[o] && !isSpace(text[o])) return [o, o + 1];
      if (o > 0 && text[o - 1] && !isSpace(text[o - 1])) return [o - 1, o];
      return null;
    }
    while (s > 0 && !isB(text[s - 1])) s--;
    while (e < text.length && !isB(text[e])) e++;
    return [s, e];
  }
  function snapStart(text, s) {
    while (s > 0 && !isB(text[s - 1])) s--;
    while (s < text.length && isSpace(text[s])) s++;
    return s;
  }
  function snapEnd(text, e) {
    while (e < text.length && !isB(text[e])) e++;
    while (e > 0 && isSpace(text[e - 1])) e--;
    return e;
  }

  function toBlockPos(node, off) {
    const elm = node.nodeType === 3 ? node.parentElement : node;
    const host = elm && elm.closest ? elm.closest('[data-b]') : null;
    if (!host || !contentEl.contains(host)) return null;
    const r = document.createRange();
    r.setStart(host, 0);
    try {
      r.setEnd(node, off);
    } catch (e) {
      return null;
    }
    return { b: host.dataset.b, o: r.toString().length };
  }
  function charPosInBlock(el, x, y) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const r = document.createRange();
    let pos = 0;
    let best = { d: Infinity, o: 0 };
    let n;
    while ((n = walker.nextNode())) {
      for (let i = 0; i < n.data.length; i++) {
        r.setStart(n, i);
        r.setEnd(n, i + 1);
        const rc = r.getBoundingClientRect();
        if (!rc.width && !rc.height) continue;
        const dy = y < rc.top ? rc.top - y : y > rc.bottom ? y - rc.bottom : 0;
        const dx = x < rc.left ? rc.left - x : x > rc.right ? x - rc.right : 0;
        const d = dy * 4 + dx;
        if (d < best.d) best = { d, o: pos + i + (x > rc.left + rc.width / 2 ? 1 : 0) };
      }
      pos += n.data.length;
    }
    return { b: el.dataset.b, o: best.o };
  }
  let blockTops = null; // 페이지 기준 y (지연 계산)
  function measureBlockTops() {
    const sy = window.scrollY;
    let last = 0;
    blockTops = blockEls.map((el) => {
      const r = el.getBoundingClientRect();
      if (r.width || r.height) last = r.top + sy;
      return last;
    });
  }
  function nearestBlockIndex(pageY) {
    if (!blockTops) measureBlockTops();
    let lo = 0;
    let hi = blockTops.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (blockTops[mid] <= pageY) lo = mid;
      else hi = mid - 1;
    }
    // 보이는 블록으로 보정
    for (let i = lo; i >= 0; i--) if (isRendered(blockEls[i])) return i;
    for (let i = lo; i < blockEls.length; i++) if (isRendered(blockEls[i])) return i;
    return lo;
  }
  function posFromPoint(x, y) {
    let node = null;
    let off = 0;
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      if (p && p.offsetNode) {
        node = p.offsetNode;
        off = p.offset;
      }
    }
    if (!node && document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      if (r) {
        node = r.startContainer;
        off = r.startOffset;
      }
    }
    let pos = node ? toBlockPos(node, off) : null;
    if (pos) return pos;
    const hit = document.elementFromPoint(x, y);
    const el = hit && hit.closest ? hit.closest('[data-b]') : null;
    if (el && contentEl.contains(el)) return charPosInBlock(el, x, y);
    const i = nearestBlockIndex(y + window.scrollY);
    const bel = blockEls[i];
    if (!bel) return null;
    const r = bel.getBoundingClientRect();
    if (y > r.bottom) return { b: bel.dataset.b, o: blockText(bel.dataset.b).length };
    if (y < r.top) return { b: bel.dataset.b, o: 0 };
    return charPosInBlock(bel, x, y);
  }
  function wordPiece(pos) {
    if (!pos) return null;
    const text = blockText(pos.b);
    const w = wordAt(text, pos.o);
    if (!w) return null;
    return { b: pos.b, s: w[0], e: w[1], t: text.slice(w[0], w[1]) };
  }
  function piecesBetween(a, z) {
    if (!a || !z) return [];
    let ia = blockIdx.get(a.b);
    let iz = blockIdx.get(z.b);
    if (ia > iz || (ia === iz && a.o > z.o)) {
      [a, z] = [z, a];
      [ia, iz] = [iz, ia];
    }
    const out = [];
    for (let i = ia; i <= iz; i++) {
      const el = blockEls[i];
      if (i !== ia && i !== iz && !isRendered(el)) continue;
      const b = el.dataset.b;
      const text = blockText(b);
      let s = i === ia ? snapStart(text, a.o) : 0;
      let e = i === iz ? snapEnd(text, z.o) : text.length;
      while (s < e && isSpace(text[s])) s++;
      while (e > s && isSpace(text[e - 1])) e--;
      if (e > s) out.push({ b, s, e, t: text.slice(s, e).slice(0, 300) });
    }
    return out;
  }
  function rangeToPieces(range) {
    let a = toBlockPos(range.startContainer, range.startOffset);
    let z = toBlockPos(range.endContainer, range.endOffset);
    if (!a) {
      const first = blockEls.find((el) => range.intersectsNode(el));
      if (first) a = { b: first.dataset.b, o: 0 };
    }
    if (!z) {
      for (let i = blockEls.length - 1; i >= 0; i--) {
        if (range.intersectsNode(blockEls[i])) {
          z = { b: blockEls[i].dataset.b, o: blockText(blockEls[i].dataset.b).length };
          break;
        }
      }
    }
    return piecesBetween(a, z);
  }
  function domPoint(el, o) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let pos = 0;
    let n;
    let last = null;
    while ((n = walker.nextNode())) {
      if (o <= pos + n.data.length) return [n, o - pos];
      pos += n.data.length;
      last = n;
    }
    return last ? [last, last.data.length] : [el, 0];
  }
  function domRange(b, s, e) {
    const el = byId(b);
    if (!el) return null;
    const r = document.createRange();
    const [sn, so] = domPoint(el, s);
    const [en, eo] = domPoint(el, e);
    try {
      r.setStart(sn, so);
      r.setEnd(en, eo);
    } catch (err) {
      return null;
    }
    return r;
  }

  // ================= 주석 렌더링 =================
  const annByBlock = new Map();
  const origHTML = new Map();
  function rangesOf(kind, it) {
    if (!it || kind === 'prog') return [];
    if (kind === 'memo') return it.rs || [];
    if (kind === 'ink') return it.b ? [{ b: it.b }] : [];
    return [{ b: it.b, s: it.s, e: it.e }];
  }
  function rebuildAnnIndex() {
    annByBlock.clear();
    for (const kind of ['hl', 'bl', 'memo']) {
      for (const it of liveItems(kind)) {
        if (orphans.has(kind + ':' + it.id)) continue;
        const rs = rangesOf(kind, it);
        rs.forEach((r, k) => {
          if (!blockIdx.has(r.b) || !(r.e > r.s)) return;
          let list = annByBlock.get(r.b);
          if (!list) annByBlock.set(r.b, (list = []));
          list.push({ kind, id: it.id, g: it.g || it.id, s: r.s, e: r.e, c: it.c, u: it.u, last: k === rs.length - 1 });
        });
      }
    }
  }
  function renderBlock(b) {
    const el = byId(b);
    if (!el) return;
    const anns = annByBlock.get(b);
    if (origHTML.has(b)) el.innerHTML = origHTML.get(b);
    else if (!anns || !anns.length) return;
    else origHTML.set(b, el.innerHTML);
    if (!anns || !anns.length) return;
    const cuts = new Set();
    for (const a of anns) {
      cuts.add(a.s);
      cuts.add(a.e);
    }
    const cutList = [...cuts].sort((x, y) => x - y);
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const texts = [];
    let n;
    while ((n = walker.nextNode())) texts.push(n);
    let pos = 0;
    for (const node of texts) {
      const len = node.data.length;
      const start = pos;
      const end = pos + len;
      pos = end;
      if (!len) continue;
      const pieces = [];
      let cur = node;
      let curStart = start;
      for (const c of cutList) {
        if (c <= curStart || c >= end) continue;
        const rest = cur.splitText(c - curStart);
        pieces.push([cur, curStart, c]);
        cur = rest;
        curStart = c;
      }
      pieces.push([cur, curStart, end]);
      for (const [tn, ps, pe] of pieces) {
        const cover = anns.filter((a) => a.s < pe && a.e > ps);
        if (cover.length) wrapText(tn, cover, pe);
      }
    }
  }
  function wrapText(tn, cover, pe) {
    const span = document.createElement('span');
    span.className = 'a';
    let hl = null;
    let bk = null;
    const mm = [];
    for (const a of cover) {
      if (a.kind === 'hl') {
        if (!hl || a.u > hl.u) hl = a;
      } else if (a.kind === 'bl') bk = a;
      else mm.push(a);
    }
    if (hl) {
      span.classList.add('hl-' + hl.c);
      span.dataset.h = hl.id;
    }
    if (bk) {
      span.classList.add('bk');
      span.dataset.k = bk.id;
      span.dataset.kg = bk.g;
      if (revealed.has(bk.g)) span.classList.add('rv');
    }
    if (mm.length) {
      span.classList.add('mm');
      span.dataset.m = mm.map((a) => a.id).join(' ');
      const ends = mm.filter((a) => a.last && a.e === pe);
      if (ends.length) {
        span.classList.add('mm-end');
        span.dataset.me = ends.map((a) => a.id).join(' ');
      }
    }
    tn.parentNode.insertBefore(span, tn);
    span.appendChild(tn);
  }
  function renderAllAnnotations() {
    rebuildAnnIndex();
    const all = new Set([...origHTML.keys(), ...annByBlock.keys()]);
    for (const b of all) renderBlock(b);
    numberMemos();
  }
  function refreshBlocks(bids) {
    rebuildAnnIndex();
    for (const b of bids) renderBlock(b);
    numberMemos();
    updateBlankCount();
    scheduleLayout();
  }
  function orderedMemos() {
    return liveItems('memo')
      .filter((m) => !orphans.has('memo:' + m.id) && m.rs && m.rs.length && blockIdx.has(m.rs[0].b))
      .sort((a, b) => blockIdx.get(a.rs[0].b) - blockIdx.get(b.rs[0].b) || a.rs[0].s - b.rs[0].s);
  }
  let memoNumber = new Map();
  function numberMemos() {
    memoNumber = new Map(orderedMemos().map((m, i) => [m.id, i + 1]));
    for (const el of $$('.a.mm-end', contentEl)) {
      const nums = el.dataset.me.split(' ').map((id) => memoNumber.get(id)).filter(Boolean);
      el.dataset.mn = nums.join(',');
    }
  }

  // 원문 확인: 저장된 텍스트와 위치가 맞지 않으면 같은 블록·전체 문서에서 다시 찾는다
  function relocate(r) {
    if (!r.t) return blockIdx.has(r.b);
    if (blockIdx.has(r.b) && blockText(r.b).slice(r.s, r.e) === r.t) return true;
    if (blockIdx.has(r.b)) {
      const i = blockText(r.b).indexOf(r.t);
      if (i >= 0) {
        r.s = i;
        r.e = i + r.t.length;
        return true;
      }
    }
    for (const el of blockEls) {
      const i = blockText(el.dataset.b).indexOf(r.t);
      if (i >= 0) {
        r.b = el.dataset.b;
        r.s = i;
        r.e = i + r.t.length;
        return true;
      }
    }
    return false;
  }
  function resolveAnchors() {
    orphans.clear();
    for (const kind of ['hl', 'bl']) {
      for (const it of liveItems(kind)) if (!relocate(it)) orphans.add(kind + ':' + it.id);
    }
    for (const m of liveItems('memo')) {
      const ok = (m.rs || []).map(relocate);
      if (!ok.length || !ok[0]) orphans.add('memo:' + m.id);
      else m.b = m.rs[0].b;
    }
    for (const s of liveItems('ink')) if (!blockIdx.has(s.b)) orphans.add('ink:' + s.id);
  }

  // ================= 변경 · 되돌리기 =================
  const undoStack = [];
  const redoStack = [];
  function setItem(kind, id, after, prev) {
    const now = Date.now();
    if (after) {
      const it = Object.assign({}, after, { id, u: now });
      delete it.del;
      store[kind][id] = it;
    } else if (prev) {
      store[kind][id] = { id, del: 1, u: now, b: prev.b };
    }
  }
  function touchedBlocks(kind, before, after, set) {
    if (kind === 'ink' || kind === 'prog') return;
    for (const r of rangesOf(kind, before)) set.add(r.b);
    for (const r of rangesOf(kind, after)) set.add(r.b);
  }
  function commit(changes, opts) {
    const rec = [];
    const touched = new Set();
    for (const ch of changes) {
      const prev = store[ch.kind][ch.id];
      const before = isLive(prev) ? clone(prev) : null;
      const after = ch.after ? clone(ch.after) : null;
      if (!before && !after) continue;
      setItem(ch.kind, ch.id, after, prev);
      if (after) orphans.delete(ch.kind + ':' + ch.id);
      rec.push({ kind: ch.kind, id: ch.id, before, after });
      touchedBlocks(ch.kind, before, after, touched);
    }
    if (!rec.length) return;
    if (!opts || opts.undoable !== false) {
      undoStack.push(rec);
      if (undoStack.length > 300) undoStack.shift();
      redoStack.length = 0;
    }
    afterMutation(rec, touched);
  }
  function applyRecords(rec, dir) {
    const touched = new Set();
    const list = dir === 'before' ? [...rec].reverse() : rec;
    for (const r of list) {
      setItem(r.kind, r.id, r[dir], store[r.kind][r.id]);
      touchedBlocks(r.kind, r.before, r.after, touched);
    }
    afterMutation(rec, touched);
  }
  function afterMutation(rec, touched) {
    if (touched.size) refreshBlocks(touched);
    if (rec.some((r) => r.kind === 'ink')) renderInkChanges(rec);
    for (const r of rec) markDirty(r.kind, store[r.kind][r.id]);
    if (rec.some((r) => r.kind === 'memo')) scheduleLayout();
    if (rec.some((r) => r.kind === 'prog')) updateProgress();
    scheduleSave();
    updateHistoryButtons();
    if (mode === 'focus') renderFocus();
    requestPersist();
  }
  function undo() {
    const rec = undoStack.pop();
    if (!rec) return;
    applyRecords(rec, 'before');
    redoStack.push(rec);
    updateHistoryButtons();
  }
  function redo() {
    const rec = redoStack.pop();
    if (!rec) return;
    applyRecords(rec, 'after');
    undoStack.push(rec);
    updateHistoryButtons();
  }
  function updateHistoryButtons() {
    $('#undo').disabled = !undoStack.length;
    $('#redo').disabled = !redoStack.length;
  }

  // ----- 하이라이트 · 빈칸 · 메모 조작 -----
  const sliceText = (b, s, e) => blockText(b).slice(s, e).slice(0, 300);
  function subtractChanges(kind, pieces, changes, skipIds) {
    for (const p of pieces) {
      for (const x of liveItems(kind)) {
        if (x.b !== p.b || !(x.s < p.e && x.e > p.s) || (skipIds && skipIds.has(x.id))) continue;
        if (skipIds) skipIds.add(x.id);
        changes.push({ kind, id: x.id, after: null });
        const text = blockText(x.b);
        if (x.s < p.s && text.slice(x.s, p.s).trim()) {
          const e = snapBackSpace(text, x.s, p.s);
          changes.push({ kind, id: uid(), after: Object.assign({}, x, { id: undefined, u: undefined, e, t: sliceText(x.b, x.s, e) }) });
        }
        if (x.e > p.e && text.slice(p.e, x.e).trim()) {
          const s = snapFwdSpace(text, p.e, x.e);
          changes.push({ kind, id: uid(), after: Object.assign({}, x, { id: undefined, u: undefined, s, t: sliceText(x.b, s, x.e) }) });
        }
      }
    }
    return changes;
  }
  function snapBackSpace(text, s, e) {
    while (e > s && isSpace(text[e - 1])) e--;
    return e;
  }
  function snapFwdSpace(text, s, e) {
    while (s < e && isSpace(text[s])) s++;
    return s;
  }
  function addHighlight(pieces, color) {
    if (!pieces.length) return;
    const g = uid();
    const changes = subtractChanges('hl', pieces, [], new Set());
    for (const p of pieces) changes.push({ kind: 'hl', id: uid(), after: { b: p.b, s: p.s, e: p.e, c: color, g, t: p.t } });
    commit(changes);
  }
  function addBlank(pieces) {
    if (!pieces.length) return;
    const g = uid();
    const changes = [];
    for (const p of pieces) {
      let s = p.s;
      let e = p.e;
      for (const x of liveItems('bl')) {
        if (x.b !== p.b || !(x.s <= e && x.e >= s)) continue;
        s = Math.min(s, x.s);
        e = Math.max(e, x.e);
        changes.push({ kind: 'bl', id: x.id, after: null });
      }
      changes.push({ kind: 'bl', id: uid(), after: { b: p.b, s, e, g, t: sliceText(p.b, s, e) } });
    }
    commit(changes);
  }
  function groupItems(kind, g) {
    return liveItems(kind).filter((x) => (x.g || x.id) === g);
  }
  function deleteGroup(kind, g) {
    commit(groupItems(kind, g).map((x) => ({ kind, id: x.id, after: null })));
  }
  function recolorGroup(g, c) {
    commit(groupItems('hl', g).map((x) => ({ kind: 'hl', id: x.id, after: Object.assign({}, x, { c }) })));
  }
  function saveMemo(id, rs, text) {
    const clean = text.replace(/\s+$/, '');
    if (!clean.trim()) {
      if (id) commit([{ kind: 'memo', id, after: null }]);
      return;
    }
    const prev = id ? store.memo[id] : null;
    const ranges = prev ? prev.rs : rs;
    commit([{ kind: 'memo', id: id || uid(), after: { b: ranges[0].b, rs: ranges, text: clean, c0: (prev && prev.c0) || Date.now() } }]);
  }

  // ================= 텍스트 도구 입력(일반·빈칸 모드) =================
  let gesture = null;
  let suppressClickUntil = 0;
  let pointerDown = false;
  const toolActive = () => (mode === 'blank' ? true : mode === 'read' && !!readTool);

  function onDocPointerDown(e) {
    pointerDown = true;
    if (mode !== 'read' && mode !== 'blank') return;
    if (!toolActive()) return;
    if (e.target.closest('#ink')) return;
    const t = e.pointerType;
    if (t === 'mouse' && e.button !== 0) return;
    if (t === 'touch' && !ui.finger) return; // 손가락: 스크롤(탭은 click 으로 처리)
    e.preventDefault();
    hideSelMenu();
    closePopover();
    const pos = posFromPoint(e.clientX, e.clientY);
    gesture = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, start: pos, end: pos, moved: false, target: e.target };
    try {
      docEl.setPointerCapture(e.pointerId);
    } catch (err) {
      /* 무시 */
    }
    edgeLoop();
  }
  let pickRaf = 0;
  function onDocPointerMove(e) {
    if (!gesture || e.pointerId !== gesture.id) return;
    gesture.lx = e.clientX;
    gesture.ly = e.clientY;
    if (!gesture.moved && Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) > 6) gesture.moved = true;
    if (gesture.moved && !pickRaf) {
      pickRaf = requestAnimationFrame(() => {
        pickRaf = 0;
        if (!gesture) return;
        gesture.end = posFromPoint(gesture.lx, gesture.ly) || gesture.end;
        drawPick(piecesBetween(gesture.start, gesture.end));
      });
    }
  }
  function onDocPointerUp(e) {
    pointerDown = false;
    if (!gesture || e.pointerId !== gesture.id) return;
    const g = gesture;
    gesture = null;
    clearPick();
    suppressClickUntil = performance.now() + 450;
    if (e.type === 'pointercancel') return;
    if (!g.moved) tapAction(g.target, g.start);
    else {
      const end = posFromPoint(e.clientX, e.clientY) || g.end;
      dragAction(piecesBetween(g.start, end));
    }
  }
  function edgeLoop() {
    if (!gesture) return;
    const y = gesture.ly;
    const top = crumbsEl.getBoundingClientRect().bottom;
    let dy = 0;
    if (y < top + 36) dy = -Math.ceil((top + 36 - y) / 6);
    else if (y > window.innerHeight - 70) dy = Math.ceil((y - (window.innerHeight - 70)) / 6);
    if (dy && gesture.moved) {
      window.scrollBy(0, dy);
      onDocPointerMove({ pointerId: gesture.id, clientX: gesture.lx, clientY: gesture.ly });
    }
    requestAnimationFrame(edgeLoop);
  }
  function drawPick(pieces) {
    const d0 = docOrigin();
    const dr = { left: d0.left, top: d0.top };
    const frag = document.createDocumentFragment();
    for (const p of pieces) {
      const r = domRange(p.b, p.s, p.e);
      if (!r) continue;
      for (const rc of r.getClientRects()) {
        if (rc.width < 1) continue;
        const d = document.createElement('div');
        d.style.cssText = `left:${rc.left - dr.left}px;top:${rc.top - dr.top}px;width:${rc.width}px;height:${rc.height}px`;
        frag.appendChild(d);
      }
    }
    pickEl.replaceChildren(frag);
  }
  const clearPick = () => pickEl.replaceChildren();

  function tapAction(target, pos) {
    const span = target && target.closest ? target.closest('.a') : null;
    const isBlankSpan = span && span.classList.contains('bk');
    if (isBlankSpan && blanksHidden && !(mode === 'blank' && blankTool === 'unblank')) {
      toggleReveal(span.dataset.kg);
      return;
    }
    if (mode === 'blank') {
      if (blankTool === 'unblank') {
        if (isBlankSpan) deleteGroup('bl', span.dataset.kg);
        return;
      }
      if (isBlankSpan) return;
      const p = wordPiece(pos);
      if (p) addBlank([p]);
      return;
    }
    if (readTool === 'hl') {
      if (span && span.dataset.h) {
        openHlPopover(span);
        return;
      }
      const p = wordPiece(pos);
      if (p) addHighlight([p], ui.hlColor);
    } else if (readTool === 'erase') {
      if (span && span.dataset.h) deleteGroup('hl', groupOfHl(span.dataset.h));
    } else if (readTool === 'memo') {
      const mid = span && span.dataset.m ? span.dataset.m.split(' ')[0] : null;
      if (mid) openMemoEditor(mid);
      else {
        const p = wordPiece(pos);
        if (p) openMemoEditor(null, [p]);
      }
    }
  }
  function dragAction(pieces) {
    if (!pieces.length) return;
    if (mode === 'blank') {
      if (blankTool === 'unblank') commit(subtractChanges('bl', pieces, [], new Set()));
      else addBlank(pieces);
      return;
    }
    if (readTool === 'hl') addHighlight(pieces, ui.hlColor);
    else if (readTool === 'erase') commit(subtractChanges('hl', pieces, [], new Set()));
    else if (readTool === 'memo') openMemoEditor(null, pieces);
  }
  const groupOfHl = (id) => (store.hl[id] && (store.hl[id].g || id)) || id;

  // 클릭: 손가락 탭, 도구 없는 클릭, 링크
  function underInk(e) {
    const els = document.elementsFromPoint(e.clientX, e.clientY);
    return els.find((el) => el !== inkSvg && !inkSvg.contains(el)) || null;
  }
  function onClickCapture(e) {
    if (performance.now() < suppressClickUntil && (docEl.contains(e.target) || e.target === docEl)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }
  function onDocClick(e) {
    let target = e.target;
    if (inkSvg.contains(target) || target === inkSvg) {
      if (mode !== 'ink') return;
      target = underInk(e);
      if (!target) return;
      const bk = target.closest('.a.bk');
      if (bk && blanksHidden) toggleReveal(bk.dataset.kg);
      else if (target.closest('.a.mm')) openMemoView(target.closest('.a.mm').dataset.m.split(' ')[0], target.closest('.a.mm'));
      return;
    }
    const jump = target.closest('[data-jump]');
    if (jump && !toolActive()) {
      e.preventDefault();
      jumpToAnchor(jump.dataset.jump);
      return;
    }
    if (target.closest('[data-jump-heading]')) {
      e.preventDefault();
      const t = target.closest('[data-jump-heading]').dataset.jumpHeading;
      const h = toc.find((x) => x.t.includes(t));
      if (h) goToHeading(h);
      return;
    }
    if (!contentEl.contains(target)) return;
    // 손가락 탭 + 도구 사용 중 → 탭 동작
    if (toolActive() && (mode === 'read' || mode === 'blank')) {
      e.preventDefault();
      tapAction(target, posFromPoint(e.clientX, e.clientY));
      return;
    }
    const span = target.closest('.a');
    if (!span) return;
    if (span.classList.contains('bk') && blanksHidden) {
      e.preventDefault();
      toggleReveal(span.dataset.kg);
      return;
    }
    if (span.dataset.m) {
      e.preventDefault();
      openMemoView(span.dataset.m.split(' ')[0], span);
      return;
    }
    if (span.dataset.h && mode === 'read') {
      e.preventDefault();
      openHlPopover(span);
    }
  }

  // 손가락으로 길게 눌러 선택한 경우의 떠 있는 메뉴
  let selRange = null;
  const checkSelection = debounce(() => {
    if (pointerDown || gesture) return;
    if ((mode !== 'read' && mode !== 'blank') || (mode === 'read' && readTool)) return hideSelMenu();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return hideSelMenu();
    const r = sel.getRangeAt(0);
    if (!contentEl.contains(r.commonAncestorContainer)) return hideSelMenu();
    const rects = r.getClientRects();
    const last = rects[rects.length - 1] || r.getBoundingClientRect();
    selRange = r.cloneRange();
    selMenu.hidden = false;
    const w = selMenu.offsetWidth;
    const h = selMenu.offsetHeight;
    let top = last.bottom + 12;
    if (top + h > window.innerHeight - 80) top = r.getBoundingClientRect().top - h - 12;
    selMenu.style.left = clamp(last.right - w / 2, 12, window.innerWidth - w - 12) + 'px';
    selMenu.style.top = clamp(top, 96, window.innerHeight - h - 12) + 'px';
  }, 260);
  function hideSelMenu() {
    selMenu.hidden = true;
    selRange = null;
  }
  selMenu.addEventListener('pointerdown', (e) => e.preventDefault());
  selMenu.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sel]');
    if (!btn || !selRange) return;
    const pieces = rangeToPieces(selRange);
    const kind = btn.dataset.sel;
    window.getSelection().removeAllRanges();
    hideSelMenu();
    if (!pieces.length) return;
    if (kind === 'hl') addHighlight(pieces, btn.dataset.color);
    else if (kind === 'blank') addBlank(pieces);
    else if (kind === 'memo') openMemoEditor(null, pieces);
  });

  // ================= 빈칸 =================
  function setBlanksHidden(v) {
    blanksHidden = v;
    app.classList.toggle('blanks-hidden', v);
    $('#blankToggle').checked = v;
    ui.blanks = v;
    saveUI();
    updateBlankCount();
  }
  function toggleReveal(g) {
    if (!g) return;
    if (revealed.has(g)) revealed.delete(g);
    else revealed.add(g);
    const on = revealed.has(g);
    for (const el of $$('.a.bk')) if (el.dataset.kg === g) el.classList.toggle('rv', on);
    updateBlankCount();
  }
  function updateBlankCount() {
    const groups = new Set(liveItems('bl').map((x) => x.g || x.id));
    const open = [...groups].filter((g) => revealed.has(g)).length;
    $('#blankCount').textContent = groups.size ? `빈칸 ${groups.size}개` + (blanksHidden ? ` · 연 것 ${open}` : '') : '빈칸 없음';
  }

  // ================= 떠 있는 창(팝오버) =================
  let popState = null;
  function openPopover(html, rect, state, opts) {
    popEl.innerHTML = html;
    popEl.hidden = false;
    popState = state;
    const w = popEl.offsetWidth;
    const h = popEl.offsetHeight;
    const topLimit = crumbsEl.getBoundingClientRect().bottom + 8;
    let left;
    let top;
    if (opts && opts.fixedTop) {
      left = (window.innerWidth - w) / 2;
      top = topLimit + 4;
    } else {
      left = rect.left + rect.width / 2 - w / 2;
      top = rect.bottom + 8;
      if (top + h > window.innerHeight - 76) top = rect.top - h - 8;
    }
    popEl.style.left = clamp(left, 12, window.innerWidth - w - 12) + 'px';
    popEl.style.top = clamp(top, topLimit, Math.max(topLimit, window.innerHeight - h - 12)) + 'px';
  }
  function closePopover() {
    if (popEl.hidden) return;
    popEl.hidden = true;
    popEl.innerHTML = '';
    popState = null;
  }
  function openHlPopover(span) {
    const it = store.hl[span.dataset.h];
    if (!it) return;
    const g = it.g || it.id;
    const sw = COLORS.map((c) => `<button type="button" class="swatch" data-act="color" data-color="${c}" aria-label="${COLOR_NAME[c]}" aria-pressed="${c === it.c}"></button>`).join('');
    openPopover(
      `<div class="pop-row">${sw}<span class="grow"></span><button type="button" class="text-btn" data-act="memo">메모</button><button type="button" class="text-btn danger" data-act="del">지우기</button></div>`,
      span.getBoundingClientRect(),
      { type: 'hl', g }
    );
  }
  function memoQuote(rs) {
    return rs.map((r) => r.t || sliceText(r.b, r.s, r.e)).join(' … ').slice(0, 160);
  }
  function openMemoEditor(id, pieces) {
    const m = id ? store.memo[id] : null;
    const rs = m ? m.rs : pieces;
    if (!rs || !rs.length) return;
    hideSelMenu();
    openPopover(
      `<p class="pop-quote">${escHTML(memoQuote(rs))}</p>
       <textarea id="memoInput" placeholder="메모를 적어 주세요" aria-label="메모 내용"></textarea>
       <div class="pop-row">${m ? '<button type="button" class="text-btn danger" data-act="del">삭제</button>' : ''}<span class="grow"></span>
       <button type="button" class="text-btn" data-act="cancel">취소</button><button type="button" class="text-btn solid" data-act="save">저장</button></div>`,
      null,
      { type: 'memo-edit', id, rs },
      { fixedTop: true }
    );
    const ta = $('#memoInput');
    ta.value = m ? m.text : '';
    setTimeout(() => ta.focus({ preventScroll: true }), 30);
  }
  function openMemoView(id, anchor) {
    const m = store.memo[id];
    if (!m) return;
    if (!app.classList.contains('margin-off') && mode !== 'focus') {
      const card = marginEl.querySelector(`.memo-card[data-id="${id}"]`);
      if (card) {
        card.classList.add('open');
        linkMemo(id, true);
        setTimeout(() => linkMemo(id, false), 1600);
        return;
      }
    }
    openPopover(
      `<p class="pop-title"><span class="mn">${memoNumber.get(id) || ''}</span> 메모</p>
       <p class="pop-quote">${escHTML(memoQuote(m.rs))}</p>
       <div class="pop-text"></div>
       <div class="pop-row"><span class="grow"></span><button type="button" class="text-btn" data-act="edit">고치기</button><button type="button" class="text-btn danger" data-act="del">삭제</button></div>`,
      anchor.getBoundingClientRect(),
      { type: 'memo-view', id }
    );
    $('.pop-text', popEl).textContent = m.text;
  }
  function confirmPop(rect, message, okLabel, onOk, opts) {
    openPopover(
      `<p class="pop-text"></p><div class="pop-row"><span class="grow"></span>${(opts && opts.extra) || ''}<button type="button" class="text-btn" data-act="cancel">취소</button><button type="button" class="text-btn solid" data-act="ok">${escHTML(okLabel)}</button></div>`,
      rect,
      { type: 'confirm', onOk, onExtra: opts && opts.onExtra }
    );
    $('.pop-text', popEl).textContent = message;
  }
  popEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn || !popState) return;
    const act = btn.dataset.act;
    const st = popState;
    if (st.type === 'hl') {
      if (act === 'color') recolorGroup(st.g, btn.dataset.color);
      else if (act === 'del') deleteGroup('hl', st.g);
      else if (act === 'memo') {
        const rs = groupItems('hl', st.g)
          .sort((a, b) => blockIdx.get(a.b) - blockIdx.get(b.b) || a.s - b.s)
          .map((x) => ({ b: x.b, s: x.s, e: x.e, t: x.t }));
        closePopover();
        openMemoEditor(null, rs);
        return;
      }
      closePopover();
    } else if (st.type === 'memo-edit') {
      if (act === 'save') saveMemo(st.id, st.rs, $('#memoInput').value);
      else if (act === 'del' && st.id) commit([{ kind: 'memo', id: st.id, after: null }]);
      closePopover();
    } else if (st.type === 'memo-view') {
      if (act === 'edit') {
        closePopover();
        openMemoEditor(st.id);
        return;
      }
      if (act === 'del') commit([{ kind: 'memo', id: st.id, after: null }]);
      closePopover();
    } else if (st.type === 'confirm') {
      closePopover();
      if (act === 'ok') st.onOk();
      else if (act === 'extra' && st.onExtra) st.onExtra();
    }
  });
  popEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && popState && popState.type === 'memo-edit') {
      e.preventDefault();
      saveMemo(popState.id, popState.rs, $('#memoInput').value);
      closePopover();
    }
  });

  // ================= 여백 메모 카드 =================
  function linkMemo(id, on) {
    for (const el of $$('.a.mm', contentEl)) if (el.dataset.m.split(' ').includes(id)) el.classList.toggle('linked', on);
    const card = marginEl.querySelector(`.memo-card[data-id="${id}"]`);
    if (card) card.classList.toggle('linked', on);
  }
  function layoutMargin() {
    if (app.classList.contains('margin-off') || mode === 'focus') {
      marginEl.replaceChildren();
      return;
    }
    const memos = orderedMemos();
    const existing = new Map($$('.memo-card', marginEl).map((c) => [c.dataset.id, c]));
    const base = marginEl.getBoundingClientRect().top;
    let lastBottom = -Infinity;
    const keep = new Set();
    for (const m of memos) {
      const anchor = $$('.a.mm', contentEl).find((el) => el.dataset.m.split(' ').includes(m.id));
      if (!anchor || !isRendered(anchor)) continue;
      let card = existing.get(m.id);
      if (!card) {
        card = document.createElement('div');
        card.className = 'memo-card';
        card.dataset.id = m.id;
        card.innerHTML =
          '<div class="mc-head"><span class="mn"></span><span class="mc-quote"></span></div><div class="mc-text"></div>' +
          '<div class="mc-foot"><button type="button" data-mact="edit">고치기</button><button type="button" data-mact="del">삭제</button></div>';
        marginEl.appendChild(card);
      }
      keep.add(m.id);
      $('.mn', card).textContent = memoNumber.get(m.id) || '';
      $('.mc-quote', card).textContent = memoQuote(m.rs);
      $('.mc-text', card).textContent = m.text;
      const desired = anchor.getBoundingClientRect().top - base - 8;
      const top = Math.max(desired, lastBottom + 8);
      card.style.top = top + 'px';
      lastBottom = top + card.offsetHeight;
    }
    for (const [id, c] of existing) if (!keep.has(id)) c.remove();
  }
  marginEl.addEventListener('click', (e) => {
    const card = e.target.closest('.memo-card');
    if (!card) return;
    const id = card.dataset.id;
    const act = e.target.closest('[data-mact]');
    if (act && act.dataset.mact === 'edit') openMemoEditor(id);
    else if (act && act.dataset.mact === 'del') commit([{ kind: 'memo', id, after: null }]);
    else if (e.target.closest('.mc-text')) {
      card.classList.toggle('open');
      scheduleLayout();
    }
  });
  marginEl.addEventListener('mouseover', (e) => {
    const card = e.target.closest('.memo-card');
    if (card) linkMemo(card.dataset.id, true);
  });
  marginEl.addEventListener('mouseout', (e) => {
    const card = e.target.closest('.memo-card');
    if (card && !card.contains(e.relatedTarget)) linkMemo(card.dataset.id, false);
  });
  contentEl.addEventListener('mouseover', (e) => {
    const a = e.target.closest('.a.mm');
    if (a) a.dataset.m.split(' ').forEach((id) => linkMemo(id, true));
  });
  contentEl.addEventListener('mouseout', (e) => {
    const a = e.target.closest('.a.mm');
    if (a && !a.contains(e.relatedTarget)) a.dataset.m.split(' ').forEach((id) => linkMemo(id, false));
  });

  // ================= 필기 =================
  const inkGroups = new Map(); // 블록 id → <g>
  const inkPaths = new Map(); // 획 id → <path>
  const inkGeom = new Map(); // 획 id → {pts, bb}
  const origins = new Map(); // 블록 id → {x, y} (#doc 기준)
  function encodePts(pts) {
    const out = [];
    let px = 0;
    let py = 0;
    for (const [x, y] of pts) {
      const ix = Math.round(x * 2);
      const iy = Math.round(y * 2);
      out.push(ix - px, iy - py);
      px = ix;
      py = iy;
    }
    return out;
  }
  function decodePts(arr) {
    const pts = [];
    let x = 0;
    let y = 0;
    for (let i = 0; i + 1 < arr.length; i += 2) {
      x += arr[i];
      y += arr[i + 1];
      pts.push([x / 2, y / 2]);
    }
    return pts;
  }
  function simplify(pts, eps) {
    if (pts.length < 3) return pts;
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      let best = 0;
      let idx = -1;
      const [ax, ay] = pts[a];
      const [bx, by] = pts[b];
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      for (let i = a + 1; i < b; i++) {
        const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
        if (d > best) {
          best = d;
          idx = i;
        }
      }
      if (best > eps && idx > 0) {
        keep[idx] = 1;
        stack.push([a, idx], [idx, b]);
      }
    }
    return pts.filter((_, i) => keep[i]);
  }
  const f1 = (n) => Math.round(n * 10) / 10;
  function pathD(pts) {
    if (!pts.length) return '';
    if (pts.length === 1) return `M${f1(pts[0][0])} ${f1(pts[0][1])}l0.01 0`;
    let d = `M${f1(pts[0][0])} ${f1(pts[0][1])}`;
    if (pts.length === 2) return d + `L${f1(pts[1][0])} ${f1(pts[1][1])}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[i + 1];
      d += `Q${f1(x1)} ${f1(y1)} ${f1((x1 + x2) / 2)} ${f1((y1 + y2) / 2)}`;
    }
    const [lx, ly] = pts[pts.length - 1];
    return d + `L${f1(lx)} ${f1(ly)}`;
  }
  // #ink·#pick 은 #doc 의 padding-box 기준이므로 테두리 두께를 뺀 원점을 쓴다
  function docOrigin() {
    const r = docEl.getBoundingClientRect();
    return { left: r.left + docEl.clientLeft, top: r.top + docEl.clientTop };
  }
  function blockOrigin(b) {
    const el = byId(b);
    if (!el) return null;
    const d = docOrigin();
    const r = el.getBoundingClientRect();
    return { x: r.left - d.left, y: r.top - d.top };
  }
  function groupFor(b) {
    let g = inkGroups.get(b);
    if (!g) {
      g = document.createElementNS(SVGNS, 'g');
      g.dataset.b = b;
      inkSvg.appendChild(g);
      inkGroups.set(b, g);
      positionGroup(b, g);
    }
    return g;
  }
  function positionGroup(b, g) {
    const el = byId(b);
    if (!el || !isRendered(el)) {
      g.style.display = 'none';
      origins.delete(b);
      return;
    }
    const o = blockOrigin(b);
    origins.set(b, o);
    g.style.display = '';
    g.setAttribute('transform', `translate(${f1(o.x)} ${f1(o.y)})`);
  }
  function geomOf(it) {
    let gm = inkGeom.get(it.id);
    if (!gm) {
      const pts = decodePts(it.p || []);
      let x1 = Infinity;
      let y1 = Infinity;
      let x2 = -Infinity;
      let y2 = -Infinity;
      for (const [x, y] of pts) {
        x1 = Math.min(x1, x);
        y1 = Math.min(y1, y);
        x2 = Math.max(x2, x);
        y2 = Math.max(y2, y);
      }
      gm = { pts, bb: { x1, y1, x2, y2 } };
      inkGeom.set(it.id, gm);
    }
    return gm;
  }
  function drawStroke(it) {
    if (!blockIdx.has(it.b)) return;
    const g = groupFor(it.b);
    const path = document.createElementNS(SVGNS, 'path');
    path.setAttribute('d', pathD(geomOf(it).pts));
    path.setAttribute('class', 'p' + (it.c || 'k'));
    path.setAttribute('stroke-width', it.w || 2.6);
    path.dataset.id = it.id;
    g.appendChild(path);
    inkPaths.set(it.id, path);
  }
  function removeStroke(id) {
    const p = inkPaths.get(id);
    if (p) p.remove();
    inkPaths.delete(id);
    inkGeom.delete(id);
  }
  function renderAllInk() {
    for (const id of [...inkPaths.keys()]) removeStroke(id);
    for (const it of liveItems('ink')) drawStroke(it);
  }
  function renderInkChanges(rec) {
    for (const r of rec) {
      if (r.kind !== 'ink') continue;
      removeStroke(r.id);
      const it = store.ink[r.id];
      if (isLive(it)) drawStroke(it);
    }
  }
  function layoutInk() {
    for (const [b, g] of inkGroups) positionGroup(b, g);
  }
  function docPoint(ev) {
    const d = docOrigin();
    return { x: ev.clientX - d.left, y: ev.clientY - d.top };
  }
  function anchorBlockAt(x, y) {
    const els = document.elementsFromPoint(x, y);
    for (const el of els) {
      if (el === inkSvg || inkSvg.contains(el)) continue;
      const host = el.closest && el.closest('[data-b]');
      if (host && contentEl.contains(host)) return host.dataset.b;
    }
    return blockEls[nearestBlockIndex(y + window.scrollY)].dataset.b;
  }

  let stroke = null;
  let erasing = null;
  function onInkDown(e) {
    if (mode !== 'ink') return;
    const t = e.pointerType;
    if (t === 'touch' && !ui.finger) return;
    if (t === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    closePopover();
    try {
      inkSvg.setPointerCapture(e.pointerId);
    } catch (err) {
      /* 무시 */
    }
    const p = docPoint(e);
    if (inkTool === 'erase') {
      erasing = { id: e.pointerId, hits: new Set(), last: p };
      eraseAt(p);
      return;
    }
    const b = anchorBlockAt(e.clientX, e.clientY);
    const o = blockOrigin(b) || { x: 0, y: 0 };
    const path = document.createElementNS(SVGNS, 'path');
    path.setAttribute('class', 'p' + ui.penColor);
    path.setAttribute('stroke-width', ui.penWidth);
    inkSvg.appendChild(path);
    stroke = { id: e.pointerId, b, o, pts: [[p.x, p.y]], path, raf: 0 };
    path.setAttribute('d', pathD(stroke.pts));
  }
  function onInkMove(e) {
    if (erasing && e.pointerId === erasing.id) {
      const p = docPoint(e);
      const steps = Math.max(1, Math.ceil(Math.hypot(p.x - erasing.last.x, p.y - erasing.last.y) / 4));
      for (let i = 1; i <= steps; i++) {
        eraseAt({ x: erasing.last.x + ((p.x - erasing.last.x) * i) / steps, y: erasing.last.y + ((p.y - erasing.last.y) * i) / steps });
      }
      erasing.last = p;
      return;
    }
    if (!stroke || e.pointerId !== stroke.id) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    const d = docOrigin();
    for (const ev of evs.length ? evs : [e]) {
      const x = ev.clientX - d.left;
      const y = ev.clientY - d.top;
      const [lx, ly] = stroke.pts[stroke.pts.length - 1];
      if (Math.hypot(x - lx, y - ly) >= 0.7) stroke.pts.push([x, y]);
    }
    if (!stroke.raf) {
      stroke.raf = requestAnimationFrame(() => {
        if (!stroke) return;
        stroke.raf = 0;
        stroke.path.setAttribute('d', pathD(stroke.pts));
      });
    }
  }
  function onInkUp(e) {
    suppressClickUntil = performance.now() + 400;
    if (erasing && e.pointerId === erasing.id) {
      const hits = [...erasing.hits];
      erasing = null;
      if (hits.length) commit(hits.map((id) => ({ kind: 'ink', id, after: null })));
      return;
    }
    if (!stroke || e.pointerId !== stroke.id) return;
    const s = stroke;
    stroke = null;
    cancelAnimationFrame(s.raf);
    s.path.remove();
    if (e.type === 'pointercancel') return;
    const rel = simplify(s.pts, 0.3).map(([x, y]) => [x - s.o.x, y - s.o.y]);
    commit([{ kind: 'ink', id: uid(), after: { b: s.b, c: ui.penColor, w: ui.penWidth, p: encodePts(rel) } }]);
  }
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = clamp(t, 0, 1);
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }
  function eraseAt(p) {
    const R = 9;
    for (const [id, path] of inkPaths) {
      if (erasing.hits.has(id)) continue;
      const it = store.ink[id];
      if (!isLive(it)) continue;
      const o = origins.get(it.b);
      if (!o) continue;
      const { pts, bb } = geomOf(it);
      const x = p.x - o.x;
      const y = p.y - o.y;
      const r = R + (it.w || 2.6) / 2;
      if (x < bb.x1 - r || x > bb.x2 + r || y < bb.y1 - r || y > bb.y2 + r) continue;
      let hit = pts.length === 1 && Math.hypot(x - pts[0][0], y - pts[0][1]) <= r;
      for (let i = 1; i < pts.length && !hit; i++) if (segDist(x, y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) <= r) hit = true;
      if (hit) {
        erasing.hits.add(id);
        path.classList.add('erasing');
      }
    }
  }
  function clearAllInk(btn) {
    const live = liveItems('ink');
    if (!live.length) {
      toast('지울 필기가 없어요');
      return;
    }
    confirmPop(btn.getBoundingClientRect(), `필기 ${live.length}획을 모두 지울까요? 되돌리기로 다시 살릴 수 있어요.`, '모두 지우기', () =>
      commit(live.map((it) => ({ kind: 'ink', id: it.id, after: null })))
    );
  }

  // 아이패드: 애플펜슬 드래그가 스크롤·확대경·텍스트 선택으로 번지지 않게
  function stylusGuard(e) {
    let stylus = false;
    for (const t of e.changedTouches) if (t.touchType === 'stylus') stylus = true;
    if (!stylus) return;
    if (mode === 'ink' && (e.target === inkSvg || inkSvg.contains(e.target))) e.preventDefault();
    else if ((mode === 'read' || mode === 'blank') && toolActive() && docEl.contains(e.target)) e.preventDefault();
  }
  // 손가락 필기 모드에서 두 손가락으로 스크롤
  let twoFinger = null;
  const avgY = (ts) => (ts[0].clientY + ts[1].clientY) / 2;
  function onTouchStartDoc(e) {
    if (!ui.finger) return;
    if (e.touches.length === 2) {
      twoFinger = { y: avgY(e.touches) };
      if (stroke) {
        stroke.path.remove();
        stroke = null;
      }
      if (gesture) {
        gesture = null;
        clearPick();
      }
    }
  }
  function onTouchMoveDoc(e) {
    if (twoFinger && e.touches.length === 2) {
      const y = avgY(e.touches);
      window.scrollBy(0, twoFinger.y - y);
      twoFinger.y = y;
    }
  }
  function onTouchEndDoc(e) {
    if (e.touches.length < 2) twoFinger = null;
  }

  // ================= 중요 내용 모드 =================
  const focusFilter = { type: 'all', colors: new Set(COLORS) };
  function renderFocus() {
    const units = new Map();
    const orphanList = [];
    const unitFor = (b) => {
      const el = byId(b);
      if (!el) return null;
      let key = el;
      if (el.matches('td, th')) key = el.closest('.table-wrap') || el;
      let u = units.get(key);
      if (!u) {
        u = { key, order: blockIdx.get(b), b, colors: new Set(), memos: [] };
        units.set(key, u);
      }
      if (blockIdx.get(b) < u.order) {
        u.order = blockIdx.get(b);
        u.b = b;
      }
      return u;
    };
    const hls = liveItems('hl');
    const memos = liveItems('memo');
    for (const h of hls) {
      if (orphans.has('hl:' + h.id)) {
        orphanList.push({ kind: 'hl', it: h });
        continue;
      }
      const u = unitFor(h.b);
      if (u) u.colors.add(h.c);
    }
    for (const m of memos) {
      if (orphans.has('memo:' + m.id)) {
        orphanList.push({ kind: 'memo', it: m });
        continue;
      }
      const u = unitFor(m.rs[0].b);
      if (u) u.memos.push(m);
    }
    const list = [...units.values()]
      .filter((u) => {
        const hasHl = [...u.colors].some((c) => focusFilter.colors.has(c));
        const hasMemo = u.memos.length > 0;
        if (focusFilter.type === 'hl') return hasHl;
        if (focusFilter.type === 'memo') return hasMemo;
        return hasHl || hasMemo;
      })
      .sort((a, b) => a.order - b.order);

    const frag = document.createDocumentFragment();
    const head = document.createElement('div');
    head.className = 'f-head';
    head.innerHTML = `<h2>중요 내용 모아보기</h2><span class="f-count">하이라이트 ${new Set(hls.map((h) => h.g || h.id)).size}곳 · 메모 ${memos.length}개</span>`;
    frag.appendChild(head);
    if (!hls.length && !memos.length) {
      const empty = document.createElement('div');
      empty.className = 'f-empty';
      empty.innerHTML = '<strong>아직 모인 내용이 없어요</strong>일반 모드에서 하이라이트를 치거나 메모를 달면<br>그 부분이 들어 있는 블록이 여기에 쟁점별로 모여요.';
      frag.appendChild(empty);
    } else if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'f-empty';
      empty.innerHTML = '<strong>조건에 맞는 내용이 없어요</strong>아래 도구막대에서 보기 종류나 색을 바꿔 보세요.';
      frag.appendChild(empty);
    }
    let group = null;
    let groupSec;
    for (const u of list) {
      const sec = blockSec[u.order];
      if (!group || sec !== groupSec) {
        group = document.createElement('section');
        group.className = 'f-group';
        groupSec = sec;
        const path = document.createElement('div');
        path.className = 'f-path';
        (sec ? pathOf(sec) : []).forEach((h, i) => {
          if (i) path.insertAdjacentHTML('beforeend', '<span class="sep">›</span>');
          const bt = document.createElement('button');
          bt.type = 'button';
          bt.dataset.gohead = h.i;
          bt.textContent = h.t;
          path.appendChild(bt);
        });
        if (!sec) path.textContent = '문서 첫머리';
        group.appendChild(path);
        frag.appendChild(group);
      }
      group.appendChild(focusCard(u));
    }
    if (orphanList.length) {
      const g = document.createElement('section');
      g.className = 'f-group';
      g.innerHTML = '<div class="f-path"><button type="button" disabled>원문에서 위치를 찾지 못한 항목</button></div>';
      for (const { kind, it } of orphanList) {
        const card = document.createElement('div');
        card.className = 'f-card';
        const body = document.createElement('div');
        body.className = 'f-body';
        const p = document.createElement('p');
        const span = document.createElement('span');
        span.className = kind === 'hl' ? 'a hl-' + it.c : '';
        span.textContent = kind === 'hl' ? it.t : memoQuote(it.rs);
        p.appendChild(span);
        body.appendChild(p);
        card.appendChild(body);
        if (kind === 'memo') card.appendChild(memoNote(it));
        g.appendChild(card);
      }
      frag.appendChild(g);
    }
    focusEl.replaceChildren(frag);
  }
  function memoNote(m) {
    const note = document.createElement('div');
    note.className = 'f-memo';
    note.innerHTML = `<span class="mn">${memoNumber.get(m.id) || ''}</span><div class="f-memo-text"></div>`;
    $('.f-memo-text', note).textContent = m.text;
    return note;
  }
  function focusCard(u) {
    const card = document.createElement('article');
    card.className = 'f-card';
    const top = document.createElement('div');
    top.className = 'f-card-top';
    const callout = u.key.closest('.callout');
    if (callout) {
      const chip = document.createElement('span');
      chip.className = 'f-ctx';
      chip.style.setProperty('--c', `var(--cl-${callout.dataset.callout}, var(--cl-case))`);
      chip.textContent = callout.dataset.label;
      top.appendChild(chip);
      const ct = callout.querySelector(':scope > .callout-title .ct');
      if (ct && !u.key.closest('.callout-title')) {
        const t = document.createElement('span');
        t.className = 'f-ctx-title';
        t.textContent = ct.textContent;
        top.appendChild(t);
      }
    }
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'text-btn f-go';
    go.dataset.go = u.b;
    go.textContent = '원문 보기';
    top.appendChild(go);
    card.appendChild(top);
    const body = document.createElement('div');
    body.className = 'f-body';
    if (callout) {
      body.style.setProperty('--c', `var(--cl-${callout.dataset.callout}, var(--cl-case))`);
      body.dataset.callout = callout.dataset.callout;
    }
    const c = u.key.cloneNode(true);
    for (const el of [c, ...c.querySelectorAll('[id],[data-b]')]) {
      el.removeAttribute('id');
      el.removeAttribute('data-b');
    }
    c.classList.remove('flash');
    if (u.key.classList.contains('ct')) {
      const wrap = document.createElement('div');
      wrap.className = 'callout-title';
      wrap.appendChild(c);
      body.appendChild(wrap);
    } else body.appendChild(c);
    card.appendChild(body);
    u.memos.sort((a, b) => (memoNumber.get(a.id) || 0) - (memoNumber.get(b.id) || 0)).forEach((m) => card.appendChild(memoNote(m)));
    return card;
  }
  focusEl.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (go) {
      setMode('read');
      requestAnimationFrame(() => scrollToBlock(go.dataset.go));
      return;
    }
    const gh = e.target.closest('[data-gohead]');
    if (gh) {
      goToHeading(toc[+gh.dataset.gohead]);
      return;
    }
    const bk = e.target.closest('.a.bk');
    if (bk && blanksHidden) toggleReveal(bk.dataset.kg);
  });

  // ================= 목차 · 현재 위치 =================
  const TRI = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2.5l4.5 3.5L4 9.5z"/></svg>';
  const CHECK = '<i><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.6 6.3l2.3 2.3 4.6-4.8"/></svg></i>';
  function buildToc() {
    const root = document.createElement('ul');
    const lis = new Map();
    for (const h of toc) {
      const li = document.createElement('li');
      const row = document.createElement('div');
      row.className = 'toc-row';
      row.dataset.lv = h.lv;
      const tw = document.createElement('button');
      tw.type = 'button';
      tw.className = 'tw' + (h.children.length ? '' : ' leaf');
      tw.innerHTML = TRI;
      tw.setAttribute('aria-label', h.t + ' 펼치기·접기');
      tw.dataset.i = h.i;
      const ck = document.createElement('button');
      ck.type = 'button';
      ck.className = 'ck';
      ck.dataset.i = h.i;
      ck.setAttribute('role', 'checkbox');
      ck.setAttribute('aria-checked', 'false');
      ck.setAttribute('aria-label', h.t + ' 공부 완료');
      ck.innerHTML = CHECK;
      const a = document.createElement('a');
      a.href = '#' + h.id;
      a.textContent = h.t;
      a.dataset.i = h.i;
      row.append(tw, ck, a);
      if (h.children.length) {
        const pct = document.createElement('span');
        pct.className = 'pct';
        row.appendChild(pct);
        h.pct = pct;
      }
      h.ck = ck;
      li.appendChild(row);
      if (h.children.length) {
        li.appendChild(document.createElement('ul'));
        if (h.lv > 1) li.classList.add('collapsed');
      }
      (h.parent ? lis.get(h.parent).lastElementChild : root).appendChild(li);
      lis.set(h, li);
      h.li = li;
      h.row = row;
    }
    tocTree.appendChild(root);
  }
  tocTree.addEventListener('click', (e) => {
    const ck = e.target.closest('.ck');
    if (ck) {
      toggleHeading(toc[+ck.dataset.i]);
      return;
    }
    const tw = e.target.closest('.tw');
    if (tw) {
      toc[+tw.dataset.i].li.classList.toggle('collapsed');
      return;
    }
    const a = e.target.closest('a[data-i]');
    if (a) {
      e.preventDefault();
      goToHeading(toc[+a.dataset.i]);
      if (!isWide()) setToc(false);
    }
  });
  $('#tocFilter').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    const visit = (h) => {
      const self = !q || h.t.toLowerCase().includes(q);
      let child = false;
      for (const c of h.children) if (visit(c)) child = true;
      const show = self || child;
      h.li.classList.toggle('filtered-out', !show);
      if (q && child) h.li.classList.remove('collapsed');
      return show;
    };
    toc.filter((h) => !h.parent).forEach(visit);
  });
  $('#tocExpand').addEventListener('click', () => toc.forEach((h) => h.li.classList.remove('collapsed')));
  $('#tocCollapse').addEventListener('click', () => toc.forEach((h) => h.children.length && h.li.classList.add('collapsed')));

  const isWide = () => window.innerWidth >= 1180;
  function setToc(open, persist) {
    app.classList.toggle('toc-open', open);
    app.classList.toggle('toc-pinned', open && isWide());
    $('#scrim').hidden = !(open && !isWide());
    $('#btnToc').setAttribute('aria-expanded', String(open));
    if (persist && isWide()) {
      ui.toc = open;
      saveUI();
    }
    if (open) setTimeout(() => revealActiveInToc(), 220);
    scheduleLayout();
  }
  $('#btnToc').addEventListener('click', () => setToc(!app.classList.contains('toc-open'), true));
  $('#tocClose').addEventListener('click', () => setToc(false, true));
  $('#scrim').addEventListener('click', () => setToc(false));

  const topOffset = () => crumbsEl.getBoundingClientRect().bottom;
  let headTops = [];
  function measureHeadings() {
    const sy = window.scrollY;
    headTops = toc.map((h) => (h.el ? h.el.getBoundingClientRect().top + sy : 0));
  }
  function currentHeading() {
    const y = window.scrollY + topOffset() + 28;
    let lo = 0;
    let hi = headTops.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (headTops[mid] <= y) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans >= 0 ? toc[ans] : null;
  }
  let activeH;
  function updateActive(force) {
    if (mode === 'focus') return;
    const h = currentHeading();
    if (h === activeH && !force) return;
    activeH = h;
    renderCrumbs();
    for (const el of $$('.toc-row.active', tocTree)) el.classList.remove('active');
    for (const el of $$('li.in-path', tocTree)) el.classList.remove('in-path');
    if (!h) return;
    h.row.classList.add('active');
    for (let x = h.parent; x; x = x.parent) {
      x.li.classList.add('in-path');
      x.li.classList.remove('collapsed');
    }
    revealActiveInToc();
  }
  function revealActiveInToc() {
    if (!activeH || !app.classList.contains('toc-open')) return;
    const row = activeH.row;
    const tr = tocTree.getBoundingClientRect();
    const rr = row.getBoundingClientRect();
    if (rr.top < tr.top + 20 || rr.bottom > tr.bottom - 60) tocTree.scrollTop += rr.top - tr.top - tr.height / 3;
  }
  const crumbPath = $('.crumb-path', crumbsEl);
  function renderCrumbs() {
    crumbPath.replaceChildren();
    updateSecDone();
    if (mode === 'focus') {
      const n = document.createElement('span');
      n.className = 'crumb-note';
      n.textContent = '중요 내용 모아보기 · 하이라이트와 메모가 있는 블록을 쟁점별로 모았어요';
      crumbPath.appendChild(n);
      return;
    }
    const path = activeH ? pathOf(activeH) : [];
    if (!path.length) {
      const n = document.createElement('span');
      n.className = 'crumb-note';
      n.textContent = DATA.title;
      crumbPath.appendChild(n);
      return;
    }
    path.forEach((h, i) => {
      if (i) {
        const s = document.createElement('span');
        s.className = 'sep';
        s.textContent = '›';
        crumbPath.appendChild(s);
      }
      const bt = document.createElement('button');
      bt.type = 'button';
      bt.textContent = h.t;
      bt.title = h.t;
      bt.addEventListener('click', () => goToHeading(h));
      crumbPath.appendChild(bt);
    });
  }

  // ================= 진도(쟁점별 완료 체크) =================
  // 각 제목의 가중치 = 그 제목부터 다음 제목 전까지의 블록 수. 상위 제목은 하위 전체를 합산한다.
  const ownWeight = new Array(toc.length).fill(0);
  blockSec.forEach((h) => {
    if (h) ownWeight[h.i]++;
  });
  const headKey = (h) => h.el.dataset.b;
  const isDoneH = (h) => isLive(store.prog[headKey(h)]);
  function subtreeOf(h) {
    const out = [h];
    for (const c of h.children) out.push(...subtreeOf(c));
    return out;
  }
  function computeProgress() {
    const res = new Array(toc.length);
    const visit = (h) => {
      let total = ownWeight[h.i] || 1;
      let done = isDoneH(h) ? total : 0;
      for (const c of h.children) {
        const r = visit(c);
        total += r.total;
        done += r.done;
      }
      res[h.i] = { total, done };
      return res[h.i];
    };
    let total = 0;
    let done = 0;
    for (const h of toc) {
      if (h.parent) continue;
      const r = visit(h);
      total += r.total;
      done += r.done;
    }
    return { res, total, done };
  }
  const pctOf = (done, total) => (done >= total ? 100 : Math.floor((done / total) * 100));
  function updateProgress() {
    const p = computeProgress();
    for (const h of toc) {
      const r = p.res[h.i];
      const pct = pctOf(r.done, r.total);
      const state = r.done >= r.total ? 'all' : r.done > 0 ? 'part' : 'none';
      h.ck.dataset.state = state;
      h.ck.style.setProperty('--p', pct);
      h.ck.setAttribute('aria-checked', state === 'all' ? 'true' : state === 'part' ? 'mixed' : 'false');
      h.row.classList.toggle('is-done', state === 'all');
      if (h.pct) h.pct.textContent = pct ? pct + '%' : '';
    }
    const pct = p.total ? pctOf(p.done, p.total) : 0;
    $('#progPct').textContent = pct + '%';
    $('#progCount').textContent = `완료 ${toc.filter(isDoneH).length}/${toc.length}곳`;
    $('#progBar i').style.width = pct + '%';
    $('#progBar').setAttribute('aria-valuenow', String(pct));
    updateSecDone();
  }
  // 하위가 있는 제목은 아래 쟁점 전체를 한 번에 완료/해제, 경로 바의 버튼(ownOnly)은 그 제목 구간만
  function toggleHeading(h, ownOnly) {
    if (!h) return;
    const targets = ownOnly || !h.children.length ? [h] : subtreeOf(h);
    const allDone = targets.every(isDoneH);
    commit(
      targets
        .filter((x) => isDoneH(x) === allDone)
        .map((x) => ({ kind: 'prog', id: headKey(x), after: allDone ? null : { b: headKey(x), done: 1 } }))
    );
  }
  function updateSecDone() {
    const btn = $('#secDone');
    if (mode === 'focus' || !activeH) {
      btn.hidden = true;
      return;
    }
    btn.hidden = false;
    const done = isDoneH(activeH);
    btn.setAttribute('aria-pressed', String(done));
    $('span', btn).textContent = done ? '완료' : '완료 표시';
    btn.title = `${activeH.t} — ${done ? '누르면 완료 해제' : '이 부분을 공부 완료로 표시'}`;
  }
  $('#secDone').addEventListener('click', () => toggleHeading(activeH, true));

  // ================= 메모 여백 접기 =================
  function updateMemoToggle(canMargin, count) {
    const btn = $('#memoToggle');
    btn.hidden = !(canMargin && count > 0 && mode !== 'focus');
    btn.setAttribute('aria-expanded', String(ui.memoOpen));
    $('span', btn).textContent = ui.memoOpen ? '메모 접기' : `메모 ${count}개 펼치기`;
  }
  function toggleMemoPanel() {
    if ($('#memoToggle').hidden) return;
    ui.memoOpen = !ui.memoOpen;
    saveUI();
    scheduleLayout();
  }
  $('#memoToggle').addEventListener('click', toggleMemoPanel);
  function scrollToY(y, smooth) {
    window.scrollTo({ top: Math.max(0, y), behavior: smooth ? 'smooth' : 'auto' });
  }
  function goToHeading(h) {
    if (!h) return;
    if (mode === 'focus') setMode('read');
    requestAnimationFrame(() => {
      const y = h.el.getBoundingClientRect().top + window.scrollY - topOffset() - 14;
      scrollToY(y);
    });
  }
  function flash(el) {
    if (!el) return;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1500);
  }
  function scrollToBlock(b) {
    const el = byId(b);
    if (!el) return;
    const det = el.closest('details:not([open])');
    if (det) det.open = true;
    const y = el.getBoundingClientRect().top + window.scrollY - topOffset() - 80;
    scrollToY(y);
    flash(el);
  }
  function jumpToAnchor(id) {
    const a = document.getElementById(id);
    if (!a) return;
    const target = a.previousElementSibling || a.parentElement;
    const y = target.getBoundingClientRect().top + window.scrollY - topOffset() - 20;
    scrollToY(y);
    flash(target);
  }

  // ================= 자동 스크롤 =================
  const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5];
  const BASE_PX = 34;
  const auto = { on: false, raf: 0, last: 0, acc: 0, hold: 0 };
  let wakeLock = null;
  function setAuto(on) {
    auto.on = on;
    $('#autoPlay').setAttribute('aria-pressed', String(on));
    cancelAnimationFrame(auto.raf);
    if (on) {
      auto.last = performance.now();
      auto.acc = 0;
      auto.raf = requestAnimationFrame(tickAuto);
      if (navigator.wakeLock && navigator.wakeLock.request) {
        navigator.wakeLock
          .request('screen')
          .then((l) => (wakeLock = l))
          .catch(() => {});
      }
    } else if (wakeLock) {
      wakeLock.release().catch(() => {});
      wakeLock = null;
    }
  }
  function tickAuto(now) {
    if (!auto.on) return;
    const dt = Math.min(now - auto.last, 100);
    auto.last = now;
    if (now > auto.hold && !gesture && !stroke) {
      auto.acc += (BASE_PX * ui.speed * dt) / 1000;
      const px = Math.floor(auto.acc);
      if (px >= 1) {
        auto.acc -= px;
        window.scrollBy(0, px);
        if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
          setAuto(false);
          toast('끝까지 내려왔어요');
          return;
        }
      }
    }
    auto.raf = requestAnimationFrame(tickAuto);
  }
  function setSpeed(dir) {
    let i = SPEEDS.indexOf(ui.speed);
    if (i < 0) i = 3;
    i = clamp(i + dir, 0, SPEEDS.length - 1);
    ui.speed = SPEEDS[i];
    $('#speedLabel').textContent = ui.speed + '×';
    saveUI();
  }
  const holdAuto = () => {
    if (auto.on) auto.hold = performance.now() + 1600;
  };

  // ================= 모드 · 도구 =================
  let docScrollY = 0;
  function setMode(m) {
    if (m === mode) return;
    const prev = mode;
    closePopover();
    hideSelMenu();
    clearPick();
    if (m === 'focus') docScrollY = window.scrollY;
    mode = m;
    app.dataset.mode = m;
    for (const b of $$('#modeTabs [role=tab]')) b.setAttribute('aria-selected', String(b.dataset.mode === m));
    if (m === 'blank') setBlanksHidden(true);
    if (m === 'focus') {
      renderFocus();
      focusEl.hidden = false;
      window.scrollTo(0, 0);
    } else {
      focusEl.hidden = true;
      if (prev === 'focus') {
        requestAnimationFrame(() => {
          window.scrollTo(0, docScrollY);
          scheduleLayout();
        });
      }
    }
    syncToolUI();
    renderCrumbs();
    if (m !== 'focus') updateActive(true);
    scheduleLayout();
  }
  function syncToolUI() {
    for (const b of $$('.tb-panel[data-for=read] [data-tool]')) {
      const on = b.dataset.tool === readTool && (readTool !== 'hl' || b.dataset.color === ui.hlColor);
      b.setAttribute('aria-pressed', String(on));
    }
    for (const b of $$('.tb-panel[data-for=blank] [data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === blankTool));
    for (const b of $$('.tb-panel[data-for=ink] .pen')) b.setAttribute('aria-pressed', String(inkTool === 'pen' && b.dataset.color === ui.penColor));
    for (const b of $$('.tb-panel[data-for=ink] .width')) b.setAttribute('aria-pressed', String(+b.dataset.width === ui.penWidth));
    $('[data-tool=inkErase]').setAttribute('aria-pressed', String(inkTool === 'erase'));
    app.classList.toggle('tool-active', toolActive());
    app.classList.toggle('ink-erasing', inkTool === 'erase');
  }
  function firstToolHint() {
    if (ui.hinted) return;
    ui.hinted = true;
    saveUI();
    toast('펜·마우스로 끌면 단어 단위로 적용돼요. 손가락으로 끌면 스크롤이에요.', 4200);
  }
  $('#toolbar').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const tool = b.dataset.tool;
    if (b.id === 'undo') return undo();
    if (b.id === 'redo') return redo();
    if (b.id === 'autoPlay') return setAuto(!auto.on);
    if (b.id === 'speedUp') return setSpeed(1);
    if (b.id === 'speedDown') return setSpeed(-1);
    if (b.id === 'hideAll') {
      revealed.clear();
      for (const el of $$('.a.bk.rv')) el.classList.remove('rv');
      setBlanksHidden(true);
      return;
    }
    if (b.id === 'showAll') {
      for (const x of liveItems('bl')) revealed.add(x.g || x.id);
      for (const el of $$('.a.bk')) el.classList.add('rv');
      updateBlankCount();
      return;
    }
    if (b.id === 'inkClear') return clearAllInk(b);
    if (b.dataset.ftype) {
      focusFilter.type = b.dataset.ftype;
      for (const c of $$('[data-ftype]')) c.setAttribute('aria-pressed', String(c === b));
      return renderFocus();
    }
    if (b.dataset.fcolor) {
      const c = b.dataset.fcolor;
      if (focusFilter.colors.has(c) && focusFilter.colors.size > 1) focusFilter.colors.delete(c);
      else focusFilter.colors.add(c);
      for (const s of $$('[data-fcolor]')) s.setAttribute('aria-pressed', String(focusFilter.colors.has(s.dataset.fcolor)));
      return renderFocus();
    }
    if (b.classList.contains('width')) {
      ui.penWidth = +b.dataset.width;
      inkTool = 'pen';
      saveUI();
      return syncToolUI();
    }
    if (!tool) return;
    if (mode === 'read') {
      if (tool === 'hl') {
        const same = readTool === 'hl' && ui.hlColor === b.dataset.color;
        readTool = same ? null : 'hl';
        ui.hlColor = b.dataset.color;
        saveUI();
      } else readTool = readTool === tool ? null : tool;
      if (readTool) firstToolHint();
      window.getSelection().removeAllRanges();
    } else if (mode === 'blank') {
      blankTool = tool;
    } else if (mode === 'ink') {
      if (tool === 'pen') {
        inkTool = 'pen';
        ui.penColor = b.dataset.color;
        saveUI();
      } else if (tool === 'inkErase') inkTool = inkTool === 'erase' ? 'pen' : 'erase';
    }
    syncToolUI();
  });
  $('#modeTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (b) setMode(b.dataset.mode);
  });
  $('#blankToggle').addEventListener('change', (e) => setBlanksHidden(e.target.checked));

  // ================= 설정 메뉴 =================
  const hostTheme = document.documentElement.getAttribute('data-theme');
  function applyTheme() {
    if (ui.theme === 'auto') {
      if (hostTheme) document.documentElement.setAttribute('data-theme', hostTheme);
      else document.documentElement.removeAttribute('data-theme');
    } else document.documentElement.setAttribute('data-theme', ui.theme);
    for (const b of $$('[data-theme-opt]')) b.setAttribute('aria-pressed', String(b.dataset.themeOpt === ui.theme));
  }
  function toggleMenu(open) {
    menuEl.hidden = !open;
    $('#btnMenu').setAttribute('aria-expanded', String(open));
  }
  $('#btnMenu').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMenu(menuEl.hidden);
  });
  menuEl.addEventListener('click', (e) => {
    const t = e.target.closest('[data-theme-opt]');
    if (t) {
      ui.theme = t.dataset.themeOpt;
      saveUI();
      applyTheme();
    }
  });
  $('#optInk').addEventListener('change', (e) => {
    ui.showInk = e.target.checked;
    app.classList.toggle('hide-ink', !ui.showInk);
    saveUI();
  });
  $('#optFinger').addEventListener('change', (e) => {
    ui.finger = e.target.checked;
    app.classList.toggle('finger-draw', ui.finger);
    saveUI();
    if (ui.finger) toast('손가락으로 쓰는 동안 스크롤은 두 손가락으로 해요', 3200);
  });
  $('#btnExport').addEventListener('click', exportBackup);
  $('#btnImport').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', importBackup);

  // ================= 알림 =================
  let toastTimer = 0;
  function toast(msg, ms) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms || 2200);
  }

  // ================= 레이아웃 갱신 =================
  let layoutRaf = 0;
  function scheduleLayout() {
    if (!layoutRaf) {
      layoutRaf = requestAnimationFrame(() => {
        layoutRaf = 0;
        doLayout();
      });
    }
  }
  function doLayout() {
    const main = $('#main');
    // 메모 여백은 화면에 들어가고, 펼쳐 두었고, 메모가 있을 때만. 아니면 숨겨서 본문이 가운데 온다
    const canMargin = main.clientWidth >= 760 + 22 + 248 + 36;
    const memoCount = orderedMemos().length;
    app.classList.toggle('margin-off', !(canMargin && ui.memoOpen && memoCount > 0));
    updateMemoToggle(canMargin, memoCount);
    blockTops = null;
    measureHeadings();
    layoutInk();
    layoutMargin();
    updateActive();
  }

  // ================= 저장(이 기기) =================
  const LOCAL_KEY = DATA.docKey + ':state';
  const Local = {
    mode: 'none',
    db: null,
    init() {
      return new Promise((resolve) => {
        let done = false;
        const fallback = () => {
          if (done) return;
          done = true;
          try {
            localStorage.setItem('__mb2', '1');
            localStorage.removeItem('__mb2');
            this.mode = 'ls';
          } catch (e) {
            this.mode = 'none';
          }
          resolve();
        };
        try {
          if (!window.indexedDB) return fallback();
          const req = indexedDB.open('minbeop2-study', 1);
          req.onupgradeneeded = () => req.result.createObjectStore('kv');
          req.onsuccess = () => {
            if (done) return;
            done = true;
            this.db = req.result;
            this.mode = 'idb';
            resolve();
          };
          req.onerror = fallback;
          req.onblocked = fallback;
          setTimeout(fallback, 2500);
        } catch (e) {
          fallback();
        }
      });
    },
    load() {
      if (this.mode === 'idb') {
        return new Promise((resolve) => {
          try {
            const r = this.db.transaction('kv').objectStore('kv').get(LOCAL_KEY);
            r.onsuccess = () => resolve(r.result || null);
            r.onerror = () => resolve(null);
          } catch (e) {
            resolve(null);
          }
        });
      }
      if (this.mode === 'ls') {
        try {
          return Promise.resolve(JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null'));
        } catch (e) {
          return Promise.resolve(null);
        }
      }
      return Promise.resolve(null);
    },
    save(obj) {
      if (this.mode === 'idb') {
        try {
          this.db.transaction('kv', 'readwrite').objectStore('kv').put(obj, LOCAL_KEY);
        } catch (e) {
          /* 무시 */
        }
      } else if (this.mode === 'ls') {
        try {
          localStorage.setItem(LOCAL_KEY, JSON.stringify(obj));
        } catch (e) {
          toast('이 기기의 저장 공간이 가득 찼어요. 백업을 내보내 두세요.', 4000);
        }
      }
    },
  };
  let saveTimer = 0;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 400);
  }
  function saveNow() {
    clearTimeout(saveTimer);
    Local.save({ v: 1, items: store });
  }
  let persistAsked = false;
  function requestPersist() {
    if (persistAsked) return;
    persistAsked = true;
    try {
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    } catch (e) {
      /* 무시 */
    }
  }
  function mergeItems(items, opts) {
    const touched = new Set();
    let inkChanged = false;
    let any = false;
    if (!items) return { touched, inkChanged, any };
    for (const kind of KINDS) {
      const src = items[kind];
      if (!src) continue;
      for (const id of Object.keys(src)) {
        const inc = src[id];
        if (!inc || typeof inc !== 'object') continue;
        const cur = store[kind][id];
        if (cur && !(inc.u > cur.u)) continue;
        const it = Object.assign({}, inc, { id });
        if (opts && opts.bump) it.u = opts.bump;
        touchedBlocks(kind, isLive(cur) ? cur : null, isLive(it) ? it : null, touched);
        store[kind][id] = it;
        if (kind === 'ink') inkChanged = true;
        any = true;
        if (opts && opts.dirty) markDirty(kind, it);
      }
    }
    return { touched, inkChanged, any };
  }
  function refreshAfterMerge(res) {
    if (!res.any) return;
    resolveAnchors();
    if (res.touched.size) refreshBlocks(res.touched);
    if (res.inkChanged) renderAllInk();
    updateProgress();
    scheduleLayout();
    scheduleSave();
    if (mode === 'focus') renderFocus();
  }

  // ================= 클라우드 동기화(claude.ai 아티팩트로 열었을 때) =================
  const cloud = { col: null, dirty: new Set(), timer: 0, writing: false, remote: new Map(), ready: false };
  function bucket(id, n) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return h % n;
  }
  function shardKey(kind, it) {
    if (kind === 'prog') return 'p.0';
    const sec = it && it.b ? secOf(it.b) : null;
    if (kind === 'ink') {
      const s = sec ? ancestorUpTo(sec, 3) : null;
      return 'i' + (s ? s.i : 'x') + '.' + bucket(it.id, 4);
    }
    const s = sec ? ancestorUpTo(sec, 2) : null;
    return 'm' + (s ? s.i : 'x') + '.' + bucket(it.id, 2);
  }
  function markDirty(kind, it) {
    if (!cloud.col || !it) return;
    cloud.dirty.add(shardKey(kind, it));
    scheduleFlush();
  }
  function scheduleFlush(ms) {
    if (!cloud.col) return;
    setSync('syncing');
    clearTimeout(cloud.timer);
    cloud.timer = setTimeout(flush, ms || 1500);
  }
  function collectShard(key) {
    const out = {};
    const cutoff = Date.now() - 30 * DAY;
    for (const kind of KINDS) {
      for (const id of Object.keys(store[kind])) {
        const it = store[kind][id];
        if (shardKey(kind, it) !== key) continue;
        if (it.del && it.u < cutoff) {
          delete store[kind][id];
          continue;
        }
        (out[kind] = out[kind] || {})[id] = it;
      }
    }
    return out;
  }
  function sameItems(a, b) {
    for (const kind of KINDS) {
      const x = (a && a[kind]) || {};
      const y = (b && b[kind]) || {};
      const kx = Object.keys(x);
      if (kx.length !== Object.keys(y).length) return false;
      for (const id of kx) if (!y[id] || y[id].u !== x[id].u) return false;
    }
    return true;
  }
  async function flush() {
    cloud.timer = 0;
    if (!cloud.col) return;
    if (cloud.writing) {
      scheduleFlush();
      return;
    }
    cloud.writing = true;
    let key = null;
    let failed = false;
    try {
      while (cloud.dirty.size) {
        key = cloud.dirty.values().next().value;
        cloud.dirty.delete(key);
        const ref = cloud.col.doc(key);
        const snap = await ref.get();
        const remote = snap.exists ? (snap.data() || {}).items || {} : {};
        refreshAfterMerge(mergeItems(remote));
        const items = collectShard(key);
        if (sameItems(items, remote)) continue;
        const body = { v: 1, at: Date.now(), items };
        if (JSON.stringify(body).length > 250000) {
          toast('이 구간은 필기가 많아 클라우드 한도를 넘었어요. 이 기기에는 저장돼 있어요.', 4200);
          continue;
        }
        await ref.set(body);
        cloud.remote.set(key, items);
        key = null;
      }
      setSync('synced');
    } catch (err) {
      failed = true;
      if (key) cloud.dirty.add(key);
      setSync('error');
    } finally {
      cloud.writing = false;
      if (cloud.dirty.size) {
        if (failed) {
          clearTimeout(cloud.timer);
          cloud.timer = setTimeout(flush, 15000);
        } else if (!cloud.timer) scheduleFlush();
      }
    }
  }
  async function initCloud() {
    if (!window.claude || typeof window.claude.use !== 'function') return;
    let db = null;
    let user = null;
    try {
      [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
    } catch (e) {
      return;
    }
    if (!db || !user || typeof user.id !== 'function') return;
    let id = null;
    try {
      id = await user.id();
    } catch (e) {
      id = null;
    }
    if (!id) return;
    try {
      cloud.col = db.collection('data/users/' + id);
    } catch (e) {
      return;
    }
    setSync('syncing');
    cloud.col.onSnapshot(
      (snap) => {
        const changes = snap.docChanges ? snap.docChanges() : snap.docs.map((d) => ({ type: 'added', doc: d }));
        const merged = { touched: new Set(), inkChanged: false, any: false };
        for (const ch of changes) {
          if (ch.type === 'removed') continue;
          const items = (ch.doc.data() || {}).items || {};
          cloud.remote.set(ch.doc.id, items);
          const r = mergeItems(items);
          r.touched.forEach((b) => merged.touched.add(b));
          merged.inkChanged = merged.inkChanged || r.inkChanged;
          merged.any = merged.any || r.any;
        }
        refreshAfterMerge(merged);
        if (!cloud.ready) {
          cloud.ready = true;
          for (const kind of KINDS) {
            for (const it of Object.values(store[kind])) {
              const key = shardKey(kind, it);
              const rem = cloud.remote.get(key);
              const ri = rem && rem[kind] && rem[kind][it.id];
              if (!ri || ri.u < it.u) cloud.dirty.add(key);
            }
          }
          if (cloud.dirty.size) scheduleFlush(300);
          else setSync('synced');
        }
      },
      () => setSync('error')
    );
  }
  function setSync(state) {
    const el = $('#syncStatus');
    const label = { local: '이 기기에 저장', syncing: '동기화 중', synced: '동기화됨', error: '동기화 오류', nostore: '저장 안 됨' }[state];
    el.dataset.state = state;
    el.textContent = label;
    const ex = $('#syncExplain');
    if (state === 'nostore') ex.textContent = '이 브라우저에서는 저장이 막혀 있어요. 창을 닫기 전에 백업 내보내기로 파일을 받아 두세요.';
    else if (cloud.col)
      ex.textContent = 'claude.ai 계정에 저장돼서 PC와 아이패드에서 같은 하이라이트·빈칸·메모·필기를 이어서 볼 수 있어요. 이 기기에도 함께 저장돼요.' + (state === 'error' ? ' 지금은 연결이 끊겨 이 기기에만 저장 중이에요. 다시 연결되면 자동으로 맞춰요.' : '');
    else ex.textContent = '이 기기의 브라우저에 저장돼요. 다른 기기로 옮기려면 백업을 내보낸 뒤 그 기기에서 가져오세요. claude.ai 링크로 열면 기기 사이에 자동으로 동기화돼요.';
  }

  // ================= 백업 =================
  async function exportBackup() {
    const items = {};
    for (const kind of KINDS) {
      items[kind] = {};
      for (const it of liveItems(kind)) items[kind][it.id] = it;
    }
    const json = JSON.stringify({ app: 'minbeop2-study', v: 1, doc: DATA.docKey, exportedAt: new Date().toISOString(), items });
    const d = new Date();
    const name = `minbeop2-notes-backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
    let dl = null;
    if (window.claude && typeof window.claude.use === 'function') {
      try {
        dl = await Promise.race([window.claude.use('downloads'), new Promise((r) => setTimeout(() => r(null), 3000))]);
      } catch (e) {
        dl = null;
      }
    }
    if (dl) {
      try {
        await dl.save({ filename: name, data: json });
        toast('백업 파일을 저장했어요');
      } catch (e) {
        toast('백업 저장이 취소됐어요');
      }
      return;
    }
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    toast('백업 파일을 내려받았어요');
  }
  function importBackup(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    file.text().then((text) => {
      let data;
      try {
        data = JSON.parse(text);
      } catch (err) {
        toast('백업 파일을 읽지 못했어요. 이 앱에서 내보낸 .json 파일인지 확인해 주세요.', 4000);
        return;
      }
      if (!data || data.app !== 'minbeop2-study' || !data.items) {
        toast('이 앱의 백업 파일이 아니에요.', 3500);
        return;
      }
      const cnt = (k) => Object.keys(data.items[k] || {}).length;
      toggleMenu(false);
      confirmPop(
        $('#btnMenu').getBoundingClientRect(),
        `백업에 하이라이트 ${cnt('hl')} · 빈칸 ${cnt('bl')} · 메모 ${cnt('memo')} · 필기 ${cnt('ink')} · 완료 쟁점 ${cnt('prog')}개가 있어요. 지금 내용과 합칠까요, 백업으로 바꿀까요?`,
        '합치기',
        () => {
          refreshAfterMerge(mergeItems(data.items, { dirty: true }));
          renderAllAnnotations();
          toast('백업을 합쳤어요');
        },
        {
          extra: '<button type="button" class="text-btn danger" data-act="extra">백업으로 바꾸기</button>',
          onExtra: () => {
            const now = Date.now();
            for (const kind of KINDS) {
              for (const it of liveItems(kind)) {
                if (!(data.items[kind] && data.items[kind][it.id])) {
                  store[kind][it.id] = { id: it.id, del: 1, u: now, b: it.b };
                  markDirty(kind, store[kind][it.id]);
                }
              }
            }
            mergeItems(data.items, { bump: now + 1, dirty: true });
            undoStack.length = 0;
            redoStack.length = 0;
            updateHistoryButtons();
            resolveAnchors();
            renderAllAnnotations();
            renderAllInk();
            scheduleLayout();
            scheduleSave();
            if (mode === 'focus') renderFocus();
            toast('백업 내용으로 바꿨어요');
          },
        }
      );
    });
  }

  // ================= 전역 이벤트 =================
  docEl.addEventListener('pointerdown', onDocPointerDown);
  docEl.addEventListener('pointermove', onDocPointerMove);
  docEl.addEventListener('pointerup', onDocPointerUp);
  docEl.addEventListener('pointercancel', onDocPointerUp);
  inkSvg.addEventListener('pointerdown', onInkDown);
  inkSvg.addEventListener('pointermove', onInkMove);
  inkSvg.addEventListener('pointerup', onInkUp);
  inkSvg.addEventListener('pointercancel', onInkUp);
  // 길게 눌러 선택할 때 iOS 는 pointerup 대신 pointercancel 을 보내므로 모두에서 해제
  for (const ev of ['pointerup', 'pointercancel', 'touchend']) document.addEventListener(ev, () => (pointerDown = false), { passive: true });
  document.addEventListener('click', onClickCapture, true);
  document.addEventListener('click', onDocClick);
  document.addEventListener('touchstart', stylusGuard, { passive: false });
  document.addEventListener('touchmove', stylusGuard, { passive: false });
  docEl.addEventListener('touchstart', onTouchStartDoc, { passive: true });
  docEl.addEventListener('touchmove', onTouchMoveDoc, { passive: true });
  docEl.addEventListener('touchend', onTouchEndDoc, { passive: true });
  document.addEventListener('selectstart', (e) => {
    if (gesture || stroke || erasing || (mode === 'ink' && docEl.contains(e.target))) e.preventDefault();
  });
  document.addEventListener('selectionchange', checkSelection);
  document.addEventListener('pointerdown', (e) => {
    if (!popEl.hidden && !popEl.contains(e.target)) closePopover();
    if (!menuEl.hidden && !menuEl.contains(e.target) && !e.target.closest('#btnMenu')) toggleMenu(false);
    if (!selMenu.hidden && !selMenu.contains(e.target)) setTimeout(checkSelection, 0);
  });
  let scrollRaf = 0;
  window.addEventListener(
    'scroll',
    () => {
      if (!scrollRaf) {
        scrollRaf = requestAnimationFrame(() => {
          scrollRaf = 0;
          updateActive();
        });
      }
      if (!selMenu.hidden) hideSelMenu();
    },
    { passive: true }
  );
  window.addEventListener('wheel', holdAuto, { passive: true });
  window.addEventListener(
    'touchstart',
    (e) => {
      if ([...e.touches].some((t) => t.touchType !== 'stylus')) holdAuto();
    },
    { passive: true }
  );
  let lastWide = isWide();
  window.addEventListener('resize', () => {
    if (isWide() !== lastWide) {
      lastWide = isWide();
      setToc(lastWide ? ui.toc !== false : false);
    }
    scheduleLayout();
  });
  new ResizeObserver(scheduleLayout).observe(contentEl);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      saveNow();
      if (cloud.dirty.size) flush();
    }
  });
  window.addEventListener('pagehide', saveNow);
  document.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) {
      if (e.key === 'Escape') {
        e.target.blur();
        closePopover();
      }
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && k === 'y') {
      e.preventDefault();
      redo();
      return;
    }
    if (mod || e.altKey) return;
    if (['1', '2', '3', '4'].includes(e.key)) setMode(['read', 'blank', 'ink', 'focus'][+e.key - 1]);
    else if (e.key === '[') setToc(!app.classList.contains('toc-open'), true);
    else if (k === 'b') setBlanksHidden(!blanksHidden);
    else if (k === 'm') toggleMemoPanel();
    else if (k === 'p') setAuto(!auto.on);
    else if (e.key === '+' || e.key === '=') setSpeed(1);
    else if (e.key === '-') setSpeed(-1);
    else if (e.key === 'Escape') {
      if (!popEl.hidden) closePopover();
      else if (!menuEl.hidden) toggleMenu(false);
      else if (mode === 'read' && readTool) {
        readTool = null;
        syncToolUI();
      }
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'PageDown' || e.key === 'PageUp' || e.key === ' ') holdAuto();
  });

  // ================= 시작 =================
  async function boot() {
    buildToc();
    applyTheme();
    $('#speedLabel').textContent = ui.speed + '×';
    $('#optInk').checked = ui.showInk;
    $('#optFinger').checked = ui.finger;
    app.classList.toggle('hide-ink', !ui.showInk);
    app.classList.toggle('finger-draw', ui.finger);
    setBlanksHidden(!!ui.blanks);
    setToc(isWide() ? ui.toc !== false : false);
    syncToolUI();
    updateHistoryButtons();
    renderCrumbs();
    scheduleLayout();
    await Local.init();
    setSync(Local.mode === 'none' ? 'nostore' : 'local');
    const saved = await Local.load();
    if (saved && saved.items) mergeItems(saved.items);
    resolveAnchors();
    renderAllAnnotations();
    renderAllInk();
    updateBlankCount();
    updateProgress();
    scheduleLayout();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleLayout);
    initCloud();
  }
  boot();
})();
