// 스모크 테스트: node tests/smoke.mjs  (먼저 npm run build)
// 로컬 HTTP 서버로 index.html 을 열어 주요 기능을 실제 브라우저에서 한 번씩 확인한다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = process.env.SMOKE_OUT || path.join(ROOT, 'tests/out');
fs.mkdirSync(OUT, { recursive: true });

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const req = createRequire(import.meta.url);
    for (const p of ['/opt/node22/lib/node_modules/playwright', '/usr/local/lib/node_modules/playwright']) {
      try {
        return req(p);
      } catch {
        /* 다음 후보 */
      }
    }
    throw new Error('playwright 를 찾지 못했습니다');
  }
}

const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const URL_ = `http://127.0.0.1:${server.address().port}/index.html`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
try {
  // ---------- 데스크톱 ----------
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/fonts\.g|ERR_|net::/.test(m.text()) && errors.push(m.text()));
  await page.goto(URL_);
  await page.waitForSelector('#tocTree a');

  check('목차 항목 수', (await page.locator('#tocTree a').count()) === 268);

  // 목차 클릭 → breadcrumb
  await page.click('#tocExpand');
  await page.locator('#tocTree a', { hasText: '물권법정주의 위반의 효과' }).first().click();
  await page.waitForTimeout(400);
  const crumbs = await page.locator('#crumbs').innerText();
  check('현재 위치 표시', crumbs.includes('권리총론') && crumbs.includes('물권') && crumbs.includes('물권법정주의 위반의 효과'), crumbs.replace(/\n/g, ' '));

  // 단어 중간 → 다른 단어 중간 드래그 = 두 단어 전체까지 하이라이트
  const target = page.locator('#content p', { hasText: '물건을 직접' }).first();
  await target.scrollIntoViewIfNeeded();
  const pts = await target.evaluate((el) => {
    const text = el.textContent;
    const at = (i) => {
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let pos = 0;
      let n;
      while ((n = w.nextNode())) {
        if (i < pos + n.data.length) {
          const r = document.createRange();
          r.setStart(n, i - pos);
          r.setEnd(n, i - pos + 1);
          const rc = r.getBoundingClientRect();
          return { x: rc.left + rc.width / 2, y: rc.top + rc.height / 2 };
        }
        pos += n.data.length;
      }
    };
    return { a: at(text.indexOf('물건을') + 1), b: at(text.indexOf('이익을') + 1) };
  });
  await page.click('.tb-panel[data-for=read] .swatch[data-color=y]');
  await page.mouse.move(pts.a.x, pts.a.y);
  await page.mouse.down();
  await page.mouse.move((pts.a.x + pts.b.x) / 2, pts.a.y, { steps: 4 });
  await page.mouse.move(pts.b.x, pts.b.y, { steps: 4 });
  await page.mouse.up();
  const hlText = await target.evaluate((el) => [...el.querySelectorAll('.a.hl-y')].map((s) => s.textContent).join(''));
  check('드래그 하이라이트 단어 스냅', hlText === '물건을 직접 지배하여 이익을', JSON.stringify(hlText));

  // 탭 한 번 = 단어 전체
  await page.click('.tb-panel[data-for=read] .swatch[data-color=g]');
  const tapPt = await target.evaluate((el) => {
    const text = el.textContent;
    const i = text.indexOf('향유할') + 1;
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let pos = 0;
    let n;
    while ((n = w.nextNode())) {
      if (i < pos + n.data.length) {
        const r = document.createRange();
        r.setStart(n, i - pos);
        r.setEnd(n, i - pos + 1);
        const rc = r.getBoundingClientRect();
        return { x: rc.left + rc.width / 2, y: rc.top + rc.height / 2 };
      }
      pos += n.data.length;
    }
  });
  await page.mouse.click(tapPt.x, tapPt.y);
  const gText = await target.evaluate((el) => [...el.querySelectorAll('.a.hl-g')].map((s) => s.textContent).join(''));
  check('탭 하이라이트 단어 전체', gText === '향유할', JSON.stringify(gText));

  // 메모
  await page.click('[data-tool=memo]');
  await page.mouse.click(pts.b.x, pts.b.y);
  await page.waitForSelector('#memoInput');
  await page.fill('#memoInput', '이익 향유 = 물권의 핵심');
  await page.click('#popover [data-act=save]');
  await page.waitForTimeout(300);
  check('메모 여백 카드', (await page.locator('.memo-card .mc-text').first().innerText()).includes('물권의 핵심'));
  await page.click('[data-tool=memo]');

  // 되돌리기 · 다시 하기
  const before = await page.locator('#content .a.hl-g').count();
  await page.keyboard.press('Control+z'); // 메모 되돌리기
  await page.keyboard.press('Control+z'); // 초록 하이라이트 되돌리기
  const afterUndo = await page.locator('#content .a.hl-g').count();
  await page.keyboard.press('Control+Shift+z');
  await page.keyboard.press('Control+Shift+z');
  const afterRedo = await page.locator('#content .a.hl-g').count();
  check('되돌리기/다시 하기', before > 0 && afterUndo === 0 && afterRedo === before, `${before}→${afterUndo}→${afterRedo}`);

  // 빈칸 모드
  await page.click('#modeTabs [data-mode=blank]');
  const para2 = page.locator('#content p', { hasText: '배타성 X' }).first();
  await para2.scrollIntoViewIfNeeded();
  const box = await para2.boundingBox();
  await page.mouse.click(box.x + 10, box.y + box.height / 2);
  const blank = para2.locator('.a.bk').first();
  const hiddenColor = await blank.evaluate((el) => getComputedStyle(el).color);
  check('빈칸 생성 + 가림', (await para2.locator('.a.bk').count()) > 0 && /rgba\(0, 0, 0, 0\)|transparent/.test(hiddenColor), hiddenColor);
  await blank.click();
  check('빈칸 탭하면 공개', await blank.evaluate((el) => el.classList.contains('rv')));

  // 필기 모드: 마우스 획, 되돌리기, 획 지우개
  await page.click('#modeTabs [data-mode=ink]');
  const db = await page.locator('#doc').boundingBox();
  const sy = 420;
  await page.mouse.move(db.x + 120, sy);
  await page.mouse.down();
  for (let i = 0; i <= 20; i++) await page.mouse.move(db.x + 120 + i * 10, sy + Math.sin(i / 3) * 12);
  await page.mouse.up();
  const strokes1 = await page.locator('#ink path[data-id]').count();
  await page.click('#undo');
  const strokes0 = await page.locator('#ink path[data-id]').count();
  await page.click('#redo');
  await page.click('[data-tool=inkErase]');
  await page.mouse.move(db.x + 200, sy - 40);
  await page.mouse.down();
  await page.mouse.move(db.x + 200, sy + 40, { steps: 8 });
  await page.mouse.up();
  const strokesE = await page.locator('#ink path[data-id]').count();
  check('필기 획 · 되돌리기 · 획 지우개', strokes1 === 1 && strokes0 === 0 && strokesE === 0, `${strokes1}/${strokes0}/${strokesE}`);
  await page.click('#undo'); // 지운 획 복구
  await page.click('[data-tool=inkErase]');

  // 펜(애플펜슬) 포인터 이벤트
  const penDrawn = await page.evaluate(() => {
    const ink = document.getElementById('ink');
    const r = document.getElementById('doc').getBoundingClientRect();
    const opt = (x, y) => ({ pointerId: 7, pointerType: 'pen', isPrimary: true, clientX: r.left + x, clientY: 300 + y, bubbles: true, cancelable: true, pressure: 0.5 });
    ink.dispatchEvent(new PointerEvent('pointerdown', opt(300, 0)));
    for (let i = 1; i < 15; i++) ink.dispatchEvent(new PointerEvent('pointermove', opt(300 + i * 6, i * 3)));
    ink.dispatchEvent(new PointerEvent('pointerup', opt(390, 45)));
    return document.querySelectorAll('#ink path[data-id]').length;
  });
  check('펜 입력으로 필기', penDrawn === 2, String(penDrawn));

  // 중요 모드
  await page.click('#modeTabs [data-mode=focus]');
  const cards = await page.locator('.f-card').count();
  const focusHl = await page.locator('.f-card .a.hl-y').count();
  const focusMemo = await page.locator('.f-memo').count();
  check('중요 모드 수집', cards >= 1 && focusHl >= 1 && focusMemo === 1, `카드 ${cards}, 노랑 ${focusHl}, 메모 ${focusMemo}`);
  await page.screenshot({ path: path.join(OUT, 'desktop-focus.png') });
  await page.click('.f-card .f-go');
  await page.waitForTimeout(300);
  check('원문 보기 이동', (await page.getAttribute('#app', 'data-mode')) === 'read');

  // 새로고침 후 유지
  await page.waitForTimeout(700);
  await page.reload();
  await page.waitForSelector('#tocTree a');
  await page.waitForTimeout(800);
  const persisted = {
    hl: await page.locator('#content .a.hl-y').count(),
    bk: await page.locator('#content .a.bk').count(),
    ink: await page.locator('#ink path[data-id]').count(),
    memo: await page.locator('.memo-card').count(),
  };
  check('새로고침 후 유지', persisted.hl > 0 && persisted.bk > 0 && persisted.ink === 2 && persisted.memo === 1, JSON.stringify(persisted));

  // 콜아웃 색·양식(옵시디언 스니펫 기준)
  const style = await page.evaluate(() => {
    const cs = (el) => (el ? getComputedStyle(el) : null);
    const lawTitle = document.querySelector('.c-law:not(.untitled) > .callout-title');
    const caseTitle = document.querySelector('.c-case:not(.untitled) > .callout-title');
    const law = document.querySelector('.c-law');
    const code = document.querySelector('#content code');
    const body = cs(document.querySelector('#content p'));
    return {
      lawWeight: cs(lawTitle).fontWeight,
      lawColorIsText: cs(lawTitle).color === body.color,
      caseColor: cs(caseTitle).color,
      lawBg: cs(law).backgroundColor,
      badgeBg: cs(code).backgroundColor,
      pills: document.querySelectorAll('.c-issue strong.pill').length,
      nestedPills: document.querySelectorAll('.c-issue .callout strong.pill, .c-issue .callout-title strong.pill').length,
      firstPill: document.querySelector('.c-issue strong.pill')?.textContent,
      lblLeft: document.querySelectorAll('code[class*="lbl-"]').length,
      ...(() => {
        const li = [...document.querySelectorAll('#content li')].find((l) => l.nextElementSibling && l.offsetParent);
        const a = li.getBoundingClientRect();
        const b = li.nextElementSibling.getBoundingClientRect();
        return { lh: cs(li).lineHeight, liGap: b.top - a.bottom };
      })(),
    };
  });
  check('본문 행간 2.0 · 목록 항목 간격', style.lh === '32px' && style.liGap > 7 && style.liGap < 9, `행간 ${style.lh}, 항목 간격 ${style.liGap.toFixed(1)}px`);
  check('조문 제목 줄은 본문처럼', style.lawWeight === '400' && style.lawColorIsText, JSON.stringify([style.lawWeight, style.lawColorIsText]));
  check('판례 제목은 스니펫 회색', style.caseColor === 'rgb(110, 118, 128)', style.caseColor);
  check('콜아웃 배경은 스니펫 색을 더 연하게', style.lawBg === 'rgba(62, 106, 168, 0.055)', style.lawBg);
  check('백틱 배지 한 가지 색', style.badgeBg === 'rgba(180, 140, 60, 0.2)' && style.lblLeft === 0, style.badgeBg);
  check('쟁점 라벨 알약', style.pills >= 100 && style.nestedPills === 0 && style.firstPill === '사안', `${style.pills}개, 첫 알약 ${style.firstPill}, 중첩 ${style.nestedPills}`);

  // 메모 접기 → 본문 가운데
  const centerGap = () =>
    page.evaluate(() => {
      const d = document.getElementById('doc').getBoundingClientRect();
      const m = document.getElementById('main').getBoundingClientRect();
      return Math.abs(d.left + d.width / 2 - (m.left + m.width / 2));
    });
  const gapOpen = await centerGap();
  await page.click('#memoToggle');
  await page.waitForTimeout(300);
  const gapClosed = await centerGap();
  const cardsClosed = await page.locator('.memo-card').count();
  await page.click('#memoToggle');
  await page.waitForTimeout(300);
  check('메모 접으면 본문 가운데', gapOpen > 50 && gapClosed < 2 && cardsClosed === 0 && (await page.locator('.memo-card').count()) === 1, `열림 ${gapOpen.toFixed(0)}px, 접힘 ${gapClosed.toFixed(1)}px`);

  // 진도: 목차 체크 → 상위 % → 새로고침 후 유지
  await page.click('#tocExpand');
  const leaf = page.locator('#tocTree .toc-row', { hasText: '가. 물권과 채권의 준별과 특징' }).first();
  await leaf.locator('.ck').click();
  const parentPct = await page.locator('#tocTree .toc-row', { hasText: '물권과 채권' }).first().locator('.pct').innerText();
  const overall = await page.locator('#progPct').innerText();
  await page.locator('#tocTree .toc-row[data-lv="1"]', { hasText: '시험 설명' }).locator('.ck').click();
  await page.waitForTimeout(700);
  await page.reload();
  await page.waitForSelector('#tocTree a');
  await page.waitForTimeout(600);
  const leafState = await page.locator('#tocTree .toc-row', { hasText: '가. 물권과 채권의 준별과 특징' }).first().locator('.ck').getAttribute('data-state');
  check('진도 체크 · 진도율 · 유지', /\d+%/.test(parentPct) && overall !== '0%' && leafState === 'all', `상위 ${parentPct}, 전체 ${overall}, 새로고침 뒤 ${leafState}`);
  await page.locator('#tocTree a', { hasText: '시험 설명' }).first().click();
  await page.waitForTimeout(400);
  const secBefore = await page.getAttribute('#secDone', 'aria-pressed');
  await page.click('#secDone');
  const secAfter = await page.getAttribute('#secDone', 'aria-pressed');
  check('경로 바에서 현재 쟁점 완료', secBefore === 'true' && secAfter === 'false', `${secBefore}→${secAfter}`);
  await page.click('#secDone');

  // 목차 접기
  await page.click('#btnToc');
  await page.waitForTimeout(300);
  check('목차 접기', !(await page.locator('#app').evaluate((el) => el.classList.contains('toc-open'))));
  await page.click('#btnToc');
  await page.locator('#content p', { hasText: '물건을 직접' }).first().scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -200));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'desktop-read.png') });
  check('콘솔 오류 없음', errors.length === 0, errors.join(' | '));
  await ctx.close();

  // ---------- 아이패드 ----------
  const ipad = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const ip = await ipad.newPage();
  await ip.goto(URL_);
  await ip.waitForSelector('#tocTree a', { state: 'attached' });
  await ip.waitForTimeout(500);
  const narrow = await ip.locator('#app').evaluate((el) => el.classList.contains('margin-off') && !el.classList.contains('toc-open'));
  const docW = (await ip.locator('#doc').boundingBox()).width;
  const scrollW = await ip.evaluate(() => document.documentElement.scrollWidth);
  check('아이패드 세로: 좁은 레이아웃, 가로 스크롤 없음', narrow && docW >= 750 && scrollW <= 820, `doc ${docW}, scrollW ${scrollW}`);
  await ip.tap('#btnToc');
  await ip.waitForTimeout(300);
  check('아이패드 목차 서랍', await ip.locator('#scrim').isVisible());
  await ip.tap('#scrim');
  await ip.tap('#modeTabs [data-mode=blank]');
  const p3 = ip.locator('#content p', { hasText: '상대권, 특정인에게만' }).first();
  await p3.scrollIntoViewIfNeeded();
  const b3 = await p3.boundingBox();
  await ip.touchscreen.tap(b3.x + 14, b3.y + b3.height / 2);
  await ip.waitForTimeout(200);
  check('아이패드 손가락 탭으로 빈칸', (await p3.locator('.a.bk').count()) > 0);
  await ip.tap('#modeTabs [data-mode=read]');
  await ip.evaluate(() => window.scrollTo(0, 0));
  await ip.waitForTimeout(300);
  await ip.screenshot({ path: path.join(OUT, 'ipad-read.png') });
  await ipad.close();

  // ---------- 클라우드 동기화(모의 db) ----------
  const cctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await cctx.addInitScript(() => {
    const docs = new Map();
    const listeners = [];
    const snapOf = (id) => ({ id, exists: docs.has(id), data: () => docs.get(id), metadata: { fromCache: false, hasPendingWrites: false } });
    const emit = (ids) => listeners.forEach((fn) => fn({ docs: [...docs.keys()].map(snapOf), docChanges: () => ids.map((id) => ({ type: 'modified', doc: snapOf(id) })), metadata: { fromCache: false } }));
    window.__docs = docs;
    window.__remoteWrite = (id, body) => {
      docs.set(id, body);
      emit([id]);
    };
    const col = {
      doc: (id) => ({ id, get: async () => snapOf(id), set: async (b) => { docs.set(id, JSON.parse(JSON.stringify(b))); setTimeout(() => emit([id]), 10); } }),
      onSnapshot(next) {
        listeners.push(next);
        setTimeout(() => next({ docs: [...docs.keys()].map(snapOf), docChanges: () => [...docs.keys()].map((id) => ({ type: 'added', doc: snapOf(id) })), metadata: { fromCache: false } }), 20);
        return () => {};
      },
    };
    window.claude = { use: async (n) => (n === 'db' ? { collection: () => col } : n === 'user' ? { id: async () => 'viewer-1' } : null) };
  });
  const cp = await cctx.newPage();
  await cp.goto(URL_);
  await cp.waitForSelector('#tocTree a');
  await cp.waitForTimeout(600);
  // 다른 기기에서 쓴 하이라이트가 들어오면 표시되는지
  const remote = await cp.evaluate(() => {
    const el = [...document.querySelectorAll('#content p[data-b]')].find((p) => p.textContent.includes('중간고사보다'));
    const t = el.textContent;
    const s = t.indexOf('기말고사');
    window.__remoteWrite('m0.0', { v: 1, items: { hl: { r1: { id: 'r1', b: el.dataset.b, s, e: s + 4, c: 'p', g: 'r1', t: '기말고사', u: Date.now() } } } });
    return el.dataset.b;
  });
  await cp.waitForTimeout(300);
  const remoteShown = await cp.locator(`#content [data-b="${remote}"] .a.hl-p`).innerText().catch(() => '');
  check('다른 기기 하이라이트 반영', remoteShown === '기말고사', remoteShown);
  // 이 기기에서 친 하이라이트가 계정 저장소로 올라가는지
  await cp.click('#modeTabs [data-mode=blank]');
  const p4 = cp.locator('#content p', { hasText: '중간고사보다' }).first();
  const bx = await p4.boundingBox();
  await cp.mouse.click(bx.x + 8, bx.y + bx.height / 2);
  await cp.waitForTimeout(2300);
  const uploaded = await cp.evaluate(() => [...window.__docs.values()].some((d) => d.items && d.items.bl && Object.values(d.items.bl).some((x) => !x.del)));
  const status = await cp.locator('#syncStatus').innerText();
  check('이 기기 기록 업로드 · 동기화 상태', uploaded && status === '동기화됨', `${uploaded} / ${status}`);
  // 진도 체크도 계정 저장소(p.0)로 올라가는지
  await cp.locator('#tocTree .toc-row[data-lv="1"]', { hasText: '시험 설명' }).locator('.ck').click();
  await cp.waitForTimeout(2300);
  const progUp = await cp.evaluate(() => {
    const d = window.__docs.get('p.0');
    return !!(d && d.items && d.items.prog && Object.values(d.items.prog).some((x) => x.done && !x.del));
  });
  check('진도 체크 계정 동기화', progUp);
  await cctx.close();
} finally {
  await browser.close();
  server.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
if (failed.length) process.exit(1);
