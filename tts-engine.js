// tts-engine.js
// Speech synthesis state machine with MediaSession integration.

const SILENT_AUDIO_URL = './silent.wav';

const state = {
  voices: [],
  currentVoice: null,
  rate: 1.0,
  sentences: [],
  currentIndex: 0,
  isPlaying: false,
  shouldAutoAdvance: false,
  silentAudioEl: null,
  callbacks: {
    onSentenceStart: null,
    onSentenceEnd: null,
    onPageComplete: null,
    onStateChange: null,
    onError: null,
    onVoicesChanged: null,
  },
};

function loadVoices() {
  state.voices = speechSynthesis.getVoices();
  if (!state.currentVoice && state.voices.length > 0) {
    const preferred = state.voices.find((v) => v.lang.startsWith('en') && v.localService)
      || state.voices.find((v) => v.lang.startsWith('en'))
      || state.voices[0];
    state.currentVoice = preferred;
  }
}

export function initTTS(callbacks) {
  state.callbacks = Object.assign({}, state.callbacks, callbacks || {});
  loadVoices();
  speechSynthesis.onvoiceschanged = () => {
    loadVoices();
    if (state.callbacks.onVoicesChanged) {
      state.callbacks.onVoicesChanged(state.voices);
    }
  };
  setupMediaSession();
}

export function getVoices() {
  return state.voices.slice();
}

export function setVoice(voice) {
  state.currentVoice = voice;
}

export function setRate(rate) {
  state.rate = rate;
}

export function loadSentences(sentences, startIndex) {
  state.sentences = sentences;
  state.currentIndex = startIndex || 0;
}

export function getCurrentIndex() {
  return state.currentIndex;
}

export function isPlaying() {
  return state.isPlaying;
}

export function play() {
  if (speechSynthesis.paused && speechSynthesis.speaking) {
    speechSynthesis.resume();
    state.isPlaying = true;
    notifyStateChange();
    return;
  }
  if (state.sentences.length === 0) return;
  state.isPlaying = true;
  state.shouldAutoAdvance = true;
  startSilentAudio();
  notifyStateChange();
  speakCurrent();
}

export function pause() {
  if (speechSynthesis.speaking && !speechSynthesis.paused) {
    speechSynthesis.pause();
  }
  state.isPlaying = false;
  notifyStateChange();
}

export function stop() {
  state.isPlaying = false;
  state.shouldAutoAdvance = false;
  speechSynthesis.cancel();
  stopSilentAudio();
  notifyStateChange();
}

export function jumpToSentence(index) {
  if (index < 0 || index >= state.sentences.length) return;
  speechSynthesis.cancel();
  state.currentIndex = index;
  if (state.isPlaying || state.shouldAutoAdvance) {
    speakCurrent();
  }
}

function speakCurrent() {
  while (
    state.currentIndex < state.sentences.length
    && state.sentences[state.currentIndex].isReference
  ) {
    state.currentIndex++;
  }

  if (state.currentIndex >= state.sentences.length) {
    if (state.shouldAutoAdvance && state.callbacks.onPageComplete) {
      Promise.resolve(state.callbacks.onPageComplete()).then((didAdvance) => {
        if (didAdvance && state.shouldAutoAdvance) {
          speakCurrent();
        } else {
          state.isPlaying = false;
          stopSilentAudio();
          notifyStateChange();
        }
      });
    } else {
      state.isPlaying = false;
      stopSilentAudio();
      notifyStateChange();
    }
    return;
  }

  const sentence = state.sentences[state.currentIndex];
  const textToSpeak = sentence.spoken || sentence.raw;

  if (!textToSpeak || textToSpeak.trim().length === 0) {
    state.currentIndex++;
    speakCurrent();
    return;
  }

  const utterance = new SpeechSynthesisUtterance(textToSpeak);
  if (state.currentVoice) {
    utterance.voice = state.currentVoice;
    utterance.lang = state.currentVoice.lang;
  }
  utterance.rate = state.rate;

  const indexAtSpeak = state.currentIndex;

  utterance.onstart = () => {
    if (state.callbacks.onSentenceStart) state.callbacks.onSentenceStart(indexAtSpeak);
  };

  utterance.onend = () => {
    if (state.callbacks.onSentenceEnd) state.callbacks.onSentenceEnd(indexAtSpeak);
    if (!state.isPlaying) return;
    state.currentIndex = indexAtSpeak + 1;
    speakCurrent();
  };

  utterance.onerror = (event) => {
    if (event.error === 'canceled' || event.error === 'interrupted') return;
    if (state.callbacks.onError) state.callbacks.onError(event);
    state.isPlaying = false;
    notifyStateChange();
  };

  speechSynthesis.speak(utterance);
}

function notifyStateChange() {
  if (state.callbacks.onStateChange) state.callbacks.onStateChange(state.isPlaying);
  updateMediaSessionState();
}

function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;

  navigator.mediaSession.setActionHandler('play', () => play());
  navigator.mediaSession.setActionHandler('pause', () => pause());
  navigator.mediaSession.setActionHandler('stop', () => stop());

  navigator.mediaSession.setActionHandler('nexttrack', () => {
    jumpToSentence(Math.min(state.currentIndex + 1, state.sentences.length - 1));
  });

  navigator.mediaSession.setActionHandler('previoustrack', () => {
    jumpToSentence(Math.max(state.currentIndex - 1, 0));
  });

  try {
    navigator.mediaSession.setActionHandler('seekforward', (details) => {
      const step = details && details.seekOffset ? Math.ceil(details.seekOffset / 5) : 3;
      jumpToSentence(Math.min(state.currentIndex + step, state.sentences.length - 1));
    });
    navigator.mediaSession.setActionHandler('seekbackward', (details) => {
      const step = details && details.seekOffset ? Math.ceil(details.seekOffset / 5) : 3;
      jumpToSentence(Math.max(state.currentIndex - step, 0));
    });
  } catch (err) {
    // older browsers
  }
}

export function updateMediaSessionMetadata(title, pageInfo) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: title || 'PDF',
    artist: pageInfo || '',
    album: 'PDF Talker',
  });
}

function updateMediaSessionState() {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.playbackState = state.isPlaying ? 'playing' : 'paused';
}

function startSilentAudio() {
  if (state.silentAudioEl) {
    state.silentAudioEl.play().catch(() => { /* user gesture may be needed */ });
    return;
  }
  const audio = document.createElement('audio');
  audio.src = SILENT_AUDIO_URL;
  audio.loop = true;
  audio.volume = 0.001;
  audio.preload = 'auto';
  audio.setAttribute('playsinline', 'true');
  audio.style.display = 'none';
  document.body.appendChild(audio);
  state.silentAudioEl = audio;
  audio.play().catch((err) => {
    console.warn('Silent audio failed to play (MediaSession may not surface):', err);
  });
}

function stopSilentAudio() {
  if (state.silentAudioEl) {
    state.silentAudioEl.pause();
  }
}
