// ============================================================
// حفظ الحديث - المنطق الرئيسي
// ============================================================

// ---------- Firebase Setup (تحميل اختياري، ما يوقفش باقي التطبيق لو فشل) ----------
const firebaseConfig = {
  apiKey: "AIzaSyD8jxpVrvicStETloL8tk5s865dmNatIqE",
  authDomain: "mazen-productivity-bab1c.firebaseapp.com",
  databaseURL: "https://mazen-productivity-bab1c-default-rtdb.firebaseio.com",
  projectId: "mazen-productivity-bab1c",
  storageBucket: "mazen-productivity-bab1c.firebasestorage.app",
  messagingSenderId: "388570583199",
  appId: "1:388570583199:web:45e958a32585b0572252aa",
  measurementId: "G-LCMB1W8DW9"
};

let auth = null;
let db = null;
let fbReady = false;
let currentUser = null;
let authMode = "login"; // login | signup
let fbFns = {}; // سيحتوي على دوال Firebase بعد التحميل

async function initFirebase(){
  try{
    const [{ initializeApp }, authMod, dbMod] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js")
    ]);
    const fbApp = initializeApp(firebaseConfig);
    auth = authMod.getAuth(fbApp);
    db = dbMod.getDatabase(fbApp);
    fbFns = {
      createUserWithEmailAndPassword: authMod.createUserWithEmailAndPassword,
      signInWithEmailAndPassword: authMod.signInWithEmailAndPassword,
      onAuthStateChanged: authMod.onAuthStateChanged,
      signOut: authMod.signOut,
      ref: dbMod.ref, set: dbMod.set, get: dbMod.get
    };
    fbReady = true;

    fbFns.onAuthStateChanged(auth, (user) => {
      currentUser = user;
      const authBtn = document.getElementById("authBtn");
      const logoutBtn = document.getElementById("logoutBtn");
      const syncStatus = document.getElementById("syncStatus");

      if(user){
        authBtn.textContent = user.email;
        logoutBtn.style.display = "block";
        syncStatus.textContent = "متزامن ✓ — " + user.email;
        loadCloudProgress(user.uid);
      } else {
        authBtn.textContent = "تسجيل الدخول";
        logoutBtn.style.display = "none";
        syncStatus.textContent = "غير مسجّل دخول — البيانات محلية فقط";
      }
    });
  }catch(err){
    console.error("فشل تحميل Firebase:", err);
    const syncStatus = document.getElementById("syncStatus");
    if(syncStatus) syncStatus.textContent = "المزامنة غير متاحة الآن — البيانات محلية فقط";
    showToast("تعذّر الاتصال بخدمة المزامنة، التطبيق شغال بالبيانات المحلية", true);
  }
}

// ---------- App State ----------
// progress structure:
// progress[hadithKey] = {
//   lastReviewDate: "2026-08-18",
//   nextReviewDate: "2026-08-19",
//   intervalDays: 1,
//   history: [{date, rating}]
// }
let progress = {};
let activeQuiz = null; // { key, hadith, chapterTitle, revealedWords }

const LOCAL_KEY = "hadith_app_progress_v1";

function hadithKey(bookName, chapterId, numInBook){
  return `${bookName}::${chapterId}::${numInBook}`;
}

function loadLocalProgress(){
  try{
    const raw = localStorage.getItem(LOCAL_KEY);
    progress = raw ? JSON.parse(raw) : {};
  }catch(e){ progress = {}; }
}
function saveLocalProgress(){
  localStorage.setItem(LOCAL_KEY, JSON.stringify(progress));
}

function saveProgress(){
  saveLocalProgress();
  if(currentUser && fbReady){
    fbFns.set(fbFns.ref(db, `hadithApp/${currentUser.uid}/progress`), progress)
      .catch(err => showToast("خطأ في المزامنة: " + err.message, true));
  }
}

