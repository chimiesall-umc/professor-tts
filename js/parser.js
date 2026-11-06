/* ============================================================================
 * parser.js — bilingual text processing  (browser port of text_parser.py)
 *
 * 1. Dot-run custom pauses:  "..." -> 3.0 s, "....." -> 5.0 s
 *    (decimals like 3.14 are NOT pauses; other dot runs stay punctuation)
 * 2. Sentence splitting on terminal punctuation (., !, ?, ؟, ،, ؛, : …)
 * 3. Word-level script detection → Arabic / French (Latin) groups
 * 4. Consecutive same-language merges → executable timeline:
 *        [Speech(text, lang) | Pause(seconds, custom)]
 * ==========================================================================*/
(function (root) {
  "use strict";

  var RE_ARABIC = /[\u0621-\u064A\u064B-\u065F\u0660-\u0669\u066E-\u06D3\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g;
  var RE_LATIN = /[A-Za-z\u00C0-\u00FF]/g;
  var RE_SENTENCE = /(?<=[.!?؟،؛:…])\s+/g;

  function countRe(str, re) {
    re.lastIndex = 0;
    var n = 0;
    while (re.exec(str) !== null) n += 1;
    return n;
  }

  function detectLang(fragment) {
    var ar = countRe(fragment, RE_ARABIC);
    var la = countRe(fragment, RE_LATIN);
    if (ar === 0 && la === 0) return null;          // digits / symbols only
    return ar >= la ? "ar" : "fr";
  }

  function normalizeText(text) {
    text = text.replace(/\uFEFF/g, "");
    // drop author annotation lines (# // ;)
    text = text.replace(/^[ \t]*(?:#|\/\/|;).*$/gm, "");
    text = text.replace(/[ \t]+/g, " ");
    text = text.replace(/ ?\n ?/g, "\n");
    return text.trim();
  }

  /* "..." -> 3 s, "....." -> 5 s ; returns { text, pauses } --------------- */
  function extractDotPauses(text, pauseMap) {
    var pauses = [];
    var clean = text.replace(/\.{3,}/g, function (run, offset) {
      var prev = offset > 0 ? text[offset - 1] : "";
      var next = offset + run.length < text.length ? text[offset + run.length] : "";
      var digits = !isNaN(prev) && !isNaN(next) && prev !== " " && next !== " ";
      var isNumericPair = /\d/.test(prev) && /\d/.test(next);
      if (pauseMap[run.length] !== undefined && !isNumericPair) {
        pauses.push({ type: "pause", custom: true, seconds: pauseMap[run.length],
                      reason: run.length === 3 ? "3-dot pause" : "5-dot pause" });
        return "\u0000PAUSE" + pauses.length + "\u0000";
      }
      return run.length < 3 ? run : "…";   // collapse long stylistic runs
    });
    return { text: clean, pauses: pauses };
  }

  function splitSentences(chunk) {
    var parts = chunk.split(RE_SENTENCE)
      .map(function (p) { return p.trim(); })
      .filter(function (p) { return p; });
    return parts.length ? parts : (chunk.trim() ? [chunk.trim()] : []);
  }

  function splitByScript(sentence, fallback) {
    var words = sentence.split(/\s+/).filter(Boolean);
    var groups = [], langs = [];
    for (var i = 0; i < words.length; i += 1) {
      var w = words[i];
      var lang = detectLang(w) || fallback;
      var symbolOnly = detectLang(w) === null;
      if (langs.length && (langs[langs.length - 1] === lang || symbolOnly)) {
        groups[groups.length - 1].push(w);
      } else {
        groups.push([w]);
        langs.push(lang);
      }
    }
    return groups.map(function (g, i) { return [g.join(" "), langs[i]]; });
  }

  function appendSpeech(items, text, lang) {
    text = text.replace(/\s+/g, " ").trim();
    if (!text) return;
    var prev = items[items.length - 1];
    if (prev && prev.type === "speech" && prev.lang === lang) {
      prev.text = prev.text + " " + text;
    } else {
      items.push({ type: "speech", text: text, lang: lang });
    }
  }

  /* Prosody fix: re-attach a mild comma before a custom pause ------------- */
  function postfixTerminalPunct(items) {
    for (var i = 0; i < items.length - 1; i += 1) {
      var cur = items[i], nxt = items[i + 1];
      if (cur.type !== "speech" || nxt.type !== "pause" || !nxt.custom) continue;
      var core = cur.text.replace(/[\s.\u2026]+$/, "");
      var hasTerm = /[.!،;:,؟؛…]/.test(core.slice(-1));
      cur.text = hasTerm ? core : core + (cur.lang === "ar" ? "،" : ",");
    }
  }

  /* Full parse → items[] --------------------------------------------------- */
  function parseScript(text, pauseMap, defaultLang) {
    text = normalizeText(text);
    var items = [];
    var lastLang = defaultLang || "ar";
    var paragraphs = text.split("\n\n").filter(function (p) { return p.trim(); });
    var nPara = text.split("\n\n").length;

    paragraphs.forEach(function (para, idx) {
      para = para.replace(/\n/g, " ").trim();
      if (!para) return;
      var ex = extractDotPauses(para, pauseMap);
      var tokens = ex.text.split(/\u0000PAUSE(\d+)\u0000/);
      for (var i = 0; i < tokens.length; i += 1) {
        if (i % 2 === 1) {                      // sentinel → custom pause
          items.push(ex.pauses[parseInt(tokens[i], 10) - 1]);
          continue;
        }
        var tok = tokens[i].trim();
        if (!tok) continue;
        splitSentences(tok).forEach(function (sentence) {
          splitByScript(sentence, lastLang).forEach(function (piece) {
            var sub = piece[0], lang = piece[1] || lastLang;
            appendSpeech(items, sub, lang);
            lastLang = lang;
          });
        });
      }
      if (idx !== nPara - 1) items.push({ type: "pause", custom: false,
                                         seconds: 0, reason: "paragraph" });
    });
    postfixTerminalPunct(items);
    return items;
  }

  /* Single-reader merge: consecutive speech → one bilingual block ---------- */
  function mergeForSingleReader(items) {
    var out = [];
    for (var i = 0; i < items.length; i += 1) {
      var it = items[i];
      var prev = out[out.length - 1];
      if (it.type === "speech" && prev && prev.type === "speech") {
        prev = { type: "speech", text: prev.text + " " + it.text, lang: "bi" };
        out[out.length - 1] = prev;
      } else {
        out.push(it);
      }
    }
    return out;
  }

  var ProfParser = { normalizeText: normalizeText, detectLang: detectLang,
    extractDotPauses: extractDotPauses, splitSentences: splitSentences,
    splitByScript: splitByScript, parseScript: parseScript,
    mergeForSingleReader: mergeForSingleReader };

  root.ProfParser = ProfParser;
  if (typeof module !== "undefined" && module.exports) module.exports = ProfParser;
})(typeof window !== "undefined" ? window : globalThis);
