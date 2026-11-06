/* ============================================================================
 * edge-tts.js — Microsoft Edge neural TTS directly from the browser.
 * Faithful port of the edge-tts wire protocol (edge/v1 + Sec-MS-GEC v2):
 *   • v2 DRM token: "<cs64:16hex>-<obf-sha256:64hex>" over ticks+token
 *   • WSS frames: speech.config JSON, SSML request, binary Path:audio frames
 *     (2-byte big-endian header length prefix), last frame Path:turn.end
 * Returns: MP3 ArrayBuffer (24 kHz mono, 48 kbps).
 * ==========================================================================*/
(function (root) {
  "use strict";

  var TRUSTED_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
  var WIN_EPOCH = 11644473600;
  var WSS_BASE =
    "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1" +
    "?TrustedClientToken=" + TRUSTED_TOKEN;
  var GEC_VERSION = "2-143.0.3650.75";

  var VOICES = {
    single: [
      "en-US-AndrewMultilingualNeural",
      "fr-FR-RemyMultilingualNeural",
      "en-US-BrianMultilingualNeural",
      "en-US-AvaMultilingualNeural",
      "fr-FR-VivienneMultilingualNeural"
    ],
    ar: ["ar-DZ-IsmaelNeural", "ar-SA-HamedNeural", "ar-EG-ShakirNeural",
         "ar-TN-ArejNeural"],
    fr: ["fr-FR-HenriNeural", "fr-FR-ClaudeNeural", "fr-CA-JeanNeural"]
  };

  /* ================= Sec-MS-GEC v2 DRM (port of edge_tts.drm) ============ */
  var U32 = 0xFFFFFFFF;

  var SHA_INITIAL = [
    0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A, 0x510E527F, 0x9B05688C,
    0x1F83D9AB, 0x5BE0CD19
];
  var SHA_STATE = [
    0xFD9FBEA2, 0x91243CE7, 0xBE499094, 0xCD2E1E0A, 0x6C006F49, 0x04BD35AB,
    0xFEB0A7E4, 0x03EFFBD2
];
  var SHA_SCHEDULE = [
    0xEB24BF9E, 0x1558691F, 0xA0C09EE2, 0x0CFA32BA, 0xA622EE8C, 0xD1DD9491,
    0xC0DD25A0, 0xF9E70AB6, 0xF0C31573, 0x7058CE4E, 0x7188E606, 0x00E5AB33,
    0xD258B060, 0x72766564
];
  var K = [
    0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1,
    0x923F82A4, 0xAB1C5ED5, 0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3,
    0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174, 0xE49B69C1, 0xEFBE4786,
    0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA,
    0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7, 0xC6E00BF3, 0xD5A79147,
    0x06CA6351, 0x14292967, 0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13,
    0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85, 0xA2BFE8A1, 0xA81A664B,
    0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070,
    0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A,
    0x5B9CCA4F, 0x682E6FF3, 0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208,
    0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2
];
  var SHA_ADJUST = 0xC9DC06A7;
  var SIG0_ADJ = 0x059C0B80;
  var SIG1_ADJ = 0x000B92C0;
  var CS_COEFF = [
    [0xE82E91B1, 0xB32700D0],
    [0x44DE24C6, 0x88DFF51D],
    [0x3BEB65BC, 0x29514038],
    [0xC89C5933, 0xB328CBDF],
    [0x8D1EC211, 0xD405B4D5],
    [0x314EF5D5, 0x26E55F3C],
    [0xE92491B1, 0x607801C6],
    [0xF0A5B9D5, 0x82B2C1FB],
    [0x06064CF3, 0xFA51A3DA],
    [0xDA79FA60, 0x207CC464],
    [0xBED20560, 0x3C3C74F3],
    [0x89F9C9F8, 0xD2D14B61],
    [0x35FA38C6, 0xBB04A2C1],
    [0xCB49E3C6, 0xC5626167]
];
  var CS_FACTOR = 0x82893933;
  var CS_ADJ0 = 0xF2F90B1A;
  var CS_ADJ1 = 0x0B1A0000;

  function rol16(v) {
    v &= U32;
    return ((v << 16) | (v >>> 16)) & U32;
  }
  function rotr(x, n) {
    return ((x >>> n) | (x << (32 - n))) & U32;
  }
  function mul(a, b) { return Math.imul(a, b) & U32; }

  function sigma0(v) {
    return ((v >>> 7) ^ ((v << 25) >>> 0) ^ (v >>> 18) ^
            ((v << 14) >>> 0) ^ (v >>> 3)) & U32;
  }
  function sigma1(v) {
    return ((v >>> 17) ^ ((v << 15) >>> 0) ^ (v >>> 19) ^
            ((v << 13) >>> 0) ^ (v >>> 10)) & U32;
  }
  function bigSigma0(v) { return (rotr(v, 2) ^ rotr(v, 13) ^ rotr(v, 22)) & U32; }
  function bigSigma1(v) { return (rotr(v, 6) ^ rotr(v, 11) ^ rotr(v, 25)) & U32; }

  // standard SHA-256 round loop over words[round..63] from given state
  function shaRounds(state, words, firstRound) {
    var a = state[0], b = state[1], c = state[2], d = state[3],
        e = state[4], f = state[5], g = state[6], h = state[7];
    var constants = (firstRound === 14) ? K.map(function (k, i) {
      return i === 14 ? SHA_ADJUST : k;
    }) : K.slice();
    for (var i = firstRound; i < 64; i += 1) {
      var t1 = (h + bigSigma1(e) + (g ^ (e & (f ^ g))) +
                constants[i] + words[i]) & U32;
      var t2 = (bigSigma0(a) + ((a & b) | (c & (a | b)))) & U32;
      h = g; g = f; f = e; e = (d + t1) & U32;
      d = c; c = b; b = a; a = (t1 + t2) & U32;
    }
    return [a, b, c, d, e, f, g, h];
  }

  function expandSchedule(words, firstWord) {
    for (var i = firstWord; i < 64; i += 1) {
      var x = words[i - 2], y = words[i - 15];
      words[i] = (sigma1(x) + words[i - 7] + sigma0(y) + words[i - 16]) & U32;
    }
  }

  function u32BE(bytes, off) {
    return ((bytes[off] << 24) | (bytes[off + 1] << 16) |
            (bytes[off + 2] << 8) | bytes[off + 3]) >>> 0;
  }

  /* The library's obfuscated SHA-256 init over the first 7 bytes ---------- */
  function sha256Init(prefix) {                 // prefix.length >= 7
    var words = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      (prefix[0] << 16) | (prefix[1] << 8) | prefix[2],   // data[0:3] — 24-bit!
      (prefix[3] << 24 | prefix[4] << 16 | prefix[5] << 8 |
       prefix[6]) >>> 0];                                // data[3:7]
    for (var index = 16; index < 30; index += 1) {
      var value = SHA_SCHEDULE[index - 16];
      if (index - 2 >= 14) {
        value += (index === 16)
          ? (sigma1(words[index - 2]) ^ SIG1_ADJ)
          : sigma1(words[index - 2]);
      }
      if (index - 7 >= 14) value += words[index - 7];
      if (index - 15 >= 14) {
        value += (index === 29)
          ? (sigma0(words[index - 15]) ^ SIG0_ADJ)
          : sigma0(words[index - 15]);
      }
      words.push(value & U32);
    }
    words.push((sigma1(words[28]) + words[23] + sigma0(words[15]) +
      words[14] + SHA_ADJUST - K[14]) & U32);
    expandSchedule(words, 31);
    var working = shaRounds(SHA_STATE, words, 14);
    var state = new Array(8);
    for (var i = 0; i < 8; i += 1) {
      state[i] = (working[i] + SHA_INITIAL[i]) & U32;
    }
    return state;
  }

  /* Obfuscated SHA-256 digest (port of _sha256_digest) --------------------- */
  function sha256Digest(data) {                 // Uint8Array
    var mask = U32;
    var length = 57 + data.length;
    var padded = data.slice(7);
    padded = concat(padded, new Uint8Array([0x80]));
    var zeros = ((55 - length) % 64 + 64) % 64;
    var tmp = new Uint8Array(padded.length + zeros);
    tmp.set(padded, 0);
    padded = tmp;
    var lenBytes = new Uint8Array(8);
    var bitLen = length * 8;
    // >Q big-endian (bitLen < 2^53 — exact as float)
    for (var i = 7; i >= 0; i -= 1) {
      lenBytes[i] = bitLen & 0xFF;
      bitLen = Math.floor(bitLen / 256);
    }
    padded = concat(padded, lenBytes);

    var state = sha256Init(data.slice(0, 7));
    for (var off = 0; off < padded.length; off += 64) {
      var words = new Array(16);
      for (var w = 0; w < 16; w += 1) words[w] = u32BE(padded, off + w * 4);
      expandSchedule(words, 16);
      var working = shaRounds(state, words, 0);
      for (var j = 0; j < 8; j += 1) state[j] = (state[j] + working[j]) & mask;
    }
    return state;                               // 8 u32 words
  }

  function concat(a, b) {
    var out = new Uint8Array(a.length + b.length);
    out.set(a, 0); out.set(b, a.length);
    return out;
  }

  function swap32(w) {
    return (((w & 0xFF) << 24) | (((w >>> 8) & 0xFF) << 16) |
            (((w >>> 16) & 0xFF) << 8) | ((w >>> 24) & 0xFF)) >>> 0;
  }

  function wordsLe4Even(bytes) {                // b"\x00" + data semantics
    var padded = concat(new Uint8Array([0]), bytes);
    var rem = (4 - (padded.length % 4)) % 4;
    if (rem) padded = concat(padded, new Uint8Array(rem));
    var words = [];
    for (var i = 0; i < padded.length; i += 4) {
      words.push(((padded[i]) | (padded[i + 1] << 8) | (padded[i + 2] << 16) |
                  (padded[i + 3] << 24)) >>> 0);
    }
    if (words.length % 2) words.push(0);
    return words;
  }

  function cs64Digest(data, digestWords) {      // port of _cs64_digest
    // python: key_a, key_b = struct.unpack_from("<II", digest) — the digest
    // is packed big-endian words, unpacked LITTLE-endian → byte-swap.
    var keyA = (swap32(digestWords[0]) | 1) >>> 0;
    var keyB = (swap32(digestWords[1]) | 1) >>> 0;
    var factorA = mul(keyA, CS_FACTOR);
    var factorB = mul(keyB, CS_FACTOR);
    var terms = [], offsets = [];
    for (var i = 0; i < CS_COEFF.length; i += 1) {
      terms.push(mul(CS_COEFF[i][0], i % 2 === 0 ? factorA : factorB));
      offsets.push(CS_COEFF[i][1]);
    }
    var words = wordsLe4Even(data);
    for (var w = 0; w < words.length; w += 1) {
      var word = words[w];
      var term = mul(word, w % 2 === 0 ? keyA : keyB);
      var offset = mul(rol16(word), w % 2 === 0 ? 0xEF0569FB : 0xC31713DB);
      if (w === 0) {
        term = (term + mul(CS_ADJ0, factorA)) & U32;
        offset = (offset + CS_ADJ1) & U32;
      }
      terms.push(term);
      offsets.push(offset);
    }
    var swapAcc = 0, swapLast = 0, state = 0, acc = 0;
    for (var idx = 0; idx < terms.length; idx += 2) {
      var x = terms[idx], y = terms[idx + 1];
      var t = rol16((offsets[idx] + x) & U32);
      var q = mul(t, 0x76F50F34);
      swapAcc = (swapAcc + mul(rol16(q), 0xC3EFEA97) + q) & U32;
      t = rol16((offsets[idx + 1] + y) & U32);
      q = mul(t, 0x1881CE3C);
      swapLast = (mul(rol16(q), 0x35BD1EC9) + q) & U32;
      swapAcc = (swapAcc + swapLast) & U32;

      state = (mul(state, keyA) + x) & U32;
      state = mul(rol16(state), 0xCF98B111);
      state = mul(rol16(state), 0x87085B9F);
      state = mul(rol16(state), 0x12CEB96D);
      state = mul(rol16(state), 0x257E1D83);
      acc = (acc + state) & U32;
      t = (mul(state, keyB) + y) & U32;
      t = mul(rol16(t), 0xA27416F5);
      t = mul(rol16(t), 0xD38396FF);
      state = mul(rol16(mul(rol16(t), 0x7C932B89)), 0xBFA49F69);
      acc = (acc + state) & U32;
    }
    return [(swapLast ^ state) >>> 0, (swapAcc ^ acc) >>> 0];
  }

  function hex32(v) {
    return (v >>> 0).toString(16).padStart(8, "0").toUpperCase();
  }

  /* struct.pack("<II", w0, w1).hex().upper() — little-endian per word ----- */
  function hexLE(v) {
    var s = "";
    for (var i = 0; i < 4; i += 1) {
      var b = (v >>> (8 * i)) & 0xFF;
      s += b.toString(16).padStart(2, "0");
    }
    return s.toUpperCase();
  }

  function tokenHash(data) {                    // Uint8Array -> [cs64, sha]
    var digest = sha256Digest(data);
    var cs = cs64Digest(data, digest);
    var shaHex = digest.map(hex32).join("");
    return [hexLE(cs[0]) + hexLE(cs[1]), shaHex];
  }

  function makeGecTokenV2(unixSeconds) {
    var ticks = unixSeconds;
    ticks += WIN_EPOCH;
    ticks -= ticks % 300;
    ticks *= 1e9 / 100;
    var str = ticks.toFixed(0) + TRUSTED_TOKEN;
    var bytes = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i += 1) bytes[i] = str.charCodeAt(i);
    return Promise.resolve().then(function () {
      var parts = tokenHash(bytes);
      return parts[0] + "-" + parts[1];
    });
  }

  /* ================= connection & framing ================= */
  function newGuid() {
    var hex = "";
    for (var i = 0; i < 32; i += 1) {
      hex += Math.floor(Math.random() * 16).toString(16);
    }
    return hex;
  }

  function dateToString(d) {
    var days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug",
                  "Sep", "Oct", "Nov", "Dec"];
    function p2(n) { return String(n).padStart(2, "0"); }
    return days[d.getUTCDay()] + " " + months[d.getUTCMonth()] + " " +
      p2(d.getUTCDate()) + " " + d.getUTCFullYear() + " " +
      p2(d.getUTCHours()) + ":" + p2(d.getUTCMinutes()) + ":" +
      p2(d.getUTCSeconds()) + " GMT+0000 (Coordinated Universal Time)";
  }

  function escapeXml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function buildSsml(text, voice, rate, pitch, volume) {
    return "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' " +
      "xml:lang='en-US'><voice name='" + voice + "'><prosody pitch='" +
      pitch + "' rate='" + rate + "' volume='" + volume + "'>" +
      escapeXml(text) + "</prosody></voice></speak>";
  }

  function wsSynthesize(ssml, timeoutMs) {
    timeoutMs = timeoutMs || 30000;
    var connId = newGuid();
    return makeGecTokenV2(Date.now() / 1000).then(function (gec) {
      return new Promise(function (resolve, reject) {
        var ws;
        var chunks = [];
        var bytes = 0;
        var done = false;
        var timer = setTimeout(function () {
          finish(new Error("انتهت مهلة الاتصال بخادم مايكروسوفت. / Délai dépassé."));
        }, timeoutMs);

        function finish(err, result) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          try { if (ws) ws.close(); } catch (e) { /* ignore */ }
          if (err) reject(err);
          else resolve(result);
        }

        try {
          ws = new WebSocket(WSS_BASE + "&Sec-MS-GEC=" + gec +
            "&Sec-MS-GEC-Version=" + GEC_VERSION + "&ConnectionId=" + connId);
        } catch (err) {
          finish(err);
          return;
        }
        ws.binaryType = "arraybuffer";

        ws.onerror = function () {
          finish(new Error(
            "فشل الاتصال بخادم Edge (قد يكون المحرك محجوبًا مؤقتًا). " +
            "أعِد المحاولة أو استخدم محرك Gemini. / " +
            "Échec connexion Edge — réessayez ou utilisez Gemini."));
        };
        ws.onclose = function () {
          if (!done && bytes === 0) {
            finish(new Error(
              "أغلق الخادم الاتصال قبل إرسال الصوت — غالبًا حجب مؤقت. " +
              "أعِد المحاولة بقليل أو استخدم محرك Gemini."));
          }
        };

        ws.onopen = function () {
          var utcNow = dateToString(new Date());
          var configMsg =
            "X-Timestamp:" + utcNow + "\r\n" +
            "Content-Type:application/json; charset=utf-8\r\n" +
            "Path:speech.config\r\n\r\n" +
            '{"context":{"synthesis":{"audio":{"metadataoptions":' +
            '{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},' +
            '"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n';
          ws.send(configMsg);

          var reqId = newGuid();
          var ssmlMsg =
            "X-RequestId:" + reqId + "\r\n" +
            "Content-Type:application/ssml+xml\r\n" +
            "X-Timestamp:" + utcNow + "Z\r\n" +
            "Path:ssml\r\n\r\n" + ssml;
          ws.send(ssmlMsg);
        };

        ws.onmessage = function (ev) {
          if (typeof ev.data === "string") {
            if (ev.data.indexOf("Path:turn.end") !== -1) {
              if (bytes > 0) finish(null, mergeChunks(chunks, bytes));
              else finish(new Error("لم يصل أي صوت من الخادم."));
            }
            return;
          }
          // binary frame: [2-byte BE header length][header][payload]
          var dv = new DataView(ev.data);
          if (ev.data.byteLength < 2) return;
          var headLen = dv.getUint16(0, false);
          var header = new TextDecoder().decode(
            new Uint8Array(ev.data, 2, Math.min(headLen, ev.data.byteLength - 2)));
          if (header.indexOf("Path:audio") !== -1) {
            var audio = ev.data.slice(2 + headLen);
            chunks.push(audio);
            bytes += audio.byteLength;
          }
        };
      });
    });
  }

  function mergeChunks(chunks, total) {
    var out = new Uint8Array(total);
    var off = 0;
    for (var i = 0; i < chunks.length; i += 1) {
      out.set(new Uint8Array(chunks[i]), off);
      off += chunks[i].byteLength;
    }
    return out.buffer;
  }

  /* Public API: synthesize(text, {voice, rate, pitch, volume, fallbacks}) -- */
  function synthesize(text, opts) {
    opts = opts || {};
    var voice = opts.voice || VOICES.single[0];
    var rate = opts.rate || "-12%";
    var pitch = opts.pitch || "-8Hz";
    var volume = opts.volume || "+0%";
    var fallbacks = opts.fallbacks || [];

    var candidates = [voice].concat(fallbacks);
    var lastErr = null;
    var i = 0;

    function tryNext() {
      if (i >= candidates.length) {
        return Promise.reject(lastErr ||
          new Error("فشل توليد الصوت عبر Edge لكل المقاطع."));
      }
      var v = candidates[i];
      i += 1;
      return wsSynthesize(buildSsml(text, v, rate, pitch, volume))
        .then(function (buf) {
          if (buf.byteLength < 600) throw new Error("صوت فارغ من الخادم.");
          return buf;
        }).catch(function (err) {
          lastErr = err;
          return tryNext();
        });
    }
    return tryNext();
  }

  root.EdgeTTS = { synthesize: synthesize, VOICES: VOICES,
    makeGecTokenV2: makeGecTokenV2, buildSsml: buildSsml,
    /* exposed for unit tests */
    _i: { sha256Digest: sha256Digest, cs64Digest: cs64Digest,
          tokenHash: tokenHash, rol16: rol16, sigma0: sigma0, sigma1: sigma1,
          shaRounds: shaRounds, expandSchedule: expandSchedule,
          sha256Init: sha256Init, wordsLe4Even: wordsLe4Even } };
  if (typeof module !== "undefined" && module.exports) module.exports = root.EdgeTTS;
})(typeof window !== "undefined" ? window : globalThis);