function loadCloudProgress(uid){
  if(!fbReady) return;
  return fbFns.get(fbFns.ref(db, `hadithApp/${uid}/progress`)).then(snap => {
    if(snap.exists()){
      const cloud = snap.val();
      // دمج: أحدث تعديل يفوز (بنسخة مبسطة: البيانات السحابية تفوز لو موجودة)
      progress = cloud;
      saveLocalProgress();
    } else if(Object.keys(progress).length > 0){
      // مافيش بيانات سحابية بس فيه بيانات محلية -> رفعها
      fbFns.set(fbFns.ref(db, `hadithApp/${uid}/progress`), progress);
    }
    renderCurrentView();
  }).catch(err => {
    showToast("تعذّر تحميل بيانات المزامنة: " + err.message, true);
  });
}

// ---------- Toast ----------
function showToast(msg, isErr){
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast show" + (isErr ? " err" : "");
  setTimeout(() => { t.className = "toast" + (isErr ? " err" : ""); }, 2800);
}

// ---------- Navigation (History API) ----------
// كل حالة تنقل بيتم تسجيلها في history عشان زر الرجوع والـ refresh يشتغلوا صح
let currentTab = "books";
let currentBookIdx = null;
let currentChapterId = null;

function updateTabButtons(tab){
  document.querySelectorAll(".header-tabs button").forEach(b => b.classList.remove("active"));
  const btn = document.getElementById("nav-" + tab);
  if(btn) btn.classList.add("active");
}

// state = { view: "books" | "chapters" | "chapter-content" | "review" | "auth", bookIdx, chapterId }
function applyState(state, push){
  currentTab = (state.view === "review") ? "review" : "books";
  updateTabButtons(currentTab);

  if(state.view === "books"){
    showView("view-books");
    renderBooksList();
  } else if(state.view === "chapters"){
    currentBookIdx = state.bookIdx;
    const book = BOOKS[currentBookIdx];
    document.getElementById("chaptersBookTitle").textContent = book.bookName;
    document.getElementById("chaptersTitle").textContent = book.bookName;
    renderChaptersList();
    showView("view-chapters");
  } else if(state.view === "chapter-content"){
    currentBookIdx = state.bookIdx;
    currentChapterId = state.chapterId;
    const book = BOOKS[currentBookIdx];
    const chapter = book.chapters.find(c => c.id === currentChapterId);
    if(!chapter){ applyState({view:"books"}, false); return; }
    document.getElementById("crumbBook").textContent = book.bookName;
    document.getElementById("crumbChapter").textContent = chapter.title;
    document.getElementById("chapterContentTitle").textContent = chapter.title;
    renderAyat(chapter);
    renderHadiths(book, chapter);
    showView("view-chapter-content");
  } else if(state.view === "review"){
    showView("view-review");
    renderReviewTab();
  } else if(state.view === "auth"){
    showView("view-auth");
  }

  if(push){
    history.pushState(state, "", "#" + stateToHash(state));
  }
}

function stateToHash(state){
  if(state.view === "books") return "books";
  if(state.view === "chapters") return "chapters/" + state.bookIdx;
  if(state.view === "chapter-content") return "chapter/" + state.bookIdx + "/" + state.chapterId;
  if(state.view === "review") return "review";
  if(state.view === "auth") return "auth";
  return "books";
}

