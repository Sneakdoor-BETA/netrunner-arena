# Jinteki PnP browser engine

This directory contains the client-only Print-and-Play implementation.

- `pnp-engine.js` owns the dialog, card-face expansion, image pipeline, PDF layout, and download.
- `image-worker.js` converts WebP card images off the main thread.
- `jspdf.umd.min.js` is the locally packaged jsPDF 2.5.2 distribution.

The ClojureScript integration calls:

```js
window.JintekiPnPEngine.open(deck, {
  language: "zh-simp",
  resolution: "default",
  workerUrl: "/lib/js/pnp/image-worker.js"
});
```

The engine consumes the fully resolved card objects already held by Jinteki's Deck Builder. It does not scrape the DOM or request `/data/decks` or `/data/cards`.
