/* ============================================================================
 * audio.js — studio audio toolbox, entirely in the browser (no ffmpeg!):
 *   • decodeToMono48k   — MP3 bytes / PCM → Float32 mono @ 48 kHz via the
 *                         browser's own resampler (OfflineAudioContext)
 *   • timeStretchPitchSafe — OLA time-stretch, pitch preserved: the online
 *                         equivalent of ffmpeg `atempo` (Gemini speed-up)
 *   • peakNormalize     — peak target −1.5 dBFS (same as desktop app)
 *   • wavEncode         — 48 kHz / 16-bit stereo WAV blob  (studio export)
 *   • mp3Encode         — 320 kbps MP3 via bundled lamejs
 *
 * CRITICAL invariant carried over from the desktop pipeline: the custom
 * pauses (3 s / 5 s) are inserted by the assembler as exact digital zeros —
 * never by the TTS engines — so any DSP is applied to SPEECH ONLY.
 * ==========================================================================*/
(function (root) {
  "use strict";

  var SR = 48000;                       // studio sample rate

  /* Any input (MP3 bytes, or {samples, rate}) → Float32 mono at 48 kHz ----- */
  function decodeToMono48k(input) {
    var p;
    if (input instanceof ArrayBuffer || (input && input.byteLength)) {
      p = root.audioCtxDecode(input);
    } else if (input && input.samples) {
      // wrap raw PCM into a WAV container so the browser resampler handles it
      var wav = floatToWavBytes(input.samples, input.rate, false);
      p = root.audioCtxDecode(wav);
    } else {
      p = Promise.reject(new Error("صوت غير مفهوم."));
    }
    return p.then(function (mono) { return mono; });
  }

  /* Offline decode with explicit 48 kHz target + channel folding ---------- */
  root.audioCtxDecode = function (bytes) {
    // decodeAudioData returns the fully decoded/resampled buffer regardless
    // of the context's length hint, so keep the hint tiny to stay far below
    // every browser's OfflineAudioContext length limits.
    var ctx = new (root.OfflineAudioContext || root.webkitOfflineAudioContext)(
      1, 4800, SR);
    return ctx.decodeAudioData(bytes).then(function (buf) {
      var n = buf.length, chs = buf.numberOfChannels, i, c, s;
      var out = new Float32Array(n);
      if (chs === 1) out.set(buf.getChannelData(0));
      else for (i = 0; i < n; i += 1) {
        s = 0;
        for (c = 0; c < chs; c += 1) s += buf.getChannelData(c)[i];
        out[i] = s / chs;
      }
      return out;
    });
  };

  /* OLA time-stretch (pitch preserved). factor 1.25 = 25% faster ---------- */
  function timeStretchPitchSafe(x, factor) {
    if (!factor || Math.abs(factor - 1) < 0.02) return x;
    var win = 2048;
    var Ha = win >> 1;                               // analysis hop (50%)
    var Hs = Math.max(1, Math.round(Ha / factor));   // synthesis hop
    var Hann = new Float32Array(win);
    for (var i = 0; i < win; i += 1) {
      Hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / win);  // periodic Hann
    }
    var frames = Math.max(1, Math.floor((x.length - win) / Ha));
    var outLen = Math.min(x.length + win, Math.ceil(x.length / factor) + win);
    var acc = new Float32Array(outLen);
    var wgt = new Float32Array(outLen);
    for (var f = 0; f < frames; f += 1) {
      var ix = f * Ha;
      var ox = f * Hs;
      if (ox + win > outLen) break;
      for (var i2 = 0; i2 < win; i2 += 1) {
        acc[ox + i2] += x[ix + i2] * Hann[i2];
        wgt[ox + i2] += Hann[i2];
      }
    }
    var out = new Float32Array(Math.ceil(x.length / factor));
    for (var k = 0; k < out.length && k < outLen; k += 1) {
      out[k] = wgt[k] > 1e-6 ? acc[k] / wgt[k] : 0;
    }
    return out;
  }

  /* Peak normalize to −1.5 dBFS ------------------------------------------- */
  function peakNormalize(x, targetDb) {
    var peak = 0;
    for (var i = 0; i < x.length; i += 1) {
      var a = Math.abs(x[i]);
      if (a > peak) peak = a;
    }
    if (peak < 1e-9) return x;
    var gain = Math.pow(10, (targetDb || -1.5) / 20) / peak;
    if (gain > 8) gain = 8;                          // safety cap
    var out = new Float32Array(x.length);
    for (var j = 0; j < x.length; j += 1) out[j] = x[j] * gain;
    return out;
  }

  /* 20 ms fade in/out edges — replaces pydub's crossfade joins, click-free
     and keeps every marker timestamp EXACT. -------------------------------- */
  function fadeEdges(x, ms) {
    var n = Math.round((ms || 20) * SR / 1000);
    for (var i = 0; i < n && i < x.length; i += 1) {
      x[i] *= i / n;
    }
    for (var j = 0; j < n && j < x.length; j += 1) {
      x[x.length - 1 - j] *= j / n;
    }
    return x;
  }

  /* Float32 mono (−1..1) → WAV ArrayBuffer (48 kHz, 16-bit, stereo opt) --- */
  function floatToWavBytes(x, srcRate, stereo) {
    var rate = srcRate || SR;
    var channels = stereo ? 2 : 1;
    var frames = x.length;
    var dataSize = frames * channels * 2;
    var buf = new ArrayBuffer(44 + dataSize);
    var dv = new DataView(buf);
    function ascii(off, s) {
      for (var i = 0; i < s.length; i += 1) dv.setUint8(off + i, s.charCodeAt(i));
    }
    ascii(0, "RIFF");
    dv.setUint32(4, 36 + dataSize, true);
    ascii(8, "WAVE");
    ascii(12, "fmt ");
    dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true);            // PCM
    dv.setUint16(22, channels, true);
    dv.setUint32(24, rate, true);
    dv.setUint32(28, rate * channels * 2, true);
    dv.setUint16(32, channels * 2, true);
    dv.setUint16(34, 16, true);
    ascii(36, "data");
    dv.setUint32(40, dataSize, true);
    var off = 44;
    for (var i = 0; i < frames; i += 1) {
      var v = Math.max(-1, Math.min(1, x[i]));
      var s16 = Math.round(v * 32767);
      for (var c = 0; c < channels; c += 1) {
        dv.setInt16(off, s16, true);
        off += 2;
      }
    }
    return buf;
  }

  /* lamejs 320 kbps CBR — chunked so the UI stays responsive -------------- */
  function mp3Encode(mono, sr, kbps, onProgress) {
    var encoder = new lamejs.Mp3Encoder(2, sr, kbps || 320);   // stereo → mono duplicated
    var left = toInt16(mono);
    var right = left;                      // mono source duplicated
    var block = 1152 * 20;
    var mp3Chunks = [];
    var total = left.length + right.length;
    var done = 0;
    for (var i = 0; i < left.length; i += block) {
      var l = left.subarray(i, i + block);
      var r = right.subarray(i, i + block);
      var chunk = encoder.encodeBuffer(l, r);
      if (chunk.length > 0) mp3Chunks.push(new Int8Array(chunk));
      done += block * 2;
      if (onProgress && (i / block) % 20 === 0) {
        onProgress(Math.min(0.99, done / total));
      }
    }
    var end = encoder.flush();
    if (end.length > 0) mp3Chunks.push(new Int8Array(end));
    var size = 0;
    mp3Chunks.forEach(function (c) { size += c.length; });
    var out = new Uint8Array(size);
    var off = 0;
    mp3Chunks.forEach(function (c) { out.set(c, off); off += c.length; });
    if (onProgress) onProgress(1);
    return out;
  }

  function toInt16(f32) {
    var out = new Int16Array(f32.length);
    for (var i = 0; i < f32.length; i += 1) {
      var v = Math.max(-1, Math.min(1, f32[i]));
      out[i] = Math.round(v < 0 ? v * 32768 : v * 32767);
    }
    return out;
  }

  var mod = { SR: SR, decodeToMono48k: decodeToMono48k, timeStretchPitchSafe:
    timeStretchPitchSafe, peakNormalize: peakNormalize, fadeEdges: fadeEdges,
    floatToWavBytes: floatToWavBytes, mp3Encode: mp3Encode, toInt16: toInt16 };

  root.ProfAudio = mod;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = mod;                 // Node tests (no audioCtx there)
  }
})(typeof window !== "undefined" ? window : globalThis);