function hashToState(hash){
  const parts = hash.replace(/^#/, "").split("/");
  if(parts[0] === "chapters" && parts[1] !== undefined){
    return { view: "chapters", bookIdx: Number(parts[1]) };
  }
  if(parts[0] === "chapter" && parts[1] !== undefined && parts[2] !== undefined){
    return { view: "chapter-content", bookIdx: Number(parts[1]), chapterId: Number(parts[2]) };
  }
  if(parts[0] === "review") return { view: "review" };
  if(parts[0] === "auth") return { view: "auth" };
  return { view: "books" };
}

window.addEventListener("popstate", (e) => {
  const state = e.state || hashToState(location.hash);
  applyState(state, false);
});

function switchTab(tab){
  if(tab === "books"){
    applyState({ view: "books" }, true);
  } else if(tab === "review"){
    applyState({ view: "review" }, true);
  }
}

function showView(id){
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

function goToBooks(){
  applyState({ view: "books" }, true);
}

function goToChapters(){
  applyState({ view: "chapters", bookIdx: currentBookIdx }, true);
}

function showAuthView(){
  applyState({ view: "auth" }, true);
}

function renderCurrentView(){
  const state = hashToState(location.hash);
  applyState(state, false);
  updateReviewBadge();
}

// ---------- Books List ----------
const BOOKS = [RIYAD_ALSALIHIN];

function renderBooksList(){
  const wrap = document.getElementById("booksList");
  wrap.innerHTML = "";
  BOOKS.forEach((book, idx) => {
    const totalHadiths = book.chapters.reduce((s,c) => s + c.hadiths.length, 0);
    const el = document.createElement("div");
    el.className = "card-item";
    el.onclick = () => openBook(idx);
    el.innerHTML = `
      <div class="row-main">
        <div class="num-badge">📖</div>
        <div>
          <div class="title">${book.bookName}</div>
          <div class="meta">${book.chapters.length} باب · ${totalHadiths} حديث</div>
        </div>
      </div>
      <span class="chev">‹</span>
    `;
    wrap.appendChild(el);
  });
}

function openBook(idx){
  applyState({ view: "chapters", bookIdx: idx }, true);
}

function renderChaptersList(){
  const book = BOOKS[currentBookIdx];
  const wrap = document.getElementById("chaptersList");
  wrap.innerHTML = "";
  book.chapters.forEach(chapter => {
    const dueCount = chapter.hadiths.filter(h => {
      const key = hadithKey(book.bookName, chapter.id, h.numInBook);
      return isDue(key);
    }).length;

    const el = document.createElement("div");
    el.className = "card-item";
    el.onclick = () => openChapter(chapter.id);
    el.innerHTML = `
      <div class="row-main">
        <div class="num-badge">${chapter.id}</div>
        <div>
          <div class="title">${chapter.title}</div>
          <div class="meta">${chapter.hadiths.length} حديث${dueCount > 0 ? ` · <span style="color:var(--red-err);font-weight:700;">${dueCount} مستحق للمراجعة</span>` : ""}</div>
        </div>
      </div>
      <span class="chev">‹</span>
    `;
    wrap.appendChild(el);
  });
}

function openChapter(chapterId){
  applyState({ view: "chapter-content", bookIdx: currentBookIdx, chapterId: chapterId }, true);
}

function renderAyat(chapter){
  const wrap = document.getElementById("ayatContainer");
  wrap.innerHTML = "";
  if(!chapter.ayat || chapter.ayat.length === 0) return;

  const block = document.createElement("div");
  block.className = "ayat-block";
  block.innerHTML = `<div class="label">آيات الباب</div>`;
  chapter.ayat.forEach(a => {
    const item = document.createElement("div");
    item.className = "ayah-item";
    item.innerHTML = `
      <div class="ayah-text">﴿ ${a.text} ﴾</div>
      <div class="ayah-ref">[${a.reference}]</div>
    `;
    block.appendChild(item);
  });
  wrap.appendChild(block);
}

function renderHadiths(book, chapter){
  const wrap = document.getElementById("hadithsContainer");
  wrap.innerHTML = "";
  chapter.hadiths.forEach(h => {
    const key = hadithKey(book.bookName, chapter.id, h.numInBook);
    const safeKey = key.replace(/[^a-zA-Z0-9]/g,'_');
    const prog = progress[key];
    const due = isDue(key);

    const card = document.createElement("div");
    card.className = "hadith-card";
    card.innerHTML = `
      <div class="hh">
        <div class="nums">
          <span class="num-pill">رقم الباب: <b>${h.numInChapter}</b></span>
          <span class="num-pill">رقم الكتاب: <b>${h.numInBook}</b></span>
        </div>
        ${due ? `<span class="num-pill" style="background:#F5E1DD;color:var(--red-err);font-weight:700;">مستحق للمراجعة</span>` : ""}
      </div>
      <div class="narrator">${h.narrator}</div>
      <div class="hadith-text" id="hadithText-${safeKey}">${h.text}</div>
      <div class="takhrij">${h.takhrij}</div>
      ${h.note ? `<div class="note">${h.note}</div>` : ""}
      <div class="hh-actions">
        <button class="btn btn-outline btn-sm" onclick="toggleHadithText(this,'${safeKey}')">إظهار / إخفاء الحديث</button>
        <button class="btn btn-primary btn-sm" onclick="openQuiz('${book.bookName}', ${chapter.id}, ${h.numInBook})">تسميع (كتابة) ✍️</button>
      </div>
      ${prog ? `<div class="meta" style="margin-top:10px;font-size:0.76rem;color:var(--ink-soft);">
          آخر مراجعة: ${prog.lastReviewDate || "—"} · المراجعة القادمة: ${prog.nextReviewDate || "—"}
        </div>` : ""}
    `;
    wrap.appendChild(card);
  });
}

function toggleHadithText(btn, safeKey){
  const el = document.getElementById("hadithText-" + safeKey);
  el.classList.toggle("shown");
}

// ---------- Arabic text normalization for comparison ----------
function stripDiacritics(text){
  // إزالة التشكيل والتطويل وعلامات الترقيم غير الجوهرية
  return text
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "") // تشكيل
    .replace(/ـ/g, "") // تطويل
    .replace(/[،.,؛:؟!"'«»()"]/g, "")
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForCompare(text){
  return stripDiacritics(text).toLowerCase();
}

function tokenize(text){
  return text.split(/\s+/).filter(Boolean);
}

// ---------- LCS-based word alignment ----------
function lcsAlign(origWords, origNorm, userNorm){
  const n = origNorm.length, m = userNorm.length;
  // dp[i][j] = طول أطول تسلسل مشترك بين origNorm[0..i) و userNorm[0..j)
  const dp = Array.from({length: n+1}, () => new Uint16Array(m+1));
  for(let i = n-1; i >= 0; i--){
    for(let j = m-1; j >= 0; j--){
      if(origNorm[i] === userNorm[j]){
        dp[i][j] = dp[i+1][j+1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i+1][j], dp[i][j+1]);
      }
    }
  }

  // نرجع بالمسار عشان نبني قائمة العمليات: match / missing (من الأصل) / extra (من المستخدم)
  const ops = [];
  let i = 0, j = 0;
  while(i < n && j < m){
    if(origNorm[i] === userNorm[j]){
      ops.push({ type: "match", origIdx: i, userIdx: j });
      i++; j++;
    } else if(dp[i+1][j] >= dp[i][j+1]){
      ops.push({ type: "missing", origIdx: i });
      i++;
    } else {
      ops.push({ type: "extra", userIdx: j });
      j++;
    }
  }
  while(i < n){ ops.push({ type: "missing", origIdx: i }); i++; }
  while(j < m){ ops.push({ type: "extra", userIdx: j }); j++; }

  return ops;
}

// ---------- Quiz (تسميع) ----------
function openQuiz(bookName, chapterId, numInBook){
  const book = BOOKS.find(b => b.bookName === bookName);
  const chapter = book.chapters.find(c => c.id === chapterId);
  const h = chapter.hadiths.find(x => x.numInBook === numInBook);
  const key = hadithKey(bookName, chapterId, numInBook);

  activeQuiz = { key, hadith: h, chapterTitle: chapter.title, revealedWordsCount: 0, lastRating: null, takhrijCorrect: null };

  document.getElementById("quizTitle").textContent = `تسميع حديث رقم ${h.numInBook} (باب: ${chapter.title})`;
  document.getElementById("quizInput").value = "";
  document.getElementById("quizInput").placeholder = "اكتب الراوي ثم الحديث معاً بدون تشكيل...";
  document.getElementById("hintBox").className = "hint-box";
  document.getElementById("hintBox").textContent = "";
  document.getElementById("compareResult").innerHTML = "";
  document.getElementById("takhrijQuizBox").className = "takhrij-quiz-box";
  document.getElementById("takhrijResult").innerHTML = "";
  document.getElementById("selfRateBox").className = "self-rate";
  document.getElementById("manualReviewDate").value = "";

  // بناء خانات اختيار التخريج
  const checksWrap = document.getElementById("takhrijChecks");
  checksWrap.innerHTML = TAKHRIJ_SOURCES.filter(s => s !== "أخرى").map((src, idx) => `
    <label class="takhrij-check-item">
      <input type="checkbox" name="takhrijCheck" value="${src}">
      <span>${src}</span>
    </label>
  `).join("");

  document.getElementById("quizModal").classList.add("active");
}

function closeQuizModal(){
  document.getElementById("quizModal").classList.remove("active");
  activeQuiz = null;
}

function showNextWordHint(){
  if(!activeQuiz) return;
  const words = tokenize(activeQuiz.hadith.narrator).concat(tokenize(activeQuiz.hadith.text));
  activeQuiz.revealedWordsCount = Math.min(activeQuiz.revealedWordsCount + 1, words.length);
  const revealed = words.slice(0, activeQuiz.revealedWordsCount).join(" ");
  const box = document.getElementById("hintBox");
  box.className = "hint-box shown";
  box.innerHTML = `<b>البداية:</b> ${revealed} ...`;
}

function checkQuizAnswer(){
  if(!activeQuiz) return;
  const userText = document.getElementById("quizInput").value.trim();
  if(!userText){
    showToast("اكتب الراوي ثم الحديث قبل التحقق", true);
    return;
  }

  const narratorWords = tokenize(activeQuiz.hadith.narrator);
  const hadithWords = tokenize(activeQuiz.hadith.text);
  const userWords = tokenize(userText);

  // نقسم كلام المستخدم بنفس عدد كلمات الراوي كتقدير أولي، لأن المستخدم كتب الاتنين متواصلين
  // نستخدم LCS بمقارنة النص كله أولاً لتحديد أين ينتهي جزء الراوي فعلياً عند المستخدم
  const narratorNorm = narratorWords.map(normalizeForCompare);
  const hadithNorm = hadithWords.map(normalizeForCompare);
  const userNorm = userWords.map(normalizeForCompare);

  // نحاذي كلام المستخدم بالكامل مقابل (الراوي + الحديث) كسلسلة واحدة عشان نلاقي نقطة الفصل
  const fullOrigWords = narratorWords.concat(hadithWords);
  const fullOrigNorm = narratorNorm.concat(hadithNorm);
  const fullOps = lcsAlign(fullOrigWords, fullOrigNorm, userNorm);

  // نحدد آخر userIdx اتقابل مع كلمة من الراوي (origIdx < narratorWords.length)
  let splitUserIdx = -1;
  fullOps.forEach(op => {
    if(op.type === "match" && op.origIdx < narratorWords.length){
      splitUserIdx = Math.max(splitUserIdx, op.userIdx);
    }
  });
  const splitPoint = splitUserIdx >= 0 ? splitUserIdx + 1 : 0;

  const userNarratorWords = userWords.slice(0, splitPoint);
  const userNarratorNorm = userNorm.slice(0, splitPoint);
  const userHadithWords = userWords.slice(splitPoint);
  const userHadithNorm = userNorm.slice(splitPoint);

  function buildResult(origWords, origNorm, uWords, uNorm){
    const ops = lcsAlign(origWords, origNorm, uNorm);
    let correctCount = 0;
    let htmlParts = [];
    ops.forEach(op => {
      if(op.type === "match"){
        htmlParts.push(`<span class="word-ok">${origWords[op.origIdx]}</span>`);
        correctCount++;
      } else if(op.type === "missing"){
        htmlParts.push(`<span class="word-missing">${origWords[op.origIdx]}</span>`);
      } else if(op.type === "extra"){
        htmlParts.push(`<span class="word-extra">${uWords[op.userIdx]}</span>`);
      }
    });
    const percentage = origWords.length > 0 ? Math.round((correctCount / origWords.length) * 100) : 0;
    return { html: htmlParts.join(" "), correctCount, total: origWords.length, percentage };
  }

  const narratorResult = buildResult(narratorWords, narratorNorm, userNarratorWords, userNarratorNorm);
  const hadithResult = buildResult(hadithWords, hadithNorm, userHadithWords, userHadithNorm);

  const resultBox = document.getElementById("compareResult");
  resultBox.innerHTML = `
    <div style="margin-top:14px;">
      <div class="compare-section-label">الراوي</div>
      <div class="compare-output">${narratorResult.html || "<span style='color:var(--ink-soft)'>(لم يُكتب)</span>"}</div>
      <div class="compare-percentage">
        نسبة الصحة: <b style="color:${narratorResult.percentage >= 80 ? 'var(--green-ok)' : 'var(--red-err)'}">${narratorResult.percentage}%</b>
        (${narratorResult.correctCount} من ${narratorResult.total})
      </div>
    </div>
    <div style="margin-top:14px;">
      <div class="compare-section-label">متن الحديث</div>
      <div class="compare-output">${hadithResult.html || "<span style='color:var(--ink-soft)'>(لم يُكتب)</span>"}</div>
      <div class="compare-percentage">
        نسبة الصحة: <b style="color:${hadithResult.percentage >= 80 ? 'var(--green-ok)' : 'var(--red-err)'}">${hadithResult.percentage}%</b>
        (${hadithResult.correctCount} من ${hadithResult.total})
      </div>
    </div>
    <div class="compare-legend">
      <span class="word-ok">أخضر = صحيح</span> ·
      <span class="word-missing">أحمر باهت = ناقص من كلامك</span> ·
      <span class="word-extra">مشطوب = كتبته زيادة أو غلط</span>
    </div>
  `;

  document.getElementById("takhrijQuizBox").className = "takhrij-quiz-box shown";
}

function checkTakhrijAnswer(){
  if(!activeQuiz) return;
  const checked = Array.from(document.querySelectorAll('input[name="takhrijCheck"]:checked')).map(el => el.value);
  const correct = activeQuiz.hadith.correctTakhrij || [];

  if(checked.length === 0){
    showToast("اختر مصدر واحد على الأقل قبل التحقق", true);
    return;
  }

  // النجاح: نفس المجموعة تماماً (لا زيادة ولا نقصان)
  const sortedChecked = [...checked].sort();
  const sortedCorrect = [...correct].sort();
  const isCorrect = sortedChecked.length === sortedCorrect.length &&
    sortedChecked.every((v, i) => v === sortedCorrect[i]);

  activeQuiz.takhrijCorrect = isCorrect;

  const resultBox = document.getElementById("takhrijResult");
  if(isCorrect){
    resultBox.innerHTML = `<div class="takhrij-result-box correct">✓ صحيح! هذا الحديث ${correct.join(" و")}</div>`;
  } else {
    resultBox.innerHTML = `<div class="takhrij-result-box wrong">✗ غير صحيح. التخريج الصحيح: ${correct.join(" و")}</div>`;
  }

  document.getElementById("selfRateBox").className = "self-rate shown";
}

// ---------- Spaced Repetition ----------
const BASE_INTERVAL_DAYS = 1;
const RATING_DELTA = {
  excellent: 10,
  good: 5,
  medium: 2,
  bad: -2
};

function todayStr(){
  const d = new Date();
  return d.toISOString().slice(0,10);
}

function addDays(dateStr, days){
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0,10);
}

