(() => {
  'use strict';

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
})();
