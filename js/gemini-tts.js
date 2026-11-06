/* ============================================================================
 * gemini-tts.js — Google Gemini TTS called DIRECTLY from the browser.
 * Same REST contract as the desktop engine (tts_engine.py):
 *   POST /v1beta/models/{model}:generateContent?key=KEY
 *   parts[].speech_metadata.style  (gemini-3.x — style never spoken)
 *   "Say <style>: " prefix          (legacy 2.5)
 * Returns { samples: Float32Array (−1..1), rate } per chunk; the assembler
 * resamples to the 48 kHz studio target.
 *
 * Privacy: the key stays in the visitor's localStorage and is sent ONLY to
 * generativelanguage.googleapis.com. Never committed anywhere.
 * In-session segment cache protects the small free-tier daily quota
 * (~10-15 requests/day per model): a re-render only retries failed chunks.
 * ==========================================================================*/
(function (root) {
  "use strict";

  var REST = "https://generativelanguage.googleapis.com/v1beta/models/";

  var VOICES = [
    { name: "Sulafat", note: "دافئ ★" },
    { name: "Charon", note: "إخباري وقور ★" },
    { name: "Kore", note: "رصين حازم" },
    { name: "Alnilam", note: "ثابت رصين" },
    { name: "Gacrux", note: "ناضج ★" },
    { name: "Rasalgethi", note: "إخباري" },
    { name: "Umbriel", note: "هادئ" },
    { name: "Algenib", note: "أجش" },
    { name: "Iapetus", note: "واضح" },
    { name: "Enceladus", note: "متنفّس" },
    { name: "Puck", note: "متوهّج" },
    { name: "Schedar", note: "متوازن" },
    { name: "Orus", note: "رصين" },
    { name: "Zephyr", note: "مشرق" },
    { name: "Fenrir", note: "متحمّس" },
    { name: "Aoede", note: "عذب" },
    { name: "Callirrhoe", note: "مطمئن" },
    { name: "Sadaltager", note: "عالم" }
  ];

  var MODELS = [
    { name: "gemini-3.8-flash-tts", note: "أعلى جودة" },
    { name: "gemini-3.8-flash-lite-tts", note: "أسرع — حصة أكبر غالبًا" },
    { name: "gemini-2.5-flash-preview-tts", note: "الجيل السابق" }
  ];

  var STYLE_PROMPT = "an elderly, charismatic and authoritative university " +
    "professor: warm, deep and unhurried voice, calm measured pacing; reads " +
    "Arabic words in Arabic and French words in French";

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function GeminiTTS() {
    this.cache = new Map();          // chunkKey -> {samples, rate}
    this.lastRequestAt = 0;
  }

  GeminiTTS.VOICES = VOICES;
  GeminiTTS.MODELS = MODELS;
  GeminiTTS.STYLE_PROMPT = STYLE_PROMPT;

  /* prompt parts[] — style travels OUTSIDE the verbatim text --------------- */
  GeminiTTS.prototype._part = function (chunk, model, style) {
    var part = { text: chunk };
    if (style) {
      if (model.indexOf("gemini-3") === 0) {
        part.speech_metadata = { style: style };
      } else {
        part.text = "Say " + style + ": " + chunk;
      }
    }
    return part;
  };

  /* ~1200-char chunks at sentence boundaries (fewer requests = safer quota) */
  GeminiTTS.prototype._chunks = function (text, mx) {
    if (text.length <= mx) return [text];
    var parts = text.split(/(?<=[.!?؟\u06D4…])\s+/);
    var out = [], cur = "";
    for (var i = 0; i < parts.length; i += 1) {
      if (cur && cur.length + parts[i].length + 1 > mx) {
        out.push(cur.trim());
        cur = parts[i];
      } else {
        cur = (cur + " " + parts[i]).trim();
      }
    }
    if (cur) out.push(cur.trim());
    return out.filter(Boolean);
  };

  /* one REST call → {samples, rate} ---------------------------------------- */
  GeminiTTS.prototype._request = function (chunk, key, model, voice, style) {
    var self = this;
    var body = {
      contents: [{ parts: [this._part(chunk, model, style)] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: {
          prebuiltVoiceConfig: { voiceName: voice } } }
      }
    };
    var attempt = 0;

    function go() {
      attempt += 1;
      return fetch(REST + model + ":generateContent?key=" +
        encodeURIComponent(key), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }).then(function (res) {
        if (res.status === 429) {
          if (attempt >= 3) {
            var q = new Error("انتهت الحصة اليومية المجانية لـ Gemini (429). " +
              "جرّب النموذج Lite أو أكمل غدًا — المقاطع المنجزة محفوظة في هذه " +
              "الجلسة. / Quota Gemini épuisée : essayez le modèle Lite ou " +
              "reprenez demain.");
            q.quota = true;
            throw q;
          }
          return sleep(25000 * attempt).then(go);
        }
        return res.json().then(function (payload) {
          if (!res.ok) {
            var detail = (payload && payload.error &&
              payload.error.message) || JSON.stringify(payload).slice(0, 200);
            var upper = detail.toUpperCase();
            if ((res.status === 400 || res.status === 401 ||
                 res.status === 403) &&
                (upper.indexOf("API KEY") !== -1 ||
                 upper.indexOf("PERMISSION") !== -1)) {
              throw new Error("مفتاح Gemini غير صالح (" + res.status + ") — " +
                "تحقّق من المفتاح؛ يجب تقييده على Generative Language API. | " +
                "Clé invalide: " + detail.slice(0, 150));
            }
            throw new Error("Gemini HTTP " + res.status + ": " + detail);
          }
          var cands = (payload && payload.candidates) || [];
          for (var i = 0; i < cands.length; i += 1) {
            var parts = ((cands[i].content || {}).parts) || [];
            for (var j = 0; j < parts.length; j += 1) {
              var inline = parts[j].inlineData;
              if (inline && inline.data) return decodeInline(inline);
            }
          }
          throw new Error("Gemini لم يُرجع صوتًا: " +
            JSON.stringify(payload).slice(0, 300));
        });
      }).catch(function (err) {
        if (err.quota || /Clé|مفتاح|HTTP 4/.test(String(err.message))) throw err;
        if (attempt >= 3) throw err;
        return sleep(6000 * attempt).then(go);
      });
    }
    return go();
  };

  GeminiTTS.prototype.synthesize = function (text, opts) {
    opts = opts || {};
    var key = opts.key, model = opts.model || MODELS[0].name,
        voice = opts.voice || VOICES[0].name,
        style = (opts.style || STYLE_PROMPT).trim(),
        maxChars = opts.maxChunkChars || 1200,
        gapMs = (opts.minChunkEvery || 2) * 1000;
    var self = this;

    return this._chunks(text, maxChars).reduce(function (p, chunk) {
      return p.then(function (acc) {
        var ck = JSON.stringify(["v2", chunk, voice, model, style]);
        var cached = self.cache.get(ck);
        var seg = cached ? Promise.resolve(cached)
          : self._request(chunk, key, model, voice, style)
              .then(function (res) {
                self.cache.set(ck, res);
                self.lastRequestAt = Date.now();
                return res;
              });
        var wait = (self.lastRequestAt && self.cache.has(ck))
          ? Promise.resolve()
          : sleep(Math.max(0, gapMs - (Date.now() - self.lastRequestAt)));
        return Promise.all([seg, wait]).then(function (r) {
          acc.push(r[0]);
          return acc;
        });
      });
    }, Promise.resolve([])).then(function (list) {
      var rate = list[0].rate;
      var total = 0, i;
      for (i = 0; i < list.length; i += 1) total += list[i].samples.length;
      var out = new Float32Array(total);
      total = 0;
      for (i = 0; i < list.length; i += 1) {
        out.set(list[i].samples, total);
        total += list[i].samples.length;
      }
      if (total < 4096) throw new Error("أنتج Gemini صوتًا فارغًا.");
      return { samples: out, rate: rate };
    });
  };

  /* base64 → Float32Array; handles WAV (3.x) and raw L16 PCM --------------- */
  function decodeInline(inline) {
    var bin = atob(inline.data);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    var dv = new DataView(bytes.buffer);
    var isWav = (bytes[0] === 0x52 && bytes[1] === 0x49 &&
                 bytes[2] === 0x46 && bytes[3] === 0x46) ||
                (inline.mimeType || "").indexOf("wav") !== -1;
    var rate = 24000, m = /rate=(\d+)/.exec(inline.mimeType || "");
    if (m) rate = parseInt(m[1], 10);
    var samples;
    if (isWav) {
      var parsed = parseWav(bytes);
      samples = parsed.samples;
      rate = parsed.rate;
    } else {
      var n = Math.floor(bytes.length / 2);
      samples = new Float32Array(n);
      for (var k = 0; k < n; k += 1) samples[k] = dv.getInt16(k * 2, true) / 32768;
    }
    return { samples: samples, rate: rate };
  }

  /* minimal RIFF/FMT/DATA reader (PCM 16-bit) ------------------------------ */
  function parseWav(bytes) {
    var dv = new DataView(bytes.buffer);
    var off = 12, fmt = {}, data = null;
    while (off + 8 <= bytes.length) {
      var id = String.fromCharCode(bytes[off], bytes[off + 1],
        bytes[off + 2], bytes[off + 3]);
      var size = dv.getUint32(off + 4, true);
      if (id === "fmt ") {
        fmt.audioFormat = dv.getUint16(off + 8, true);
        fmt.channels = dv.getUint16(off + 10, true);
        fmt.rate = dv.getUint32(off + 12, true);
        fmt.bits = dv.getUint16(off + 22, true);
      } else if (id === "data") {
        data = { off: off + 8, size: Math.min(size, bytes.length - off - 8) };
        if (fmt.rate) break;
      }
      off += 8 + size + (size % 2);
    }
    if (!data || !fmt.rate) throw new Error("ردّ Gemini بصيغة WAV غير مفهومة.");
    var samples;
    if (fmt.bits === 16) {
      var n = Math.floor(data.size / 2 / (fmt.channels || 1));
      samples = new Float32Array(n);
      for (var i = 0; i < n; i += 1) {
        var s = 0;
        for (var c = 0; c < (fmt.channels || 1); c += 1) {
          s += dv.getInt16(data.off + (i * fmt.channels + c) * 2, true);
        }
        samples[i] = s / (fmt.channels || 1) / 32768;
      }
    } else {
      throw new Error("WAV غير مدعوم (ليس PCM-16).");
    }
    return { samples: samples, rate: fmt.rate };
  }

  root.GeminiTTS = GeminiTTS;
  if (typeof module !== "undefined" && module.exports) module.exports = GeminiTTS;
})(typeof window !== "undefined" ? window : globalThis);