function isDue(key){
  const p = progress[key];
  if(!p || !p.nextReviewDate) return false;
  return p.nextReviewDate <= todayStr();
}

function daysDiff(a, b){
  const d1 = new Date(a + "T00:00:00");
  const d2 = new Date(b + "T00:00:00");
  return Math.round((d2 - d1) / (1000*60*60*24));
}

function recordReview(key, reviewDate, rating){
  const p = progress[key] || { history: [] };
  const prevInterval = p.intervalDays || 0;

  let newInterval;
  if(rating === "manual"){
    // تسجيل تاريخ يدوي بدون تقييم: نحافظ على نفس الفترة القديمة أو نبدأ بالأساسية
    newInterval = prevInterval > 0 ? prevInterval : BASE_INTERVAL_DAYS;
  } else {
    const base = prevInterval > 0 ? prevInterval : BASE_INTERVAL_DAYS;
    newInterval = Math.max(1, base + RATING_DELTA[rating]);
  }

  p.lastReviewDate = reviewDate;
  p.intervalDays = newInterval;
  p.nextReviewDate = addDays(reviewDate, newInterval);
  p.history = p.history || [];
  p.history.push({ date: reviewDate, rating: rating });

  progress[key] = p;
  saveProgress();
}

function submitSelfRating(rating){
  if(!activeQuiz) return;
  recordReview(activeQuiz.key, todayStr(), rating);
  showToast("تم تسجيل المراجعة ✓ — المراجعة القادمة بعد " + progress[activeQuiz.key].intervalDays + " يوم");
  closeQuizModal();
  refreshAfterProgress();
}

