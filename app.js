/* ============================================================================
 * app.js — web-orchestrator for the ONLINE ("GitHub Pages") edition.
 * Identical experience to the local Flask app, but with NO server:
 *   parse (parser.js) → synthesize (edge-tts.js / gemini-tts.js) →
 *   assemble (audio.js) → WAV 48 kHz + MP3 320 kbps + sync_markers.json
 *
 * Sliders keep the exact desktop arithmetic:
 *   two-reader  : rate = −12% + slider,  pitch = −8/−6 Hz + slider
 *   single-reader(Edge): rate = −10% + slider, pitch = −4 Hz + slider
 *   Gemini      : API has no rate knob → pitch-preserving DSP stretch
 *                 (timeStretchPitchSafe = online atempo), pauses untouched.
 * ==========================================================================*/
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var PAUSE_MAP = { 3: 3.0, 5: 5.0 };            // "..." → 3 s, "....." → 5 s
  var PARAGRAPH_MS = 900;
  var BREATH_MS = 240;                           // between adjacent speech segs
  var FADE_MS = 20;                              // anti-click edges

  var gemini = new GeminiTTS();
  var memCache = new Map();                      // edge/segment audio buffers
  var currentDownloads = {};

  /* ---------------- utilities ---------------- */
  function fmt(s) {
    var m = Math.floor(s / 60), r = s - m * 60;
    return (m ? m + "m " : "") + r.toFixed(2) + "s";
  }
  function setStatus(cls, msg) {
    var st = $("status");
    st.className = "status " + cls;
    st.textContent = msg;
    st.hidden = false;
  }
  function hideStatus() { $("status").hidden = true; }
  function progress(frac, txt) {
    $("progressWrap").hidden = false;
    $("progressBar").style.width = (frac * 100).toFixed(1) + "%";
    $("progressText").textContent = txt || "";
  }
  function save(key, val) { try { localStorage.setItem("ptts_" + key, val); }
    catch (e) { /* private mode */ } }
  function load(key) { try { return localStorage.getItem("ptts_" + key); }
    catch (e) { return null; } }
  function boolLoad(key, dflt) {
    var v = load(key);
    return v === null ? dflt : v === "1";
  }

  /* ---------------- dropdowns ---------------- */
  function fillEdgeSelects() {
    var single = $("voice_single"), ar = $("voice_ar"), fr = $("voice_fr");
    function fill(sel, names) {
      sel.innerHTML = "";
      names.forEach(function (n) {
        var o = document.createElement("option");
        o.value = n; o.textContent = n;
        sel.appendChild(o);
      });
    }
    fill(single, EdgeTTS.VOICES.single);
    fill(ar, EdgeTTS.VOICES.ar);
    fill(fr, EdgeTTS.VOICES.fr);
    var s = load("voice_single"); if (s) single.value = s;
    var a = load("voice_ar"); if (a) ar.value = a;
    var f = load("voice_fr"); if (f) fr.value = f;
  }
  function fillGeminiSelects() {
    var vs = $("geminiVoice"), ms = $("geminiModel");
    GeminiTTS.VOICES.forEach(function (v) {
      var o = document.createElement("option");
      o.value = v.name;
      o.textContent = v.name + (v.note ? " — " + v.note : "");
      vs.appendChild(o);
    });
    GeminiTTS.MODELS.forEach(function (m) {
      var o = document.createElement("option");
      o.value = m.name;
      o.textContent = m.name + (m.note ? " — " + m.note : "");
      ms.appendChild(o);
    });
    vs.value = load("g_voice") || GeminiTTS.VOICES[0].name;
    ms.value = load("g_model") || GeminiTTS.MODELS[0].name;
    var k = load("g_key"); if (k) $("geminiKey").value = k;
  }

  /* ---------------- demo / import ---------------- */
  var DEMO =
