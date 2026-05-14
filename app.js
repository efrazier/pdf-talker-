// app.js
// Entry point. Wires modules to the DOM.

import { loadPdfFromArrayBuffer, getOutlineTree, extractPageText, getDocumentTitle } from './pdf-engine.js';
import { processPageText } from './text-utils.js';
import {
  initTTS, getVoices, setVoice, setRate, loadSentences,
  play, pause, stop, jumpToSentence, isPlaying, getCurrentIndex,
  updateMediaSessionMetadata,
} from './tts-engine.js';
import {
  computeFileId, getProgress, saveProgress,
} from './storage.js';

// ===== App state =====
const app = {
  pdfDoc: null,
  fileId: null,
  fileName: '',
  docTitle: '',
  totalPages: 0,
  currentPage: 1,
  pageSentences: [],
  outline: [],
  skipCitations: true,
  resumeOffer: null,
  saveTimer: null,
  lastMetadataTitle: '',
};

// ===== DOM =====
const el = {
  openFileBtn: document.getElementById('open-file-btn'),
  openFileBtn2: document.getElementById('open-file-btn-2'),
  fileInput: document.getElementById('pdf-file'),
  sidebar: document.getElementById('sidebar'),
  closeSidebar: document.getElementById('close-sidebar'),
  toggleSidebar: document.getElementById('toggle-sidebar'),
  outlineTree: document.getElementById('outline-tree'),
  readerEmpty: document.getElementById('reader-empty'),
  readerContent: document.getElementById('reader-content'),
  readerControls: document.getElementById('reader-controls'),
  docTitle: document.getElementById('doc-title'),
  pageIndicator: document.getElementById('page-indicator'),
  textView: document.getElementById('text-view'),
  prevPageBtn: document.getElementById('prev-page-btn'),
  nextPageBtn: document.getElementById('next-page-btn'),
  playPauseBtn: document.getElementById('play-pause-btn'),
  playIcon: document.querySelector('.play-icon'),
  pauseIcon: document.querySelector('.pause-icon'),
  voiceSelect: document.getElementById('voice-select'),
  rateSlider: document.getElementById('rate-slider'),
  rateDisplay: document.getElementById('rate-display'),
  skipCitations: document.getElementById('skip-citations'),
  resumeBanner: document.getElementById('resume-banner'),
  resumeText: document.getElementById('resume-text'),
  resumeYes: document.getElementById('resume-yes'),
  resumeNo: document.getElementById('resume-no'),
  toast: document.getElementById('toast'),
};

function init() {
  registerServiceWorker();
  initTTS({
    onSentenceStart: handleSentenceStart,
    onSentenceEnd: handleSentenceEnd,
    onPageComplete: handlePageComplete,
    onStateChange: handlePlaybackStateChange,
    onVoicesChanged: populateVoiceSelect,
    onError: (err) => {
      console.warn('TTS error', err);
      showToast('Speech error: ' + (err.error || 'unknown'));
    },
  });
  populateVoiceSelect();
  wireUpEvents();
}

function wireUpEvents() {
  el.openFileBtn.addEventListener('click', () => el.fileInput.click());
  el.openFileBtn2.addEventListener('click', () => el.fileInput.click());
  el.fileInput.addEventListener('change', handleFileChosen);

  el.playPauseBtn.addEventListener('click', togglePlayback);
  el.prevPageBtn.addEventListener('click', () => navigatePage(-1));
  el.nextPageBtn.addEventListener('click', () => navigatePage(1));

  el.voiceSelect.addEventListener('change', () => {
    const voices = getVoices();
    const selectedIndex = parseInt(el.voiceSelect.value, 10);
    if (!Number.isNaN(selectedIndex) && voices[selectedIndex]) {
      setVoice(voices[selectedIndex]);
      localStorage.setItem('pdf-talker.voice', voices[selectedIndex].name);
    }
  });

  el.rateSlider.addEventListener('input', () => {
    const r = parseFloat(el.rateSlider.value);
    setRate(r);
    el.rateDisplay.textContent = r.toFixed(1) + '×';
    localStorage.setItem('pdf-talker.rate', String(r));
  });

  el.skipCitations.addEventListener('change', () => {
    app.skipCitations = el.skipCitations.checked;
    localStorage.setItem('pdf-talker.skipCitations', app.skipCitations ? '1' : '0');
    if (app.pdfDoc) {
      reloadCurrentPageText();
    }
  });

  el.toggleSidebar.addEventListener('click', () => el.sidebar.classList.add('open'));
  el.closeSidebar.addEventListener('click', () => el.sidebar.classList.remove('open'));

  el.resumeYes.addEventListener('click', acceptResume);
  el.resumeNo.addEventListener('click', declineResume);

  const savedRate = localStorage.getItem('pdf-talker.rate');
  if (savedRate) {
    el.rateSlider.value = savedRate;
    el.rateDisplay.textContent = parseFloat(savedRate).toFixed(1) + '×';
    setRate(parseFloat(savedRate));
  }
  const savedSkip = localStorage.getItem('pdf-talker.skipCitations');
  if (savedSkip !== null) {
    app.skipCitations = savedSkip === '1';
    el.skipCitations.checked = app.skipCitations;
  }
}