function submitManualDate(){
  if(!activeQuiz) return;
  const dateVal = document.getElementById("manualReviewDate").value;
  if(!dateVal){
    showToast("اختر تاريخ أولاً", true);
    return;
  }
  recordReview(activeQuiz.key, dateVal, "manual");
  showToast("تم تسجيل تاريخ المراجعة اليدوي ✓");
  closeQuizModal();
  refreshAfterProgress();
}

function refreshAfterProgress(){
  if(document.getElementById("view-review").classList.contains("active")){
    renderReviewTab();
  }
  if(document.getElementById("view-chapter-content").classList.contains("active")){
    const book = BOOKS[currentBookIdx];
    const chapter = book.chapters.find(c => c.id === currentChapterId);
    renderHadiths(book, chapter);
  }
  if(document.getElementById("view-chapters").classList.contains("active") && currentBookIdx !== null){
    renderChaptersList();
  }
  updateReviewBadge();
}

// ---------- Review Tab ----------
function getAllDueHadiths(){
  const results = [];
  BOOKS.forEach(book => {
    book.chapters.forEach(chapter => {
      chapter.hadiths.forEach(h => {
        const key = hadithKey(book.bookName, chapter.id, h.numInBook);
        const p = progress[key];
        if(p && p.nextReviewDate && p.nextReviewDate <= todayStr()){
          results.push({
            key, book, chapter, hadith: h,
            nextReviewDate: p.nextReviewDate,
            overdueDays: daysDiff(p.nextReviewDate, todayStr())
          });
        }
      });
    });
  });
  // الأكثر تأخيراً أولاً
  results.sort((a,b) => b.overdueDays - a.overdueDays);
  return results;
}