"بسم الله الرحمن الرحيم\n\nالدرس الأول: مقدمة في الخوارزميات.\n\n" +
"Une algorithm est une suite d'instructions... qui résout un problème.\n\n" +
"ودعونا نتأمل هذه الفكرة بعمق..... ثم ننتقل إلى التعريف الدقيق.";

  $("btnDemo").addEventListener("click", function () {
    fetch("demo_script.txt")
      .then(function (r) { return r.ok ? r.text() : Promise.reject(); })
      .catch(function () { return DEMO; })
      .then(function (t) { $("script").value = t; });
  });

  $("btnImport").addEventListener("click", function () { $("fileInput").click(); });
  $("fileInput").addEventListener("change", function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    if (/\.docx$/i.test(file.name)) {
      reader.onload = function () {
        if (typeof mammoth === "undefined") {
          setStatus("err", "مكتبة قراءة docx غير محمّلة. / Mammoth non chargé.");
          return;
        }
        mammoth.extractRawText({ arrayBuffer: reader.result })
          .then(function (out) {
            $("script").value = (out.value || "").trim();
            setStatus("ok", "تم استيراد «" + file.name + "» ✓");
          })
          .catch(function (err) {
            setStatus("err", "فشل قراءة docx: " + err.message);
          });
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = function () {
        $("script").value = String(reader.result).trim();
        setStatus("ok", "تم استيراد «" + file.name + "» ✓");
      };
      reader.readAsText(file, "utf-8");
    }
  });

  $("btnGetKey").addEventListener("click", function () {
    window.open("https://aistudio.google.com/apikey", "_blank");
  });

  /* ---------------- slider labels ---------------- */
  var rateLabels = { "-30": "بطيء جدًّا (−30%)", "-20": "بطيء (−20%)",
    "-10": "أبطأ قليلًا", "0": "افتراضية (−12%)", "5": "أسرع قليلًا (+5%)",
    "10": "أسرع (+10%)", "15": "أسرع بوضوح (+15%)", "20": "سريع جدًّا (+20%)",
    "25": "أقصى سرعة (+25%)" };
  $("rate").addEventListener("input", function (e) {
    $("rateVal").textContent = rateLabels[e.target.value] ||
      (e.target.value + "%");
  });
  $("pitch").addEventListener("input", function (e) {
    var v = parseInt(e.target.value, 10);
    $("pitchVal").textContent = v === 0 ? "افتراضية (−8Hz)"
      : "أعمق (−" + (8 + Math.floor(v / 2)) + "Hz)";
  });

  /* ---------------- engine toggling ---------------- */
  function refreshEngineBox() {
    var eng = $("engineSel").value;
    $("geminiBox").hidden = eng !== "gemini";
    $("edgeControls").style.display = eng === "edge" ? "" : "none";
    $("singleSelLabel").style.display =
      (eng === "edge" && $("singleReader").checked) ? "" : "none";
    var two = eng === "edge" && !$("singleReader").checked;
    $("arSelLabel").style.display = two ? "" : "none";
    $("frSelLabel").style.display = two ? "" : "none";
  }
  ["engineSel", "singleReader"].forEach(function (id) {
    $(id).addEventListener("change", refreshEngineBox);
  });
  $("singleReader").addEventListener("change", function () {
    save("single", $("singleReader").checked ? "1" : "0");
  });
  ["voice_single", "voice_ar", "voice_fr"].forEach(function (id) {
    $(id).addEventListener("change", function () {
      save(id.replace("voice_", "").replace("single", "voice_single"), $(id).value);
      save(id, $(id).value);
    });
  });
  $("geminiKey").addEventListener("change", function () {
    save("g_key", $("geminiKey").value.trim());
  });
  $("geminiVoice").addEventListener("change", function () {
    save("g_voice", $("geminiVoice").value);
  });
  $("geminiModel").addEventListener("change", function () {
    save("g_model", $("geminiModel").value);
  });

  /* ---------------- engine personas (desktop-identical) ---------------- */
  function buildEngine() {
    var eng = $("engineSel").value;
    var rateSlider = parseInt($("rate").value, 10) || 0;
    var pitchSlider = parseInt($("pitch").value, 10) || 0;
    var speechSpeed = 1.0;

    if (eng === "gemini") {
      var key = $("geminiKey").value.trim() || load("g_key") || "";
      if (!key) {
        return { error: "مفتاح Gemini مفقود. احصل على مفتاح مجاني من " +
          "aistudio.google.com/apikey (بلا بطاقة بنكية) والصقه في حقل " +
          "المفتاح. / Clé Gemini absente — obtenez-la gratuitement sur " +
          "aistudio.google.com/apikey." };
      }
      // Gemini TTS has NO rate parameter (same as desktop) → DSP stretch.
      speechSpeed = Math.max(0.7, Math.min(2.0, 1 + rateSlider / 100.0));
      if (Math.abs(speechSpeed - 1.0) < 0.02) speechSpeed = 1.0;
      return { engine: "gemini", key: key,
        model: $("geminiModel").value, voice: $("geminiVoice").value,
        speechSpeed: speechSpeed };
    }

    if ($("singleReader").checked) {
      var voice = $("voice_single").value || EdgeTTS.VOICES.single[0];
      var rate = -10 + rateSlider;              // SINGLE_READER base −10%
      var pitch = -4 + pitchSlider;
      var p = { voice: voice,
        fallbacks: EdgeTTS.VOICES.single.filter(function (v) {
          return v !== voice; }).slice(0, 2),
        rate: (rate >= 0 ? "+" : "") + rate + "%",
        pitch: (pitch >= 0 ? "+" : "") + pitch + "Hz",
        volume: "+0%" };
      return { engine: "edge", profiles: { ar: p, fr: p, bi: p },
               speechSpeed: 1.0 };
    }
    function twoProfile(lang) {
      var base = lang === "ar"
        ? { voice: "ar-DZ-IsmaelNeural", fb: ["ar-SA-HamedNeural", "ar-EG-ShakirNeural"], pitch: -8 }
        : { voice: "fr-FR-HenriNeural", fb: ["fr-FR-ClaudeNeural", "fr-CA-JeanNeural"], pitch: -6 };
      var sel = (lang === "ar" ? $("voice_ar") : $("voice_fr")).value;
      var rp = -12 + rateSlider;
      var pp = base.pitch + pitchSlider;
      return { voice: sel || base.voice, fallbacks: base.fb,
        rate: (rp >= 0 ? "+" : "") + rp + "%",
        pitch: (pp >= 0 ? "+" : "") + pp + "Hz", volume: "+0%" };
    }
    return { engine: "edge",
             profiles: { ar: twoProfile("ar"), fr: twoProfile("fr") },
             speechSpeed: 1.0 };
  }

  /* ---------------- synthesis dispatch ---------------- */
  function synth(item) {
    var eng = currentEngine;
    var key;
    if (eng.engine === "gemini") {
      key = "gem|" + JSON.stringify([item.text, eng.voice, eng.model,
        eng.speechSpeed]);
      if (memCache.has(key)) return Promise.resolve(memCache.get(key));
      return gemini.synthesize(item.text, {
        key: eng.key, model: eng.model, voice: eng.voice }).then(function (r) {
          return applySpeed(rawToMono48(r), eng.speechSpeed);
        }).then(function (mono) {
          memCache.set(key, mono);
          return mono;
        });
    }
    var profile = eng.profiles[item.lang] || eng.profiles.bi || eng.profiles.ar;
    key = "edge|" + JSON.stringify([item.text, profile]);
    if (memCache.has(key)) return Promise.resolve(memCache.get(key));
    return EdgeTTS.synthesize(item.text, profile).then(function (buf) {
      return ProfAudio.decodeToMono48k(buf);
    }).then(function (mono) {
      memCache.set(key, mono);
      return mono;
    });
  }

  function rawToMono48(pcmObj) {
    return ProfAudio.decodeToMono48k(pcmObj);
  }
  function applySpeed(mono, factor) {
    return Math.abs(factor - 1.0) < 0.02
      ? mono : ProfAudio.timeStretchPitchSafe(mono, factor);
  }

  /* ---------------- assembly ---------------- */
  function assemble(timeline, onProgress) {
    var speechIdx = -1;
    var chunks = [];                               // {samples: Float32Array}
    var markers = [];
    var t = 0.0;
    var prevKind = null;

    function pushSilence(ms, item) {
      var n = Math.round(ms * ProfAudio.SR / 1000);
      chunks.push({ silence: n });
      markers.push({ type: "pause", custom: !!(item && item.custom),
        seconds: n / ProfAudio.SR, start: Math.round(t * 1000) / 1000,
        end: Math.round((t + n / ProfAudio.SR) * 1000) / 1000,
        reason: item ? item.reason : "" });
      t += n / ProfAudio.SR;
    }

    function pushSpeech(mono) {
      var faded = ProfAudio.fadeEdges(Float32Array.from(mono), FADE_MS);
      if (prevKind === "speech" && BREATH_MS > 0) {
        pushSilence(BREATH_MS, null);
        markers.pop();                             // breath: informational only
      }
      chunks.push({ samples: faded });
      var dur = faded.length / ProfAudio.SR;
      markers.push({ type: "speech", lang: item ? item.lang : "",
        start: Math.round(t * 1000) / 1000,
        end: Math.round((t + dur) * 1000) / 1000,
        text: item ? item.text.slice(0, 400) : "" });
      t += dur;
    }

    var item = null;
    var promiseChain = Promise.resolve();
    var total = timeline.filter(function (i) { return i.type === "speech"; }).length;
    var done = 0;

    timeline.forEach(function (it) {
      if (it.type === "pause") {
        var ms = Math.round(it.seconds * 1000);
        if (it.reason === "paragraph") ms = PARAGRAPH_MS;
        (function (ms2, it2) {
          promiseChain = promiseChain.then(function () {
            item = null;
            pushSilence(ms2, it2);
            prevKind = "pause";
          });
        })(ms, it);
        return;
      }
      speechIdx += 1;
      (function (it2) {
        item = it2;
        promiseChain = promiseChain.then(function () {
          return synth(it2).then(function (mono) {
            done += 1;
            onProgress(done / total,
              "المقطع " + done + "/" + total + " · segment " + done + "/" + total);
            item = it2;
            pushSpeech(mono);
            prevKind = "speech";
          });
        }).catch(function (err) {
          err.segment = it2.text.slice(0, 60);
          throw err;
        });
      })(it);
      item = it;
    });

    return promiseChain.then(function () {
      // final mix
      var totalLen = 0;
      chunks.forEach(function (c) {
        totalLen += c.silence ? c.silence : c.samples.length;
      });
      var mix = new Float32Array(totalLen + 1);
      var off = 0;
      chunks.forEach(function (c) {
        if (c.silence) off += c.silence;
        else { mix.set(c.samples, off); off += c.samples.length; }
      });
      mix = ProfAudio.peakNormalize(mix, -1.5);
      if (off === 0) throw new Error("لم يُنتَج أي صوت. / Aucun audio produit.");
      return { mix: mix, markers: markers, duration: off / ProfAudio.SR };
    });
  }

  /* ---------------- exports ---------------- */
  function exportAll(mix, markers) {
    var wavBytes = ProfAudio.floatToWavBytes(mix, ProfAudio.SR, true);
    var wavBlob = new Blob([wavBytes], { type: "audio/wav" });
    var wavUrl = URL.createObjectURL(wavBlob);
    var stamp = new Date().toISOString().replace(/[:T-]/g, "").slice(0, 14);

    setDownload($("dlWav"), wavUrl, "lesson_48k_" + stamp + ".wav");
    currentDownloads.wav = wavUrl;

    var markersText = JSON.stringify({
      project: "bilingual-professor-tts (web edition)",
      created: new Date().toISOString(),
      sample_rate: ProfAudio.SR,
      duration_s: Math.round(mix.length / ProfAudio.SR * 1000) / 1000,
      items: markers
    }, null, 2);
    var jsonBlob = new Blob([markersText], { type: "application/json" });
    setDownload($("dlJson"), URL.createObjectURL(jsonBlob),
      "sync_markers_" + stamp + ".json");

    // MP3 takes a few seconds → do it after showing the WAV result
    setTimeout(function () {
      try {
        var mp3 = ProfAudio.mp3Encode(mix, ProfAudio.SR, 320);
        var mp3Blob = new Blob([mp3], { type: "audio/mpeg" });
        setDownload($("dlMp3"), URL.createObjectURL(mp3Blob),
          "lesson_320k_" + stamp + ".mp3");
        $("dlMp3").classList.remove("disabled");
      } catch (e) {
        $("dlMp3").classList.add("disabled");
        setStatus("warn", "تعذّر ترميز MP3 (" + e.message + ") — WAV متاح.");
      }
    }, 60);
  }
  function setDownload(a, url, name) {
    a.href = url;
    a.download = name;
  }

  function showMarkers(markers, duration) {
    var box = $("markers");
    box.innerHTML = "";
    var tbl = document.createElement("table");
    markers.forEach(function (m) {
      var tr = document.createElement("tr");
      var t0 = m.start.toFixed(2), t1 = m.end.toFixed(2);
      var desc = m.type === "speech" ? ("🔊 " + (m.lang || "").toUpperCase() +
        " — " + (m.text || "").slice(0, 60))
        : ("⏸ " + (m.reason || "pause") + " (" + m.seconds.toFixed(1) + "s)");
      tr.innerHTML = "<td class='t'>" + t0 + " → " + t1 +
        "</td><td class='d'></td>";
      tr.querySelector(".d").textContent = desc;
      tbl.appendChild(tr);
    });
    box.appendChild(tbl);
    $("markersWrap").hidden = markers.length === 0;
  }

  /* ---------------- main render ---------------- */
  var currentEngine = null;
  $("btnRender").addEventListener("click", function () {
    hideStatus();
    var text = $("script").value.trim();
    if (!text) {
      setStatus("err", "النص فارغ — اكتب أو استورد النص أولًا. / Texte vide.");
      return;
    }
    var eng = buildEngine();
    if (eng.error) { setStatus("err", eng.error); return; }
    currentEngine = eng;
    memCache.clear();

    var timeline = ProfParser.parseScript(text, PAUSE_MAP, "ar");
    var isSingle = eng.engine === "gemini" ||
      ($("singleReader").checked && eng.engine === "edge");
    if (isSingle) timeline = ProfParser.mergeForSingleReader(timeline);

    var nSpeech = timeline.filter(function (i) { return i.type === "speech"; }).length;
    var nPause = timeline.filter(function (i) {
      return i.type === "pause" && i.custom; }).length;
    if ($("engineSel").value === "edge") {
      setStatus("warn", "⏳ جارٍ التوليد عبر Edge — " + nSpeech +
        " مقطع كلام / " + nPause + " توقف مخصّص … (قد يستغرق بعض الوقت)");
    } else {
      setStatus("busy", "⏳ جارٍ التوليد عبر Gemini — " + nSpeech +
        " مقطع / " + nPause + " توقف مخصّص … لا تغلق التبويب أثناء العمل");
    }
    $("btnRender").disabled = true;
    progress(0, "");

    var t0 = performance.now();
    assemble(timeline, progress).then(function (r) {
      var secs = r.duration;
      var elapsed = ((performance.now() - t0) / 1000).toFixed(1);
      exportAll(r.mix, r.markers);
      showMarkers(r.markers, secs);
      $("player").src = currentDownloads.wav;
      $("result").hidden = false;
      $("meta").textContent = "المدة: " + fmt(secs) + " · 48 kHz استريو · " +
        r.markers.length + " علامة تزامن · زمن التوليد " + elapsed + " ثانية";
      setStatus("ok", "✓ اكتمل التوليد — استمع في المشغّل ثم نزّل الملفات.");
      progress(1, "");
    }).catch(function (err) {
      progress(1, "");
      var msg = String((err && err.message) || err);
      setStatus("err", "❌ فشل: " + msg);
    }).finally(function () {
      $("btnRender").disabled = false;
    });
  });

  /* ---------------- boot ---------------- */
  fillEdgeSelects();
  fillGeminiSelects();
  $("engineSel").value = load("engine") || "edge";
  $("engineSel").addEventListener("change", function () {
    save("engine", $("engineSel").value);
  });
  $("singleReader").checked = boolLoad("single", true);
  refreshEngineBox();
  if (!load("g_key")) {
    setStatus("warn", "للجودة الأفضل اختر محرك Gemini وحصل على مفتاح مجاني من " +
      "aistudio.google.com/apikey — يبقى محفوظًا في متصفحك. " +
      "(محرك Edge يعمل بلا مفتاح)");
  }

  /* demo script preload if page opened fresh */
  fetch("demo_script.txt")
    .then(function (r) { return r.ok ? r.text() : null; })
    .then(function (t) { if (t && !$("script").value) $("script").value = t; });
})();
