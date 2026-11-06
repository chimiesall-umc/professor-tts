# 🚀 نشر الموقع على GitHub Pages — دليل الخطوة بخطوة
# Publier le site sur GitHub Pages — guide pas à pas

هذا المجلد (`github-site/`) هو **موقع كامل مستقل** — لا يحتاج خادمًا ولا بايثون. يُنشر على GitHub كـ **GitHub Pages** ويعمل لكل الزوار مجانًا.

Ce dossier est un **site statique autonome** : aucune dépendance serveur, Python ou ffmpeg.

---

## الخطوات / Les étapes

### 1) إنشاء حساب GitHub
- افتح <https://github.com/signup> وسجّل حسابًا مجانيًا (بريد إلكتروني فقط).

### 2) إنشاء مستودع new Repository
- من الصفحة الرئيسية اضغط **"+"** أعلى اليمين ثم **"New repository"**.
- الاسم: مثل `professor-tts` (أو أي اسم — سيصبح رابط الموقع).
- اختر **Public** (مطلوب لـ GitHub Pages المجاني).
- اضغط **Create repository**.

### 3) رفع الملفات (بالسحب والإفلات — بدون أي أوامر!)
- في صفحة المستودع الجديد اضغط **"uploading an existing file"** (وصلة في وسط الصفحة).
- افتح مجلد `github-site/` على جهازك واسحب **محتواه بالكامل** إلى نافذة الرفع:
  ```
  index.html
  app.js
  style.css
  demo_script.txt
  js/lame.min.js
  js/mammoth.browser.min.js
  js/parser.js
  js/edge-tts.js
  js/gemini-tts.js
  js/audio.js
  GITHUB-SETUP.md   (اختياري)
  README.md
  ```
- اكتب وصفًا، مثل "first release"، ثم اضغط **Commit changes**.

### 4) تشغيل GitHub Pages
- في المستودع: **Settings → Pages** (يسار الشاشة).
- تحت **Build and deployment**:
  - **Source**: `Deploy from a branch`
  - **Branch**: `main`  — **Folder**: `/ (root)`
- اضغط **Save** وانتظر 1-2 دقيقة.

### 5) موقعك جاهز ✅
- سيظهر الرابط أعلى صفحة Settings: مثل
  `https://YOUR-USERNAME.github.io/professor-tts/`
- شارك الرابط مع من تشاء — كل زائر سيملك نسخته الخاصة في متصفحه.

---

## ما يحتاجه الزوار / Ce dont le visiteur a besoin

| المحرك | مفتاح؟ | جودة | ملاحظة |
|---|---|---|---|
| ✨ Google Gemini TTS | مفتاح مجاني من <https://aistudio.google.com/apikey> | الأفضل لكلام ع/فر | الحصة المجانية ~10-15 طلب/يوم لكل نموذج؛ كل مقطع يُخزَّن مؤقتًا في جلستك فلا يُعاد توليده |
| 🟣 Microsoft Edge TTS | بلا مفتاح | جيدة | تجريبي في النسخة السحابية — يعتمد على نقطة نهاية مايكروسوفت المجانية وقد تتغير |

> 🔒 **الخصوصية**: المفتاح يبقى في متصفح الزائر (localStorage) ويُرسَل مباشرة إلى Google فقط. يمكنك Commit نسختك **بلا أي مفتاح** آمنًا.

> 💡 **نصيحة**: أرسل لكل مستخدم كان يحتاج الموقع التعليمات نفسها أعلاه للحصول على المفتاح المجاني (بطاقة بنكية غير مطلوبة).

---

## 🧰 لو كنت تفضّل Git من سطر الأوامر (اختياري)

```bash
cd github-site
git init
git add .
git commit -m "Professor TTS — web edition"
git branch -M main
git remote add origin https://github.com/USERNAME/professor-tts.git
git push -u origin main
# ثم فعّل Pages من Settings كما في الخطوة 4
```

## تحديث الموقع لاحقًا
Only أعد رفع الملفات المعدّلة بنفس الطريقة (أو `git push`) — GitHub يعيد النشر تلقائيًا.