function renderReviewTab(){
  const due = getAllDueHadiths();
  const overdueOnly = due.filter(d => d.overdueDays > 0);
  const todayOnly = due.filter(d => d.overdueDays === 0);

  const summary = document.getElementById("reviewSummary");
  summary.innerHTML = `
    <div class="stat-box overdue">
      <div class="num">${overdueOnly.length}</div>
      <div class="lbl">متأخرة</div>
    </div>
    <div class="stat-box">
      <div class="num">${todayOnly.length}</div>
      <div class="lbl">مستحقة اليوم</div>
    </div>
    <div class="stat-box">
      <div class="num">${due.length}</div>
      <div class="lbl">الإجمالي</div>
    </div>
  `;

  const list = document.getElementById("reviewList");
  list.innerHTML = "";

  if(due.length === 0){
    list.innerHTML = `
      <div class="empty-state">
        <div class="emoji">✅</div>
        <div>مافيش أحاديث مستحقة للمراجعة دلوقتي، تبارك الله عليك</div>
      </div>
    `;
    return;
  }

  due.forEach(item => {
    const el = document.createElement("div");
    el.className = "review-item " + (item.overdueDays > 0 ? "overdue" : "today");
    let tagText = item.overdueDays > 0 ? `متأخر ${item.overdueDays} يوم` : "مستحق اليوم";
    el.innerHTML = `
      <div class="info">
        <div class="title">حديث رقم ${item.hadith.numInBook} — ${item.chapter.title}</div>
        <div class="sub">${item.book.bookName} · باب رقم ${item.hadith.numInChapter} في الباب</div>
      </div>
      <span class="due-tag">${tagText}</span>
    `;
    el.onclick = () => openQuiz(item.book.bookName, item.chapter.id, item.hadith.numInBook);
    list.appendChild(el);
  });
}

