'use strict';
const API_BASE = 'https://api.alquran.cloud/v1';
const CACHE_NAME = 'mohammed-quran-data-v6';
let currentSurahNumber = 1;
let currentSurahName = '';
let currentEnglishName = '';
let currentFontSize = Number(localStorage.getItem('quran_font_size')) || 2.2;
let surahsCache = [];
let toastTimer = null;

const RECITERS = {
  afs:'https://server8.mp3quran.net/afs/',
  maher:'https://server12.mp3quran.net/maher/',
  sds:'https://server11.mp3quran.net/sds/',
  gmd:'https://server7.mp3quran.net/s_gmd/',
  yasser:'https://server11.mp3quran.net/yasser/',
  abkr:'https://server6.mp3quran.net/abkr/',
  ajm:'https://server10.mp3quran.net/ajm/',
  Fares:'https://server8.mp3quran.net/frs_a/',
  minsh:'https://server10.mp3quran.net/minsh/',
  husri:'https://server13.mp3quran.net/husr/'
};

function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 2600);
}

async function fetchJSON(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.code && data.code !== 200) throw new Error(data.status || 'API error');
    return data;
  } catch (error) {
    if ('caches' in window) {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(url);
      if (cached) return cached.json();
    }
    throw error;
  }
}

function safeText(value) { return String(value ?? ''); }

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function stripTajweedMarkers(encodedText) {
  let source = String(encodedText ?? '');
  source = source.replace(/<tajweed[^>]*>([\s\S]*?)<\/tajweed>/gi, '$1');
  source = source.replace(/\[([a-z])(?::[^\[]*)?\[([^\]]*)\]/gi, '$2');
  return source.replace(/\[([a-z])(?::[^\[]*)?\[/gi, '');
}

const TAJWEED_RULES = {
  h: 'ham_wasl', s: 'silent', l: 'lam_shamsiyyah',
  n: 'madda_normal', p: 'madda_permissible', m: 'madda_necessary',
  q: 'qalqalah', o: 'madda_obligatory', c: 'ikhafa_shafawi',
  f: 'ikhafa', w: 'idgham_shafawi', i: 'iqlab',
  a: 'idgham_ghunnah', u: 'idgham_no_ghunnah',
  d: 'idgham_mutajanisayn', b: 'idgham_mutaqaribayn', g: 'ghunnah'
};

function renderTajweedText(encodedText) {
  let source = String(encodedText ?? '');

  const renderRule = (rule, text) => {
    const cls = TAJWEED_RULES[rule] || rule;
    const safe = escapeHTML(text);
    return Object.values(TAJWEED_RULES).includes(cls)
      ? `<span class="tajweed-rule ${cls}">${safe}</span>`
      : safe;
  };

  source = source.replace(
    /<tajweed[^>]*class\s*=\s*["']?([a-z_]+)["']?[^>]*>([\s\S]*?)<\/tajweed>/gi,
    (_whole, ruleClass, text) => renderRule(ruleClass, text)
  );

  const marker = /\[([a-z])(?::[^\[]*)?\[([^\]]*)\]/gi;
  let html = '';
  let lastIndex = 0;
  let match;
  while ((match = marker.exec(source)) !== null) {
    html += escapeHTML(source.slice(lastIndex, match.index));
    html += renderRule(match[1].toLowerCase(), match[2]);
    lastIndex = marker.lastIndex;
  }
  html += escapeHTML(source.slice(lastIndex));

  return html.replace(/\[([a-z])(?::[^\[]*)?\[/gi, '');
}

function setTheme(theme) {
  document.body.classList.remove('warm','emerald');
  if (theme === 'warm' || theme === 'emerald') document.body.classList.add(theme);
  localStorage.setItem('quran_theme', theme);
}

function changeTheme(theme) { setTheme(theme); }

function changeFontSize(direction) {
  currentFontSize = Math.max(1.4, Math.min(3.5, currentFontSize + direction * .15));
  document.getElementById('ayahs-container').style.fontSize = `${currentFontSize}rem`;
  localStorage.setItem('quran_font_size', String(currentFontSize));
}

function changeSpeed() {
  const audio = document.getElementById('audio-player');
  const speed = Number(document.getElementById('speed-select').value) || 1;
  audio.playbackRate = speed;
  localStorage.setItem('quran_playback_speed', String(speed));
}

function saveLastRead(surah, ayah, name, englishName = '') {
  localStorage.setItem('last_read', JSON.stringify({surah, ayah, name, englishName}));
  checkLastRead();
}

function checkLastRead() {
  const saved = JSON.parse(localStorage.getItem('last_read') || 'null');
  const banner = document.getElementById('last-read-banner');
  if (!saved || !saved.surah || !saved.name) {
    banner.classList.add('hidden');
    return;
  }
  document.getElementById('last-read-title').textContent = `سورة ${saved.name}، الآية ${saved.ayah || 1}`;
  banner.classList.remove('hidden');
}

async function resumeLastRead() {
  const saved = JSON.parse(localStorage.getItem('last_read') || 'null');
  if (!saved) return;
  let englishName = saved.englishName || '';
  if (!englishName && surahsCache.length) {
    const found = surahsCache.find(s => s.number === Number(saved.surah));
    if (found) englishName = found.englishName;
  }
  await openSurah(saved.surah, saved.name, englishName, saved.ayah || 1);
}

async function fetchSurahs() {
  const container = document.getElementById('surahs-container');
  try {
    const result = await fetchJSON(`${API_BASE}/surah`);
    surahsCache = result.data || [];
    container.replaceChildren();
    surahsCache.forEach(surah => {
      const button = document.createElement('button');
      button.className = 'surah';
      button.type = 'button';
      const info = document.createElement('span');
      info.innerHTML = `<b>${surah.number}. ${safeText(surah.name)}</b><small>${surah.numberOfAyahs} آية • ${surah.revelationType === 'Meccan' ? 'مكية' : 'مدنية'}</small>`;
      const badge = document.createElement('span');
      badge.textContent = 'فتح ←';
      button.append(info, badge);
      button.addEventListener('click', () => openSurah(surah.number, surah.name, surah.englishName));
      container.append(button);
    });
  } catch (error) {
    container.textContent = 'تعذر تحميل فهرس السور. اتصل بالإنترنت ثم أعد المحاولة.';
  }
}

async function openSurah(number, name, englishName, jumpToAyah = 1) {
  if (!Number.isInteger(Number(number)) || number < 1 || number > 114) return;
  currentSurahNumber = Number(number);
  currentSurahName = safeText(name);
  currentEnglishName = safeText(englishName);
  document.getElementById('home-view').hidden = true;
  document.getElementById('top-tools-container').hidden = true;
  document.getElementById('reader-view').hidden = false;
  const subTitle = currentEnglishName ? `${currentEnglishName} • سورة رقم ${currentSurahNumber}` : `سورة رقم ${currentSurahNumber}`;
  document.getElementById('surah-header').innerHTML = `<h2>${escapeHTML(currentSurahName)}</h2><p class="small muted">${escapeHTML(subTitle)}</p>`;
  saveLastRead(currentSurahNumber, jumpToAyah, currentSurahName, currentEnglishName);
  updateAudio();
  await loadAyahs(jumpToAyah);
}

function getCurrentAudioUrl() {
  const key = document.getElementById('reciter-select').value;
  const base = RECITERS[key] || RECITERS.afs;
  return `${base}${String(currentSurahNumber).padStart(3,'0')}.mp3`;
}

function updateAudio() {
  const key = document.getElementById('reciter-select').value;
  localStorage.setItem('quran_reciter', key);
  const url = getCurrentAudioUrl();
  const audio = document.getElementById('audio-player');
  audio.src = url;
  document.getElementById('download-btn').href = url;
  changeSpeed();
}

function changeReciter() { updateAudio(); }

async function downloadAudio(event) {
  event.preventDefault();
  const url = getCurrentAudioUrl();
  const filename = `${String(currentSurahNumber).padStart(3,'0')}-${currentSurahName || 'surah'}.mp3`;
  showToast('جاري تجهيز ملف الصوت للتنزيل...');
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Download failed');
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}

async function loadAyahs(jumpToAyah = 1) {
  const container = document.getElementById('ayahs-container');
  container.textContent = 'جاري تحميل الآيات...';
  try {
    const tajweedMode = document.getElementById('mode-selector').value === 'tajweed';
    const endpoint = tajweedMode
      ? `${API_BASE}/surah/${currentSurahNumber}/quran-tajweed`
      : `${API_BASE}/surah/${currentSurahNumber}`;
    const result = await fetchJSON(endpoint);
    container.replaceChildren();
    const ayahs = result.data.ayahs;
    if (tajweedMode && (!ayahs.length || !ayahs[0].text || !/(?:\[[a-z](?::[^\[]*)?\[|<tajweed)/i.test(ayahs[0].text))) {
      throw new Error('Tajweed edition returned no verse text');
    }
    ayahs.forEach(ayah => {
      const span = document.createElement('span');
      span.className = 'ayah';
      span.id = `ayah-${ayah.numberInSurah}`;
      const cleanAyahText = tajweedMode ? stripTajweedMarkers(ayah.text) : ayah.text;

      if (tajweedMode) {
        span.innerHTML = renderTajweedText(ayah.text);
        span.classList.add('tajweed-ayah');
      } else {
        span.textContent = ayah.text;
        span.classList.remove('tajweed-ayah');
      }
      const controls = document.createElement('span');
      controls.className = 'ayah-tools';
      const tafsir = document.createElement('button');
      tafsir.textContent = 'تفسير';
      tafsir.addEventListener('click', () => {
        saveLastRead(currentSurahNumber, ayah.numberInSurah, currentSurahName, currentEnglishName);
        showTafsir(currentSurahNumber, ayah.numberInSurah);
      });
      const copy = document.createElement('button');
      copy.textContent = '📋';
      copy.title = 'نسخ الآية';
      copy.addEventListener('click', () => {
        saveLastRead(currentSurahNumber, ayah.numberInSurah, currentSurahName, currentEnglishName);
        copyAyah(cleanAyahText, currentSurahName, ayah.numberInSurah);
      });
      const number = document.createElement('span');
      number.className = 'number';
      number.textContent = `(${ayah.numberInSurah})`;
      controls.append(tafsir, copy, number);
      container.append(span, controls, document.createTextNode(' '));
    });
    const target = document.getElementById(`ayah-${jumpToAyah}`);
    if (target) setTimeout(() => target.scrollIntoView({behavior:'smooth', block:'center'}), 80);
  } catch (error) {
    container.textContent = document.getElementById('mode-selector').value === 'tajweed'
      ? 'تعذر تحميل نص التجويد الملوّن حاليًا. جرّب النص القرآني العادي أو أعد المحاولة مع الاتصال بالإنترنت.'
      : 'تعذر تحميل الآيات. تحقق من الإنترنت أو احفظ السور مسبقًا للعمل دون اتصال.';
  }
}

async function copyAyah(text, surahName, ayahNumber) {
  const value = `${text} [سورة ${surahName} - آية ${ayahNumber}]`;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
    } else {
      const area = document.createElement('textarea');
      area.value = value; document.body.append(area); area.select();
      const ok = document.execCommand('copy'); area.remove();
      if (!ok) throw new Error('copy failed');
    }
    showToast('✅ تم نسخ الآية بنجاح');
  } catch {
    showToast('تعذر النسخ تلقائيًا. يمكنك تحديد الآية ونسخها يدويًا.');
  }
}

async function showTafsir(surah, ayah) {
  const modal = document.getElementById('tafsir-modal');
  const output = document.getElementById('tafsir-text');
  modal.hidden = false;
  output.textContent = 'جاري تحميل التفسير...';
  try {
    const result = await fetchJSON(`${API_BASE}/ayah/${surah}:${ayah}/editions/ar.muyassar`);
    output.textContent = result.data[0].text;
  } catch {
    output.textContent = 'تعذر تحميل التفسير. يلزم الاتصال بالإنترنت أول مرة.';
  }
}

function closeTafsir() { document.getElementById('tafsir-modal').hidden = true; }

async function searchQuran() {
  const query = document.getElementById('search-input').value.trim();
  const box = document.getElementById('search-results');
  if (!query) { box.hidden = true; return; }
  box.hidden = false; box.textContent = 'جاري البحث...';
  try {
    const result = await fetchJSON(`${API_BASE}/search/${encodeURIComponent(query)}/all/ar`);
    box.replaceChildren();
    const matches = result.data?.matches || [];
    if (!matches.length) { box.textContent = 'لا توجد نتائج.'; return; }
    const heading = document.createElement('p');
    heading.textContent = `النتائج: ${result.data.count}`;
    box.append(heading);
    matches.slice(0,30).forEach(match => {
      const item = document.createElement('div');
      item.className = 'result';
      const title = document.createElement('b');
      title.textContent = `سورة ${match.surah.name} • آية ${match.numberInSurah}`;
      const verse = document.createElement('p');
      verse.textContent = match.text;
      item.append(title, verse);
      item.addEventListener('click', () => openSurah(match.surah.number, match.surah.name, match.surah.englishName, match.numberInSurah));
      box.append(item);
    });
  } catch {
    box.textContent = 'تعذر البحث. البحث يحتاج إلى اتصال بالإنترنت.';
  }
}

async function playNextSurah() {
  if (currentSurahNumber >= 114) return;
  try {
    const next = await fetchJSON(`${API_BASE}/surah/${currentSurahNumber + 1}`);
    await openSurah(currentSurahNumber + 1, next.data.name, next.data.englishName);
    const audio = document.getElementById('audio-player');
    try { await audio.play(); } catch {}
  } catch { showToast('تعذر تحميل السورة التالية.'); }
}

async function downloadQuranOffline() {
  if (!('caches' in window) || !('serviceWorker' in navigator)) {
    showToast('الحفظ دون إنترنت يحتاج إلى متصفح حديث واتصال HTTPS أو localhost.');
    return;
  }
  const button = document.getElementById('offline-quran-btn');
  const progress = document.getElementById('offline-progress');
  button.disabled = true;
  let completed = 0;
  try {
    const cache = await caches.open(CACHE_NAME);
    const listURL = `${API_BASE}/surah`;
    const listResponse = await fetch(listURL);
    if (!listResponse.ok) throw new Error('تعذر تحميل الفهرس');
    await cache.put(listURL, listResponse.clone());
    const listData = await listResponse.json();
    for (const surah of listData.data) {
      const url = `${API_BASE}/surah/${surah.number}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`فشل تحميل السورة ${surah.number}`);
      await cache.put(url, response.clone());
      try {
        const tajweedURL = `${API_BASE}/surah/${surah.number}/quran-tajweed`;
        const tajweedResponse = await fetch(tajweedURL);
        if (tajweedResponse.ok) await cache.put(tajweedURL, tajweedResponse.clone());
      } catch (tajweedError) {
        // Standard Quran text remains saved even if the optional Tajweed edition is unavailable.
      }
      completed++;
      progress.textContent = `تم حفظ ${completed} من 114 سورة`;
    }
    progress.textContent = '✅ تم حفظ نص القرآن كاملًا. الصوت والتفسير والبحث تحتاج اتصالًا عند عدم تخزينها مسبقًا.';
    button.textContent = '✅ النص محفوظ دون إنترنت';
  } catch (error) {
    progress.textContent = `تعذر إكمال الحفظ (${completed}/114). تحقق من الاتصال ثم أعد المحاولة.`;
    button.textContent = '🔄 إعادة المحاولة';
  } finally { button.disabled = false; }
}

function goHome() {
  document.getElementById('reader-view').hidden = true;
  document.getElementById('home-view').hidden = false;
  document.getElementById('top-tools-container').hidden = false;
  document.getElementById('audio-player').pause();
  document.getElementById('search-results').hidden = true;
  document.getElementById('search-input').value = '';
  window.scrollTo({top:0,behavior:'smooth'});
}

document.addEventListener('DOMContentLoaded', () => {
  const theme = localStorage.getItem('quran_theme') || 'dark';
  document.getElementById('theme-selector').value = theme;
  setTheme(theme);

  const savedReciter = localStorage.getItem('quran_reciter');
  if (savedReciter && RECITERS[savedReciter]) {
    document.getElementById('reciter-select').value = savedReciter;
  }

  const savedSpeed = localStorage.getItem('quran_playback_speed');
  if (savedSpeed) {
    document.getElementById('speed-select').value = savedSpeed;
  }

  const savedMode = localStorage.getItem('quran_mode') || 'text';
  document.getElementById('mode-selector').value = savedMode;
  const isInitialTajweed = savedMode === 'tajweed';
  document.getElementById('tajweed-note').hidden = !isInitialTajweed;
  document.getElementById('tajweed-legend').hidden = !isInitialTajweed;

  document.getElementById('theme-selector').addEventListener('change', e => changeTheme(e.target.value));
  document.getElementById('mode-selector').addEventListener('change', () => {
    const mode = document.getElementById('mode-selector').value;
    localStorage.setItem('quran_mode', mode);
    const isTajweed = mode === 'tajweed';
    document.getElementById('tajweed-note').hidden = !isTajweed;
    document.getElementById('tajweed-legend').hidden = !isTajweed;
    if (!document.getElementById('reader-view').hidden && currentSurahNumber) {
      loadAyahs(1);
    }
  });

  document.getElementById('tafsir-modal').addEventListener('click', e => {
    if (e.target.id === 'tafsir-modal') closeTafsir();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !document.getElementById('tafsir-modal').hidden) closeTafsir();
  });

  document.getElementById('ayahs-container').style.fontSize = `${currentFontSize}rem`;
  checkLastRead();
  fetchSurahs();
  document.getElementById('search-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') searchQuran();
  });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.error('Service worker:', err));
  }
});