async function handleFileChosen(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  showToast('Loading ' + file.name + '...');
  try {
    const arrayBuffer = await file.arrayBuffer();
    app.pdfDoc = await loadPdfFromArrayBuffer(arrayBuffer);
    app.fileName = file.name;
    app.totalPages = app.pdfDoc.numPages;
    app.fileId = await computeFileId(file);
    app.docTitle = await getDocumentTitle(app.pdfDoc, file.name);
    app.lastMetadataTitle = '';

    el.docTitle.textContent = app.docTitle;
    el.readerEmpty.hidden = true;
    el.readerContent.hidden = false;
    el.readerControls.hidden = false;

    app.outline = await getOutlineTree(app.pdfDoc);
    renderOutline();

    const savedProgress = await getProgress(app.fileId);
    if (savedProgress && savedProgress.pageNumber > 1) {
      offerResume(savedProgress);
      await loadPage(1, 0);
    } else {
      await loadPage(1, 0);
    }

    showToast(app.totalPages + ' pages loaded');
  } catch (err) {
    console.error('PDF load failed', err);
    showToast('Failed to load PDF: ' + err.message);
  }
}

function renderOutline() {
  el.outlineTree.innerHTML = '';
  if (!app.outline || app.outline.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No table of contents in this PDF. Use page navigation.';
    el.outlineTree.appendChild(empty);
    return;
  }
  renderOutlineNodes(app.outline, el.outlineTree);
}

function renderOutlineNodes(nodes, container) {
  for (const node of nodes) {
    const item = document.createElement('div');
    item.className = 'outline-item';
    item.textContent = node.title;
    item.dataset.page = node.pageNumber || '';
    if (node.pageNumber) {
      item.addEventListener('click', async (e) => {
        e.stopPropagation();
        await loadPage(node.pageNumber, 0);
        markActiveOutlineItem(item);
        if (window.innerWidth <= 720) {
          el.sidebar.classList.remove('open');
        }
      });
    } else {
      item.style.opacity = '0.5';
      item.style.cursor = 'default';
    }
    container.appendChild(item);

    if (node.children && node.children.length > 0) {
      const childWrap = document.createElement('div');
      childWrap.className = 'outline-children';
      container.appendChild(childWrap);
      renderOutlineNodes(node.children, childWrap);
    }
  }
}

function markActiveOutlineItem(item) {
  document.querySelectorAll('.outline-item.active').forEach((n) => n.classList.remove('active'));
  item.classList.add('active');
}

async function loadPage(pageNumber, startSentenceIndex) {
  if (!app.pdfDoc) return;
  if (pageNumber < 1) pageNumber = 1;
  if (pageNumber > app.totalPages) pageNumber = app.totalPages;

  app.currentPage = pageNumber;
  el.pageIndicator.textContent = 'p. ' + pageNumber + ' / ' + app.totalPages;

  const rawText = await extractPageText(app.pdfDoc, pageNumber);
  app.pageSentences = processPageText(rawText, { skipCitations: app.skipCitations });

  renderTextView();
  loadSentences(app.pageSentences, startSentenceIndex || 0);

  // Only update MediaSession metadata when the doc changes — not on every page —
  // because each metadata assignment triggers Chrome to re-evaluate manifest icons.
  if (app.lastMetadataTitle !== app.docTitle) {
    app.lastMetadataTitle = app.docTitle;
    updateMediaSessionMetadata(app.docTitle, app.totalPages + ' pages');
  }

  schedulePersist();
  highlightOutlineForPage(pageNumber);
}

function reloadCurrentPageText() {
  loadPage(app.currentPage, getCurrentIndex());
}