function updateReviewBadge(){
  const due = getAllDueHadiths();
  const badge = document.getElementById("reviewBadge");
  if(due.length > 0){
    badge.style.display = "flex";
    badge.textContent = due.length > 99 ? "99+" : due.length;
  } else {
    badge.style.display = "none";
  }
}

// ---------- Auth ----------
function switchAuthTab(mode){
  authMode = mode;
  document.getElementById("tabLogin").classList.toggle("active", mode === "login");
  document.getElementById("tabSignup").classList.toggle("active", mode === "signup");
  document.getElementById("authSubmitBtn").textContent = mode === "login" ? "تسجيل الدخول" : "إنشاء الحساب";
  document.getElementById("authMsg").textContent = "";
}

function submitAuth(){
  const msgEl = document.getElementById("authMsg");
  msgEl.className = "auth-msg";
  msgEl.textContent = "";

  if(!fbReady){
    msgEl.className = "auth-msg err";
    msgEl.textContent = "خدمة المزامنة غير متاحة الآن، حاول تاني بعد قليل";
    return;
  }

  const email = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;

  if(!email || !password){
    msgEl.className = "auth-msg err";
    msgEl.textContent = "من فضلك اكتب البريد وكلمة المرور";
    return;
  }

  const action = authMode === "login"
    ? fbFns.signInWithEmailAndPassword(auth, email, password)
    : fbFns.createUserWithEmailAndPassword(auth, email, password);

  action
    .then(() => {
      msgEl.className = "auth-msg ok";
      msgEl.textContent = authMode === "login" ? "تم تسجيل الدخول ✓" : "تم إنشاء الحساب ✓";
      setTimeout(() => goToBooks(), 700);
    })
    .catch(err => {
      msgEl.className = "auth-msg err";
      msgEl.textContent = translateAuthError(err.code);
    });
}

