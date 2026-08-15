(function () {
  'use strict';

  const SCRIPT_ID = 'jinteki-pnp';
  const OVERLAY_ID = `${SCRIPT_ID}-overlay`;
  const CARD_WIDTH_MM = 63.5;
  const CARD_HEIGHT_MM = 88.9;
  const MIN_MARGIN_MM = 6.35;
  const IMAGE_CONCURRENCY = 5;
  const MAX_LAYOUT_BLOCK_MS = 50;
  const BLEED_MM = Object.freeze({ none: 0, narrow: 3, wide: 6 });
  const pageFetch = window.fetch.bind(window);

  let modalState = null;
  let engineOptions = {
    workerUrl: '/lib/js/pnp/image-worker.js',
  };

  addStyles();

  globalThis.JintekiPnPEngine = Object.freeze({
    version: '0.6.0-integrated',
    open: openModal,
    close: closeModal,
  });

  function openModal(rawDeck, options = {}) {
    const deck = normalizeEmbeddedDeck(rawDeck, options);
    if (!deck) throw new Error('没有收到有效的 Jinteki 卡组数据。');

    closeModal();
    engineOptions = {
      ...engineOptions,
      workerUrl: usableImageUrl(options.workerUrl) || engineOptions.workerUrl,
    };

    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.innerHTML = `
      <section class="jpnp-dialog" role="dialog" aria-modal="true" aria-labelledby="jpnp-title">
        <header class="jpnp-header">
          <div>
            <h2 id="jpnp-title">Jinteki PnP</h2>
            <p>从当前卡组详情生成可打印 PDF</p>
          </div>
          <button type="button" class="jpnp-icon-button" data-action="close" aria-label="关闭">×</button>
        </header>

        <div class="jpnp-body">
          <div class="jpnp-deck-summary" data-role="summary">
            <div class="jpnp-summary-main">
              <span class="jpnp-spinner" aria-hidden="true"></span>
              <span data-role="summary-text"></span>
            </div>
            <div class="jpnp-multiface-note" data-role="multiface-note" hidden></div>
          </div>

          <div class="jpnp-options" data-role="options" hidden>
            <label>
              <span>卡图语言</span>
              <select data-setting="language">
                <option value="current">跟随当前页面</option>
                <option value="zh-simp">简体中文</option>
                <option value="en">English</option>
              </select>
            </label>

            <label>
              <span>图片质量</span>
              <select data-setting="resolution">
                <option value="current">跟随当前页面</option>
                <option value="default">普通</option>
                <option value="high">高分辨率</option>
              </select>
            </label>

            <label>
              <span>纸张</span>
              <select data-setting="format">
                <option value="a4">A4</option>
                <option value="letter">Letter</option>
              </select>
            </label>

            <label class="jpnp-option-with-help">
              <span>出血</span>
              <select data-setting="bleed">
                <option value="none">无 · 0 mm</option>
                <option value="narrow">窄 · 3 mm</option>
                <option value="wide">宽 · 6 mm</option>
              </select>
              <small data-role="bleed-help">保持标准 63.5 × 88.9 mm 卡牌尺寸，不留出血沟槽。</small>
            </label>

            <label class="jpnp-option-with-help">
              <span>裁切方式</span>
              <select data-setting="cut-style">
                <option value="none">无</option>
                <option value="lines">贯穿裁切线</option>
                <option value="marks" selected>页边裁切标记</option>
              </select>
              <small data-role="cut-style-help">从纸张边缘指向每张卡边界，不穿过卡图。</small>
            </label>

            <label class="jpnp-checkbox-row">
              <input type="checkbox" data-setting="include-identity" checked>
              <span>包含身份牌</span>
            </label>
          </div>

          <div class="jpnp-progress" data-role="progress" hidden>
            <div class="jpnp-progress-track"><div class="jpnp-progress-bar" data-role="progress-bar"></div></div>
            <div class="jpnp-progress-label" data-role="progress-label"></div>
          </div>

          <div class="jpnp-message" data-role="message" hidden></div>
        </div>

        <footer class="jpnp-footer">
          <button type="button" class="jpnp-secondary" data-action="close">取消</button>
          <button type="button" class="jpnp-primary" data-action="generate" disabled>生成 PDF</button>
        </footer>
      </section>
    `;

    document.body.appendChild(overlay);

    modalState = {
      overlay,
      deck,
      busy: false,
      abortController: null,
      cancelRequested: false,
      keydownHandler: null,
    };

    overlay.addEventListener('click', handleModalClick);
    overlay.addEventListener('change', handleSettingChange);
    modalState.keydownHandler = (event) => {
      if (event.key !== 'Escape') return;
      if (modalState?.busy) requestCancellation();
      else closeModal();
    };
    document.addEventListener('keydown', modalState.keydownHandler);

    const identityText = deck.identity ? '，含身份牌' : '';
    setSummary(`${deck.name} · ${deck.totalCards} 张卡 · ${deck.cards.length} 种${identityText}`, false);
    setOptionsVisible(true);
    setGenerateEnabled(deck.cards.length > 0);
    updateMultiFaceSummary(deck);
  }

  function normalizeEmbeddedDeck(rawDeck, options) {
    if (!rawDeck || !Array.isArray(rawDeck.cards)) return null;

    const cards = rawDeck.cards.map((entry) => {
      const databaseCard = entry?.card;
      const qty = Number.parseInt(entry?.qty, 10);
      if (!databaseCard?.title || !Number.isFinite(qty) || qty <= 0) return null;
      return {
        title: databaseCard.title,
        qty,
        code: databaseCard.code || null,
        databaseCard,
      };
    }).filter(Boolean);

    const identityCard = rawDeck.identity;
    const identity = identityCard?.title
      ? {
          title: identityCard.title,
          qty: 1,
          code: identityCard.code || null,
          databaseCard: identityCard,
        }
      : null;

    return {
      name: cleanText(rawDeck.name) || 'Jinteki Deck',
      cards,
      identity,
      totalCards: cards.reduce((sum, card) => sum + card.qty, 0),
      currentLanguage: normalizeSetting(options.language, 'en'),
      currentResolution: normalizeSetting(options.resolution, 'default') === 'high' ? 'high' : 'default',
    };
  }

  function normalizeSetting(value, fallback) {
    const normalized = String(value || '').replace(/^:/, '');
    return normalized || fallback;
  }

  function handleSettingChange(event) {
    if (!event.target.matches('[data-setting="bleed"], [data-setting="cut-style"]')) return;
    updateSettingHelp();
  }

  function updateSettingHelp() {
    if (!modalState) return;

    const bleed = settingElement('bleed').value;
    const cutStyle = settingElement('cut-style').value;
    const bleedHelp = modalState.overlay.querySelector('[data-role="bleed-help"]');
    const cutStyleHelp = modalState.overlay.querySelector('[data-role="cut-style-help"]');

    bleedHelp.textContent = {
      none: '保持标准 63.5 × 88.9 mm 卡牌尺寸，不留出血沟槽。',
      narrow: '卡间留 3 mm 沟槽，并按纸张可用空间等比缩放卡图。',
      wide: '卡间留 6 mm 沟槽，并按纸张可用空间等比缩放卡图。',
    }[bleed];

    cutStyleHelp.textContent = {
      none: 'PDF 中不添加任何裁切辅助线。',
      lines: '绘制横贯整页的裁切线；有出血时落在沟槽中央。',
      marks: '从纸张边缘指向每张卡边界，不穿过卡图。',
    }[cutStyle];
  }

  function closeModal() {
    if (!modalState) {
      document.getElementById(OVERLAY_ID)?.remove();
      return;
    }

    if (modalState.keydownHandler) {
      document.removeEventListener('keydown', modalState.keydownHandler);
    }
    modalState.overlay.remove();
    modalState = null;
  }

  function handleModalClick(event) {
    if (!modalState) return;

    const action = event.target.closest('[data-action]')?.dataset.action;
    if (modalState.busy) {
      if (action === 'close') requestCancellation();
      return;
    }

    if (event.target === modalState.overlay) {
      closeModal();
      return;
    }

    if (action === 'close') closeModal();
    if (action === 'generate') generatePdfFromModal();
  }

  function requestCancellation() {
    if (!modalState?.busy || modalState.cancelRequested) return;

    modalState.cancelRequested = true;
    modalState.abortController?.abort();
    showMessage('正在停止生成……', 'warning', true);
    for (const button of modalState.overlay.querySelectorAll('[data-action="close"]')) {
      button.disabled = true;
    }
  }

  function usableImageUrl(value) {
    if (!value || /\/img\/missing\.png(?:$|\?)/i.test(value)) return null;
    try {
      return new URL(value, location.origin).href;
    } catch (_error) {
      return null;
    }
  }

  async function generatePdfFromModal() {
    if (!modalState?.deck || modalState.busy) return;

    const jsPDF = globalThis.jspdf?.jsPDF;
    if (!jsPDF) {
      showMessage('本地 jsPDF 没有加载成功，请刷新页面后重试。', 'error', true);
      return;
    }

    const stateAtStart = modalState;
    const deck = stateAtStart.deck;
    const settings = readSettings(deck);
    const abortController = new AbortController();
    stateAtStart.abortController = abortController;
    stateAtStart.cancelRequested = false;
    const { signal } = abortController;
    setBusy(true);
    setProgressVisible(true);
    showMessage('', 'info', false);
    const generationStartedAt = performance.now();

    try {
      updateProgress(0, '正在解析卡图链接……');
      const printableCards = await resolvePrintableCards(deck, settings);
      const resolvedAt = performance.now();
      throwIfCancelled(signal);
      const missing = printableCards.filter((card) => !card.url);
      const resolved = printableCards.filter((card) => card.url);

      if (!resolved.length) {
        throw new Error('没有找到任何可用卡图。');
      }

      const flowProgress = {
        downloaded: 0,
        totalDownloads: new Set(resolved.map((card) => card.url)).size,
        laidOut: 0,
        totalLayout: resolved.reduce((sum, card) => sum + card.qty, 0),
      };
      const renderFlowProgress = () => {
        const downloadRatio = flowProgress.downloaded / Math.max(flowProgress.totalDownloads, 1);
        const layoutRatio = flowProgress.laidOut / Math.max(flowProgress.totalLayout, 1);
        updateProgress(
          5 + downloadRatio * 35 + layoutRatio * 59,
          `正在生成：卡图 ${flowProgress.downloaded}/${flowProgress.totalDownloads} · 排版 ${flowProgress.laidOut}/${flowProgress.totalLayout}……`,
        );
      };
      const imageLoader = createImageLoader(resolved, signal, (done) => {
        flowProgress.downloaded = done;
        renderFlowProgress();
      });

      renderFlowProgress();
      await yieldForPaint();
      throwIfCancelled(signal);
      const layoutStartedAt = performance.now();
      const { doc, failed } = await buildPdf(jsPDF, resolved, imageLoader, settings, signal, (done) => {
        flowProgress.laidOut = done;
        renderFlowProgress();
      });
      const layoutFinishedAt = performance.now();
      await imageLoader.wait();

      const filename = `${sanitizeFilename(deck.name)}_PnP_${isoDate()}.pdf`;
      updateProgress(99, '正在封装 PDF……');
      await yieldForPaint();
      throwIfCancelled(signal);
      const saveStartedAt = performance.now();
      doc.save(filename);
      const finishedAt = performance.now();
      updateProgress(100, `完成：${filename}`);

      console.info('[Jinteki PnP] 生成耗时', {
        resolveMs: roundedMs(resolvedAt - generationStartedAt),
        downloadMs: roundedMs(imageLoader.stats.finishedAt - imageLoader.stats.startedAt),
        layoutPipelineMs: roundedMs(layoutFinishedAt - layoutStartedAt),
        saveMs: roundedMs(finishedAt - saveStartedAt),
        totalMs: roundedMs(finishedAt - generationStartedAt),
        uniqueImages: flowProgress.totalDownloads,
        cardSlots: flowProgress.totalLayout,
        imageProcessor: imageLoader.stats.processor.mode,
        nativeConverted: imageLoader.stats.processor.nativeConverted,
        jsPdfFallbacks: imageLoader.stats.processor.jsPdfFallbacks,
      });

      const problems = [...missing, ...failed];
      if (problems.length) {
        const names = problems.map((card) => card.title).join('、');
        showMessage(`PDF 已生成，但跳过 ${problems.length} 种缺图或下载失败的卡：${names}`, 'warning', true);
      } else {
        showMessage('PDF 已生成。相同卡图仅请求一次，后续会优先使用浏览器缓存。', 'success', true);
      }
    } catch (error) {
      abortController.abort();
      if (isCancellationError(error)) {
        showMessage('生成已停止。', 'info', true);
        updateProgress(0, '已停止');
      } else {
        console.error('[Jinteki PnP]', error);
        showMessage(`生成失败：${error.message || String(error)}`, 'error', true);
        updateProgress(0, '生成失败');
      }
    } finally {
      if (modalState === stateAtStart) {
        stateAtStart.abortController = null;
        setBusy(false);
      }
    }
  }

  function readSettings(deck) {
    const languageValue = settingElement('language').value;
    const resolutionValue = settingElement('resolution').value;

    return {
      language: languageValue === 'current' ? deck.currentLanguage : languageValue,
      resolution: resolutionValue === 'current' ? deck.currentResolution : resolutionValue,
      format: settingElement('format').value,
      bleed: BLEED_MM[settingElement('bleed').value] ?? 0,
      cutStyle: settingElement('cut-style').value,
      includeIdentity: settingElement('include-identity').checked,
    };
  }

  async function resolvePrintableCards(deck, settings) {
    const sourceCards = settings.includeIdentity && deck.identity
      ? [{ ...deck.identity, isIdentity: true }, ...deck.cards]
      : [...deck.cards];

    return sourceCards.flatMap((card) => expandPrintableFaces(card, settings));
  }

  function expandPrintableFaces(card, settings) {
    const databaseCard = card.databaseCard;
    const faces = printableFaceDescriptors(databaseCard);

    if (!faces.length) {
      const images = imageContainer(databaseCard);
      const url = chooseImageUrl(images, settings.language, settings.resolution);
      return [{ ...card, url, faceKey: 'front' }];
    }

    return faces.map((face, index) => {
      const faceTitle = faces.length === 1
        ? card.title
        : face.title && normalizeTitle(face.title) !== normalizeTitle(card.title)
          ? face.title
          : `${card.title}（${faceLabel(face.key)}）`;

      return {
        ...card,
        title: faceTitle,
        faceKey: face.key,
        url: chooseImageUrl(face.images, settings.language, settings.resolution),
      };
    });
  }

  function printableFaceDescriptors(card) {
    if (!card) return [];

    const entries = Object.entries(card.faces || {})
      .filter(([, face]) => face?.images)
      .sort(([left], [right]) => {
        if (left === 'front') return -1;
        if (right === 'front') return 1;
        return 0;
      });

    if (!entries.length) return [];
    const namedFaces = card['named-faces'] || card.namedFaces || {};
    const descriptors = entries.map(([key, face]) => ({
      key,
      images: face.images,
      title: namedFaces[key] || face.title || null,
    }));
    if (card.images && !entries.some(([key]) => key === 'front')) {
      descriptors.unshift({ key: 'front', images: card.images, title: card.title || null });
    }
    return descriptors;
  }

  function faceLabel(key) {
    return {
      front: '正面',
      back: '背面',
    }[key] || key;
  }

  function updateMultiFaceSummary(deck) {
    const sourceCards = deck.identity ? [deck.identity, ...deck.cards] : deck.cards;
    const multiFaceCards = sourceCards.flatMap((card) => {
      const faceCount = printableFaceDescriptors(card.databaseCard).length;
      return faceCount > 1 ? [{ title: card.title, faceCount }] : [];
    });
    setMultiFaceNote(multiFaceCards);
  }

  function imageContainer(card) {
    if (!card) return null;
    if (card.images) return card.images;
    if (card.faces?.front?.images) return card.faces.front.images;
    const firstFace = Object.values(card.faces || {}).find((face) => face?.images);
    return firstFace?.images || null;
  }

  function chooseImageUrl(images, language, resolution) {
    if (!images) return null;

    const candidates = [
      images?.[language]?.[resolution]?.stock,
      resolution !== 'default' ? images?.[language]?.default?.stock : null,
      language !== 'en' ? images?.en?.[resolution]?.stock : null,
      language !== 'en' && resolution !== 'default' ? images?.en?.default?.stock : null,
    ];

    for (const candidate of candidates) {
      const value = Array.isArray(candidate) ? candidate[0] : candidate;
      const url = usableImageUrl(value);
      if (url) return url;
    }
    return null;
  }

  function imageWorkerMain() {
    const queue = [];
    let processing = false;

    self.onmessage = (event) => {
      if (event.data?.type !== 'process') return;
      queue.push(event.data);
      processQueue();
    };

    async function processQueue() {
      if (processing) return;
      processing = true;
      while (queue.length) {
        const job = queue.shift();
        try {
          if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
            throw new Error('Worker 不支持 createImageBitmap 或 OffscreenCanvas');
          }
          const bitmap = await createImageBitmap(new Blob([job.data], { type: 'image/webp' }));
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const context = canvas.getContext('2d', { alpha: false });
          if (!context) throw new Error('无法创建 OffscreenCanvas 2D context');
          context.drawImage(bitmap, 0, 0);
          bitmap.close();
          const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality: 1 });
          const data = await jpeg.arrayBuffer();
          self.postMessage({ type: 'result', id: job.id, ok: true, data }, [data]);
        } catch (error) {
          self.postMessage({
            type: 'result',
            id: job.id,
            ok: false,
            error: error?.message || String(error),
          });
        }
      }
      processing = false;
    }
  }

  function createImageProcessor(signal) {
    const stats = {
      mode: 'jsPDF WebP fallback',
      nativeConverted: 0,
      jsPdfFallbacks: 0,
    };
    let worker = null;
    let workerObjectUrl = null;
    let workerFailed = false;
    let nextId = 1;
    const pending = new Map();

    try {
      if (typeof Worker !== 'function') throw new Error('Worker API 不可用');
      const workerUrl = engineOptions.workerUrl || (() => {
        const source = `(${imageWorkerMain.toString()})()`;
        workerObjectUrl = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
        return workerObjectUrl;
      })();
      worker = new Worker(workerUrl);
      stats.mode = engineOptions.workerUrl ? 'packaged native worker' : 'blob native worker';
      worker.addEventListener('message', handleWorkerMessage);
      worker.addEventListener('error', (event) => {
        console.warn('[Jinteki PnP] 图片 Worker 失效，将回退到主线程原生转换。', event.error || event.message);
        failWorker();
      });
    } catch (error) {
      console.warn('[Jinteki PnP] 无法启动图片 Worker，将回退到主线程原生转换。', error);
      workerFailed = true;
      stats.mode = 'main-thread native fallback';
      revokeWorkerUrl();
    }

    signal.addEventListener('abort', () => close(true), { once: true });

    function handleWorkerMessage(event) {
      const message = event.data;
      if (message?.type !== 'result') return;
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.ok) {
        stats.nativeConverted += 1;
        request.resolve({ data: new Uint8Array(message.data), format: 'JPEG' });
      } else {
        console.warn(`[Jinteki PnP] Worker 原生转换失败：${message.error}`);
        transcodeOnMainOrFallback(request.data, request.format, stats).then(request.resolve);
      }
    }

    function failWorker() {
      if (workerFailed) return;
      workerFailed = true;
      stats.mode = 'main-thread native fallback';
      worker?.terminate();
      worker = null;
      revokeWorkerUrl();
      for (const request of pending.values()) {
        transcodeOnMainOrFallback(request.data, request.format, stats).then(request.resolve);
      }
      pending.clear();
    }

    function revokeWorkerUrl() {
      if (!workerObjectUrl) return;
      URL.revokeObjectURL(workerObjectUrl);
      workerObjectUrl = null;
    }

    function close(cancelled = false) {
      worker?.terminate();
      worker = null;
      revokeWorkerUrl();
      if (cancelled) {
        for (const request of pending.values()) request.reject(cancellationError());
        pending.clear();
      }
    }

    return {
      stats,
      async process(data, format) {
        if (format !== 'WEBP') return { data, format };
        throwIfCancelled(signal);
        if (workerFailed || !worker) return transcodeOnMainOrFallback(data, format, stats);

        return new Promise((resolve, reject) => {
          const id = nextId;
          nextId += 1;
          pending.set(id, { resolve, reject, data, format });
          try {
            worker.postMessage({ type: 'process', id, data: data.buffer });
          } catch (error) {
            pending.delete(id);
            console.warn('[Jinteki PnP] 无法向图片 Worker 发送数据，将使用主线程转换。', error);
            failWorker();
            transcodeOnMainOrFallback(data, format, stats).then(resolve, reject);
          }
        });
      },
      close,
    };
  }

  async function transcodeOnMainOrFallback(data, format, stats) {
    try {
      if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
        throw new Error('createImageBitmap 或 OffscreenCanvas 不可用');
      }
      const bitmap = await createImageBitmap(new Blob([data], { type: 'image/webp' }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('无法创建 OffscreenCanvas 2D context');
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality: 1 });
      stats.nativeConverted += 1;
      return { data: new Uint8Array(await jpeg.arrayBuffer()), format: 'JPEG' };
    } catch (error) {
      stats.jsPdfFallbacks += 1;
      console.warn('[Jinteki PnP] 原生 WebP 转换不可用，将交给 jsPDF 处理。', error);
      return { data, format };
    }
  }

  function createImageLoader(cards, signal, onProgress) {
    const uniqueUrls = [...new Set(cards.map((card) => card.url))];
    const entries = new Map();
    let finished = 0;
    let taskError = null;
    const stats = {
      startedAt: performance.now(),
      finishedAt: null,
      total: uniqueUrls.length,
      processor: null,
    };
    const imageProcessor = createImageProcessor(signal);
    stats.processor = imageProcessor.stats;

    for (const url of uniqueUrls) {
      let settle;
      const promise = new Promise((resolve) => {
        settle = resolve;
      });
      entries.set(url, { promise, settle, settled: false });
    }

    const task = mapWithConcurrency(uniqueUrls, IMAGE_CONCURRENCY, async (url) => {
      throwIfCancelled(signal);
      const entry = entries.get(url);
      let image = null;
      try {
        const response = await pageFetch(url, {
          cache: 'force-cache',
          credentials: new URL(url).origin === location.origin ? 'same-origin' : 'omit',
          signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const contentType = response.headers.get('content-type') || '';
        const data = new Uint8Array(await response.arrayBuffer());
        throwIfCancelled(signal);
        const processed = await imageProcessor.process(data, imageFormat(contentType, url));
        throwIfCancelled(signal);
        image = {
          data: processed.data,
          format: processed.format,
          alias: `jpnp-${hashString(url)}`,
        };
      } catch (error) {
        if (isCancellationError(error) || signal.aborted) throw cancellationError();
        console.warn(`[Jinteki PnP] 卡图加载失败：${url}`, error);
      } finally {
        if (!entry.settled) {
          entry.settled = true;
          entry.settle(image);
        }
        if (!signal.aborted) {
          finished += 1;
          onProgress?.(finished, uniqueUrls.length);
        }
      }
    }, signal).catch((error) => {
      taskError = error;
      for (const entry of entries.values()) {
        if (!entry.settled) {
          entry.settled = true;
          entry.settle(null);
        }
      }
    }).finally(() => {
      stats.finishedAt = performance.now();
      imageProcessor.close();
    });

    return {
      stats,
      async get(url) {
        const image = await entries.get(url)?.promise;
        if (taskError) throw taskError;
        throwIfCancelled(signal);
        return image || null;
      },
      async wait() {
        await task;
        if (taskError) throw taskError;
        throwIfCancelled(signal);
      },
    };
  }

  async function buildPdf(jsPDF, cards, imageLoader, settings, signal, onProgress) {
    const doc = new jsPDF({ unit: 'mm', format: settings.format, compress: true });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const bleed = settings.bleed;

    let width = CARD_WIDTH_MM;
    let height = CARD_HEIGHT_MM;
    if (bleed > 0) {
      const widthScale = (pageWidth - MIN_MARGIN_MM * 2 - bleed * 2) / (CARD_WIDTH_MM * 3);
      const heightScale = (pageHeight - MIN_MARGIN_MM * 2 - bleed * 2) / (CARD_HEIGHT_MM * 3);
      const scale = Math.min(widthScale, heightScale);
      width *= scale;
      height *= scale;
    }

    const marginLeft = (pageWidth - (width * 3 + bleed * 2)) / 2;
    const marginTop = (pageHeight - (height * 3 + bleed * 2)) / 2;
    const totalInstances = cards.reduce((sum, card) => sum + card.qty, 0);
    const failed = [];
    const maybeYield = createPaintScheduler(MAX_LAYOUT_BLOCK_MS);
    let processed = 0;
    let placed = 0;

    for (const card of cards) {
      throwIfCancelled(signal);
      const image = await imageLoader.get(card.url);
      if (!image) {
        failed.push(card);
        processed += card.qty;
        onProgress?.(processed, totalInstances);
        await maybeYield();
        continue;
      }

      for (let copy = 0; copy < card.qty; copy += 1) {
        throwIfCancelled(signal);
        if (placed > 0 && placed % 9 === 0) doc.addPage(settings.format);

        const position = placed % 9;
        const row = Math.floor(position / 3);
        const col = position % 3;
        const x = marginLeft + col * (width + bleed);
        const y = marginTop + row * (height + bleed);

        doc.addImage(
          image.data,
          image.format,
          x,
          y,
          width,
          height,
          image.alias,
          'FAST',
        );
        placed += 1;
        processed += 1;
        onProgress?.(processed, totalInstances);
        await maybeYield(placed % 9 === 0);
      }
    }

    throwIfCancelled(signal);
    if (!placed) throw new Error('卡图下载全部失败。');
    const geometry = {
      pageWidth,
      pageHeight,
      marginLeft,
      marginTop,
      width,
      height,
      bleed,
    };
    if (settings.cutStyle === 'lines') {
      drawCutLines(doc, geometry);
    } else if (settings.cutStyle === 'marks') {
      drawCutMarks(doc, geometry, 2);
    }

    return { doc, failed };
  }

  function prepareCutDrawing(doc) {
    doc.setLineWidth(0.15);
    doc.setDrawColor(0, 0, 0);
  }

  function drawCutLines(doc, geometry) {
    const { pageWidth, pageHeight, marginLeft, marginTop, width, height, bleed } = geometry;
    prepareCutDrawing(doc);

    for (let page = 1; page <= doc.getNumberOfPages(); page += 1) {
      doc.setPage(page);
      for (let index = 0; index < 4; index += 1) {
        const y = marginTop + height * index + bleed * index - bleed / 2;
        doc.line(0, y, pageWidth, y);
      }
      for (let index = 0; index < 4; index += 1) {
        const x = marginLeft + width * index + bleed * index - bleed / 2;
        doc.line(x, 0, x, pageHeight);
      }
    }
  }

  function drawCutMarks(doc, geometry, padding) {
    const { pageWidth, pageHeight, marginLeft, marginTop, width, height, bleed } = geometry;
    prepareCutDrawing(doc);

    for (let page = 1; page <= doc.getNumberOfPages(); page += 1) {
      doc.setPage(page);
      for (let row = 0; row < 4; row += 1) {
        for (let column = 0; column < 4; column += 1) {
          const x = marginLeft + width * column + bleed * Math.min(2, column);
          const y = marginTop + height * row + bleed * Math.min(2, row);

          if (row === 0) {
            doc.line(x, 0, x, marginTop - padding);
            if ((column === 1 || column === 2) && bleed > 0) {
              doc.line(x - bleed, 0, x - bleed, marginTop - padding);
            }
          }

          if (column === 0) {
            doc.line(0, y, marginLeft - padding, y);
            if ((row === 1 || row === 2) && bleed > 0) {
              doc.line(0, y - bleed, marginLeft - padding, y - bleed);
            }
          }

          if (row === 3) {
            const bottomStart = marginTop + height * row + bleed * 2 + padding;
            doc.line(x, bottomStart, x, pageHeight);
            if ((column === 1 || column === 2) && bleed > 0) {
              doc.line(x - bleed, bottomStart, x - bleed, pageHeight);
            }
          }

          if (column === 3) {
            const rightStart = marginLeft + width * column + bleed * 2 + padding;
            doc.line(rightStart, y, pageWidth, y);
            if ((row === 1 || row === 2) && bleed > 0) {
              doc.line(rightStart, y - bleed, pageWidth, y - bleed);
            }
          }
        }
      }
    }
  }

  async function mapWithConcurrency(items, concurrency, worker, signal = null) {
    let nextIndex = 0;
    const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (nextIndex < items.length) {
        throwIfCancelled(signal);
        const currentIndex = nextIndex;
        nextIndex += 1;
        await worker(items[currentIndex], currentIndex);
      }
    });
    await Promise.all(runners);
  }

  function cancellationError() {
    const error = new Error('生成已停止');
    error.name = 'AbortError';
    return error;
  }

  function throwIfCancelled(signal) {
    if (signal?.aborted) throw cancellationError();
  }

  function isCancellationError(error) {
    return error?.name === 'AbortError';
  }

  function yieldForPaint() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => setTimeout(resolve, 0));
    });
  }

  function createPaintScheduler(maxBlockMs) {
    let lastYieldAt = performance.now();
    return async (force = false) => {
      if (!force && performance.now() - lastYieldAt < maxBlockMs) return;
      await yieldForPaint();
      lastYieldAt = performance.now();
    };
  }

  function roundedMs(value) {
    return Math.round(Math.max(0, Number(value) || 0));
  }

  function imageFormat(contentType, url) {
    const value = `${contentType} ${url}`.toLowerCase();
    if (value.includes('jpeg') || value.includes('.jpg')) return 'JPEG';
    if (value.includes('webp') || value.includes('.webp')) return 'WEBP';
    return 'PNG';
  }

  function setSummary(text, spinning) {
    if (!modalState) return;
    modalState.overlay.querySelector('[data-role="summary-text"]').textContent = text;
    modalState.overlay.querySelector('.jpnp-spinner').hidden = !spinning;
  }

  function setMultiFaceNote(cards) {
    if (!modalState) return;
    const element = modalState.overlay.querySelector('[data-role="multiface-note"]');
    if (!cards?.length) {
      element.hidden = true;
      element.textContent = '';
      return;
    }

    const visibleCards = cards.slice(0, 3)
      .map((card) => `${card.title}（${card.faceCount} 面）`)
      .join('、');
    const remainder = cards.length > 3 ? ` 等 ${cards.length} 种` : '';
    element.textContent = `检测到多面牌：${visibleCards}${remainder}；生成时会自动加入全部卡面。`;
    element.hidden = false;
  }

  function setOptionsVisible(visible) {
    if (!modalState) return;
    modalState.overlay.querySelector('[data-role="options"]').hidden = !visible;
  }

  function setProgressVisible(visible) {
    if (!modalState) return;
    modalState.overlay.querySelector('[data-role="progress"]').hidden = !visible;
  }

  function setGenerateEnabled(enabled) {
    if (!modalState) return;
    modalState.overlay.querySelector('[data-action="generate"]').disabled = !enabled;
  }

  function setBusy(busy) {
    if (!modalState) return;
    modalState.busy = busy;
    if (!busy) modalState.cancelRequested = false;
    modalState.overlay.classList.toggle('jpnp-busy', busy);
    for (const element of modalState.overlay.querySelectorAll('button, select, input')) {
      if (element.dataset.action === 'generate') {
        element.disabled = busy || !modalState.deck;
      } else if (element.dataset.action === 'close') {
        element.disabled = busy && modalState.cancelRequested;
      } else {
        element.disabled = busy;
      }
    }
    modalState.overlay.querySelector('[data-action="generate"]').textContent = busy
      ? '正在生成……'
      : '生成 PDF';
    const footerClose = modalState.overlay.querySelector('.jpnp-footer [data-action="close"]');
    if (footerClose) footerClose.textContent = busy ? '停止' : '取消';
  }

  function updateProgress(percent, label) {
    if (!modalState) return;
    const safePercent = Math.max(0, Math.min(100, percent));
    modalState.overlay.querySelector('[data-role="progress-bar"]').style.width = `${safePercent}%`;
    modalState.overlay.querySelector('[data-role="progress-label"]').textContent = label;
  }

  function showMessage(text, type, visible) {
    if (!modalState) return;
    const element = modalState.overlay.querySelector('[data-role="message"]');
    element.hidden = !visible;
    element.textContent = text;
    element.dataset.type = type;
  }

  function settingElement(name) {
    return modalState.overlay.querySelector(`[data-setting="${name}"]`);
  }

  function cleanText(value) {
    return String(value).replace(/\s+/g, ' ').trim();
  }

  function normalizeTitle(value) {
    return cleanText(value).normalize('NFKC').toLocaleLowerCase();
  }

  function sanitizeFilename(value) {
    return cleanText(value)
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
      .replace(/[. ]+$/g, '')
      .slice(0, 100) || 'Jinteki_Deck';
  }

  function isoDate() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function addStyles() {
    addStyle(`
      #${OVERLAY_ID} {
        position: fixed;
        inset: 0;
        z-index: 100000;
        display: grid;
        place-items: center;
        padding: 20px;
        background: rgba(5, 8, 14, 0.76);
        color: #e8edf2;
        font-family: Arial, Helvetica, sans-serif;
      }

      #${OVERLAY_ID}[hidden],
      #${OVERLAY_ID} [hidden] {
        display: none !important;
      }

      #${OVERLAY_ID} .jpnp-dialog {
        width: min(520px, 100%);
        max-height: calc(100vh - 40px);
        overflow: auto;
        border: 1px solid rgba(198, 151, 255, 0.48);
        border-radius: 10px;
        background: #18212b;
        box-shadow: 0 22px 70px rgba(0, 0, 0, 0.5);
      }

      #${OVERLAY_ID} .jpnp-header,
      #${OVERLAY_ID} .jpnp-footer {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 16px 18px;
      }

      #${OVERLAY_ID} .jpnp-header {
        justify-content: space-between;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }

      #${OVERLAY_ID} .jpnp-header h2 {
        margin: 0;
        color: #d9b8ff;
        font-size: 21px;
      }

      #${OVERLAY_ID} .jpnp-header p {
        margin: 4px 0 0;
        color: #9eabb8;
        font-size: 13px;
      }

      #${OVERLAY_ID} .jpnp-body {
        padding: 18px;
      }

      #${OVERLAY_ID} .jpnp-deck-summary {
        min-height: 46px;
        padding: 12px 14px;
        border-radius: 7px;
        background: rgba(255, 255, 255, 0.06);
        font-size: 14px;
      }

      #${OVERLAY_ID} .jpnp-summary-main {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      #${OVERLAY_ID} .jpnp-multiface-note {
        margin-top: 7px;
        padding-left: 26px;
        color: #d9b8ff;
        font-size: 13px;
        line-height: 1.45;
      }

      #${OVERLAY_ID} .jpnp-spinner {
        width: 16px;
        height: 16px;
        flex: 0 0 auto;
        border: 2px solid rgba(255, 255, 255, 0.25);
        border-top-color: #bf8cff;
        border-radius: 50%;
        animation: jpnp-spin 0.8s linear infinite;
      }

      #${OVERLAY_ID} .jpnp-options {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
        margin-top: 16px;
      }

      #${OVERLAY_ID} .jpnp-options label:not(.jpnp-checkbox-row) {
        display: grid;
        gap: 6px;
        color: #b8c2cc;
        font-size: 13px;
      }

      #${OVERLAY_ID} select {
        width: 100%;
        min-height: 36px;
        padding: 6px 9px;
        border: 1px solid #43505d;
        border-radius: 5px;
        background: #101820;
        color: #edf2f7;
      }

      #${OVERLAY_ID} .jpnp-checkbox-row {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 36px;
        font-size: 13px;
      }

      #${OVERLAY_ID} .jpnp-progress {
        margin-top: 16px;
      }

      #${OVERLAY_ID} .jpnp-progress-track {
        height: 9px;
        overflow: hidden;
        border-radius: 999px;
        background: #0f161d;
      }

      #${OVERLAY_ID} .jpnp-progress-bar {
        width: 0;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, #7b42b2, #bc84f4);
        transition: width 120ms ease;
      }

      #${OVERLAY_ID} .jpnp-progress-label {
        margin-top: 7px;
        color: #aab5c0;
        font-size: 12px;
      }

      #${OVERLAY_ID} .jpnp-message {
        margin-top: 14px;
        padding: 10px 12px;
        border-radius: 6px;
        background: rgba(78, 151, 214, 0.13);
        color: #bddcff;
        font-size: 13px;
        line-height: 1.45;
      }

      #${OVERLAY_ID} .jpnp-message[data-type="success"] {
        background: rgba(57, 179, 113, 0.14);
        color: #a7ecc6;
      }

      #${OVERLAY_ID} .jpnp-message[data-type="warning"] {
        background: rgba(231, 170, 63, 0.14);
        color: #f2d18d;
      }

      #${OVERLAY_ID} .jpnp-message[data-type="error"] {
        background: rgba(220, 72, 72, 0.15);
        color: #ffb1b1;
      }

      #${OVERLAY_ID} .jpnp-footer {
        justify-content: flex-end;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
      }

      #${OVERLAY_ID} button {
        min-height: 36px;
        padding: 7px 14px;
        border: 1px solid transparent;
        border-radius: 5px;
        cursor: pointer;
        font-weight: 600;
      }

      #${OVERLAY_ID} button:disabled {
        cursor: default;
        opacity: 0.45;
      }

      #${OVERLAY_ID} .jpnp-primary {
        background: #8e52c7;
        color: #fff;
      }

      #${OVERLAY_ID} .jpnp-primary:not(:disabled):hover {
        background: #a564de;
      }

      #${OVERLAY_ID} .jpnp-secondary,
      #${OVERLAY_ID} .jpnp-icon-button {
        border-color: #43505d;
        background: #222d37;
        color: #dce4eb;
      }

      #${OVERLAY_ID} .jpnp-icon-button {
        min-width: 34px;
        padding: 4px 9px;
        font-size: 22px;
        line-height: 1;
      }

      @keyframes jpnp-spin {
        to { transform: rotate(360deg); }
      }

      @media (max-width: 560px) {
        #${OVERLAY_ID} .jpnp-options {
          grid-template-columns: 1fr;
        }

        #${OVERLAY_ID} .jpnp-footer {
          flex-wrap: wrap;
        }
      }
    `);
  }

  function addStyle(css) {
    if (document.getElementById(`${SCRIPT_ID}-style`)) return;
    const style = document.createElement('style');
    style.id = `${SCRIPT_ID}-style`;
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }
})();