function renderTextView() {
  el.textView.innerHTML = '';
  if (app.pageSentences.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = '(No text on this page — may be scanned images. OCR needed.)';
    el.textView.appendChild(empty);
    return;
  }
  app.pageSentences.forEach((sentence, index) => {
    const span = document.createElement('span');
    span.className = 'sentence';
    if (sentence.isReference) span.classList.add('skipped');
    span.dataset.idx = String(index);
    span.textContent = sentence.raw + ' ';
    span.addEventListener('click', () => {
      jumpToSentence(index);
      if (!isPlaying()) play();
    });
    el.textView.appendChild(span);
  });
}

function highlightOutlineForPage(pageNumber) {
  let best = null;
  let bestPage = 0;
  document.querySelectorAll('.outline-item').forEach((item) => {
    const p = parseInt(item.dataset.page, 10);
    if (!Number.isNaN(p) && p <= pageNumber && p > bestPage) {
      bestPage = p;
      best = item;
    }
  });
  document.querySelectorAll('.outline-item.active').forEach((n) => n.classList.remove('active'));
  if (best) best.classList.add('active');
}

function togglePlayback() {
  if (isPlaying()) {
    pause();
  } else {
    play();
  }
}

async function navigatePage(direction) {
  const next = app.currentPage + direction;
  if (next < 1 || next > app.totalPages) return;
  const wasPlaying = isPlaying();
  stop();
  await loadPage(next, 0);
  if (wasPlaying) play();
}

function handleSentenceStart(index) {
  document.querySelectorAll('.sentence.active').forEach((n) => n.classList.remove('active'));
  const span = el.textView.querySelector('.sentence[data-idx="' + index + '"]');
  if (span) {
    span.classList.add('active');
    span.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  schedulePersist();
}

function handleSentenceEnd(index) {
  // Reserved for future use.
}

async function handlePageComplete() {
  if (app.currentPage >= app.totalPages) {
    showToast('Reached end of document');
    return false;
  }
  await loadPage(app.currentPage + 1, 0);
  return true;
}

function handlePlaybackStateChange(playing) {
  el.playIcon.hidden = playing;
  el.pauseIcon.hidden = !playing;
  el.playPauseBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
}

function populateVoiceSelect() {
  const voices = getVoices();
  if (voices.length === 0) return;
  el.voiceSelect.innerHTML = '';
  const en = voices.filter((v) => v.lang.startsWith('en'));
  const other = voices.filter((v) => !v.lang.startsWith('en'));
  const ordered = en.concat(other);
  ordered.forEach((voice) => {
    const opt = document.createElement('option');
    opt.value = String(voices.indexOf(voice));
    opt.textContent = voice.name + ' — ' + voice.lang;
    el.voiceSelect.appendChild(opt);
  });
  const savedVoiceName = localStorage.getItem('pdf-talker.voice');
  if (savedVoiceName) {
    const found = voices.find((v) => v.name === savedVoiceName);
    if (found) {
      el.voiceSelect.value = String(voices.indexOf(found));
      setVoice(found);
    }
  }
}

function offerResume(savedProgress) {
  app.resumeOffer = savedProgress;
  const where = savedProgress.pageNumber === 1
    ? 'sentence ' + (savedProgress.sentenceIndex + 1)
    : 'page ' + savedProgress.pageNumber;
  el.resumeText.textContent = 'Resume at ' + where + '?';
  el.resumeBanner.hidden = false;
}

async function acceptResume() {
  el.resumeBanner.hidden = true;
  if (!app.resumeOffer) return;
  await loadPage(app.resumeOffer.pageNumber, app.resumeOffer.sentenceIndex || 0);
  app.resumeOffer = null;
}

function declineResume() {
  el.resumeBanner.hidden = true;
  app.resumeOffer = null;
}

function schedulePersist() {
  if (app.saveTimer) clearTimeout(app.saveTimer);
  app.saveTimer = setTimeout(persistProgress, 800);
}

async function persistProgress() {
  if (!app.fileId || !app.pdfDoc) return;
  await saveProgress({
    fileId: app.fileId,
    fileName: app.fileName,
    pageNumber: app.currentPage,
    sentenceIndex: getCurrentIndex(),
    totalPages: app.totalPages,
  });
}

window.addEventListener('beforeunload', persistProgress);
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') persistProgress();
});

function showToast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  el.toast.style.animation = 'none';
  void el.toast.offsetWidth;
  el.toast.style.animation = '';
  setTimeout(() => { el.toast.hidden = true; }, 3000);
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').catch((err) => {
    console.warn('SW registration failed:', err);
  });
}

init();
