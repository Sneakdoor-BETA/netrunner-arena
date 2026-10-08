// ==UserScript==
// @name         Jinteki Mobile
// @namespace    https://jinteki.net/
// @version      0.7.2
// @description  jinteki.net / sneakdoorbeta.net 手机 / 平板布局：大厅、组牌器、对战界面
// @match        https://www.jinteki.net/*
// @match        https://jinteki.net/*
// @match        https://sneakdoorbeta.net/*
// @match        https://*.sneakdoorbeta.net/*
// @run-at       document-start
// @grant        none
// @updateURL    none
// @downloadURL  none
// ==/UserScript==

// 不自动更新：@updateURL / @downloadURL 故意写成 none。只删掉不够，Violentmonkey 会退回去用当初的安装网址检查更新；
// 写成无效地址它才会把脚本当成不可更新。有新版时手动通知大家，从 Gist 链接重新装，或者重新发文件。

(function () {
  'use strict';
  const JM_VERSION = '0.7.2'; // publish.command 会按 @version 改写这一行
  // 手机上装了两份（比如微信发的文件和链接装的文件名不同）：后来的这份不跑，记下版本，由先跑的那份提示用户删掉旧的
  if (window.__jmLoaded) { (window.__jmDup = window.__jmDup || []).push(JM_VERSION); return; }
  window.__jmLoaded = JM_VERSION;

  const doc = document;
  const LS_KEY = 'jm-mode'; // 'auto' | 'on' | 'off'
  const getMode = () => { if (window.__jmForce) return 'on'; try { return localStorage.getItem(LS_KEY) || 'auto'; } catch (e) { return 'auto'; } };
  const setMode = (m) => { try { localStorage.setItem(LS_KEY, m); } catch (e) {} };

  // 网址兜底：?jm=on / ?jm=off / ?jm=auto 直接改模式（开关按钮找不到时用）
  try {
    const u = new URL(location.href);
    const q = u.searchParams.get('jm');
    if (q && /^(on|off|auto)$/.test(q)) {
      setMode(q);
      u.searchParams.delete('jm');
      history.replaceState(history.state, '', u.pathname + u.search + u.hash);
    }
  } catch (e) {}

  const onReady = (fn) => { if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', fn, { once: true }); else fn(); };
  // document-start 时 documentElement 可能还不存在
  function whenRoot(fn) {
    if (doc.documentElement) { fn(doc.documentElement); return; }
    const mo = new MutationObserver(() => { if (doc.documentElement) { mo.disconnect(); fn(doc.documentElement); } });
    mo.observe(doc, { childList: true });
  }

  function isMobile() {
    const mode = getMode();
    if (mode === 'on') return true;
    if (mode === 'off') return false;
    // 物理屏幕短边 ≤ 1100 且是触屏：手机 + 平板
    return Math.min(screen.width, screen.height) <= 1100 && matchMedia('(pointer: coarse)').matches;
  }

  function modeSwitchLink(toMobile) {
    const a = doc.createElement('a');
    a.className = 'jm-mode-switch block-link';
    a.textContent = toMobile ? '切换到手机版' : '切换到电脑版';
    a.href = '#';
    a.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); setMode(toMobile ? 'on' : 'off'); location.reload(); });
    return a;
  }
  // 用户下拉菜单里的切换项（下拉菜单会被重新渲染，所以一直盯着补）
  function ensureMenuSwitch(toMobile) {
    const menu = doc.querySelector('#right-menu .dropdown-menu');
    if (menu && !menu.querySelector('.jm-mode-switch')) menu.appendChild(modeSwitchLink(toMobile));
  }

  if (!isMobile()) {
    // 电脑版：用户菜单里一项 + 触屏设备或手动关掉手机版时再加一个浮动按钮
    onReady(() => {
      const st = doc.createElement('style');
      st.textContent = '.jm-desk-pill{position:fixed;z-index:99999;top:52px;right:10px;font:600 13px/1 "Titillium Web",sans-serif;padding:9px 14px;border-radius:999px;background:hsl(39,100%,50%);color:#111;border:0;box-shadow:0 2px 10px rgba(0,0,0,.5);cursor:pointer}';
      doc.head.appendChild(st);
      if (getMode() === 'off' || matchMedia('(pointer: coarse)').matches) {
        const b = doc.createElement('button');
        b.type = 'button';
        b.className = 'jm-desk-pill';
        b.textContent = '手机版';
        b.addEventListener('click', () => { setMode('on'); location.reload(); });
        doc.body.appendChild(b);
      }
      const mo = new MutationObserver(() => ensureMenuSwitch(true));
      mo.observe(doc.body, { childList: true, subtree: true });
      ensureMenuSwitch(true);
    });
    return;
  }

  whenRoot(initMobile);

  function initMobile(root) {
    root.classList.add('jm');

    // ---------- viewport ----------
    const VIEWPORT = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
    function fixViewport() {
      let m = doc.querySelector('meta[name=viewport]');
      if (!m) {
        if (!doc.head) return;
        m = doc.createElement('meta');
        m.name = 'viewport';
        doc.head.appendChild(m);
      }
      if (m.content !== VIEWPORT) m.content = VIEWPORT;
    }
    // ---------- 返回键 / 返回手势（安卓返回键、iOS 左滑） ----------
    // 对局页的网址不变，按返回会直接离开牌桌。对局中在历史里垫一层：
    // 按返回先关掉最上层的东西；什么都没开就留在牌桌并提示。
    // 这个监听要在网站的路由之前注册，所以放在 document-start。
    let backGuard = false, ignorePop = false;
    window.addEventListener('popstate', (e) => {
      if (ignorePop) { ignorePop = false; e.stopImmediatePropagation(); return; }
      if (!backGuard) return;
      e.stopImmediatePropagation();
      if (!root.classList.contains('jm-game')) { backGuard = false; return; }
      history.pushState({ jmGuard: true }, '');
      onBackInGame();
    }, true);
    let onBackInGame = () => {};
    function syncBackGuard(inGame) {
      if (inGame && !backGuard) {
        backGuard = true;
        history.pushState({ jmGuard: true }, '');
      } else if (!inGame && backGuard) {
        backGuard = false;
        if (history.state && history.state.jmGuard) { ignorePop = true; history.back(); }
      }
    }

    const vpObs = new MutationObserver(fixViewport);
    vpObs.observe(root, { childList: true, subtree: true });
    onReady(() => { fixViewport(); vpObs.disconnect(); });

    // ---------- CSS ----------
    const CSS = String.raw`
/* ================= 公共 ================= */
html.jm {
  --jm-panel: hsla(212, 34%, 13%, .96);
  --jm-panel-2: hsla(212, 30%, 21%, .98);
  --jm-line: hsla(210, 30%, 80%, .16);
  --jm-line-2: hsla(210, 30%, 85%, .32);
  --jm-text: hsl(210, 25%, 94%);
  --jm-dim: hsl(210, 16%, 70%);
  --jm-gold: hsl(39, 100%, 50%);
  --jm-gold-soft: hsl(41, 83%, 65%);
  --jm-corp: hsl(214, 85%, 72%);
  --jm-runner: hsl(8, 85%, 70%);
  --jm-danger: hsl(6, 90%, 70%);
  --jm-sl: env(safe-area-inset-left, 0px);
  --jm-sr: env(safe-area-inset-right, 0px);
  --jm-st: env(safe-area-inset-top, 0px);
  --jm-sb: env(safe-area-inset-bottom, 0px);
  --jm-ease: cubic-bezier(.2, .8, .2, 1);
}
html.jm, html.jm body { height: 100%; -webkit-text-size-adjust: 100%; overflow: hidden !important; overscroll-behavior: none; touch-action: manipulation; }
html.jm body { font-size: 14px; line-height: 1.35; -webkit-tap-highlight-color: transparent; }
html.jm #main-content { height: 100%; height: 100dvh; display: flex; flex-direction: column; overflow: hidden; }
html.jm .container { width: 100% !important; }
html.jm button, html.jm .button { min-height: 36px; font-size: 14px; }
html.jm input, html.jm select, html.jm textarea { font-size: 16px !important; } /* 防止 iOS 聚焦时放大 */
html.jm #zoom-controls { display: none !important; }
html.jm ::selection { background: hsla(39, 100%, 50%, .35); }

/* ===== 顶部导航（大厅 / 组牌器） ===== */
html.jm .topnav {
  position: relative !important; flex: 0 0 auto; height: auto !important;
  display: flex; align-items: center; flex-wrap: nowrap; gap: 4px;
  padding: 0 8px; padding-top: var(--jm-st); min-height: 44px;
}
html.jm .topnav #left-menu { margin: 0 !important; flex: 1 1 auto; min-width: 0; }
html.jm .topnav #left-menu ul { display: flex; gap: 4px; margin: 0; padding: 0; }
html.jm .topnav #left-menu li { display: none !important; margin: 0 !important; height: 44px; line-height: 44px; }
html.jm .topnav #left-menu li#play-nav,
html.jm .topnav #left-menu li#deckbuilder-nav,
html.jm .topnav #left-menu li#settings-nav { display: block !important; }
html.jm .topnav #left-menu li#play-nav { order: -1; }
html.jm .topnav #left-menu li a { display: block; padding: 0 12px; font-size: 16px; font-weight: 600; white-space: nowrap; }
/* 竖屏手机放不下三个导航项 + 在线局数：局数藏掉（断线有脚本自己的红条） */
@media (max-width: 480px) { html.jm .topnav #left-menu li a { padding: 0 7px; font-size: 15px; } html.jm body .topnav #status { display: none !important; } }
html.jm .topnav #left-menu li.active a { border-bottom: 2px solid currentColor; }
html.jm .topnav #status { order: 2; height: auto !important; line-height: 1.2 !important; display: flex !important; align-items: center; font-size: 12px; white-space: nowrap; }
html.jm .topnav #status > div { display: flex; align-items: center; gap: 10px; flex-direction: row-reverse; }
html.jm .topnav #status .float-right { float: none !important; display: flex; gap: 10px; }
html.jm .topnav #right-menu { order: 3; margin: 0 !important; }
html.jm .topnav #right-menu ul { margin: 0; padding: 0; }
html.jm .topnav #right-menu li { height: 44px; line-height: 44px; }
html.jm .topnav #right-menu .dropdown-menu { right: 0; left: auto; }
html.jm .topnav #right-menu .dropdown-menu a { line-height: 40px !important; padding: 0 16px; font-size: 15px; }
html.jm #main { flex: 1 1 auto; height: auto !important; min-height: 0; }
html.jm #main > .item { height: 100% !important; padding-top: 0 !important; box-sizing: border-box; }

/* ===== 大厅 ===== */
html.jm .lobby {
  position: absolute !important; inset: 0 !important; width: auto !important;
  margin: 0 !important; padding: 8px 0 0 !important; border-radius: 0;
  display: flex; flex-direction: column;
}
html.jm .lobby .games { flex: 1 1 auto; min-height: 0; }
html.jm .lobby .games .button-bar { padding: 0 10px 8px !important; }
html.jm .lobby .games .button-bar .rooms { margin-bottom: 8px !important; font-size: 15px; }
html.jm .lobby .games .button-bar .rooms .roomtab { margin: 0 8px !important; }
html.jm .lobby .lobby-buttons { display: flex; gap: 6px; }
html.jm .lobby .lobby-buttons button { flex: 1 1 0; margin: 0 !important; padding: 0 4px; }
html.jm .lobby .reload-button { margin-right: 0 !important; }
html.jm .lobby .game-count { padding: 0 10px !important; }
html.jm .lobby .game-list { padding: 0 10px calc(10px + var(--jm-sb)) !important; -webkit-overflow-scrolling: touch; }
html.jm .lobby .gameline {
  display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px;
  padding: 10px 12px !important; margin-bottom: 8px !important; border-radius: 8px;
  height: auto !important; /* 网站写死了 53px，内容多了会压到下一行 */
}
html.jm .lobby .gameline > * { float: none !important; margin: 0 !important; }
html.jm .lobby .gameline > h4 { flex: 1 1 0; min-width: 0; order: -2; font-size: 16px; margin: 0 !important; word-break: break-word; }
html.jm .lobby .gameline .game-time { order: -1; margin-left: auto !important; white-space: nowrap; }
html.jm .lobby .gameline > div:not(.split-button):not(.game-time) { flex: 1 1 100%; }
html.jm .lobby .gameline > button, html.jm .lobby .gameline > .split-button { order: 10; margin-left: auto !important; }
html.jm .lobby .gameline.active { border-color: var(--jm-gold-soft); }
html.jm .lobby .gameline > button { min-width: 84px; }
html.jm .lobby .gameline .split-button button { min-height: 36px; }
html.jm .lobby .gameline .password-prompt { position: fixed !important; left: 10px !important; right: 10px !important; top: 30% !important; margin: 0 !important; padding: 14px; z-index: 1000 !important; }
html.jm .lobby .mod-menu { right: 0; }
html.jm .lobby .game-panel { border-left: none !important; padding: 0 !important; }
html.jm .lobby .game-panel:not(:has(> *)) { display: none !important; }
html.jm .lobby .game-panel:has(> *) { position: absolute !important; inset: 0; z-index: 50; display: block !important; background: hsl(212, 40%, 9%); }
html.jm .lobby .game-panel > div {
  position: absolute !important; inset: 0 !important; padding: 12px 12px calc(12px + var(--jm-sb));
  overflow-y: auto; -webkit-overflow-scrolling: touch; display: block !important;
}
html.jm .lobby .game-panel .content { overflow: visible !important; }
html.jm .lobby .game-panel .button-bar { display: flex; flex-wrap: wrap; gap: 6px; padding-bottom: 12px !important; }
html.jm .lobby .game-panel .button-bar button { flex: 1 1 auto; margin: 0 !important; min-width: 0 !important; }
html.jm .lobby .game-panel .button-bar .dropdown { flex: 1 1 auto; display: flex !important; }
html.jm .lobby .game-panel .button-bar .dropdown button { width: 100%; }
html.jm .lobby .game-title, html.jm .games .share-link { width: 100% !important; box-sizing: border-box; }
html.jm .lobby .game-panel .players { height: auto !important; }
html.jm .lobby .game-panel .players .label { max-width: 60vw !important; }
html.jm .lobby .game-panel .spectators { height: auto !important; }
html.jm .lobby .game-panel .options { margin-left: 0 !important; padding-left: 18px; }
html.jm .lobby .game-panel .options li { margin: 6px 0; }
html.jm .lobby .game-panel select { max-width: 100%; }
html.jm .lobby .game-panel .chat-box .message-list { height: 30vh !important; max-height: none !important; }
html.jm .lobby .game-panel .msg-box { display: flex; gap: 6px; }
html.jm .lobby .game-panel .msg-box input { flex: 1 1 auto; min-width: 0; }
html.jm .lobby .game-details-table { min-width: 0 !important; width: 100%; }

/* ===== 弹窗（选卡组等） ===== */
/* 不撑满屏：内容短时露出遮罩，点空白处能关 */
html.jm .modal-dialog {
  position: fixed !important; top: max(12px, var(--jm-st)) !important; left: 8px !important; right: 8px !important; bottom: auto !important;
  max-height: calc(100% - max(12px, var(--jm-st)) - max(12px, var(--jm-sb))); transform: none !important; width: auto !important; max-width: 640px !important; margin: 0 auto !important;
  display: flex; flex-direction: column; overflow: hidden;
}
html.jm .modal-dialog .modal-content { flex: 1 1 auto; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 12px 52px 12px 12px; }
.jm-modal-x { display: none; }
html.jm.jm-modal-open .jm-modal-x {
  display: grid; place-items: center; position: fixed; z-index: 10002; width: 40px; height: 40px !important; min-height: 0 !important; padding: 0;
  top: calc(max(12px, var(--jm-st)) + 6px); right: calc(max(8px, (100vw - 640px) / 2) + 6px);
  border-radius: 10px !important; background: var(--jm-panel-2) !important; color: var(--jm-text);
}
html.jm .jm-modal-x svg { width: 18px; height: 18px; stroke: currentColor; stroke-width: 2; fill: none; stroke-linecap: round; }
/* 断线提示 */
.jm-offline { display: none; }
html.jm .jm-offline:not([hidden]) {
  display: block; position: fixed; z-index: 10003; top: max(8px, var(--jm-st)); left: 50%; transform: translateX(-50%);
  min-height: 0 !important; height: auto !important; padding: 9px 16px; border-radius: 999px !important; font-size: 14px; font-weight: 700;
  background: hsl(6, 75%, 52%) !important; color: #fff; border: 0 !important; box-shadow: 0 6px 24px rgba(0,0,0,.55) !important; white-space: nowrap;
}
/* 还在连 / 正在重连：灰色，不可点 */
html.jm .jm-offline.jm-wait:not([hidden]) { background: var(--jm-panel-2) !important; color: var(--jm-dim); font-weight: 600; }
/* 装了两份的提示：和断线红条同款，放低一点，允许换行 */
html.jm .jm-offline.jm-dup:not([hidden]) { top: calc(max(8px, var(--jm-st)) + 48px) !important; white-space: normal !important; width: min(560px, calc(100vw - 32px)); text-align: center; border-radius: 14px !important; line-height: 1.4; background: hsl(28, 90%, 45%) !important; }
html.jm .lobby-deck-selector { width: 100% !important; max-height: none !important; }
html.jm .deckline { height: auto !important; min-height: 56px; }

/* ===== 组牌器：三栏 → 单栏切换 ===== */
html.jm .deckbuilder {
  position: absolute !important; inset: 0 !important; width: auto !important; margin: 0 !important;
  padding: 8px 0 0 !important; border-radius: 0;
}
html.jm .deckbuilder .viewport { width: 300% !important; left: 0 !important; transition: transform .25s var(--jm-ease) !important; }
html.jm .deckbuilder .viewport > .decks,
html.jm .deckbuilder .viewport > .decklist,
html.jm .deckbuilder .viewport > .deckedit {
  flex: 0 0 33.3333% !important; width: 33.3333% !important; border-right: none !important; box-sizing: border-box;
  overflow-y: auto; -webkit-overflow-scrolling: touch; padding-bottom: calc(16px + var(--jm-sb)) !important;
}
html.jm[data-jm-db="list"] .deckbuilder .viewport { transform: translateX(0); }
html.jm[data-jm-db="deck"] .deckbuilder .viewport { transform: translateX(-33.3333%); }
html.jm[data-jm-db="edit"] .deckbuilder .viewport { transform: translateX(-66.6667%); }
html.jm[data-jm-db="editview"] .deckbuilder .viewport { transform: translateX(-33.3333%); }
html.jm[data-jm-db^="edit"] .deckbuilder .decklist .button-bar,
html.jm[data-jm-db^="edit"] .deckbuilder .decklist .jm-back { display: none !important; }
html.jm.jm-editing .deckbuilder .viewport > div { padding-bottom: calc(70px + var(--jm-sb)) !important; }
.jm-editbar { display: none; }
html.jm.jm-editing .jm-editbar {
  display: flex; gap: 8px; position: fixed; left: 0; right: 0; bottom: 0; z-index: 900;
  padding: 8px 10px calc(8px + var(--jm-sb)); background: var(--jm-panel); border-top: 1px solid var(--jm-line);
}
html.jm .jm-editbar button { flex: 1 1 0; margin: 0; min-height: 42px; }
html.jm .jm-editbar button.jm-primary { flex: 1.4 1 0; font-weight: 700; }
html.jm .deckbuilder .viewport > div > div { padding: 0 10px !important; }
html.jm .deckbuilder .decks .button-bar { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 10px 10px !important; }
html.jm .deckbuilder .decks .button-bar button { width: auto !important; flex: 1 1 40%; margin: 0 !important; }
html.jm .deckbuilder .deckfilter-select { max-width: 100%; }
html.jm .deckbuilder .deckfilter-select.faction-filter { width: auto !important; }
html.jm .deckbuilder .decks .deck-collection { overflow: visible !important; }
html.jm .deck-collection .deckline { padding: 6px 8px !important; }
html.jm .deck-collection .deckline > img { height: 52px !important; }
html.jm .deck-collection .deckline h4 { font-size: 15px; }
html.jm .deckbuilder .decklist .button-bar,
html.jm .deckbuilder .deckedit .button-bar { display: flex; flex-wrap: wrap; gap: 6px; }
html.jm .deckbuilder .decklist .button-bar button,
html.jm .deckbuilder .decklist .button-bar a.button,
html.jm .deckbuilder .deckedit .button-bar button { flex: 1 1 auto; margin: 0 !important; min-width: 0 !important; }
html.jm .deckbuilder .decklist .header > img { height: 90px !important; }
html.jm .deckbuilder .decklist .cards { columns: 1 !important; }
html.jm .deckbuilder .decklist .line { line-height: 30px !important; }
html.jm .deckbuilder .deckedit input, html.jm .deckbuilder .deckedit textarea, html.jm .deckbuilder .deckedit select { width: 100% !important; box-sizing: border-box; }
html.jm .deckbuilder .deckedit textarea { min-height: 40vh; }
html.jm .deckbuilder .typeahead { max-width: none !important; width: 100%; box-sizing: border-box; }
html.jm .deckbuilder .typeahead > div { padding: 10px 10px !important; font-size: 15px; }
html.jm .deckbuilder .decklist .line button { min-height: 30px; min-width: 30px; }
html.jm .jm-back { display: flex; align-items: center; gap: 4px; margin: 0 10px 8px; padding: 6px 0; color: var(--jm-gold-soft); font-size: 15px; cursor: pointer; background: none; border: none; min-height: 0 !important; }
html:not(.jm) .jm-back { display: none; }

/* 横屏：组牌器两栏并排，大厅两列 */
@media (orientation: landscape) and (min-width: 600px) {
  html.jm .deckbuilder .viewport { width: 150% !important; }
  html.jm .deckbuilder .viewport > .decks { border-right: 1px solid var(--jm-line-2) !important; }
  html.jm .deckbuilder .viewport > .decklist { border-right: 1px solid var(--jm-line-2) !important; }
  html.jm[data-jm-db="list"] .deckbuilder .viewport,
  html.jm[data-jm-db="deck"] .deckbuilder .viewport { transform: translateX(0); }
  html.jm[data-jm-db="edit"] .deckbuilder .viewport,
  html.jm[data-jm-db="editview"] .deckbuilder .viewport { transform: translateX(-33.3333%); }
  html.jm .jm-back { display: none !important; }
  html.jm.jm-editing .jm-editbar { display: none !important; }
  html.jm.jm-editing .deckbuilder .viewport > div { padding-bottom: 16px !important; }
  html.jm[data-jm-db^="edit"] .deckbuilder .decklist .button-bar { display: flex !important; }
  html.jm .lobby .game-list { display: grid; grid-template-columns: 1fr 1fr; grid-auto-rows: max-content; gap: 8px; align-content: start; }
  html.jm .lobby .game-list > * { margin: 0 !important; }
  html.jm .lobby .game-list > .controls, html.jm .lobby .game-list > h4, html.jm .lobby .game-list > p { grid-column: 1 / -1; }
  html.jm .lobby .game-panel > div { padding-left: max(12px, var(--jm-sl)) !important; padding-right: max(12px, var(--jm-sr)) !important; }
  html.jm .topnav { padding-left: max(8px, var(--jm-sl)); padding-right: max(8px, var(--jm-sr)); min-height: 40px; }
  html.jm .topnav #left-menu li, html.jm .topnav #right-menu li { height: 40px; line-height: 40px; }
}

/* ===== 设置页（/account） ===== */
/* 网站的表单很长，「更新资料」按钮在最上面：手机上改完语言看不到保存按钮。表单单独滚动，底部固定一条保存栏 */
html.jm .page-container:has(#profile-form) { position: absolute; inset: 0; margin: 0 !important; padding: 0 !important; width: auto !important; }
html.jm #profile-form {
  position: absolute !important; inset: 0 !important; margin: 0 !important; width: auto !important; max-width: none !important; height: auto !important;
  border-radius: 0; box-sizing: border-box; overflow-y: auto !important; -webkit-overflow-scrolling: touch;
  padding: 10px max(12px, var(--jm-sr)) calc(80px + var(--jm-sb)) max(12px, var(--jm-sl)) !important; scrollbar-width: none;
}
html.jm #profile-form::-webkit-scrollbar { display: none; }
html.jm #profile-form h2 { margin: 0 0 8px; font-size: 20px; }
html.jm #profile-form section { margin: 0 0 14px; }
html.jm #profile-form h3 { font-size: 15px; margin: 0 0 6px; }
html.jm #profile-form select { max-width: 100%; min-height: 40px; }
html.jm #profile-form button[data-i18n-key="settings_update-profile"] { display: none; }
.jm-savebar { display: none; }
html.jm.jm-account .jm-savebar {
  display: flex; align-items: center; gap: 10px; position: fixed; left: 0; right: 0; bottom: 0; z-index: 900;
  padding: 8px max(12px, var(--jm-sr)) calc(8px + var(--jm-sb)) max(12px, var(--jm-sl));
  background: var(--jm-panel); border-top: 1px solid var(--jm-line); color: var(--jm-dim); font-size: 13px;
}
html.jm .jm-savebar span { flex: 1 1 auto; min-width: 0; }
html.jm .jm-savebar button { flex: 0 0 auto; min-height: 42px !important; padding: 0 18px; font-weight: 700; }
html.jm .jm-savebar button[hidden] { display: none; }
html.jm .jm-savebar.dirty { border-top-color: var(--jm-gold); }
html.jm .jm-savebar.dirty span { color: var(--jm-gold-soft); font-weight: 700; }
html.jm .jm-savebar button.jm-primary { background: var(--jm-gold); color: #141414; }

/* 组牌器长按看大图 */
html.jm .deckbuilder .card-preview,
html.jm .cardbrowser .card-preview { display: none !important; }
html.jm.jm-zoom .deckbuilder .card-preview {
  display: block !important; position: fixed !important; z-index: 2000 !important;
  left: 50% !important; top: 50% !important; right: auto !important; margin: 0 !important;
  transform: translate(-50%, -50%) !important; width: min(80vw, 340px) !important; height: auto !important; padding: 0 !important;
  background: none !important; box-shadow: 0 0 0 100vmax rgba(0,0,0,.6) !important;
}
html.jm.jm-zoom .deckbuilder .card-preview img { width: 100%; height: auto; border-radius: 12px; display: block; }

/* 用户菜单里的模式开关 */
html.jm .jm-mode-switch { display: block; padding: 0 16px; line-height: 40px; font-size: 15px; color: inherit; }

/* ================= 对战界面 ================= */
/* 布局：左侧状态栏 | 牌桌 | 提示栏（没事可做时收起）
                    | 手牌 |                         */
html.jm.jm-game {
  --jm-rail: 62px; --jm-hand: 76px; --jm-prompt: 160px; --jm-gap: 4px; --jm-hand-zoom: .82;
  --jm-l: max(var(--jm-gap), var(--jm-sl));
  --jm-r: max(var(--jm-gap), var(--jm-sr));
  --jm-b: max(var(--jm-gap), var(--jm-sb));
  --jm-pw: var(--jm-prompt);
  --jm-board-left: calc(var(--jm-l) + var(--jm-rail) + var(--jm-gap));
  --jm-board-right: calc(var(--jm-r) + var(--jm-pw) + var(--jm-gap));
}
html.jm.jm-game.jm-noprompt { --jm-pw: 0px; }
html.jm.jm-game .topnav { display: none !important; }
html.jm.jm-game .gameview { height: 100%; }
html.jm.jm-game .gameview > .gameboard { flex: 1 1 auto; min-height: 0; height: auto; }
html.jm.jm-game .gameboard {
  display: grid !important; position: relative; box-sizing: border-box; height: 100%; overflow: hidden !important;
  grid-template-columns: var(--jm-rail) minmax(0, 1fr) var(--jm-pw);
  grid-template-rows: minmax(0, 1fr) var(--jm-hand);
  grid-template-areas: "rail board prompt" "rail hand prompt";
  gap: var(--jm-gap);
  padding: var(--jm-gap) var(--jm-r) var(--jm-b) var(--jm-l);
  background: hsl(212, 40%, 7%);
  -webkit-user-select: none; user-select: none; -webkit-touch-callout: none;
}
html.jm.jm-game.jm-noprompt .gameboard { column-gap: 0; grid-template-columns: var(--jm-rail) minmax(0, 1fr) 0; }
html.jm.jm-game.jm-noprompt .gameboard .leftpane > .me,
html.jm.jm-game.jm-noprompt .gameboard .centralpane { margin-left: var(--jm-gap); }
html.jm.jm-game .gameboard input, html.jm.jm-game .gameboard textarea { -webkit-user-select: text; user-select: text; }
html.jm.jm-game .gameboard img { -webkit-user-drag: none; -webkit-touch-callout: none; }
/* 背景图：网站的壁纸太花，压暗 */
html.jm.jm-game .gameboard > div:has(+ .right-pane) { position: absolute !important; inset: 0; z-index: 0; pointer-events: none; opacity: .14; }
html.jm.jm-game .gameboard .leftpane,
html.jm.jm-game .gameboard .inner-leftpane { display: contents !important; }
html.jm.jm-game .gameboard ::-webkit-scrollbar { width: 0; height: 0; }
html.jm.jm-game .gameboard * { scrollbar-width: none; }

/* --- 左侧状态栏（脚本自己画） --- */
.jm-rail { display: none; }
html.jm.jm-game .jm-rail {
  display: flex; flex-direction: column; gap: 4px; position: fixed; z-index: 30;
  left: var(--jm-l); top: var(--jm-gap); bottom: var(--jm-b); width: var(--jm-rail);
  font-variant-numeric: tabular-nums; color: var(--jm-text);
}
/* 脚本自己的按钮：不用网站的金色实底，那个留给真正的游戏操作 */
html.jm .jm-ui button {
  height: auto; margin: 0; border: 1px solid transparent; border-radius: 8px; background: var(--jm-panel-2); color: var(--jm-text);
  font-family: inherit; text-shadow: none; box-shadow: none; text-transform: none; letter-spacing: 0; cursor: pointer;
  transition: background-color .15s var(--jm-ease), border-color .15s var(--jm-ease);
}
html.jm .jm-ui button:focus, html.jm .jm-ui button:hover { box-shadow: none; border-color: var(--jm-line-2); }
html.jm .jm-ui button:active { background: hsla(212, 30%, 30%, .98); }
html.jm .gameboard .button-pane button:focus:not(:focus-visible) { box-shadow: none; border-color: hsl(39, 100%, 50%); }
html.jm .jm-rail button { min-height: 0 !important; padding: 0; background: var(--jm-panel); color: inherit; font: inherit; }
html.jm .jm-rail button:active { background: var(--jm-panel-2); }
html.jm .jm-r-top { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; flex: 0 0 auto; }
html.jm .jm-r-top button { height: 32px; display: grid; place-items: center; position: relative; color: var(--jm-dim); }
html.jm .jm-r-top svg { width: 18px; height: 18px; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
html.jm .jm-r-top .jm-dot { position: absolute; top: 5px; right: 5px; width: 7px; height: 7px; border-radius: 50%; background: var(--jm-gold); display: none; }
html.jm .jm-r-top .unread .jm-dot { display: block; }
html.jm.jm-menu-open .jm-r-top [data-act=menu], html.jm.jm-log .jm-r-top [data-act=log] { color: var(--jm-gold-soft); background: var(--jm-panel-2); }

html.jm .jm-r-player { flex: 0 0 auto; height: auto !important; min-height: 0; display: flex !important; flex-direction: column; align-items: stretch; gap: 1px; padding: 5px 6px !important; text-align: left; overflow: hidden; }
html.jm .jm-r-me { margin-top: auto !important; }
html.jm .jm-r-who { display: flex; align-items: center; gap: 4px; font-size: 11px; line-height: 14px; font-weight: 700; color: var(--jm-dim); margin-bottom: 1px; }
html.jm .jm-r-who::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--jm-side, var(--jm-dim)); flex: 0 0 auto; }
html.jm .jm-r-player[data-pside=corp] { --jm-side: var(--jm-corp); }
html.jm .jm-r-player[data-pside=runner] { --jm-side: var(--jm-runner); }
html.jm .jm-r-player.active .jm-r-who { color: var(--jm-gold-soft); }
html.jm .jm-r-player.active { box-shadow: inset 0 0 0 1px hsla(39, 100%, 50%, .55); }
html.jm .jm-r-row { display: flex; align-items: baseline; justify-content: space-between; gap: 2px; font-size: 15px; line-height: 19px; font-weight: 700; white-space: nowrap; }
html.jm .jm-r-row .anr-icon { font-size: 12px; font-weight: 400; color: var(--jm-dim); }
html.jm .jm-r-row small { font-size: 10px; font-weight: 400; color: var(--jm-dim); }
html.jm .jm-r-row[hidden] { display: none; }
html.jm .jm-r-row.jm-warn { color: var(--jm-gold-soft); }
/* 议案分这一行单独可点：打开计分区。底色标出来，跟整块（打开抽屉）区分开 */
html.jm .jm-r-row.jm-r-ap { margin: 0 -3px; padding: 0 3px; border-radius: 5px; background: hsla(210, 30%, 90%, .08); }
html.jm .jm-r-row.jm-r-ap:active { background: hsla(39, 100%, 50%, .2); }
html.jm .jm-r-row.jm-r-ap.jm-sel { box-shadow: inset 0 0 0 1px var(--jm-gold); color: var(--jm-gold-soft); }
html.jm .jm-r-me .jm-r-clicks { font-size: 19px; line-height: 23px; }
html.jm.jm-drawer-opp .jm-r-opp, html.jm.jm-drawer-me .jm-r-me { background: var(--jm-panel-2); }

html.jm .jm-r-sides { display: flex; flex-direction: column; gap: 2px; flex: 0 0 auto; padding: 2px; border-radius: 9px; background: var(--jm-panel); }
html.jm .jm-r-sides button { height: 28px; font-size: 12px; font-weight: 700; color: var(--jm-dim); background: transparent; border-radius: 7px; position: relative; }
html.jm .jm-r-sides button[data-side=run] { display: none; }
html.jm.jm-running .jm-r-sides button[data-side=run] { display: block; color: var(--jm-gold-soft); }
html.jm[data-jm-side=corp] .jm-r-sides button[data-side=corp] { background: hsla(214, 70%, 55%, .35); color: var(--jm-text); }
html.jm[data-jm-side=runner] .jm-r-sides button[data-side=runner] { background: hsla(8, 70%, 55%, .35); color: var(--jm-text); }
html.jm[data-jm-side=run] .jm-r-sides button[data-side=run] { background: hsla(39, 100%, 50%, .3); color: var(--jm-text); }

/* --- 抽屉：双方完整信息（含 +/- 手动调整、计分区、对手手牌） --- */
html.jm.jm-game .gameboard .left-inner-leftpane { display: contents !important; }
html.jm.jm-game .gameboard .left-inner-leftpane > div {
  position: fixed; z-index: 1400; left: var(--jm-board-left); top: var(--jm-gap); bottom: var(--jm-b);
  width: min(270px, 52vw); box-sizing: border-box; margin: 0 !important;
  display: flex; flex-direction: column; gap: 6px; padding: 8px;
  border-radius: 12px; background: var(--jm-panel); box-shadow: 0 10px 40px rgba(0,0,0,.55);
  overflow-y: auto; -webkit-overflow-scrolling: touch;
  transform: translateX(-12px); opacity: 0; visibility: hidden; pointer-events: none;
  transition: transform .2s var(--jm-ease), opacity .2s var(--jm-ease), visibility 0s linear .2s;
}
html.jm.jm-drawer-opp .gameboard .left-inner-leftpane > div:first-child,
html.jm.jm-drawer-me .gameboard .left-inner-leftpane > div:last-child {
  transform: none; opacity: 1; visibility: visible; pointer-events: auto; transition-delay: 0s;
}
html.jm.jm-game .gameboard .left-inner-leftpane > div > * { flex: 0 0 auto; }
html.jm.jm-game .gameboard .left-inner-leftpane > div:last-child > .stats { order: -1; }
html.jm.jm-drawer-opp .gameboard .left-inner-leftpane > div:first-child { padding-bottom: 82px; }
/* 对手抽屉：值为 0 的锁定标记 / 核心伤害 / 负面声誉不占行（自己的抽屉保留，要用 + 号） */
html.jm.jm-game .gameboard .left-inner-leftpane > div:first-child .stats-area > div:has(> [data-i18n-param-base="0"]:is([data-i18n-key="game_tag-count"], [data-i18n-key="game_bad-pub-count"])),
html.jm.jm-game .gameboard .left-inner-leftpane > div:first-child .stats-area > div[data-i18n-param-dmg="0"],
html.jm.jm-game .gameboard .left-inner-leftpane > div:first-child .stats-area > div:has(> [data-i18n-param-dmg="0"]) { display: none; }
html.jm.jm-game .gameboard .left-inner-leftpane .panel { margin: 0 !important; padding: 6px 8px !important; border-radius: 8px; box-shadow: none; background: hsla(212, 30%, 22%, .6); }
html.jm.jm-game .gameboard .stats,
html.jm.jm-game .gameboard .scored { min-height: 0 !important; height: auto !important; font-size: 13px; position: relative; }
html.jm.jm-game .gameboard .stats.active-player { box-shadow: inset 0 0 0 1px hsla(39, 100%, 50%, .55) !important; }
html.jm.jm-game .gameboard .stats .name-area { display: flex; align-items: center; gap: 6px; margin: 0 0 4px !important; }
html.jm.jm-game .gameboard .stats .name-area .avatar { width: 20px !important; height: 20px !important; }
html.jm.jm-game .gameboard .stats .name-area .pronouns { display: none; }
html.jm.jm-game .gameboard .stats .name-area .username { font-size: 13px; font-weight: 700; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
html.jm.jm-game .gameboard .stats-area { font-size: 13px !important; line-height: 1.5 !important; }
html.jm.jm-game .gameboard .stats-area .icon-grid { margin-left: 0 !important; display: grid; grid-template-columns: 1fr 1fr; gap: 0 8px; }
html.jm.jm-game .gameboard .stats-area .icon-grid > div { width: auto !important; padding: 0 !important; }
html.jm.jm-game .gameboard .stats .options-tabs { font-size: 12px; line-height: 1.4; margin-top: 6px; }
/* 抽屉里 +/- 一直可见（触屏没有 hover） */
html.jm.jm-game .gameboard .left-inner-leftpane .stat-controls { display: flex; align-items: center; min-height: 30px; }
html.jm.jm-game .gameboard .left-inner-leftpane .stat-controls > :not(.controls) { flex: 1 1 auto; color: inherit !important; }
html.jm.jm-game .gameboard .left-inner-leftpane .stat-controls .controls { display: flex !important; position: static !important; width: auto !important; height: auto !important; gap: 4px; }
html.jm.jm-game .gameboard .left-inner-leftpane .stat-controls .controls button { min-height: 28px !important; min-width: 32px; margin: 0 !important; padding: 0; font-size: 16px; line-height: 1; }
html.jm.jm-game .gameboard .scored .header { position: static !important; font-size: 12px; line-height: 1.4; background: none !important; padding: 0 0 4px !important; color: var(--jm-dim); }
html.jm.jm-game .gameboard .scored > .stats-area { position: static !important; padding: 4px 0 0 !important; }
html.jm.jm-game .gameboard .scored { display: flex; flex-wrap: wrap; gap: 4px; align-items: flex-start; }
html.jm.jm-game .gameboard .scored > .header, html.jm.jm-game .gameboard .scored > .stats-area { flex: 1 1 100%; }
html.jm.jm-game .gameboard .scored > .header { order: -1; }
html.jm.jm-game .gameboard .scored .card-wrapper { position: static !important; margin: 0 !important; transform: none !important; }
html.jm.jm-game .gameboard .scored .card { width: 48px !important; height: 67px !important; }
html.jm.jm-game .gameboard .scored .card img { width: 100%; height: 100%; }

/* --- 右侧提示栏 --- */
html.jm.jm-game .gameboard .right-inner-leftpane {
  grid-area: prompt; width: auto !important; min-width: 0; min-height: 0; display: flex !important; flex-direction: column; gap: 4px;
  justify-content: flex-start; overflow-y: auto !important; overflow-x: hidden; -webkit-overflow-scrolling: touch; position: relative; z-index: 4;
}
html.jm.jm-game.jm-noprompt .gameboard .right-inner-leftpane { visibility: hidden; }
html.jm.jm-game .gameboard .right-inner-leftpane > div { width: 100% !important; row-gap: 4px !important; flex: 0 0 auto; }
/* 靠底对齐用 margin-top:auto，不用 justify-content:flex-end：后者在内容超高时会把顶部裁掉、滚不上去 */
html.jm.jm-game .gameboard .right-inner-leftpane > :first-child { margin-top: auto; }
html.jm.jm-game .gameboard .right-inner-leftpane .panel { margin: 0 !important; border-radius: 10px; }
html.jm.jm-game .gameboard .right-inner-leftpane .timestamp { display: none !important; }
html.jm.jm-game .gameboard .right-inner-leftpane .rfg { padding: 4px 6px !important; height: auto !important; min-height: 0; margin: 0 !important; zoom: .55; background: var(--jm-panel) !important; box-shadow: none !important; }
html.jm.jm-game .gameboard .right-inner-leftpane .rfg .header { position: static !important; font-size: 14px; background: none !important; padding: 0 0 2px !important; }
html.jm.jm-game .gameboard .button-pane .panel { padding: 8px !important; background: var(--jm-panel) !important; box-shadow: none !important; }
html.jm.jm-game .gameboard .button-pane .panel.prompt { box-shadow: inset 0 0 0 1px hsla(39, 100%, 50%, .6), 0 6px 20px rgba(0,0,0,.4) !important; }
html.jm.jm-game .gameboard .button-pane h4 { margin: 0 0 8px !important; font-size: 13px; line-height: 1.35; font-weight: 600; text-align: left !important; }
html.jm.jm-game .gameboard .button-pane hr { margin: 6px 0; border-color: var(--jm-line); }
html.jm.jm-game .gameboard .button-pane button {
  min-height: 38px !important; font-size: 13px !important; line-height: 1.25; margin: 0 0 6px !important; padding: 6px 8px !important;
  border-radius: 8px; white-space: normal; word-break: break-word; touch-action: manipulation;
}
html.jm.jm-game .gameboard .button-pane button:last-child { margin-bottom: 0 !important; }
/* 不能点的按钮不占地方 */
html.jm.jm-game .gameboard .button-pane button.disabled { display: none !important; }
html.jm.jm-game .gameboard .button-pane .prompt-card-preview div.card { width: 92px !important; margin: 0 auto; }
html.jm.jm-game .gameboard .button-pane .card-title-select .command-matches-container { left: auto !important; right: 0 !important; bottom: 100% !important; margin: 0 !important; }
html.jm.jm-game .gameboard .button-pane select { width: 100%; min-height: 38px; }
html.jm.jm-game .gameboard .centralpane .encounter-info { display: none !important; }
html.jm.jm-game .gameboard .button-pane .encounter-info { position: static !important; display: block !important; width: auto !important; margin: 6px 0 !important; transform: none !important; }

/* --- 手牌：横向滑动 --- */
html.jm.jm-game .gameboard .leftpane > .me { grid-area: hand; min-width: 0; position: relative; z-index: 3; }
html.jm.jm-game .gameboard .leftpane > .me .hand-container { width: 100% !important; height: 100%; }
html.jm.jm-game .gameboard .leftpane > .me .hand-container > .hand-controls { display: block; height: 100%; }
html.jm.jm-game .gameboard .leftpane > .me .hand-controls .hand-controls { display: none !important; }
html.jm.jm-game .gameboard .leftpane > .me .hand {
  width: 100% !important; height: 100% !important; box-sizing: border-box; padding: 4px !important; margin: 0 !important; float: none;
  overflow-x: auto !important; overflow-y: hidden !important; -webkit-overflow-scrolling: touch; position: relative;
  border-radius: 10px; background: hsla(212, 34%, 13%, .7) !important; box-shadow: none !important;
}
html.jm.jm-game .gameboard .leftpane > .me .hand > div:first-child { position: static !important; display: flex !important; gap: 4px; width: max-content; zoom: var(--jm-hand-zoom); }
html.jm.jm-game .gameboard .leftpane > .me .hand .card-wrapper { position: relative !important; left: auto !important; top: auto !important; margin: 0 !important; transform: none !important; }
html.jm.jm-game .gameboard .leftpane > .me .hand > .header { display: none !important; }
html.jm.jm-game .gameboard.card-hover-movement .hand-container .card { transform: none !important; }
html.jm.jm-game .gameboard .leftpane > .me .popup { display: none !important; }

/* --- 对手手牌：只在对手抽屉里出现 --- */
html.jm.jm-game .gameboard .leftpane > .opponent { display: none; }
html.jm.jm-drawer-opp .gameboard .leftpane > .opponent {
  display: block; position: fixed; z-index: 1401; left: calc(var(--jm-board-left) + 8px); bottom: calc(var(--jm-b) + 8px); width: calc(min(270px, 52vw) - 16px);
}
html.jm.jm-game .gameboard .leftpane > .opponent .hand-controls .hand-controls,
html.jm.jm-game .gameboard .leftpane > .opponent .popup { display: none !important; }
html.jm.jm-game .gameboard .leftpane > .opponent .hand { width: 100% !important; height: 66px !important; overflow-x: auto; overflow-y: hidden; padding: 18px 4px 4px !important; margin: 0 !important; box-sizing: border-box; border-radius: 8px; float: none; }
html.jm.jm-game .gameboard .leftpane > .opponent .hand > div:first-child { position: static !important; display: flex !important; gap: 3px; width: max-content; zoom: .52; }
html.jm.jm-game .gameboard .leftpane > .opponent .hand .card-wrapper { position: relative !important; left: auto !important; margin: 0 !important; }
html.jm.jm-game .gameboard .leftpane > .opponent .hand > .header { top: 2px; left: 6px; font-size: 11px; background: none !important; color: var(--jm-dim); }

/* --- 牌桌 --- */
html.jm.jm-game .gameboard .centralpane {
  grid-area: board; min-width: 0 !important; min-height: 0; overflow: auto !important; -webkit-overflow-scrolling: touch;
  border-radius: 10px; background: hsla(212, 34%, 11%, .55); position: relative; z-index: 1;
  display: flex !important; flex-direction: column; justify-content: flex-start;
}
html.jm.jm-game .gameboard .centralpane > div {
  position: relative !important; top: auto !important; bottom: auto !important; width: max-content !important; min-width: 100%;
  flex: 0 0 auto !important; pointer-events: auto !important; opacity: 1 !important; box-sizing: border-box;
}
html.jm.jm-game .gameboard .centralpane > .me { margin-top: auto; }
html.jm.jm-game .gameboard .centralpane > .opponent { margin-bottom: auto; }
html.jm.jm-game .gameboard .centralpane .runner-board > div:first-child { margin-top: 0 !important; }
html.jm.jm-game[data-jm-side=corp] .gameboard .centralpane > .runner-board { display: none !important; }
html.jm.jm-game[data-jm-side=runner] .gameboard .centralpane > .outer-corp-board { display: none !important; }
/* 潜袭视图：被潜袭的服务器 + 潜袭者装备区，并排 */
html.jm.jm-game[data-jm-side=run] .gameboard .centralpane { flex-direction: row; align-items: center; justify-content: flex-start; gap: 10px; }
html.jm.jm-game[data-jm-side=run] .gameboard .centralpane > div { min-width: 0; margin: 0 !important; display: flex !important; flex-direction: column; justify-content: center; }
html.jm.jm-game[data-jm-side=run] .gameboard .centralpane > .outer-corp-board { order: -1; padding: 0 4px; }
html.jm.jm-game[data-jm-side=run] .gameboard .centralpane > .runner-board { padding-left: 10px; border-left: 1px solid var(--jm-line); }
html.jm.jm-game[data-jm-side=run] .gameboard .corp-board .server:not(:has(.run-arrow)) { display: none !important; }
html.jm.jm-game[data-jm-side=run] .gameboard .runner-board .runner-centrals { display: none !important; }

/* --- 服务器导航条 --- */
.jm-srvnav-bar { display: none; }
html.jm.jm-game.jm-srvnav[data-jm-side=corp] .gameboard .centralpane { padding-top: 38px; }
html.jm.jm-game.jm-srvnav[data-jm-side=corp] .jm-srvnav-bar {
  display: flex; gap: 4px; position: fixed; z-index: 35; overflow-x: auto; scrollbar-width: none;
  top: calc(var(--jm-gap) + 4px); left: calc(var(--jm-board-left) + 4px); right: calc(var(--jm-board-right) + 4px);
  padding: 3px; border-radius: 10px; background: hsla(212, 34%, 9%, .9);
}
html.jm .jm-srvnav-bar::-webkit-scrollbar { display: none; }
/* 导航条占了牌桌顶部，日志提示条和网站的 toast 往下让 */
html.jm.jm-game.jm-srvnav[data-jm-side=corp] .jm-ticker { top: calc(var(--jm-gap) + 46px); }
html.jm.jm-game.jm-srvnav[data-jm-side=corp] #toast-container { top: calc(var(--jm-gap) + 80px) !important; }
html.jm .jm-srvnav-bar button {
  flex: 0 0 auto; min-width: 30px; height: 28px !important; min-height: 0 !important; padding: 0 6px; margin: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
  border-radius: 7px; border: 1px solid transparent; background: transparent; color: var(--jm-dim);
  font-size: 13px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; text-transform: none; box-shadow: none;
}
html.jm .jm-srvnav-bar button.central { color: var(--jm-text); }
html.jm .jm-srvnav-bar button.vis { background: var(--jm-panel-2); color: var(--jm-text); }
html.jm .jm-srvnav-bar button.run { border-color: var(--jm-gold); color: var(--jm-gold-soft); }
html.jm .jm-srvnav-bar button span { display: flex; gap: 2px; height: 3px; }
html.jm .jm-srvnav-bar button i { display: block; width: 5px; height: 3px; border-radius: 1px; background: var(--jm-corp); }
html.jm .jm-srvnav-bar button { position: relative; }
html.jm .jm-srvnav-bar button em { position: absolute; top: -1px; right: -1px; min-width: 13px; height: 13px; padding: 0 2px; border-radius: 7px; background: var(--jm-gold); color: #141414; font-size: 9px; font-style: normal; font-weight: 800; line-height: 13px; text-align: center; box-sizing: border-box; }

/* --- 选服务器的提示：网格 + 按钮下标出这台服务器的情况 --- */
html.jm.jm-game.jm-wide-prompt { --jm-prompt: 252px; }
html.jm.jm-game .gameboard .button-pane .prompt[data-jm-srv] { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; align-items: stretch; }
html.jm.jm-game .gameboard .button-pane .prompt[data-jm-srv] > :not(button) { grid-column: 1 / -1; }
html.jm.jm-game .gameboard .button-pane .prompt[data-jm-srv] > button { margin: 0 !important; min-height: 44px !important; padding: 4px 6px !important; }
html.jm.jm-game .gameboard .button-pane button[data-jm-meta]::after { content: attr(data-jm-meta); display: block; margin-top: 2px; font-size: 11px; line-height: 1.3; font-weight: 400; opacity: .85; white-space: pre-line; word-break: break-word; }

/* --- 底部菜单：卡牌菜单 / 选服务器（原菜单藏起来，脚本代点） --- */
html.jm.jm-game .gameboard .active-menu { visibility: hidden !important; pointer-events: none !important; }
.jm-sheet { display: none; }
html.jm.jm-game .jm-sheet.open {
  display: flex; align-items: flex-end; justify-content: center; position: fixed; inset: 0; z-index: 1250;
  padding: var(--jm-gap) var(--jm-r) var(--jm-b) var(--jm-l); box-sizing: border-box; background: rgba(4, 9, 15, .45);
}
html.jm .jm-sh-panel {
  display: flex; gap: 10px; width: min(560px, 100%); max-height: 100%; box-sizing: border-box; padding: 10px;
  border-radius: 14px; background: var(--jm-panel); box-shadow: 0 -6px 40px rgba(0,0,0,.6);
  color: var(--jm-text); font-size: 15px; line-height: 1.3;
  animation: jm-rise .18s var(--jm-ease);
}
@keyframes jm-rise { from { transform: translateY(16px); opacity: .4; } }
html.jm .jm-sh-img { flex: 0 0 auto; height: min(250px, calc(100vh - 40px)); aspect-ratio: 300 / 418; border-radius: 8px; object-fit: cover; background: #000; cursor: zoom-in; }
html.jm .jm-sh-body { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 6px; overflow-y: auto; -webkit-overflow-scrolling: touch; }
html.jm .jm-sh-title { display: flex; align-items: center; gap: 8px; font-weight: 700; color: var(--jm-gold-soft); min-height: 32px; }
html.jm .jm-sh-title span { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
html.jm .jm-sh-close { margin: 0; min-height: 32px !important; width: 32px; padding: 0; border-radius: 8px; flex: 0 0 auto; display: grid; place-items: center; }
html.jm .jm-sh-close svg { width: 16px; height: 16px; stroke: currentColor; stroke-width: 2; fill: none; stroke-linecap: round; }
html.jm .jm-sh-head { font-size: 12px; color: var(--jm-dim); margin-top: 2px; }
html.jm .jm-sh-info { font-size: 13px; color: var(--jm-dim); padding: 2px 4px; }
html.jm .jm-sh-item {
  display: block; width: 100%; text-align: left; margin: 0; min-height: 42px; padding: 9px 12px; font-size: 15px; line-height: 1.3;
  border-radius: 9px; border: 1px solid var(--jm-line-2); background: hsla(210, 30%, 90%, .05); color: var(--jm-text); text-transform: none; height: auto;
}
html.jm .jm-sh-item:active { border-color: var(--jm-gold); background: hsla(39, 100%, 50%, .15); }
html.jm .jm-sh-item.disabled { opacity: .4; }
html.jm .jm-sh-item .float-right { float: right; }
@media (max-height: 300px) { html.jm .jm-sh-img { display: none; } }
/* 潜袭选服务器：网格，一屏放下十几台；每台写出防火墙层数和牌数，没有防火墙的用金色标出来 */
html.jm .jm-sh-panel.jm-sh-grid { width: min(760px, 100%); }
html.jm .jm-sh-grid .jm-sh-body { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px; align-content: start; }
html.jm .jm-sh-grid .jm-sh-title, html.jm .jm-sh-grid .jm-sh-head, html.jm .jm-sh-grid .jm-sh-info { grid-column: 1 / -1; }
html.jm .jm-sh-item.jm-srv { display: flex; flex-direction: column; gap: 2px; min-height: 52px; padding: 7px 10px; }
html.jm .jm-sh-item.jm-srv b { font-size: 15px; font-weight: 700; }
html.jm .jm-sh-item.jm-srv small { font-size: 12px; line-height: 1.3; color: var(--jm-dim); word-break: break-word; }
html.jm .jm-sh-item.jm-srv small.in { color: var(--jm-text); }
html.jm .jm-sh-item.jm-srv.open-srv small.ice { color: var(--jm-gold-soft); }
html.jm .jm-sh-item.jm-srv.adv { border-color: var(--jm-gold); }

/* --- 牌堆 / 计分区查看面板 --- */
/* 网站的档案库 / 弃牌堆 / 牌库 / 移出游戏弹窗挂在缩放过的牌桌里，弹出来会跑到屏幕外、被防火墙盖住。藏起来，脚本照着画一个 */
html.jm.jm-game .gameboard .popup,
html.jm.jm-game .gameboard .deck-container > .menu { visibility: hidden !important; pointer-events: none !important; }
/* 盖住牌桌和手牌，不挡左栏和提示栏（选牌时还要按提示栏里的「完成」） */
.jm-pile { display: none; }
html.jm.jm-game .jm-pile.open {
  --jm-pc-h: clamp(96px, calc((100dvh - 100px) / 2), 150px);
  display: flex; flex-direction: column; position: fixed; z-index: 1220; overflow: hidden;
  left: var(--jm-board-left); right: var(--jm-board-right); top: var(--jm-gap); bottom: var(--jm-b);
  border-radius: 12px; background: var(--jm-panel); box-shadow: 0 10px 40px rgba(0,0,0,.6); color: var(--jm-text);
  animation: jm-pop .16s var(--jm-ease);
}
html.jm .jm-pile-head { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 6px 6px 6px 12px; box-sizing: border-box; border-bottom: 1px solid var(--jm-line); }
html.jm .jm-pile-head b { font-size: 15px; color: var(--jm-gold-soft); white-space: nowrap; }
html.jm .jm-pile-head small { flex: 1 1 auto; min-width: 0; font-size: 12px; color: var(--jm-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
html.jm .jm-pile-head .jm-pile-act { min-height: 32px !important; padding: 0 10px; font-size: 13px; white-space: nowrap; }
html.jm .jm-pile-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 8px 10px 10px; scrollbar-width: none; }
html.jm .jm-pile-body::-webkit-scrollbar { display: none; }
html.jm .jm-pile-gh { font-size: 12px; font-weight: 700; color: var(--jm-dim); margin: 2px 0 6px; }
/* 计分区：双方并排，议案不多时一屏看完；放不下再换行 */
html.jm .jm-pile-body.cols { display: flex; flex-wrap: wrap; align-content: flex-start; gap: 10px 24px; }
html.jm .jm-pile-body.cols > div { flex: 0 1 auto; min-width: 0; }
html.jm .jm-pile-cards { display: flex; flex-wrap: wrap; gap: 6px; }
html.jm .jm-pile-empty { font-size: 13px; color: var(--jm-dim); padding: 2px 0 4px; }
html.jm .jm-pile .jm-pc {
  position: relative; flex: 0 0 auto; height: var(--jm-pc-h) !important; min-height: 0 !important; aspect-ratio: 300 / 418; padding: 0;
  border-radius: 7px; overflow: hidden; background: #000; border: 1px solid var(--jm-line);
}
html.jm .jm-pile .jm-pc img { display: block; width: 100%; height: 100%; object-fit: cover; }
html.jm .jm-pile .jm-pc.sel { border-color: var(--jm-gold); box-shadow: 0 0 0 2px var(--jm-gold); }
html.jm .jm-pile .jm-pc.back { cursor: default; }
html.jm .jm-pc-ct { position: absolute; left: 3px; top: 3px; display: flex; flex-wrap: wrap; gap: 2px; }
html.jm .jm-pc-ct i { min-width: 18px; height: 18px; padding: 0 4px; box-sizing: border-box; border-radius: 9px; font: 700 11px/18px sans-serif; font-style: normal; text-align: center; background: rgba(0,0,0,.78); color: #fff; }
html.jm .jm-pc-ct i.c-advance { background: var(--jm-gold); color: #141414; }
html.jm .jm-pc-ct i.c-agenda { background: hsl(150, 55%, 34%); }
html.jm .jm-pc-ct i.c-power { background: hsl(270, 50%, 50%); }
html.jm .jm-pc-ct i.c-virus { background: hsl(350, 65%, 48%); }
html.jm .jm-pc-ct i.c-credit { background: hsl(45, 90%, 48%); color: #141414; }
/* 公司看自己档案库里的暗牌：半透明（角标在手机上太小） */
html.jm .jm-pile .jm-pc.unseen img { opacity: .6; }
html.jm .jm-pile .jm-pc.unseen { border-style: dashed; border-color: var(--jm-line-2); }
/* 牌库菜单（点自己的牌库弹出来的「洗牌 / 查看」） */
html.jm .jm-pile-opts { display: flex; flex-direction: column; gap: 8px; max-width: 420px; }
html.jm .jm-pile .jm-pile-opt { display: block; width: 100%; text-align: left; min-height: 48px !important; padding: 8px 12px; border: 1px solid var(--jm-line-2); background: hsla(210, 30%, 90%, .05); font-size: 15px; }
html.jm .jm-pile .jm-pile-opt small { display: block; font-size: 12px; color: var(--jm-dim); margin-top: 2px; }
@media (orientation: landscape) and (min-height: 560px) { html.jm.jm-game .jm-pile.open { --jm-pc-h: 200px; } }

/* --- 网站的 toast 提示：收成牌桌顶部一条 --- */
html.jm.jm-game #toast-container { top: calc(var(--jm-gap) + 40px) !important; right: auto !important; left: 50% !important; transform: translateX(-50%); width: min(440px, 70vw) !important; }
html.jm.jm-game #toast-container > div { width: 100% !important; margin: 0 0 6px !important; padding: 8px 34px 8px 12px !important; font-size: 12px !important; line-height: 1.35 !important; border-radius: 10px !important; background-image: none !important; box-shadow: 0 6px 20px rgba(0,0,0,.5) !important; opacity: .96 !important; }

/* --- 开局（保留/重抽）与结束面板 --- */
/* 贴顶 + dvh：iOS Safari 的 vh 按工具栏收起时算，比实际可见区域高，居中的框顶部会钻到地址栏下面 */
html.jm.jm-game .gameboard > .win {
  position: fixed !important; left: 50% !important; top: max(8px, var(--jm-st)) !important; transform: translateX(-50%) !important;
  width: min(760px, 96vw) !important; margin: 0 !important; z-index: 1300 !important; box-sizing: border-box; border-radius: 14px;
  max-height: calc(100vh - 16px); max-height: calc(100dvh - max(8px, var(--jm-st)) - max(8px, var(--jm-sb)));
  overflow-y: auto; -webkit-overflow-scrolling: touch;
}
/* 网站的 ✘ 在框外 8px、只有 15px：框一滚动就被裁掉。挪进框里放大，另外脚本在同一位置固定一个不随内容滚走的 ✕ */
html.jm.jm-game .gameboard > .win .win-right { right: 6px !important; top: 6px !important; width: 40px !important; height: 40px !important; font-size: 18px !important; line-height: 1 !important; }
.jm-win-x { display: none; }
html.jm.jm-game.jm-win-open .jm-win-x {
  display: grid; place-items: center; position: fixed; z-index: 1301; width: 40px; height: 40px !important; min-height: 0 !important; padding: 0;
  top: calc(max(8px, var(--jm-st)) + 6px); right: calc(max(2vw, (100vw - 760px) / 2) + 6px);
  border-radius: 10px !important; background: var(--jm-panel-2) !important; color: var(--jm-text);
}
html.jm .jm-win-x svg { width: 18px; height: 18px; stroke: currentColor; stroke-width: 2; fill: none; stroke-linecap: round; }
html.jm.jm-game .gameboard > .win .start-game.ident img { height: 26vh !important; width: auto !important; }
html.jm.jm-game .gameboard > .win .contestants > div { font-size: 20px !important; line-height: 1.2 !important; margin: 0 !important; }
html.jm.jm-game .gameboard > .win .box { margin: 0 !important; }
html.jm.jm-game .gameboard > .win .start-hand { margin-top: 6px !important; zoom: .75; }
html.jm.jm-game .gameboard > .win .contestants .vs { margin: 4px 0 !important; }
html.jm.jm-game .gameboard > .win .intro-blurb { font-size: 13px !important; }
html.jm.jm-game .gameboard > .win .mulligan button { min-width: 90px; }

/* --- 日志抽屉（右侧滑出） --- */
html.jm.jm-game .gameboard .right-pane { position: fixed !important; inset: 0; width: auto !important; z-index: 1500 !important; pointer-events: none; }
html.jm.jm-game .gameboard .right-pane .card-zoom { display: none !important; }
html.jm.jm-game .gameboard .right-pane .implementation { display: none; }
html.jm.jm-game .gameboard .right-pane .content-pane {
  position: fixed !important; left: auto !important; right: 0 !important; top: 0 !important; bottom: 0 !important;
  width: min(400px, 72vw) !important; height: auto !important; transform: translateX(105%); transition: transform .22s var(--jm-ease); pointer-events: auto;
  padding-right: var(--jm-sr); box-sizing: border-box; background: var(--jm-panel); box-shadow: -10px 0 40px rgba(0,0,0,.55);
}
html.jm.jm-log .gameboard .right-pane .content-pane { transform: none; }
html.jm.jm-game .gameboard .right-pane .resize-handle { display: none !important; }
html.jm.jm-game .gameboard .right-pane .selector { display: flex; gap: 16px; height: 38px !important; align-items: center; padding: 0 12px !important; font-size: 13px; overflow-x: auto; white-space: nowrap; }
html.jm.jm-game .gameboard .right-pane .selector > a { margin: 0 !important; }
html.jm.jm-game .gameboard .right-pane .content-pane > .content { top: 38px !important; padding-bottom: var(--jm-sb); box-sizing: border-box; }
html.jm.jm-game .gameboard .right-pane .log .command-matches-container { right: auto !important; left: 0 !important; bottom: 100% !important; }

/* --- 日志提示条：新消息在牌桌顶部停留几秒 --- */
.jm-ticker { display: none; }
html.jm.jm-game .jm-ticker {
  display: flex; justify-content: center; position: fixed; z-index: 40; pointer-events: none;
  top: calc(var(--jm-gap) + 6px); left: calc(var(--jm-board-left) + 8px); right: calc(var(--jm-board-right) + 8px);
}
html.jm .jm-ticker button {
  pointer-events: auto; max-width: 100%; min-height: 0 !important; margin: 0; padding: 5px 12px; border: 0; border-radius: 999px;
  background: hsla(212, 34%, 10%, .92); color: var(--jm-text); font-size: 12px; line-height: 16px; text-transform: none; letter-spacing: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; box-shadow: 0 4px 16px rgba(0,0,0,.45);
  opacity: 0; transform: translateY(-6px); transition: opacity .2s var(--jm-ease), transform .2s var(--jm-ease); visibility: hidden;
}
html.jm .jm-ticker.show button { opacity: 1; transform: none; visibility: visible; }
html.jm .jm-ticker .timestamp, html.jm .jm-ticker .avatar { display: none; }
html.jm .jm-ticker .anr-icon { font-size: 11px; }
html.jm .jm-ticker b { color: var(--jm-gold-soft); font-weight: 700; margin-right: 4px; }

/* --- 菜单（左上角） --- */
.jm-menu { display: none; }
html.jm.jm-game.jm-menu-open .jm-menu {
  display: flex; flex-direction: column; gap: 6px; position: fixed; z-index: 2100;
  left: var(--jm-board-left); top: var(--jm-gap); max-height: calc(100% - var(--jm-gap) - var(--jm-b)); overflow-y: auto; box-sizing: border-box;
  width: min(300px, calc(100vw - var(--jm-board-left) - var(--jm-r))); padding: 8px; border-radius: 12px; background: var(--jm-panel);
  box-shadow: 0 10px 40px rgba(0,0,0,.6); color: var(--jm-text); animation: jm-pop .16s var(--jm-ease);
}
@keyframes jm-pop { from { transform: translateY(-6px); opacity: .3; } }
html.jm .jm-menu .jm-m-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
html.jm .jm-menu button { margin: 0; min-height: 40px !important; padding: 0 10px; border-radius: 8px; font-size: 14px; text-align: left; text-transform: none; letter-spacing: 0; }
html.jm .jm-menu button[hidden] { display: none; }
html.jm .jm-menu .jm-danger { color: var(--jm-danger) !important; }
html.jm .jm-menu button[data-armed="1"] { background: hsla(6, 70%, 45%, .35); border-color: var(--jm-danger); color: var(--jm-text) !important; font-weight: 700; }
html.jm .jm-menu .jm-m-sound { display: flex; align-items: center; gap: 8px; }
html.jm .jm-menu .jm-m-sound svg { width: 18px; height: 18px; flex: 0 0 auto; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
html.jm .jm-menu .jm-m-sound.off { color: var(--jm-gold-soft); }
/* 静音时菜单图标上挂一个小记号，免得忘了 */
html.jm .jm-rail.jm-muted [data-act=menu]::after { content: ""; position: absolute; right: 5px; bottom: 5px; width: 6px; height: 6px; border-radius: 50%; background: var(--jm-dim); box-shadow: 0 0 0 2px var(--jm-panel); }
html.jm .jm-menu .jm-m-sep { height: 1px; background: var(--jm-line); margin: 2px 0; }
html.jm .jm-menu .jm-m-foot { font-size: 11px; color: var(--jm-dim); line-height: 1.4; padding: 0 2px; }
html.jm .jm-menu .jm-m-foot:empty { display: none; }
html.jm .jm-menu .jm-m-title { font-size: 12px; color: var(--jm-dim); padding: 0 2px; }
html.jm .jm-menu .jm-m-counter { display: none; flex-direction: column; gap: 6px; }
html.jm .jm-menu.counter .jm-m-main { display: none; }
html.jm .jm-menu.counter .jm-m-counter { display: flex; }
html.jm .jm-menu .jm-m-main { display: flex; flex-direction: column; gap: 6px; }
html.jm .jm-menu .jm-q-types { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
html.jm .jm-menu .jm-q-types button, html.jm .jm-menu .jm-q-nums button { text-align: center; padding: 0 2px; min-height: 36px !important; }
html.jm .jm-menu .jm-q-types button.on { background: var(--jm-gold); color: #111; font-weight: 700; }
html.jm .jm-menu .jm-q-nums { display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px; }

/* --- 长按大图 + 「移动到」操作条 --- */
html.jm.jm-game.jm-zoom .gameboard .right-pane { pointer-events: auto; background: rgba(4, 9, 15, .7); }
html.jm.jm-game.jm-zoom .gameboard .right-pane .card-zoom {
  display: block !important; opacity: 1 !important; position: fixed !important; left: 50% !important; top: 50% !important; margin: 0 !important;
  transform: translate(-50%, -50%); height: 88vh !important; width: auto !important; aspect-ratio: 300 / 418;
}
html.jm.jm-game.jm-zoom .gameboard .right-pane .card-zoom .card-preview { width: 100% !important; height: 100% !important; margin: 0 !important; }
html.jm.jm-game.jm-zoom .gameboard .right-pane .card-zoom img { width: 100%; height: 100%; border-radius: 12px; }
html.jm.jm-game.jm-zoom .gameboard .right-pane .content-pane { pointer-events: none; }
.jm-zoom-actions { display: none; }
html.jm.jm-game.jm-zoom.jm-zoom-bar .jm-zoom-actions {
  display: flex; align-items: center; gap: 6px; position: fixed; z-index: 1600; left: 50%; transform: translateX(-50%);
  bottom: var(--jm-b); padding: 6px 8px; border-radius: 12px; background: var(--jm-panel);
  font-size: 13px; color: var(--jm-dim); white-space: nowrap; box-shadow: 0 6px 24px rgba(0,0,0,.5);
}
html.jm .jm-zoom-actions button { margin: 0; min-height: 38px !important; padding: 0 12px; border-radius: 8px; }
html.jm .jm-zoom-actions .jm-z-move { display: none; align-items: center; gap: 6px; }
html.jm.jm-zoom-movable .jm-zoom-actions .jm-z-move { display: flex; }
html.jm .jm-zoom-actions [data-mv=use] { display: none; background: var(--jm-gold); color: #141414; font-weight: 700; }
html.jm.jm-zoom-usable .jm-zoom-actions [data-mv=use] { display: block; }
html.jm.jm-game.jm-zoom.jm-zoom-bar .gameboard .right-pane .card-zoom { top: 44% !important; height: 76vh !important; }

/* --- 竖屏 --- */
.jm-rotate { display: none; }
@media (orientation: portrait) {
  html.jm.jm-game:not(.jm-portrait-ok) .jm-rotate {
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px;
    position: fixed; inset: 0; z-index: 5000; background: hsl(212, 40%, 7%); color: var(--jm-text); font-size: 17px; text-align: center; padding: 20px;
  }
  .jm-rotate .jm-phone { width: 46px; height: 80px; border: 3px solid var(--jm-gold); border-radius: 9px; animation: jm-rot 1.8s ease-in-out infinite; }
  @keyframes jm-rot { 0%, 25% { transform: rotate(0); } 60%, 100% { transform: rotate(-90deg); } }
  .jm-rotate button { min-width: 140px; }
  html.jm.jm-game { --jm-hand: 96px; --jm-hand-zoom: 1; }
  html.jm.jm-game .gameboard,
  html.jm.jm-game.jm-noprompt .gameboard {
    grid-template-columns: var(--jm-rail) minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) auto var(--jm-hand);
    grid-template-areas: "rail board" "rail prompt" "rail hand";
    column-gap: var(--jm-gap);
  }
  html.jm.jm-game .gameboard .right-inner-leftpane { max-height: 38vh; justify-content: flex-start; }
  html.jm.jm-game.jm-noprompt .gameboard .right-inner-leftpane { display: none !important; }
  html.jm.jm-game.jm-noprompt .gameboard .leftpane > .me,
  html.jm.jm-game.jm-noprompt .gameboard .centralpane { margin-left: 0; }
  html.jm.jm-game { --jm-pw: 0px; }
}

/* --- 平板：空间大，牌放大一点 --- */
@media (orientation: landscape) and (min-height: 560px) {
  html.jm.jm-game { --jm-rail: 76px; --jm-hand: 112px; --jm-hand-zoom: 1.24; --jm-prompt: 210px; --jm-gap: 6px; }
  html.jm.jm-game.jm-wide-prompt { --jm-prompt: 320px; }
  html.jm .jm-r-row { font-size: 17px; line-height: 22px; }
  html.jm .jm-r-me .jm-r-clicks { font-size: 22px; line-height: 26px; }
  html.jm .jm-r-who { font-size: 12px; }
  html.jm .jm-r-sides button { height: 34px; font-size: 13px; }
  html.jm .jm-r-top button { height: 38px; }
  html.jm.jm-game .gameboard .button-pane button { font-size: 14px !important; min-height: 42px !important; }
  html.jm.jm-game .gameboard .button-pane h4 { font-size: 14px; }
  html.jm.jm-game .gameboard .button-pane .prompt-card-preview div.card { width: 120px !important; }
}
/* 很矮的横屏（iPhone SE 等）：栏位再收一点 */
@media (orientation: landscape) and (max-height: 340px) {
  html.jm.jm-game { --jm-hand: 70px; --jm-hand-zoom: .74; --jm-prompt: 148px; }
  html.jm .jm-r-row { font-size: 14px; line-height: 17px; }
  html.jm .jm-r-me .jm-r-clicks { font-size: 17px; line-height: 20px; }
  html.jm .jm-r-sides button { height: 26px; }
  html.jm .jm-r-top button { height: 30px; }
  html.jm .jm-r-player { padding: 4px 6px !important; }
}
@media (orientation: landscape) and (max-height: 310px) {
  html.jm.jm-game .jm-rail { overflow-y: auto; scrollbar-width: none; gap: 3px; }
  html.jm.jm-game .jm-rail::-webkit-scrollbar { display: none; }
  html.jm .jm-r-row { font-size: 13px; line-height: 15px; }
  html.jm .jm-r-me .jm-r-clicks { font-size: 15px; line-height: 18px; }
  html.jm .jm-r-who { font-size: 10px; line-height: 12px; }
  html.jm .jm-r-sides button { height: 22px; font-size: 11px; }
  html.jm .jm-r-top button { height: 26px; }
  html.jm .jm-r-player { padding: 3px 6px !important; }
  html.jm.jm-game .gameboard .button-pane .prompt-card-preview div.card { width: 72px !important; }
}
@media (prefers-reduced-motion: reduce) {
  html.jm * { animation: none !important; transition: none !important; }
}
`;

    function injectCSS() {
      if (doc.getElementById('jm-style')) return;
      const st = doc.createElement('style');
      st.id = 'jm-style';
      st.textContent = CSS;
      (doc.head || root).appendChild(st);
    }
    injectCSS();

    const isOffline = () => !!doc.querySelector('#status .reconnect-button');
    // 网站的重连会掐掉正在进行的握手重来：网慢时连点几下反而永远连不上。8 秒内只发一次
    let lastReconnect = 0;
    function reconnect() {
      const a = doc.querySelector('#status .reconnect-button');
      if (!a || Date.now() - lastReconnect < 8000) return;
      lastReconnect = Date.now();
      a.click();
    }
    const ICON = {
      menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
      log: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v10H9l-4 4z"/><path d="M9 9h6M9 12h4"/></svg>',
      close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
      soundOn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
      soundOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9.5l5 5M22 9.5l-5 5"/></svg>'
    };
    // 音效开关：网站用 Howler.js 放声音，页面上有全局 Howler
    const MUTE_KEY = 'jm-mute';
    const isMuted = () => { try { return localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { return false; } };
    function applyMute() {
      const H = window.Howler;
      if (H && typeof H.mute === 'function' && !!H._muted !== isMuted()) H.mute(isMuted());
    }
    const escapeHtml = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const firstInt = (s) => { const m = /-?\d+/.exec(s || ''); return m ? +m[0] : null; };
    function setText(el, t) { if (el && el.textContent !== t) el.textContent = t; }

    // ---------- 主循环 ----------
    const errSeen = {};
    function safe(name, fn) {
      try { fn(); }
      catch (e) { if (!errSeen[name]) { errSeen[name] = 1; console.warn('[jinteki-mobile] ' + name + ' 出错：', e); } }
    }
    let lastPath = '';
    function sync() {
      if (!doc.body) return;
      injectCSS();
      const inGame = !!doc.querySelector('#main .gameview .gameboard');
      root.classList.toggle('jm-game', inGame);

      const path = location.pathname;
      if (path !== lastPath) {
        lastPath = path;
        if (!path.startsWith('/deckbuilder')) root.removeAttribute('data-jm-db');
      }
      // 首页等其他页面 → 自动跳到 Play
      if (!inGame && !/^\/(play|deckbuilder|account)/.test(path) && !/^\/(reset|replay|bug-report)/.test(path)) {
        const a = doc.querySelector('#play-nav a');
        if (a) a.click();
      }

      // 每一步单独兜住：某一步在真实对局里报错，也不能拖着后面的（比如提示栏开关）一起不执行
      safe('deckbuilder', syncDeckbuilder);
      safe('account', syncAccount);
      safe('game', () => syncGame(inGame));
      safe('back', () => syncBackGuard(inGame));
      safe('sheet', () => syncSheet(inGame));
      safe('pile', () => syncPile(inGame));
      safe('menu-switch', () => ensureMenuSwitch(false));
      safe('mute', applyMute);
      safe('offline', syncOffline);
      safe('duplicate', syncDuplicate);
      safe('modal', syncModal);
      safe('win-x', syncWinX);
    }

    // ---------- 装了两份 ----------
    let dupShown = false;
    function syncDuplicate() {
      if (dupShown || !window.__jmDup || !window.__jmDup.length) return;
      dupShown = true;
      const vers = [JM_VERSION].concat(window.__jmDup).map((v) => 'v' + v).join(' 和 ');
      const bar = doc.createElement('button');
      bar.type = 'button';
      bar.className = 'jm-offline jm-dup jm-ui';
      bar.textContent = '手机上装了两份 Jinteki Mobile（' + vers + '），现在跑的是 v' + JM_VERSION + '。请到脚本文件夹删掉旧的那份 · 点这里关闭';
      bar.addEventListener('click', (e) => { e.stopPropagation(); bar.remove(); });
      doc.body.appendChild(bar);
    }

    // ---------- 断线 ----------
    // 网站的「尝试重连」在顶栏里，对局中顶栏被藏了，断线后点什么都没反应却看不出来，所以脚本自己出一条提示。
    // 但网站初始化时就是「没连上」：刚打开页面、还在握手的那几秒也显示「尝试重连」（国内网络要好几秒）。分两种情况：
    //   从没连上过：前 8 秒不提示；之后灰色「正在连接」；25 秒还没连上才红色可点
    //   连上过又断了：等 3 秒（短暂断开网站自己会重连）再红色可点
    let offlineBar = null, everOpen = false, offSince = 0;
    const pageStart = Date.now();
    function offlineMode() {
      const off = isOffline(), now = Date.now();
      if (!off) {
        if (doc.querySelector('#status .float-right')) everOpen = true; // 登录了、状态栏画出来了、没有重连按钮 = 连上了
        offSince = 0;
        return null;
      }
      if (!offSince) offSince = now;
      let mode;
      if (!everOpen) mode = now - pageStart > 25000 ? 'fail' : now - pageStart > 8000 ? 'wait' : null;
      else mode = now - offSince > 3000 ? 'lost' : null;
      if ((mode === 'fail' || mode === 'lost') && now - lastReconnect < 8000) mode = 'retry';
      return mode;
    }
    const OFFLINE_TEXT = { wait: '正在连接服务器…', fail: '连不上服务器 · 点这里重试', lost: '连接断开了 · 点这里重连', retry: '正在重连…' };
    function syncOffline() {
      if (!doc.body) return;
      const mode = offlineMode();
      if (mode && !offlineBar) {
        offlineBar = doc.createElement('button');
        offlineBar.type = 'button';
        offlineBar.className = 'jm-offline jm-ui';
        offlineBar.addEventListener('click', (e) => {
          e.stopPropagation();
          const m = offlineBar.dataset.mode;
          if (m === 'fail' || m === 'lost') { reconnect(); syncOffline(); }
        });
        doc.body.appendChild(offlineBar);
      }
      if (offlineBar) {
        offlineBar.hidden = !mode;
        if (mode) {
          offlineBar.dataset.mode = mode;
          setText(offlineBar, OFFLINE_TEXT[mode]);
          offlineBar.classList.toggle('jm-wait', mode === 'wait' || mode === 'retry');
        }
      }
    }
    // 提示要按时间变（8 秒、25 秒、3 秒），页面没动静时 MutationObserver 不触发，单独每秒查一次
    setInterval(() => safe('offline', syncOffline), 1000);
    doc.addEventListener('visibilitychange', () => {
      // 只在「连上过又断了」时帮着点重连（iPhone 锁屏回来 socket 已经死了）；还在第一次握手就别打断它
      if (doc.visibilityState === 'visible') setTimeout(() => { if (everOpen && isOffline()) reconnect(); }, 800);
    });

    // ---------- 网站弹窗（选牌组等） ----------
    // Bootstrap modal 靠点遮罩关闭；手机上弹窗占满屏幕时遮罩点不到，没牌组可选时就卡死了。补一个关闭按钮
    let modalX = null;
    const openModal = () => Array.from(doc.querySelectorAll('.modal')).find((m) => m.classList.contains('in') || m.classList.contains('show') || m.style.display === 'block') || null;
    function closeModal() {
      const m = openModal();
      if (!m) return;
      const $ = window.jQuery;
      if ($ && $.fn && $.fn.modal) $(m).modal('hide');
      setTimeout(() => {
        if (openModal() !== m) return;
        m.classList.remove('in', 'show');
        m.style.display = 'none';
        doc.querySelectorAll('.modal-backdrop').forEach((x) => x.remove());
        doc.body.classList.remove('modal-open');
        syncModal();
      }, 400);
    }
    // 结算框的关闭按钮：固定在框右上角，不跟内容滚走，点它就是点网站自己的 ✘
    let winX = null;
    function syncWinX() {
      const orig = doc.querySelector('.gameboard > .win .win-right');
      root.classList.toggle('jm-win-open', !!orig);
      if (orig && !winX) {
        winX = doc.createElement('button');
        winX.type = 'button';
        winX.className = 'jm-win-x jm-ui';
        winX.setAttribute('aria-label', '关闭');
        winX.innerHTML = ICON.close;
        winX.addEventListener('click', (e) => {
          e.stopPropagation();
          const o = doc.querySelector('.gameboard > .win .win-right');
          if (o) o.click();
        });
        doc.body.appendChild(winX);
      }
    }
    function syncModal() {
      const open = !!openModal();
      root.classList.toggle('jm-modal-open', open);
      if (open && !modalX) {
        modalX = doc.createElement('button');
        modalX.type = 'button';
        modalX.className = 'jm-modal-x jm-ui';
        modalX.setAttribute('aria-label', '关闭');
        modalX.innerHTML = ICON.close;
        modalX.addEventListener('click', (e) => { e.stopPropagation(); closeModal(); });
        doc.body.appendChild(modalX);
      }
    }

    // ---------- 设置页 ----------
    // 有改动没保存：保存栏标金色；这时点导航离开，先拦一次提醒，再点才走
    let saveBar = null, acctDirty = false, acctWarned = false;
    function syncAccount() {
      const form = doc.querySelector('#profile-form form');
      root.classList.toggle('jm-account', !!form);
      if (!form) { acctDirty = false; acctWarned = false; if (saveBar) saveBar._msg = ''; return; }
      if (!form._jm) {
        form._jm = true;
        const mark = (e) => { if (e.target.closest('.block-user-btn, .delete, input[type=password]')) return; acctDirty = true; acctWarned = false; paintSaveBar(); };
        form.addEventListener('change', mark, true);
        form.addEventListener('input', mark, true);
      }
      if (!saveBar) {
        saveBar = doc.createElement('div');
        saveBar.className = 'jm-savebar jm-ui';
        saveBar.innerHTML = '<span></span><button type="button" data-a="reload" hidden>刷新</button><button type="button" data-a="save" class="jm-primary">保存设置</button>';
        saveBar.addEventListener('click', (e) => {
          const b = e.target.closest('button');
          if (!b) return;
          if (b.dataset.a === 'reload') { location.reload(); return; }
          const f = doc.querySelector('#profile-form form');
          const orig = f && (f.querySelector('button[data-i18n-key="settings_update-profile"]') || f.querySelector('button'));
          if (!orig) return;
          orig.click();
          acctDirty = false; acctWarned = false;
          paintSaveBar('已保存。卡牌语言等设置刷新页面后生效');
        });
        doc.body.appendChild(saveBar);
      }
      paintSaveBar();
    }
    function paintSaveBar(msg) {
      if (!saveBar) return;
      if (msg !== undefined) saveBar._msg = msg;
      if (acctDirty) saveBar._msg = '';
      const text = acctDirty ? (acctWarned ? '设置还没保存。再点一次导航就不保存直接离开' : '有改动，还没保存') : (saveBar._msg || '改完记得点右边保存');
      setText(saveBar.querySelector('span'), text);
      saveBar.classList.toggle('dirty', acctDirty);
      saveBar.querySelector('[data-a=reload]').hidden = acctDirty || !saveBar._msg;
    }
    doc.addEventListener('click', (e) => {
      if (!acctDirty || acctWarned || !root.classList.contains('jm-account')) return;
      const a = e.target.closest && e.target.closest('.topnav a');
      if (!a || a.closest('.jm-ui')) return;
      e.preventDefault(); e.stopPropagation();
      acctWarned = true;
      paintSaveBar();
    }, true);

    // ---------- 组牌器 ----------
    let editBar;
    function syncDeckbuilder() {
      const vp = doc.querySelector('.deckbuilder .viewport');
      if (!vp) { if (editBar) ensureEditBar(false); return; }
      let st = root.getAttribute('data-jm-db') || 'list';
      if (vp.classList.contains('edit')) { if (st !== 'editview') st = 'edit'; }
      else if (st === 'edit' || st === 'editview') {
        const hasDeck = vp.querySelector(':scope > .decklist > div');
        st = hasDeck ? 'deck' : 'list';
      }
      if (root.getAttribute('data-jm-db') !== st) root.setAttribute('data-jm-db', st);
      ensureEditBar(st === 'edit' || st === 'editview');

      const dl = vp.querySelector(':scope > .decklist');
      if (dl && !dl.querySelector(':scope > .jm-back')) {
        const b = doc.createElement('button');
        b.type = 'button';
        b.className = 'jm-back';
        b.textContent = '‹ 卡组列表';
        b.addEventListener('click', () => root.setAttribute('data-jm-db', 'list'));
        dl.insertBefore(b, dl.firstChild);
      }
    }
    function clickOriginal(re, idx) {
      const btns = doc.querySelectorAll('.deckbuilder .decklist .button-bar button');
      for (const b of btns) if (re.test(b.textContent.trim())) { b.click(); return; }
      if (btns[idx]) btns[idx].click(); // 兜底：按位置（第一个 Save，第二个 Cancel）
    }
    function ensureEditBar(show) {
      if (!editBar) {
        editBar = doc.createElement('div');
        editBar.className = 'jm-editbar jm-ui';
        editBar.innerHTML = '<button type="button" data-a="view">查看卡表</button><button type="button" data-a="cancel">取消</button><button type="button" data-a="save" class="jm-primary">保存</button>';
        editBar.addEventListener('click', (e) => {
          const b = e.target.closest('button');
          const a = b && b.dataset.a;
          if (a === 'view') {
            root.setAttribute('data-jm-db', root.getAttribute('data-jm-db') === 'editview' ? 'edit' : 'editview');
            syncEditBarLabel();
          } else if (a === 'save') clickOriginal(/^(save|保存)/i, 0);
          else if (a === 'cancel') clickOriginal(/^(cancel|取消)/i, 1);
        });
        doc.body.appendChild(editBar);
      }
      editBar.style.display = show ? '' : 'none';
      root.classList.toggle('jm-editing', !!show);
      syncEditBarLabel();
    }
    function syncEditBarLabel() {
      if (editBar) setText(editBar.querySelector('[data-a=view]'), root.getAttribute('data-jm-db') === 'editview' ? '返回编辑' : '查看卡表');
    }
    doc.addEventListener('click', (e) => {
      const t = e.target;
      if (t.closest && t.closest('.deckbuilder .deck-collection .deckline') && !t.closest('input')) {
        setTimeout(() => root.setAttribute('data-jm-db', 'deck'), 0);
      }
    }, true);

    // ---------- 服务器信息（从牌桌上读：防火墙、里面的牌、是否正被潜袭） ----------
    // 一张牌怎么称呼：网站给暗牌的图片 alt 写「Facedown corp card」（看不到正面）或「Facedown 牌名」（自己的牌，知道是什么）；
    // 正面朝上的（已激活，或者被潜袭者看过）alt 就是牌名。
    //   看不到正面 → 暗牌；自己没激活的 → 牌名（未激活）；正面朝上 → 牌名；有推进指示物再加「推进 N」
    function cardLabel(wrap) {
      const img = wrap.querySelector('img');
      const alt = (img && img.alt) || '';
      const flags = [];
      let label;
      if (!alt || /^Facedown (corp|runner) card$/i.test(alt)) label = '暗牌';
      else if (/^Facedown /i.test(alt)) { label = alt.slice(9); flags.push('未激活'); }
      else label = alt;
      const adv = wrap.querySelector('.advance-counter');
      const n = adv ? firstInt(adv.textContent) : 0;
      if (n) flags.push('推进 ' + n);
      return { label: flags.length ? label + '（' + flags.join('，') + '）' : label, adv: n || 0 };
    }
    // 牌桌是 row-reverse：DOM 里远程服务器在前（倒序）、档案库在最后，倒过来就是从左到右的顺序
    function readServers() {
      const board = doc.querySelector('.gameboard .centralpane > .outer-corp-board .corp-board');
      if (!board) return [];
      const list = [];
      for (const s of board.querySelectorAll(':scope > .server')) {
        const content = s.querySelector(':scope > .content');
        if (!content) continue;
        let key = null, short = '', name = '';
        if (content.querySelector('.discard-container')) { key = 'archives'; short = '档'; name = '档案库'; }
        else if (content.querySelector('.deck-container')) { key = 'rd'; short = '研'; name = '研发中心'; }
        else if (content.querySelector('.identity')) { key = 'hq'; short = '总'; name = '总部'; }
        else {
          const lab = content.querySelector(':scope > .server-label');
          const m = /(\d+)/.exec(lab ? lab.textContent : '');
          if (m) { key = 'remote' + m[1]; short = m[1]; name = '远程 ' + m[1]; }
        }
        if (!key) continue;
        const cards = Array.from(content.querySelectorAll(':scope > .server-card')).map(cardLabel);
        list.push({
          key, short, name, el: s, remote: key.startsWith('remote'),
          ice: s.querySelectorAll(':scope > .ices > .ice').length,
          cards: cards.length, contents: cards.map((c) => c.label), adv: Math.max(0, ...cards.map((c) => c.adv)),
          run: !!s.querySelector('.run-arrow')
        });
      }
      return list.reverse();
    }
    // 提示 / 菜单里的服务器名 → key（英文、中文界面都认）
    function serverKeyFromLabel(t) {
      t = (t || '').replace(/\s+/g, ' ').trim();
      if (/new remote|新建远程|新远程|新服务器/i.test(t)) return 'new';
      const m = /(\d+)/.exec(t);
      if (m && /server|服务器|远程|remote/i.test(t)) return 'remote' + m[1];
      if (/^(archives|档案库)$/i.test(t)) return 'archives';
      if (/^(r\s*&\s*d|研发中心)$/i.test(t)) return 'rd';
      if (/^(hq|总部)$/i.test(t)) return 'hq';
      return null;
    }
    // 服务器里有什么：远程没有牌写「空服务器」；中央服务器里只有升级，没有就不写
    function serverContents(info) {
      if (!info) return '';
      if (info.contents.length) return info.contents.join(' + ');
      return info.remote ? '空服务器' : '';
    }
    // 两行：防火墙层数；里面的牌（防火墙只写层数，逐张列名字太冗余）
    function serverMeta(info) {
      if (!info) return '';
      const ice = info.ice ? info.ice + ' 层防火墙' : '无防火墙';
      const c = serverContents(info);
      return c ? ice + '\n' + c : ice;
    }

    // ---------- 卡牌菜单 → 底部菜单（代点原菜单项） ----------
    let sheet = null, sheetSig = '';
    function closeOriginalMenu() {
      // 网站的逻辑：点菜单外面就关
      doc.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    }
    function syncSheet(inGame) {
      if (!sheet) {
        sheet = doc.createElement('div');
        sheet.className = 'jm-sheet jm-ui';
        sheet.addEventListener('click', (e) => {
          e.stopPropagation(); // 不让网站的「点外面关闭菜单」再触发一次
          const b = e.target.closest('button');
          if (!e.target.closest('.jm-sh-panel') || (b && b.dataset.close)) { closeOriginalMenu(); return; }
          // 点菜单里的卡图：看大图（菜单留着，关了大图还能接着选）
          if (e.target.closest('.jm-sh-img')) { if (sheet._card && sheet._card.isConnected) openZoom(sheet._card); return; }
          if (!b) return;
          const target = sheet._targets && sheet._targets[+b.dataset.i];
          if (target && target.isConnected) target.click();
        });
        doc.body.appendChild(sheet);
      }
      const menu = inGame ? doc.querySelector('.gameboard .active-menu') : null;
      if (!menu) {
        if (sheet.classList.contains('open')) { sheet.classList.remove('open'); sheet.innerHTML = ''; sheetSig = ''; }
        return;
      }
      const sig = menu.innerHTML;
      if (sig === sheetSig && sheet.classList.contains('open')) return;
      sheetSig = sig;
      const isServers = menu.classList.contains('servers-menu');
      const frame = menu.closest('.card-frame');
      const img = frame && frame.querySelector('img.card, img');
      const title = isServers ? '潜袭哪台服务器？' : ((img && img.alt) || (frame && frame.querySelector('.cardname') && frame.querySelector('.cardname').textContent) || '选择');
      const parts = [];
      const targets = [];
      const servers = isServers ? readServers() : [];
      menu.querySelectorAll('span.float-center, li, span[style*="block"]').forEach((el) => {
        if (el.tagName !== 'LI' && el.closest('li')) return;
        if (el.tagName === 'LI') {
          targets.push(el);
          const dis = el.classList.contains('disabled') ? ' disabled' : '';
          const key = isServers ? serverKeyFromLabel(el.textContent) : null;
          const info = key && servers.find((x) => x.key === key);
          if (info) {
            const c = serverContents(info);
            parts.push('<button type="button" class="jm-sh-item jm-srv' + dis + (info.ice ? '' : ' open-srv') + (info.adv ? ' adv' : '') + '" data-i="' + (targets.length - 1) + '"><b>' + escapeHtml(info.name) + '</b>' +
              '<small class="ice">' + escapeHtml(info.ice ? info.ice + ' 层防火墙' : '无防火墙') + '</small>' +
              (c ? '<small class="in">' + escapeHtml(c) + '</small>' : '') + '</button>');
          } else {
            parts.push('<button type="button" class="jm-sh-item' + dis + '" data-i="' + (targets.length - 1) + '">' + el.innerHTML + '</button>');
          }
        } else if (el.classList.contains('float-center')) {
          parts.push('<div class="jm-sh-head">' + el.innerHTML + '</div>');
        } else {
          parts.push('<div class="jm-sh-info">' + el.innerHTML + '</div>');
        }
      });
      sheet._targets = targets;
      sheet._card = frame ? frame.querySelector(':scope > .card') : null;
      sheet.innerHTML =
        '<div class="jm-sh-panel' + (isServers ? ' jm-sh-grid' : '') + '" role="dialog" aria-label="' + escapeHtml(title) + '">' +
          (img && img.src && !isServers ? '<img class="jm-sh-img" alt="" src="' + escapeHtml(img.src) + '">' : '') +
          '<div class="jm-sh-body"><div class="jm-sh-title"><span>' + escapeHtml(title) + '</span>' +
          '<button type="button" class="jm-sh-close" data-close="1" aria-label="关闭">' + ICON.close + '</button></div>' +
          parts.join('') + '</div></div>';
      sheet.classList.add('open');
    }

    // ---------- 牌堆 / 计分区查看 ----------
    // 档案库、弃牌堆、牌库（点牌库 →「查看」之后）、移出游戏区，网站点开是一个 .popup，挂在牌桌里：
    // 牌桌被缩放、裁切，弹窗跑到屏幕外或被防火墙盖住。原弹窗藏起来（CSS），开着的时候脚本照着它画一个面板。
    // 计分区网站没有弹窗，同一个面板画双方的计分区（左栏议案分那一行、抽屉里的计分区都能打开）。
    // 点面板里的牌：能选的（选牌提示里亮着的）直接代点；其余的看大图，大图下面按需给「打出」「使用能力」。
    // 不能一点就代点：只有一个能力的牌，网站一点就直接发动。
    let pile = null, pileSrc = null, pileSig = '', pileItems = [], pileOpenPrev = [], pileAuto = false, pileAutoDone = false;
    const pileClosing = new Set();
    const shownEl = (el) => !!el && el.isConnected && getComputedStyle(el).display !== 'none';
    const sitePiles = () => Array.from(doc.querySelectorAll('.gameboard .centralpane .popup, .gameboard .right-inner-leftpane .popup, .gameboard .centralpane .deck-container > .menu'));
    // 这个弹窗是谁的哪一堆
    function pileWhere(el) {
      const own = el.parentElement && el.parentElement.closest('.me, .opponent');
      const board = el.closest('.outer-corp-board, .corp-board, .runner-board');
      return { mine: !!(own && own.classList.contains('me')), corp: !!board && !board.classList.contains('runner-board') };
    }
    function pileCard(node, mine) {
      // node 是 .card-frame，或者裸的 img.card（潜袭者看档案库里的暗牌，网站只画牌背）
      const card = node.matches('.card-frame') ? node.querySelector(':scope > .card') : null;
      const img = node.matches('img') ? node : node.querySelector('img.card');
      const alt = (img && img.alt) || '';
      const counters = card ? Array.from(card.querySelectorAll('.counters > .counter')).map((c) => ({ t: (/\b([a-z]+)-counter\b/.exec(c.className) || [])[1] || '', n: c.textContent.trim() })) : [];
      return {
        el: card, src: (img && img.src) || '', mine, counters,
        back: !card || /^Facedown (corp|runner) card$/i.test(alt),
        unseen: !!node.closest('.unseen'),
        sel: !!(card && card.classList.contains('selectable')),
        playable: !!(card && card.classList.contains('playable'))
      };
    }
    function pileCards(scope, mine) {
      if (!scope) return [];
      return Array.from(scope.querySelectorAll('.card-frame, img.card'))
        .filter((n) => n.matches('.card-frame') ? !n.parentElement.closest('.card-frame') : !n.closest('.card-frame'))
        .map((n) => pileCard(n, mine));
    }
    function scoredBlocks() {
      const lp = doc.querySelectorAll('.gameboard .left-inner-leftpane > div');
      return lp.length ? [{ who: 'opp', el: lp[0] }, { who: 'me', el: lp[lp.length - 1] }] : [];
    }

    function pileItemHtml(it, i) {
      const ct = it.counters.filter((c) => c.n).map((c) => '<i class="c-' + escapeHtml(c.t) + '">' + escapeHtml(c.n) + '</i>').join('');
      return '<button type="button" class="jm-pc' + (it.sel ? ' sel' : '') + (it.back ? ' back' : '') + (it.unseen ? ' unseen' : '') + '" data-i="' + i + '">' +
        (it.src ? '<img alt="" src="' + escapeHtml(it.src) + '">' : '') +
        (ct ? '<span class="jm-pc-ct">' + ct + '</span>' : '') + '</button>';
    }
    function renderPile() {
      const s = pileSrc;
      let title = '', sub = '', acts = '', body = '';
      pileItems = [];
      const cardsHtml = (items) => {
        const start = pileItems.length;
        pileItems.push(...items);
        return items.length ? '<div class="jm-pile-cards">' + items.map((it, k) => pileItemHtml(it, start + k)).join('') + '</div>' : '';
      };
      if (s.kind === 'scored') {
        title = '计分区';
        for (const blk of scoredBlocks()) {
          const sc = blk.el.querySelector('.scored');
          const items = pileCards(sc, blk.who === 'me');
          const ap = param(sc, /agenda-count/, 'agenda-point');
          const who = ui ? ui[blk.who].querySelector('.jm-r-who').textContent : (blk.who === 'me' ? '我' : '对手');
          body += '<div><div class="jm-pile-gh">' + escapeHtml(who) + (ap != null ? ' · ' + ap + ' 分' : '') + '</div>' +
            (cardsHtml(items) || '<div class="jm-pile-empty">还没有议案</div>') + '</div>';
        }
        sub = '点牌看大图';
      } else if (s.kind === 'deckmenu') {
        const w = pileWhere(s.el);
        title = w.corp ? '研发中心' : '牌堆';
        body = '<div class="jm-pile-opts">' +
          '<button type="button" class="jm-pile-opt" data-pa="deck-show">查看牌库<small>日志里会写你在看牌库；关上时可以顺便洗牌</small></button>' +
          '<button type="button" class="jm-pile-opt" data-pa="deck-shuffle">洗牌</button></div>';
      } else {
        const w = pileWhere(s.el);
        const items = pileCards(s.el, w.mine);
        const isDeck = !!s.el.closest('.deck-container');
        if (s.el.closest('.discard-container')) title = w.corp ? '档案库' : '弃牌堆';
        else if (isDeck) title = w.corp ? '研发中心' : '牌堆';
        else {
          const h = s.el.parentElement && s.el.parentElement.querySelector(':scope > .header');
          title = h ? h.textContent.replace(/\s*\(\d+\)\s*$/, '').trim() : '牌';
        }
        const down = items.filter((it) => it.back || it.unseen).length;
        sub = items.length + ' 张' + (down ? ' · 暗牌 ' + down : '') + (isDeck ? ' · 从上往下' : '');
        if (isDeck) acts = '<button type="button" class="jm-pile-act" data-pa="close-shuffle">关上并洗牌</button>';
        body = cardsHtml(items) || '<div class="jm-pile-empty">没有牌</div>';
      }
      const keep = pile.querySelector('.jm-pile-body');
      const top = keep ? keep.scrollTop : 0;
      pile.innerHTML = '<div class="jm-pile-head"><b>' + escapeHtml(title) + '</b><small>' + escapeHtml(sub) + '</small>' + acts +
        '<button type="button" class="jm-sh-close" data-pa="close" aria-label="关闭">' + ICON.close + '</button></div>' +
        '<div class="jm-pile-body' + (s.kind === 'scored' ? ' cols' : '') + '">' + body + '</div>';
      if (top) pile.querySelector('.jm-pile-body').scrollTop = top;
      pile.classList.add('open');
    }

    function ensurePile() {
      if (pile) return;
      pile = doc.createElement('div');
      pile.className = 'jm-pile jm-ui';
      pile.setAttribute('role', 'dialog');
      pile.addEventListener('click', (e) => {
        e.stopPropagation();
        const b = e.target.closest('button');
        if (!b || !pileSrc) return;
        const pa = b.dataset.pa;
        const src = pileSrc;
        if (pa === 'close') { closePile(); return; }
        if (pa === 'close-shuffle') {
          // 网站弹窗里第二个链接是「关闭并洗牌」
          const links = src.el.querySelectorAll('a');
          closePile(links[1] || null);
          return;
        }
        if (pa === 'deck-show' || pa === 'deck-shuffle') {
          // 牌库菜单两项：洗牌、查看（按顺序；文字随界面语言）
          const opts = src.el.querySelectorAll(':scope > div');
          const t = opts[pa === 'deck-show' ? 1 : 0];
          pileClosing.add(src.el);
          pileSrc = null; hidePile();
          if (t) t.click();
          return;
        }
        const it = pileItems[+b.dataset.i];
        if (!it || !it.el || !it.el.isConnected) return;
        if (it.sel) { it.el.click(); return; }
        if (it.back) return;
        let use = null;
        if (it.mine && src.kind === 'scored') use = '使用能力';
        else if (it.mine && it.playable) use = '打出';
        openZoom(it.el, use);
      });
      doc.body.appendChild(pile);
    }
    function hidePile() {
      if (!pile) return;
      pile.classList.remove('open');
      pile.innerHTML = '';
      pileSig = ''; pileItems = []; pileAuto = false;
    }
    // 关面板就把网站那边开着的弹窗 / 牌库菜单一起关掉：不然网站以为还开着，下次点牌堆会变成「关」
    // link：要点的那个关闭链接（「关闭并洗牌」）；默认点第一个（「关闭」）
    function closePile(link) {
      if (!pileSrc && !pileOpenPrev.length) return;
      for (const el of sitePiles()) {
        if (!shownEl(el) || pileClosing.has(el)) continue;
        pileClosing.add(el);
        if (el.classList.contains('popup')) {
          const a = (link && el.contains(link)) ? link : el.querySelector('a');
          if (a) a.click(); else el.style.display = 'none';
        } else el.style.display = 'none';
      }
      pileSrc = null;
      hidePile();
    }
    function openScored(auto) {
      closePanels('pile');
      if (!pileSrc || pileSrc.kind !== 'scored') closePile();
      ensurePile();
      pileSrc = { kind: 'scored' };
      pileAuto = !!auto;
      pileSig = '';
    }
    function toggleScored() {
      if (pileSrc && pileSrc.kind === 'scored') closePile(); else { openScored(); syncPile(true); }
    }

    function syncPile(inGame) {
      if (!inGame) { pileSrc = null; pileOpenPrev = []; pileClosing.clear(); hidePile(); return; }
      ensurePile();
      // 关掉之后网站还要淡出 0.4 秒（jQuery fadeOut），这段时间不算开着
      for (const el of pileClosing) if (!shownEl(el)) pileClosing.delete(el);
      const open = sitePiles().filter((el) => shownEl(el) && !pileClosing.has(el));
      const added = open.filter((el) => !pileOpenPrev.includes(el));
      pileOpenPrev = open;
      if (added.length) {
        // 新打开了（点了牌堆，或者网站在选牌提示里自动弹出档案库）→ 换过去
        const el = added[added.length - 1];
        closePanels('pile');
        pileSrc = { kind: el.classList.contains('popup') ? 'popup' : 'deckmenu', el };
        pileSig = '';
      } else if (pileSrc && pileSrc.kind !== 'scored' && !open.includes(pileSrc.el)) {
        const el = open[0];
        pileSrc = el ? { kind: el.classList.contains('popup') ? 'popup' : 'deckmenu', el } : null;
        if (!el) hidePile();
      }

      // 选牌提示要选计分区里的议案（比如没收议案），而牌桌上没有别的可选的 → 自动打开计分区；选完自动关
      // 同一次选牌只自动开一次：用户自己关掉了就不再弹
      const selScored = doc.querySelectorAll('.gameboard .left-inner-leftpane .scored .card.selectable').length;
      const selAll = doc.querySelectorAll('.gameboard .card.selectable').length;
      if (!selScored) {
        pileAutoDone = false;
        if (pileAuto && pileSrc && pileSrc.kind === 'scored') { pileSrc = null; hidePile(); }
      } else if (selScored === selAll && !pileSrc && !pileAutoDone) { pileAutoDone = true; openScored(true); }

      if (!pileSrc) return;
      let sig;
      if (pileSrc.kind === 'scored') sig = scoredBlocks().map((b) => { const sc = b.el.querySelector('.scored'); return sc ? sc.innerHTML : ''; }).join('|') + (ui ? ui.me.querySelector('.jm-r-who').textContent : '');
      else sig = pileSrc.kind + pileSrc.el.innerHTML;
      if (sig !== pileSig || !pile.classList.contains('open')) { pileSig = sig; renderPile(); }
    }

    // ---------- 对战界面控件 ----------
    let ui = null;
    const PANELS = { menu: 'jm-menu-open', log: 'jm-log', opp: 'jm-drawer-opp', me: 'jm-drawer-me' };
    function closePanels(except) {
      for (const k in PANELS) if (k !== except) root.classList.remove(PANELS[k]);
      if (except !== 'menu' && ui) ui.menu.classList.remove('counter');
      if (except !== 'pile') closePile();
    }
    function togglePanel(name) {
      const on = !root.classList.contains(PANELS[name]);
      closePanels(name);
      root.classList.toggle(PANELS[name], on);
      return on;
    }
    // 状态栏里的 #status 链接（认输、离开、屏蔽观众）：顶栏被藏起来了，代点
    function statusLink(cls, re) {
      return doc.querySelector('#status a.' + cls) ||
        Array.from(doc.querySelectorAll('#status a')).find((a) => re.test(a.textContent.trim())) || null;
    }

    function buildGameUI() {
      const rail = doc.createElement('div');
      rail.className = 'jm-rail jm-ui';
      const playerBlock = (who, cls) =>
        '<button type="button" class="jm-r-player ' + cls + '" data-act="' + who + '">' +
          '<span class="jm-r-who">' + (who === 'me' ? '我' : '对手') + '</span>' +
          '<span class="jm-r-row jm-r-clicks"><b data-k="click">–</b><i class="anr-icon click"></i></span>' +
          '<span class="jm-r-row"><b data-k="credit">–</b><i class="anr-icon credit"></i></span>' +
          '<span class="jm-r-row jm-r-ap" data-scored="1" aria-label="计分区"><b data-k="ap">–</b><i class="anr-icon agenda"></i></span>' +
          (who === 'opp' ? '<span class="jm-r-row" hidden><b data-k="hand">–</b><small data-k="handlbl">手牌</small></span>' : '') +
          '<span class="jm-r-row jm-warn" hidden><b data-k="flag">0</b><small data-k="flaglbl"></small></span>' +
        '</button>';
      rail.innerHTML =
        '<div class="jm-r-top">' +
          '<button type="button" data-act="menu" aria-label="菜单">' + ICON.menu + '</button>' +
          '<button type="button" data-act="log" aria-label="日志">' + ICON.log + '<span class="jm-dot"></span></button>' +
        '</div>' +
        playerBlock('opp', 'jm-r-opp') +
        '<div class="jm-r-sides" role="tablist" aria-label="显示哪一方的牌桌">' +
          '<button type="button" role="tab" data-side="corp">公司</button>' +
          '<button type="button" role="tab" data-side="runner">潜袭者</button>' +
          '<button type="button" role="tab" data-side="run">潜袭</button>' +
        '</div>' +
        playerBlock('me', 'jm-r-me');
      rail.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        e.stopPropagation();
        if (e.target.closest('[data-scored]')) { toggleScored(); return; }
        if (b.dataset.side) {
          closePanels();
          setSide(b.dataset.side);
          sideBeforeRun = null; // 手动切过就不再自动切回
          return;
        }
        const act = b.dataset.act;
        if (act === 'log') {
          if (togglePanel('log')) {
            b.classList.remove('unread');
            hideTicker();
            const m = doc.querySelector('.gameboard .right-pane .messages');
            if (m) m.scrollTop = m.scrollHeight;
          }
        } else if (act) {
          togglePanel(act);
          if (act === 'menu') refreshMenu();
        }
      });

      const menu = doc.createElement('div');
      menu.className = 'jm-menu jm-ui';
      const nums = Array.from({ length: 13 }, (_, i) => '<button type="button" data-n="' + i + '">' + i + '</button>').join('');
      menu.innerHTML =
        '<div class="jm-m-main">' +
          '<div class="jm-m-grid">' +
            '<button type="button" data-m="undo-click">撤销时点</button>' +
            '<button type="button" data-m="undo-turn">撤销回合</button>' +
            '<button type="button" data-m="counter">设置指示物</button>' +
            '<button type="button" data-m="sort">手牌排序</button>' +
          '</div>' +
          '<button type="button" data-m="sound" class="jm-m-sound"></button>' +
          '<div class="jm-m-sep"></div>' +
          '<button type="button" data-m="mute">屏蔽观众聊天</button>' +
          '<button type="button" data-m="fs" hidden>全屏</button>' +
          '<button type="button" data-m="desktop">切换到电脑版</button>' +
          '<div class="jm-m-sep"></div>' +
          '<div class="jm-m-grid">' +
            '<button type="button" data-m="leave">离开对局</button>' +
            '<button type="button" data-m="concede" class="jm-danger">认输</button>' +
          '</div>' +
          '<div class="jm-m-foot"></div>' +
        '</div>' +
        '<div class="jm-m-counter">' +
          '<button type="button" data-m="back">‹ 返回</button>' +
          '<div class="jm-m-title">选类型和数量，再点要放的那张牌</div>' +
          '<div class="jm-q-types">' +
            '<button type="button" data-ct="" class="on">自动</button><button type="button" data-ct="ad">推进</button>' +
            '<button type="button" data-ct="ag">议案</button><button type="button" data-ct="c">信用点</button>' +
            '<button type="button" data-ct="p">能量</button><button type="button" data-ct="v">病毒</button>' +
          '</div>' +
          '<div class="jm-q-nums">' + nums + '</div>' +
        '</div>';
      let counterType = '';
      menu.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        e.stopPropagation();
        if (b.dataset.ct !== undefined) {
          counterType = b.dataset.ct;
          menu.querySelectorAll('[data-ct]').forEach((x) => x.classList.toggle('on', x === b));
          return;
        }
        if (b.dataset.n !== undefined) {
          sendCommand('/counter ' + (counterType ? counterType + ' ' : '') + b.dataset.n);
          closePanels();
          return;
        }
        const m = b.dataset.m;
        if (m === 'counter') { menu.classList.add('counter'); return; }
        if (m === 'sound') {
          try { localStorage.setItem(MUTE_KEY, isMuted() ? '0' : '1'); } catch (e) {}
          applyMute();
          refreshMenu();
          return;
        }
        if (m === 'back') { menu.classList.remove('counter'); return; }
        // 危险操作点两次确认（不用 confirm()：iOS 上原生弹窗偶尔会被吞掉）
        if (m === 'undo-turn' || m === 'leave' || m === 'concede') {
          if (!armButton(b, { 'undo-turn': '再点一次：撤销回合', leave: '再点一次：离开', concede: '再点一次：认输' }[m])) return;
        }
        closePanels();
        if (m === 'undo-click') sendCommand('/undo-click');
        else if (m === 'undo-turn') sendCommand('/undo-turn');
        else if (m === 'sort') { const s = doc.querySelector('.gameboard .leftpane > .me .hand-sort'); if (s) s.click(); }
        else if (m === 'mute') { const a = statusLink('mute-button', /mute|旁观者|观众/i); if (a) a.click(); }
        else if (m === 'fs') {
          const el = doc.documentElement;
          if (doc.fullscreenElement || doc.webkitFullscreenElement) (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc);
          else if (el.requestFullscreen) el.requestFullscreen().then(() => { try { screen.orientation.lock('landscape').catch(() => {}); } catch (_) {} }).catch(() => {});
          else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
        }
        else if (m === 'desktop') { setMode('off'); location.reload(); }
        else if (m === 'leave') {
          const a = statusLink('leave-button', /^(leave|离开)/i);
          if (a) a.click(); else showHint('没找到「离开对局」，切换到电脑版再试');
        }
        else if (m === 'concede') {
          if (isOffline()) { showHint('连接断开了，正在重连，连上后再认输'); reconnect(); return; }
          const a = statusLink('concede-button', /^(concede|认输|投降)/i);
          if (a) a.click(); else showHint('现在没法认输：对局可能已经结束了');
        }
      });

      function armButton(b, label) {
        if (b.dataset.armed === '1') { clearTimeout(b._armT); b.dataset.armed = ''; b.textContent = b._label; return true; }
        b._label = b._label || b.textContent;
        b.dataset.armed = '1';
        b.textContent = label;
        clearTimeout(b._armT);
        b._armT = setTimeout(() => { b.dataset.armed = ''; b.textContent = b._label; }, 3000);
        return false;
      }

      const ticker = doc.createElement('div');
      ticker.className = 'jm-ticker jm-ui';
      ticker.innerHTML = '<button type="button" aria-live="polite"></button>';
      ticker.addEventListener('click', (e) => {
        if (!e.target.closest('button')) return;
        e.stopPropagation();
        hideTicker();
        root.classList.remove('jm-log');
        rail.querySelector('[data-act=log]').click();
      });

      const rot = doc.createElement('div');
      rot.className = 'jm-rotate jm-ui';
      rot.innerHTML = '<div class="jm-phone"></div><div>把手机横过来玩</div><button type="button">继续竖屏</button>';
      rot.querySelector('button').addEventListener('click', () => root.classList.add('jm-portrait-ok'));

      doc.body.append(rail, menu, ticker, rot, buildZoomActions());
      return {
        rail, menu, ticker,
        opp: rail.querySelector('.jm-r-opp'), me: rail.querySelector('.jm-r-me'),
        logBtn: rail.querySelector('[data-act=log]')
      };
    }

    function refreshMenu() {
      if (!ui) return;
      const mute = statusLink('mute-button', /mute|屏蔽/i);
      const muteBtn = ui.menu.querySelector('[data-m=mute]');
      muteBtn.hidden = !mute;
      if (mute) setText(muteBtn, /unmute|允许|取消/i.test(mute.textContent) ? '恢复观众聊天' : '屏蔽观众聊天');
      ui.menu.querySelector('[data-m=fs]').hidden = !(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
      const snd = ui.menu.querySelector('[data-m=sound]');
      snd.innerHTML = (isMuted() ? ICON.soundOff + '<span>音效已关 · 点击打开</span>' : ICON.soundOn + '<span>音效已开 · 点击静音</span>');
      snd.classList.toggle('off', isMuted());
      ui.rail.classList.toggle('jm-muted', isMuted());
      ui.menu.querySelector('[data-m=concede]').hidden = !statusLink('concede-button', /^(concede|认输|投降)/i);
      ui.menu.querySelector('[data-m=sort]').hidden = !doc.querySelector('.gameboard .leftpane > .me .hand-sort');
      const ts = doc.querySelector('.gameboard .right-inner-leftpane .timestamp');
      setText(ui.menu.querySelector('.jm-m-foot'), ts ? ts.textContent.replace(/^[-+]\s*/, '').replace(/\s+/g, ' ').replace(/([^\s])([-+])(\d)/, '$1 · $3').trim() : '');
    }

    // ---------- 读取双方数值 ----------
    // 网站给数值节点挂了 data-i18n-param-*，不管界面语言都能取到准确数字
    function param(scope, keyRe, name) {
      if (!scope) return null;
      for (const el of scope.querySelectorAll('[data-i18n-key]')) {
        if (keyRe.test(el.getAttribute('data-i18n-key'))) {
          const v = el.getAttribute('data-i18n-param-' + name);
          if (v != null) return +v;
          return firstInt(el.textContent);
        }
      }
      return null;
    }
    function iconValue(stats, icon) {
      const ic = stats && stats.querySelector('.stats-area .anr-icon.' + icon);
      const d = ic && ic.closest('div');
      if (!d) return null;
      const c = d.cloneNode(true);
      c.querySelectorAll('.controls').forEach((x) => x.remove());
      return c.textContent.replace(/\s+/g, '').trim();
    }
    function readPlayer(block, side) {
      if (!block) return null;
      const stats = block.querySelector('.stats');
      const scored = block.querySelector('.scored');
      const o = {
        click: iconValue(stats, 'click') ?? String(param(stats, /click-count/, 'click') ?? '–'),
        credit: iconValue(stats, 'credit') ?? String(param(stats, /credit-count/, 'credit') ?? '–'),
        ap: param(scored, /agenda-count/, 'agenda-point'),
        req: param(scored, /agenda-count-with-req/, 'agenda-point-req'),
        active: !!(stats && stats.classList.contains('active-player')),
        flag: 0, flagLbl: ''
      };
      if (side === 'runner') {
        const tags = param(stats, /tag-count/, 'total') ?? param(stats, /tag-count/, 'base');
        if (tags) { o.flag = tags; o.flagLbl = '锁定'; }
      } else if (side === 'corp') {
        const bp = param(stats, /bad-pub-count/, 'base');
        if (bp) { o.flag = bp; o.flagLbl = '负面'; }
      }
      return o;
    }
    function paintPlayer(el, p, side) {
      if (!el || !p) return;
      if (el.dataset.pside !== side) el.dataset.pside = side || '';
      setText(el.querySelector('[data-k=click]'), p.click);
      setText(el.querySelector('[data-k=credit]'), p.credit);
      setText(el.querySelector('[data-k=ap]'), p.ap == null ? '–' : (p.req && p.req !== 7 ? p.ap + '/' + p.req : String(p.ap)));
      const fl = el.querySelector('[data-k=flag]');
      fl.parentElement.hidden = !p.flag;
      setText(fl, String(p.flag));
      setText(el.querySelector('[data-k=flaglbl]'), p.flagLbl);
      el.classList.toggle('active', p.active);
    }

    // ---------- 牌桌：显示哪一方 ----------
    const TURN_START_RE = /\bstarted\b.*\bturn\s+\d+|开始.*回合|回合.*开始|開始.*回合|ターン.*開始|commenc.*tour|começ.*turno/i;
    let wasRunning = false, sideBeforeRun = null, gameKey = null, lastLogCount = -1, tickerTimer = null, lastActive = null, turnSide = null;
    function setSide(s) {
      if (root.getAttribute('data-jm-side') !== s) { root.setAttribute('data-jm-side', s); fitSig = ''; }
    }
    function showHint(text) {
      if (!ui) return;
      ui.ticker.querySelector('button').textContent = text;
      ui.ticker.classList.add('show');
      clearTimeout(tickerTimer);
      tickerTimer = setTimeout(hideTicker, 3000);
    }
    onBackInGame = () => {
      if (root.classList.contains('jm-zoom')) { closeZoom(); return; }
      if (doc.querySelector('.gameboard .active-menu')) { closeOriginalMenu(); return; }
      if (pileSrc) { closePile(); return; }
      if (Object.keys(PANELS).some((k) => root.classList.contains(PANELS[k]))) { closePanels(); return; }
      showHint('要离开对局，请用左上角菜单里的「离开对局」');
    };
    function hideTicker() { clearTimeout(tickerTimer); if (ui) ui.ticker.classList.remove('show'); }
    function showTicker(msgEl) {
      const c = msgEl.cloneNode(true);
      c.querySelectorAll('.timestamp, .avatar, img').forEach((x) => x.remove());
      const user = c.querySelector('.username, [class$="-username"]');
      let html;
      if (user) { const name = user.textContent; user.remove(); html = '<b>' + escapeHtml(name) + '</b>' + c.innerHTML; }
      else html = c.innerHTML;
      const btn = ui.ticker.querySelector('button');
      btn.innerHTML = html.replace(/\s+/g, ' ');
      ui.ticker.classList.add('show');
      clearTimeout(tickerTimer);
      tickerTimer = setTimeout(hideTicker, 5000);
    }

    // 右侧提示栏有没有东西：没有就整列收起，把宽度让给牌桌
    function promptHasContent() {
      const pane = doc.querySelector('.gameboard .right-inner-leftpane');
      if (!pane) return false;
      if (pane.querySelector('.button-pane .prompt, .button-pane h4, .button-pane select, .button-pane input')) return true;
      if (pane.querySelector('.button-pane button:not(.disabled)')) return true;
      // 移出游戏 / 搁置 / 销毁区不值得为它撑开一整列；当前生效（Current）和打出区要看
      for (const p of pane.querySelectorAll(':scope > div:first-child > .panel:not(.timestamp)')) {
        if (!p.querySelector('.card')) continue;
        if (p.querySelector(':scope > .header [data-i18n-key="game_rfg"], :scope > .header [data-i18n-key="game_set-aside"], :scope > .header [data-i18n-key="game_destroyed"]')) continue;
        return true;
      }
      return false;
    }

    let promptSig = '';
    function syncGame(inGame) {
      if (inGame) {
        // 提示栏收起 / 展开：放最前面，跟后面的状态栏、日志互不影响
        safe('prompt', () => {
          const hasPrompt = promptHasContent();
          if (root.classList.contains('jm-noprompt') === hasPrompt) { root.classList.toggle('jm-noprompt', !hasPrompt); fitSig = ''; }
          const pr = doc.querySelector('.gameboard .button-pane .prompt');
          // 选服务器的提示（装牌、潜袭目标等）：选项 ≥ 5 个且几乎都是服务器名 → 两列网格，提示栏加宽，按钮下面标出这台服务器的情况
          // 只改属性（data-*），不往 React 管的按钮里塞节点
          let srvPrompt = false;
          if (pr) {
            const btns = Array.from(pr.querySelectorAll(':scope > button'));
            const keys = btns.map((b) => serverKeyFromLabel(b.textContent));
            srvPrompt = btns.length >= 5 && keys.filter(Boolean).length >= btns.length - 1;
            if (srvPrompt) {
              const servers = readServers();
              btns.forEach((b, i) => {
                const info = keys[i] && servers.find((x) => x.key === keys[i]);
                const meta = keys[i] === 'new' ? '新建一台' : serverMeta(info);
                if (meta && b.getAttribute('data-jm-meta') !== meta) b.setAttribute('data-jm-meta', meta);
              });
              if (!pr.hasAttribute('data-jm-srv')) pr.setAttribute('data-jm-srv', '');
            } else if (pr.hasAttribute('data-jm-srv')) pr.removeAttribute('data-jm-srv');
          }
          if (root.classList.contains('jm-wide-prompt') !== srvPrompt) { root.classList.toggle('jm-wide-prompt', srvPrompt); fitSig = ''; }
          // 新提示出现时把提示栏滚到底，保证按钮露出来（矮屏幕上内容可能比栏高）
          const sig = pr ? pr.textContent : '';
          if (sig !== promptSig) {
            promptSig = sig;
            const pane = doc.querySelector('.gameboard .right-inner-leftpane');
            if (pr && pane) requestAnimationFrame(() => { pane.scrollTop = pane.scrollHeight; });
          }
        });
      }
      syncGameRest(inGame);
    }
    function syncGameRest(inGame) {
      if (!inGame) {
        if (ui) closePanels();
        root.classList.remove('jm-running', 'jm-noprompt', 'jm-zoom', 'jm-zoom-movable', 'jm-zoom-usable', 'jm-zoom-bar');
        root.removeAttribute('data-jm-me');
        root.removeAttribute('data-jm-side');
        wasRunning = false; gameKey = null; lastLogCount = -1; fitSig = ''; lastActive = null; turnSide = null;
        return;
      }
      if (!ui) ui = buildGameUI();

      // 自己是哪一方：自己的牌桌带 .me
      const cp = doc.querySelector('.gameboard .centralpane');
      let me = null;
      if (cp) {
        if (cp.querySelector(':scope > .outer-corp-board.me')) me = 'corp';
        else if (cp.querySelector(':scope > .runner-board.me')) me = 'runner';
      }
      if (me && root.getAttribute('data-jm-me') !== me) root.setAttribute('data-jm-me', me);
      const opp = me === 'runner' ? 'corp' : 'runner';

      // 新对局：默认显示自己这一方
      const key = me || 'spectator';
      if (key !== gameKey) { gameKey = key; setSide(me || 'corp'); sideBeforeRun = null; }

      // 潜袭开始：切到潜袭视图（被潜袭的服务器 + 装备区）；结束后切回
      const running = !!(cp && cp.querySelector('.run-arrow'));
      if (running && !wasRunning) {
        const cur = root.getAttribute('data-jm-side');
        if (cur !== 'run') { sideBeforeRun = cur; setSide('run'); }
      } else if (!running && root.getAttribute('data-jm-side') === 'run') {
        setSide(sideBeforeRun || me || 'corp');
        sideBeforeRun = null;
      }
      wasRunning = running;
      root.classList.toggle('jm-running', running);

      // 状态栏数字
      const lp = doc.querySelectorAll('.gameboard .left-inner-leftpane > div');
      // 谁的回合：网站不在面板上标，从日志倒着找，先碰到哪条用哪条：
      //  1. 「XX started … turn N」（日志按界面语言翻译，常见几种说法都认）→ 就是这一方
      //  2. 回合结束后服务器单独发一条 [hr]（渲染成 <hr>），它前一条是「XX 结束回合」→ 轮到另一方
      // 用户名外面的 span 带 corp-username / runner-username，跟语言无关
      const msgs = doc.querySelectorAll('.gameboard .right-pane .messages > div');
      const n = msgs.length;
      const sideOf = (el) => { const u = el && el.querySelector('.corp-username, .runner-username'); return u ? (u.classList.contains('corp-username') ? 'corp' : 'runner') : null; };
      for (let i = n - 1; i >= Math.max(0, lastLogCount < 0 ? 0 : lastLogCount); i--) {
        if (msgs[i].querySelector('hr')) {
          for (let j = i - 1; j >= Math.max(0, i - 3); j--) { const s = sideOf(msgs[j]); if (s) { turnSide = s === 'corp' ? 'runner' : 'corp'; break; } }
          break;
        }
        const s = sideOf(msgs[i]);
        if (s && TURN_START_RE.test(msgs[i].textContent)) { turnSide = s; break; }
      }
      const pOpp = readPlayer(lp[0], opp), pMe = readPlayer(lp[lp.length - 1], me || 'corp');
      if (turnSide) { if (pOpp) pOpp.active = turnSide === opp; if (pMe) pMe.active = turnSide === (me || 'corp'); }
      paintPlayer(ui.opp, pOpp, opp);
      paintPlayer(ui.me, pMe, me || 'corp');
      // 计分区里有能选的议案（选牌提示）：议案分那一行标金色，提示点开
      [[ui.opp, lp[0]], [ui.me, lp[lp.length - 1]]].forEach(([el, blk]) => {
        el.querySelector('.jm-r-ap').classList.toggle('jm-sel', !!(blk && blk.querySelector('.scored .card.selectable')));
      });

      // 换回合：牌桌跟到行动方那一边（潜袭中先记着，潜袭结束再切）
      const active = turnSide;
      if (active && active !== lastActive) {
        if (lastActive) {
          if (root.getAttribute('data-jm-side') === 'run') sideBeforeRun = active;
          else setSide(active);
        }
        lastActive = active;
      }
      const oh = doc.querySelector('.gameboard .leftpane > .opponent .hand > .header');
      const ohRow = ui.opp.querySelector('[data-k=hand]').parentElement;
      ohRow.hidden = !oh;
      if (oh) {
        setText(ui.opp.querySelector('[data-k=hand]'), String(firstInt(oh.textContent) ?? '–'));
        setText(ui.opp.querySelector('[data-k=handlbl]'), opp === 'corp' ? '总部' : '手牌');
      }
      if (!me) { setText(ui.me.querySelector('.jm-r-who'), '公司'); setText(ui.opp.querySelector('.jm-r-who'), '潜袭者'); }

      // 日志：未读点 + 顶部提示条
      if (lastLogCount >= 0 && n > lastLogCount && !root.classList.contains('jm-log')) {
        ui.logBtn.classList.add('unread');
        showTicker(msgs[n - 1]);
      }
      lastLogCount = n;

      if (root.classList.contains('jm-menu-open')) refreshMenu();
      fitBoard();
      syncServerNav(false);
    }

    // ---------- 牌桌自动缩放 ----------
    // 让当前显示的牌桌刚好放进可视区域；空的时候放大（最多 1.5 倍），满的时候缩小（最少 0.6 倍，再小就滚动）
    let fitSig = '', fitting = false;
    const MIN_Z = 0.6, MAX_Z = 1.5;
    // 横向最多缩到 0.8 倍（牌约 48×67 像素，还认得出），再宽就横着滚，配服务器导航条；纵向照旧可以缩到 0.6
    const WIDTH_FLOOR = 0.8;
    let lastFitSide = null;
    function visibleBoards(cp) {
      const side = root.getAttribute('data-jm-side');
      const corp = cp.querySelector(':scope > .outer-corp-board');
      const runner = cp.querySelector(':scope > .runner-board');
      if (side === 'run') return [corp, runner].filter(Boolean);
      return [side === 'runner' ? runner : corp].filter(Boolean);
    }
    function fitBoard(force) {
      if (fitting) return;
      const cp = doc.querySelector('.gameboard .centralpane');
      if (!cp) return;
      const boards = visibleBoards(cp);
      if (!boards.length) return;
      const sig = [root.getAttribute('data-jm-side'), cp.clientWidth, cp.clientHeight, cp.querySelectorAll('.card').length, root.classList.contains('jm-noprompt')].join('|');
      if (!force && sig === fitSig) return;
      fitSig = sig;
      fitting = true;
      try {
        const row = root.getAttribute('data-jm-side') === 'run';
        let sumW = 0, maxW = 0, maxH = 0;
        for (const b of boards) {
          b.style.zoom = '1';
          b.style.minWidth = '0';
          const r = b.getBoundingClientRect();
          sumW += r.width; maxW = Math.max(maxW, r.width); maxH = Math.max(maxH, r.height);
        }
        const side = root.getAttribute('data-jm-side');
        const needW = row ? sumW : maxW;
        const availW = cp.clientWidth - 8;
        // 公司牌桌放不下 → 打开服务器导航条（只看宽度判断，不受导航条自己占的高度影响，不会来回跳）
        const nav = side === 'corp' && needW * WIDTH_FLOOR > availW;
        if (root.classList.contains('jm-srvnav') !== nav) root.classList.toggle('jm-srvnav', nav);
        const cs = getComputedStyle(cp);
        const availH = cp.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 8;
        let z = Math.min(MAX_Z, availH / maxH, Math.max(availW / needW, WIDTH_FLOOR));
        z = Math.max(MIN_Z, Math.floor(z * 100) / 100);
        for (const b of boards) { b.style.zoom = String(z); b.style.minWidth = ''; }
        if (side !== lastFitSide) {
          lastFitSide = side;
          cp.scrollLeft = 0;
          cp.scrollTop = side === root.getAttribute('data-jm-me') ? cp.scrollHeight : 0;
        }
        syncServerNav(true);
      } finally { fitting = false; }
    }
    window.addEventListener('resize', () => requestAnimationFrame(() => fitBoard(true)));

    // ---------- 服务器导航条（公司服务器多到横向放不下时出现在牌桌顶部） ----------
    // 每台服务器一个小标签：档 / 研 / 总 / 1 / 2 …，下面的短横是防火墙层数；正在被潜袭的那台金色，屏幕里看得见的那几台有底色。点一下滚到那台
    let navEl = null, navSig = '', navServers = [];
    function syncServerNav(force) {
      if (!root.classList.contains('jm-game') || !root.classList.contains('jm-srvnav')) { navSig = ''; return; }
      if (!navEl) {
        navEl = doc.createElement('div');
        navEl.className = 'jm-srvnav-bar jm-ui';
        navEl.addEventListener('click', (e) => {
          const b = e.target.closest('button');
          if (!b) return;
          e.stopPropagation();
          const info = navServers.find((x) => x.key === b.dataset.k);
          const cp = doc.querySelector('.gameboard .centralpane');
          if (!info || !info.el.isConnected || !cp) return;
          const r = info.el.getBoundingClientRect(), c = cp.getBoundingClientRect();
          cp.scrollBy({ left: r.left - c.left - (c.width - r.width) / 2, behavior: 'smooth' });
        });
        doc.body.appendChild(navEl);
      }
      navServers = readServers();
      const sig = navServers.map((x) => x.key + ':' + x.ice + ':' + x.adv + ':' + (x.run ? 1 : 0)).join(',');
      if (sig !== navSig || force) {
        navSig = sig;
        navEl.innerHTML = navServers.map((x) =>
          '<button type="button" data-k="' + x.key + '" class="' + (x.run ? 'run' : '') + (x.key.startsWith('remote') ? '' : ' central') + '" aria-label="' + escapeHtml(x.name + '，' + serverMeta(x).replace('\n', '，')) + '">' +
            '<b>' + escapeHtml(x.short) + '</b><span>' + '<i></i>'.repeat(Math.min(x.ice, 5)) + '</span>' + (x.adv ? '<em>' + x.adv + '</em>' : '') + '</button>').join('');
      }
      markNavVisible();
    }
    function markNavVisible() {
      const cp = doc.querySelector('.gameboard .centralpane');
      if (!navEl || !cp) return;
      const c = cp.getBoundingClientRect();
      for (const b of navEl.children) {
        const info = navServers.find((x) => x.key === b.dataset.k);
        if (!info || !info.el.isConnected) continue;
        const r = info.el.getBoundingClientRect();
        const seen = Math.min(r.right, c.right) - Math.max(r.left, c.left);
        b.classList.toggle('vis', seen > r.width * 0.5);
      }
    }
    let navRaf = 0;
    doc.addEventListener('scroll', (e) => {
      if (e.target && e.target.classList && e.target.classList.contains('centralpane')) { cancelAnimationFrame(navRaf); navRaf = requestAnimationFrame(markNavVisible); }
    }, true);

    // ---------- 用日志输入框发聊天命令（/undo-click 等） ----------
    function sendCommand(text) {
      const input = doc.querySelector('.gameboard .log-input form input');
      const form = input && input.closest('form');
      if (!input || !form) { alert('找不到日志输入框，命令没发出去'); return false; }
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      setTimeout(() => {
        if (form.requestSubmit) form.requestSubmit();
        else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }, 0);
      return true;
    }

    // ---------- 模拟拖拽：把卡移到手牌 / 弃牌堆 / 牌库顶（修正误操作） ----------
    function simulateMove(cardEl, target) {
      const sel = {
        hand: '.gameboard .leftpane > .me .hand',
        discard: '.gameboard .centralpane .me .discard-container',
        deck: '.gameboard .centralpane .me .deck-container'
      }[target];
      const dropEl = sel && doc.querySelector(sel);
      if (!cardEl || !dropEl) return false;
      let dt;
      try { dt = new DataTransfer(); } catch (e) { return false; }
      const fire = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
      fire(cardEl, 'dragstart');
      fire(dropEl, 'dragenter');
      fire(dropEl, 'dragover');
      fire(dropEl, 'drop');
      fire(cardEl, 'dragend');
      return true;
    }

    // 牌库的拖放目标把「翻译后」的名字发给服务器（中文界面是「存储栈」「研发中心」），
    // 服务器只认 Stack / R&D，于是中文界面下拖到牌库会被悄悄忽略。
    // 改用 /move-deck：服务器弹出选牌提示后，替用户点那张牌。
    function cardTitleOf(el) {
      const img = el && el.querySelector('img');
      return (img && img.alt) || (el && el.querySelector('.cardname') && el.querySelector('.cardname').textContent) || '';
    }
    function moveToDeck(cardEl) {
      const title = cardTitleOf(cardEl);
      if (!sendCommand('/move-deck')) return;
      const t0 = Date.now();
      (function poll() {
        let el = cardEl.isConnected ? cardEl : null;
        if (!el && title) el = Array.from(doc.querySelectorAll('.gameboard .card')).find((c) => cardTitleOf(c) === title) || null;
        const prompt = doc.querySelector('.gameboard .button-pane .prompt');
        const ready = el && (el.classList.contains('selectable') || (prompt && /top of your deck|牌库顶|顶部/i.test(prompt.textContent)));
        if (ready) { el.click(); return; }
        if (Date.now() - t0 > 5000) { alert('服务器没回应。可以在日志里输入 /move-deck，再点这张牌'); return; }
        setTimeout(poll, 120);
      })();
    }

    let lpTarget = null;
    function buildZoomActions() {
      const za = doc.createElement('div');
      za.className = 'jm-zoom-actions jm-ui';
      za.innerHTML =
        '<button type="button" data-mv="use"></button>' +
        '<span class="jm-z-move"><span>移到</span><button type="button" data-mv="hand">手牌</button>' +
        '<button type="button" data-mv="discard">弃牌堆</button><button type="button" data-mv="deck">牌库顶</button></span>' +
        '<button type="button" data-mv="close">关闭</button>';
      za.addEventListener('click', (e) => {
        e.stopPropagation();
        const b = e.target.closest('button');
        if (!b) return;
        const mv = b.dataset.mv;
        const card = lpTarget;
        closeZoom();
        if (mv === 'use') { if (card && card.isConnected) card.click(); }
        else if (mv === 'deck' && card) moveToDeck(card);
        else if (mv !== 'close' && card && !simulateMove(card, mv)) alert('这张卡移不了');
      });
      return za;
    }

    // ---------- 长按看大图 ----------
    const LONG_MS = 420;
    let lpTimer = null, lpStart = null, lpFired = false, suppressUntil = 0;

    function zoomTargetFrom(el) {
      if (!el || !el.closest || el.closest('.jm-ui')) return null;
      // 指示物、强度、牌名这些角标是 .card 的兄弟节点（同在 .card-frame 里），按在上面要算这张牌，
      // 不然往上找到的是宿主牌（寄生的牌）或者什么都找不到
      const frame = el.closest('.gameboard .card-frame');
      let t = frame && !el.closest('.gameboard .card-frame > .card') ? frame.querySelector(':scope > .card') : null;
      t = t || el.closest('.gameboard .card, .gameboard .card-preview-hover, .deckbuilder .line span, .deckbuilder .card-title, .button-pane [data-card-title], .log .messages [data-card-title]');
      // 不知道是什么的暗牌（牌库背面、对手没激活的牌）网站不给大图，长按只会弹出一个空框
      const img = t && t.matches('.gameboard .card') && (t.matches('img') ? t : t.querySelector('img'));
      if (img && /^Facedown (corp|runner) card$/i.test(img.alt || '')) return null;
      return t;
    }
    function fireHover(el) {
      const opts = { bubbles: true, cancelable: true, view: window, relatedTarget: doc.body };
      el.dispatchEvent(new MouseEvent('mouseover', opts));
      el.dispatchEvent(new MouseEvent('mouseenter', Object.assign({}, opts, { bubbles: false })));
    }
    function fireLeave(el) {
      if (!el || !el.isConnected) return;
      const opts = { bubbles: true, cancelable: true, view: window, relatedTarget: doc.body };
      el.dispatchEvent(new MouseEvent('mouseout', opts));
      el.dispatchEvent(new MouseEvent('mouseleave', Object.assign({}, opts, { bubbles: false })));
    }
    // use：大图下面多一个按钮，点了就是代点这张牌（牌堆面板里的「打出」「使用能力」）
    function openZoom(el, use) {
      lpTarget = el;
      fireHover(el);
      root.classList.add('jm-zoom');
      const movable = !!(el.matches && el.matches('.gameboard .card[draggable="true"]'));
      root.classList.toggle('jm-zoom-movable', movable);
      root.classList.toggle('jm-zoom-usable', !!use);
      root.classList.toggle('jm-zoom-bar', movable || !!use);
      const ub = doc.querySelector('.jm-zoom-actions [data-mv=use]');
      if (ub && use) setText(ub, use);
      if (navigator.vibrate) try { navigator.vibrate(10); } catch (e) {}
    }
    function closeZoom() {
      root.classList.remove('jm-zoom', 'jm-zoom-movable', 'jm-zoom-usable', 'jm-zoom-bar');
      fireLeave(lpTarget);
      lpTarget = null;
    }

    doc.addEventListener('touchstart', (e) => {
      lpFired = false;
      if (root.classList.contains('jm-zoom')) {
        if (e.target.closest && e.target.closest('.jm-zoom-actions')) return;
        e.preventDefault(); // 关大图这一下不要穿透到下面的牌
        closeZoom();
        return;
      }
      const el = zoomTargetFrom(e.target);
      if (!el || e.touches.length > 1) return;
      const t = e.touches[0];
      lpStart = { x: t.clientX, y: t.clientY };
      clearTimeout(lpTimer);
      lpTimer = setTimeout(() => { lpFired = true; openZoom(el); }, LONG_MS);
    }, { passive: false, capture: true });

    doc.addEventListener('touchmove', (e) => {
      if (!lpStart) return;
      const t = e.touches[0];
      if (Math.abs(t.clientX - lpStart.x) > 8 || Math.abs(t.clientY - lpStart.y) > 8) { clearTimeout(lpTimer); lpStart = null; }
    }, { passive: true, capture: true });

    doc.addEventListener('touchend', (e) => {
      clearTimeout(lpTimer); lpStart = null;
      if (lpFired) {
        // 长按松手不算一次点击；只吞这一下，下一次正常点击不受影响
        lpFired = false;
        if (e.cancelable) e.preventDefault();
        suppressUntil = Date.now() + 350;
      }
    }, { passive: false, capture: true });
    doc.addEventListener('touchcancel', () => { clearTimeout(lpTimer); lpStart = null; lpFired = false; }, { capture: true });

    doc.addEventListener('click', (e) => {
      if (Date.now() < suppressUntil) {
        suppressUntil = 0;
        if (e.target.closest && e.target.closest('.jm-ui')) return;
        e.stopPropagation(); e.preventDefault();
      }
    }, true);
    doc.addEventListener('contextmenu', (e) => { if (zoomTargetFrom(e.target)) e.preventDefault(); }, true);

    // 普通点击卡牌后，模拟出来的 hover 会让预览一直挂着；点完立即取消
    doc.addEventListener('click', (e) => {
      if (root.classList.contains('jm-zoom')) return;
      const el = e.target.closest && e.target.closest('.gameboard .card');
      if (el) setTimeout(() => fireLeave(el), 0);
    }, false);

    // 抽屉里的计分区牌太小：点计分区任何地方都打开计分区面板（议案分的 +/- 照旧）
    doc.addEventListener('click', (e) => {
      if (!root.classList.contains('jm-game')) return;
      const t = e.target;
      if (!t.closest || !t.closest('.gameboard .left-inner-leftpane .scored') || t.closest('.stat-controls .controls')) return;
      e.stopPropagation(); e.preventDefault();
      openScored();
      syncPile(true);
    }, true);

    // 点抽屉 / 菜单以外的地方关闭它们
    doc.addEventListener('click', (e) => {
      if (!root.classList.contains('jm-game')) return;
      const t = e.target;
      if (!t.closest || t.closest('.jm-ui')) return;
      if (root.classList.contains('jm-log') && !t.closest('.right-pane .content-pane')) root.classList.remove('jm-log');
      if (root.classList.contains('jm-drawer-opp') && !t.closest('.left-inner-leftpane > div:first-child, .leftpane > .opponent')) root.classList.remove('jm-drawer-opp');
      if (root.classList.contains('jm-drawer-me') && !t.closest('.left-inner-leftpane > div:last-child')) root.classList.remove('jm-drawer-me');
      if (root.classList.contains('jm-menu-open')) { root.classList.remove('jm-menu-open'); ui && ui.menu.classList.remove('counter'); }
    }, true);

    // ---------- 启动 ----------
    function start() {
      fixViewport();
      sync();
      let raf = 0;
      const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(sync); };
      // 脚本自己的元素（.jm-ui）变化不触发同步，避免自己触发自己
      const mo = new MutationObserver((muts) => {
        for (const m of muts) {
          const t = m.target.nodeType === 1 ? m.target : m.target.parentElement;
          if (!t || !t.closest('.jm-ui')) { schedule(); return; }
        }
      });
      mo.observe(doc.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
      new MutationObserver((muts) => {
        for (const m of muts) if (m.target.matches && m.target.matches('.gameboard .popup, .gameboard .deck-container > .menu')) { schedule(); return; }
      }).observe(doc.body, { subtree: true, attributes: true, attributeFilter: ['style'] });
      window.addEventListener('popstate', schedule);
      if (window.ResizeObserver) {
        let ro = null;
        setInterval(() => {
          const cp = doc.querySelector('.gameboard .centralpane');
          if (cp && (!ro || ro._el !== cp)) {
            if (ro) ro.disconnect();
            ro = new ResizeObserver(() => fitBoard());
            ro._el = cp;
            ro.observe(cp);
          }
        }, 1000);
      }
    }
    onReady(start);
  }
})();
