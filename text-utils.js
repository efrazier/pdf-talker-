// text-utils.js
// Sentence chunking with abbreviation awareness, and citation/footnote stripping.

const ABBREVIATIONS = [
  'Mr', 'Mrs', 'Ms', 'Mx', 'Dr', 'Prof', 'Rev', 'Hon', 'Sr', 'Jr', 'St',
  'e.g', 'i.e', 'cf', 'etc', 'al', 'et al', 'viz', 'vs',
  'U.S', 'U.K', 'U.S.A', 'U.S.S.R',
  'a.m', 'p.m', 'A.M', 'P.M', 'A.D', 'B.C', 'B.C.E', 'C.E',
  'Inc', 'Ltd', 'Co', 'Corp', 'LLC', 'PLC',
  'Jan', 'Feb', 'Mar', 'Apr', 'Jun', 'Jul', 'Aug', 'Sep', 'Sept', 'Oct', 'Nov', 'Dec',
  'Mon', 'Tue', 'Tues', 'Wed', 'Thu', 'Thur', 'Thurs', 'Fri', 'Sat', 'Sun',
  'No', 'Vol', 'Ed', 'Eds', 'pp', 'Fig', 'Figs', 'Sec', 'Ch', 'Ref', 'Refs',
  'in', 'ft', 'lb', 'oz',
];

const PERIOD_MARKER = '\u0005';
const ELLIPSIS_MARKER = '\u0004';
const SENTENCE_BREAK_LOOKAHEAD = /(?<=[.!?])\s+(?=[A-Z"'\u201C\u2018(\[\u2014])/;

function buildAbbreviationPattern() {
  const sorted = ABBREVIATIONS.slice().sort((a, b) => b.length - a.length);
  const escaped = sorted.map((a) => a.replace(/\./g, '\\.'));
  return new RegExp('\\b(' + escaped.join('|') + ')\\.', 'g');
}

const ABBR_PATTERN = buildAbbreviationPattern();

export function splitIntoSentences(rawText) {
  if (!rawText || rawText.trim().length === 0) return [];

  let working = rawText;
  working = working.replace(ABBR_PATTERN, (match, abbr) => abbr + PERIOD_MARKER);
  working = working.replace(/\b([A-Z])\.(?=\s*[A-Z]\.?)/g, '$1' + PERIOD_MARKER);
  working = working.replace(/(\d)\.(\d)/g, '$1' + PERIOD_MARKER + '$2');
  working = working.replace(/\.{2,}/g, ELLIPSIS_MARKER);

  const rawSentences = working.split(SENTENCE_BREAK_LOOKAHEAD);

  return rawSentences.map((s) => {
    let restored = s;
    restored = restored.replaceAll(PERIOD_MARKER, '.');
    restored = restored.replaceAll(ELLIPSIS_MARKER, '...');
    return restored.trim();
  }).filter((s) => s.length > 0);
}

export function stripCitations(text) {
  let cleaned = text;
  cleaned = cleaned.replace(/\[\s*\d+(?:\s*[,\-\u2013;]\s*\d+)*\s*\]/g, '');
  cleaned = cleaned.replace(/\[\s*[A-Z][a-zA-Z\-']+(?:\s+(?:and|et al\.?)\s+[A-Z][a-zA-Z\-']+)?,?\s+\d{4}[a-z]?\s*\]/g, '');
  cleaned = cleaned.replace(/\(\s*[A-Z][a-zA-Z\-']+(?:\s+(?:and|et al\.?)\s+[A-Z][a-zA-Z\-']+)?,?\s+\d{4}[a-z]?(?:\s*[,;]\s*[A-Z][a-zA-Z\-']+(?:\s+(?:and|et al\.?)\s+[A-Z][a-zA-Z\-']+)?,?\s+\d{4}[a-z]?)*\s*\)/g, '');
  cleaned = cleaned.replace(/([a-z\)])[\u00b9\u00b2\u00b3\u2070-\u209f]+/g, '$1');
  cleaned = cleaned.replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();
  return cleaned;
}

export function looksLikeReference(sentence) {
  if (!sentence) return false;
  if (/^\s*(?:\[\d+\]|\d{1,3}\.)\s+[A-Z]/.test(sentence) && /\b\d{4}\b/.test(sentence)) {
    return true;
  }
  const yearMatches = sentence.match(/\b(?:19|20)\d{2}\b/g) || [];
  const commaCount = (sentence.match(/,/g) || []).length;
  if (yearMatches.length >= 1 && commaCount >= 4 && sentence.length < 400 && /[A-Z]\.,/.test(sentence)) {
    return true;
  }
  return false;
}

export function processPageText(rawPageText, options) {
  const skipCitations = options && options.skipCitations !== undefined ? options.skipCitations : true;
  const collapsed = rawPageText.replace(/\s+/g, ' ').trim();
  const sentences = splitIntoSentences(collapsed);

  return sentences.map((raw) => {
    const isReference = looksLikeReference(raw);
    const spoken = skipCitations ? stripCitations(raw) : raw;
    return { raw, spoken, isReference };
  });
}
