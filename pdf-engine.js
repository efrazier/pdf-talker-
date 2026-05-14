// pdf-engine.js
// pdf.js wrapper: load, outline tree, page text extraction.
// pdf.js is bundled locally under ./vendor/ — no CDN, no network at runtime.

const PDFJS_SCRIPT = './vendor/pdf.min.js';
const PDFJS_WORKER = './vendor/pdf.worker.min.js';

let pdfjsReady = null;

function loadPdfJs() {
  if (pdfjsReady) return pdfjsReady;
  pdfjsReady = new Promise((resolve, reject) => {
    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      resolve(window.pdfjsLib);
      return;
    }
    const script = document.createElement('script');
    script.src = PDFJS_SCRIPT;
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      resolve(window.pdfjsLib);
    };
    script.onerror = () => reject(new Error('Failed to load pdf.js from ' + PDFJS_SCRIPT));
    document.head.appendChild(script);
  });
  return pdfjsReady;
}

export async function loadPdfFromArrayBuffer(arrayBuffer) {
  const pdfjsLib = await loadPdfJs();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  return loadingTask.promise;
}

async function resolveDestinationPage(pdfDoc, dest) {
  if (!dest) return null;
  try {
    let explicit = dest;
    if (typeof dest === 'string') {
      explicit = await pdfDoc.getDestination(dest);
    }
    if (!explicit || !Array.isArray(explicit) || !explicit[0]) return null;
    const pageIndex = await pdfDoc.getPageIndex(explicit[0]);
    return pageIndex + 1;
  } catch (err) {
    return null;
  }
}

async function buildOutlineTreeRecursive(pdfDoc, items, depth) {
  const nodes = [];
  for (const item of items) {
    const pageNumber = await resolveDestinationPage(pdfDoc, item.dest);
    const children = item.items && item.items.length > 0
      ? await buildOutlineTreeRecursive(pdfDoc, item.items, depth + 1)
      : [];
    nodes.push({
      title: item.title || '(untitled)',
      pageNumber,
      depth,
      children,
    });
  }
  return nodes;
}

export async function getOutlineTree(pdfDoc) {
  const rawOutline = await pdfDoc.getOutline();
  if (!rawOutline || rawOutline.length === 0) return [];
  return buildOutlineTreeRecursive(pdfDoc, rawOutline, 0);
}

export async function extractPageText(pdfDoc, pageNumber) {
  const page = await pdfDoc.getPage(pageNumber);
  const textContent = await page.getTextContent();
  const parts = textContent.items.map((item) => {
    return item.str + (item.hasEOL ? '\n' : ' ');
  });
  return parts.join('').replace(/[ \t]+/g, ' ').trim();
}

export async function getDocumentTitle(pdfDoc, fallback) {
  try {
    const meta = await pdfDoc.getMetadata();
    if (meta && meta.info && meta.info.Title && meta.info.Title.trim()) {
      return meta.info.Title.trim();
    }
  } catch (err) {
    // ignore
  }
  return fallback || 'Untitled PDF';
}
