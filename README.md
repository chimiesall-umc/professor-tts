# 🎓 مُولِّد صوت الأستاذ — النسخة السحابية (GitHub Pages)
# Bilingual Professor TTS — Web Edition

موقع ساكن بالكامل (HTML + JS فقط) يحوّل النص المكتوب (عربي مُشكَّل + فرنسي) إلى درس صوتي
استوديو بنبرة «بروفيسور عجوز كاريزمي» — دون أي خادم: كل التوليد والمعالجة والتسميل
**داخل متصفح الزائر**.

Un site 100 % statique : synthèse, assemblage et export audio se font dans le
navigateur du visiteur — aucun serveur requis.

## ✨ الميزات / Fonctionnalités

- 🔁 **قارئ واحد ثنائي اللغة**: صوت واحد يقرأ العربية بالعربية والفرنسية بالفرنسية دون أي وقفة تبديل
- ⏯ **توقفات مخصّصة دقيقة رقميًا**: `...` = صمت 3 ثوانٍ، `.....` = صمت 5 ثوانٍ (3.14 لا تُحسب!)
- 📄 استيراد `.docx / .txt`، نموذج جاهز زر واحد
- ⚙️ سرعة القراءة (−30% … +25%) وعمق الصوت
- 🎧 تصدير: **WAV 48 kHz استريو** (استوديو) + **MP3 320 kbps** + `sync_markers.json`
  لمزامنة كل مقطع مع شرائح العرض في برامج المونتاج
- 💾 تخزين مؤقت للجلسة — إعادة التوليد لا تستهلك حصة Gemini يومية
- 🔒 الخصوصية: المفتاح يبقى في متصفحك فقط

## 🧠 محكّا التوليد

| | مفتاح | أفضل ما يلي |
|---|---|---|
| ✨ **Google Gemini TTS** (مُوصى به) | مفتاح مجاني — [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | جودة ع/فر من الأعلى؛ يُستدعى من المتصفح مباشرة إلى |
| 🟣 **Microsoft Edge TTS** (تجريبي في الويب) | بلا مفتاح | مجاني 100%؛ يعمل عبر بروتوكول edge-tts مع تطبيق Sec-MS-GEC v2 داخل المتصفح |

حصة Gemini المجانية: ~10-15 طلبًا/يوم لكل نموذج (تظهر بالتحقق من AI Studio).

## 🚀 النشر / Déploiement

راجع **[GITHUB-SETUP.md](GITHUB-SETUP.md)** — 5 خطوات بالسحب والإفلات دون أوامر.

بعد تفعيل Pages سيصبح الموقع متاحًا على:
`https://USERNAME.github.io/REPO-NAME/`

## 📁 البنية

```
index.html            الواجهة (RTL، Calibri)
app.js                الموكّل: يربط المحلل + المحركات + التجميع + التصدير
js/parser.js          نقل حرفي لـ text_parser.py (عقد التوقفات + تقسيم النص)
js/edge-tts.js        عميل Microsoft Edge TTS عبر WebSocket داخل المتصفح
                      (توكن Sec-MS-GEC v2 — مطابق تمامًا لمكتبة edge-tts)
js/gemini-tts.js      استدعاء Gemini REST مباشرة بالمفتاح + تخزين مؤقت
js/audio.js           فك الترميز ← 48 kHz، تمدد زمني حافظ للطبقة، تطبيع −1.5 dBFS،
                      إخراج WAV/MP3 (lamejs)
js/mammoth.browser.min.js   استيراد docx (BSD-2 — mammoth.js)
js/lame.min.js              ترميز MP3 (lamejs — انظر الترخيص في الملف)
style.css             التنسيق
demo_script.txt       النموذج
GITHUB-SETUP.md       خطوات النشر
```

## ⚠️ حدود النسخة السحابية مقارنة بالنسخة المحلية

- Edge عبر WebSocket قد تغيّره مايكروسوفت في أي وقت (لأنها نقطة نهاية داخلية) — جودة ع/فر للأعلى استخدم Gemini
- معالجة «عمق DSP الصدرية» غير متاحة في المتصفح (تتطلب ffmpeg) — متاحة في النسخة المحلية
- التخزين المؤقت لمقاطع Gemini في الذاكرة فقط: تحديث الصفحة = بداية جلسة جديدة
  (المقاطع المنجزة تُعاد بلا تكلفة عند حفظ لقطات WAV… مع تنبيه الحصة)

## 🙏 الشكر / Crédits

- [edge-tts](https://github.com/rany2/edge-tts) — بروتوكول الخدمة المجانية (MIT)
- [Gemini TTS](https://ai.google.dev) — نموذج التوليد من Google AI Studio
- [lamejs](https://github.com/zhuker/lamejs) — ترميز MP3 (انظر رأس الملف لشروط الترخيص)
- [mammoth.js](https://github.com/mwilliamson/mammoth.js) — docx (BSD-2-Clause)