function translateAuthError(code){
  const map = {
    "auth/invalid-email": "البريد الإلكتروني غير صحيح",
    "auth/user-not-found": "لا يوجد حساب بهذا البريد",
    "auth/wrong-password": "كلمة المرور غير صحيحة",
    "auth/invalid-credential": "بيانات الدخول غير صحيحة",
    "auth/email-already-in-use": "هذا البريد مسجّل من قبل، سجّل دخول بدل إنشاء حساب",
    "auth/weak-password": "كلمة المرور ضعيفة، لازم تكون ٦ أحرف على الأقل",
    "auth/too-many-requests": "محاولات كتير، حاول بعد شوية"
  };
  return map[code] || ("حصل خطأ: " + code);
}

function doLogout(){
  if(!fbReady) return;
  fbFns.signOut(auth).then(() => {
    showToast("تم تسجيل الخروج");
    goToBooks();
  });
}

// ---------- Init ----------
loadLocalProgress();
const initialState = location.hash ? hashToState(location.hash) : { view: "books" };
history.replaceState(initialState, "", "#" + stateToHash(initialState));
applyState(initialState, false);
updateReviewBadge();
initFirebase(); // تحميل Firebase بشكل غير معطّل لباقي التطبيق

// جعل الدوال متاحة من onclick في الـ HTML (لأن الملف module)
window.switchTab = switchTab;
window.goToBooks = goToBooks;
window.goToChapters = goToChapters;
window.showAuthView = showAuthView;
window.openBook = openBook;
window.openChapter = openChapter;
window.toggleHadithText = toggleHadithText;
window.openQuiz = openQuiz;
window.closeQuizModal = closeQuizModal;
window.showNextWordHint = showNextWordHint;
window.checkQuizAnswer = checkQuizAnswer;
window.checkTakhrijAnswer = checkTakhrijAnswer;
window.submitSelfRating = submitSelfRating;
window.submitManualDate = submitManualDate;
window.switchAuthTab = switchAuthTab;
window.submitAuth = submitAuth;
window.doLogout = doLogout;
