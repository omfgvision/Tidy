(function(){
  const drop = document.getElementById('drop');
  const input = document.getElementById('fileInput');
  const nameEl = document.querySelector('[data-name]');
  const chooseBtn = document.getElementById('chooseBtn');
  const overlay = document.getElementById('overlay');
  const sheet = document.getElementById('sheet');
  const queueEl = document.getElementById('queue');
  const localLink = document.getElementById('localLink');
  const updatesBtn = document.getElementById('updatesBtn');
  const updatesHint = document.getElementById('updatesHint');
  const updatesPanel = document.getElementById('updatesPanel');
  const updatesClose = document.getElementById('updatesClose');
  const panelOverlay = document.getElementById('panelOverlay');
  const themeToggle = document.getElementById('themeToggle');
  const pendingBanner = document.getElementById('pendingBanner');
  const confirmOverlay = document.getElementById('confirmOverlay');
  const confirmBox = document.getElementById('confirmBox');
  const confirmMessage = document.getElementById('confirmMessage');
  const confirmCancel = document.getElementById('confirmCancel');
  const confirmOk = document.getElementById('confirmOk');

  // Keeps sheet.dataset.view accurate for every step so desktop-only
  // per-view CSS never lingers on an unrelated screen.
  function setSheetView(view){ sheet.dataset.view = view || ''; }

  // Device/input hints are used only for presentation. They do not gate functionality.
  function updateDeviceClass(){
    const root = document.documentElement;
    const touchLike = window.matchMedia && (window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(hover: none)').matches || navigator.maxTouchPoints > 0);
    const mobileHint = !!(navigator.userAgentData && navigator.userAgentData.mobile);
    root.dataset.inputMode = touchLike ? 'touch' : 'fine';
    root.dataset.deviceHint = mobileHint ? 'mobile' : (touchLike ? 'touch' : 'desktop');
  }
  updateDeviceClass();
  try{
    ['(pointer: coarse)','(hover: none)'].forEach(query => {
      const mq = window.matchMedia(query);
      if(mq.addEventListener) mq.addEventListener('change', updateDeviceClass);
      else if(mq.addListener) mq.addListener(updateDeviceClass);
    });
    window.addEventListener('resize', updateDeviceClass, {passive:true});
  }catch(e){}

  const GB = 1024*1024*1024, MB = 1024*1024;
  const BIG_FILE = 1 * GB;
  let currentFile = null;
  let currentURL = null;
  let queue = [];
  let pendingFile = null;
  let activeJob = null;
  let jobCounter = 0;

  // ---- Compression presets ----
  // These are intentionally simple starting presets; more refined options
  // are planned for a later update. Kept in plain, non-technical language.
  // `short` is what's shown on the button itself (kept brief so three of
  // these don't turn into a wall of text); `blurb` is the fuller explanation,
  // available as a tooltip on hover/focus.
  const COMPRESS_PRESETS = [
    {
      id: 'quick', label: 'Quick', short: 'Fastest - lighter processing, slightly less compression',
      blurb: "Finishes sooner using lighter processing, while still trying to make the file as small as reasonably possible. The result may end up a little larger, or lower quality, than a slower preset."
    },
    {
      id: 'balanced', label: 'Balanced', short: 'A steady mix of speed, size, and quality',
      blurb: "A middle ground between processing time, quality, and file size."
    },
    {
      id: 'smaller', label: 'Smaller', short: 'Smallest file - more processing time',
      blurb: "Prioritises the smallest file size, even if it takes longer to process or quality drops somewhat."
    }
  ];

  function presetMarkup(activeId){
    return `<div class="preset-row" role="group" aria-label="Compression preset">
      ${COMPRESS_PRESETS.map(p => `
        <button type="button" class="preset-btn${p.id === activeId ? ' active' : ''}" data-preset="${p.id}" title="${p.blurb}">
          <span class="preset-name">${p.label}</span>
          <span class="preset-blurb">${p.short}</span>
        </button>`).join('')}
    </div>`;
  }

  function estimateMarkup(){
    return `<div class="estimate-block">
      <div class="estimate-pair">
        <div class="estimate-item"><span class="label">Estimated size</span><span class="value" id="presetSizeEstimate">-</span></div>
        <div class="estimate-item"><span class="label">Estimated time</span><span class="value" id="presetTimeEstimate">-</span></div>
      </div>
      <p class="estimate-caveat">Estimated only. Actual results can vary.</p>
    </div>`;
  }

  // Crisp, perfectly-centred close/remove icon - replaces the plain "×"
  // character, whose glyph metrics sit slightly off-centre in most system
  // fonts and can make small circular buttons look lopsided on hover.
  function xIconMarkup(strokeWidth){
    return `<svg viewBox="0 0 20 20" width="13" height="13" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" stroke-width="${strokeWidth || 1.8}" stroke-linecap="round"/>
    </svg>`;
  }

  // Formats a duration for an up-front estimate (prefixed with ~, distinct
  // from the "About X left" wording used by the live progress ticker).
  function formatDuration(seconds){
    if(!isFinite(seconds) || seconds < 0) return '-';
    const s = Math.max(0, Math.round(seconds));
    if(s < 45) return `~${s || 1} second${s === 1 ? '' : 's'}`;
    const mins = Math.floor((s + 30) / 60) || 1;
    if(mins < 60) return `~${mins} minute${mins === 1 ? '' : 's'}`;
    const hrs = Math.floor(mins / 60), remMins = mins % 60;
    return remMins > 0 ? `~${hrs} hr ${remMins} min` : `~${hrs} hour${hrs === 1 ? '' : 's'}`;
  }
  const PROCESSING_TIME_NOTE = "Larger files and more demanding settings can take longer to process. This depends mainly on the file itself and your device, not your internet connection.";
  function formatDurationRange(lowSeconds, highSeconds){
    if(!isFinite(lowSeconds) || !isFinite(highSeconds)) return '-';
    if(highSeconds - lowSeconds < Math.max(5, lowSeconds * 0.15)) return formatDuration(highSeconds);
    return `${formatDuration(lowSeconds)} to ${formatDuration(highSeconds).replace('~','')}`;
  }

  function fmtSize(bytes){
    if(bytes >= GB*0.95) return (bytes/GB).toFixed(bytes/GB<10?1:0) + ' GB';
    if(bytes >= MB*0.95) return (bytes/MB).toFixed(bytes/MB<10?1:0) + ' MB';
    return Math.max(1, Math.round(bytes/1024)) + ' KB';
  }
  function ext(name){ const m = /\.([a-z0-9]+)$/i.exec(name); return m ? m[1].toLowerCase() : ''; }
  function baseName(name){ return name.replace(/\.[a-z0-9]+$/i,''); }
  function isImage(file){ return /^image\/(jpeg|png|webp|avif|gif)$/i.test(file.type) || /\.(jpe?g|png|webp|avif|gif)$/i.test(file.name); }
  function isGif(file){ return file.type === 'image/gif' || /\.gif$/i.test(file.name); }
  function isVideo(file){
    const type=(file.type||'').toLowerCase();
    return type.startsWith('video/') || (!type.startsWith('audio/') && !/\.(webm|ogg|oga|opus)$/i.test(file.name) && /\.(mp4|mov|m4v|ogv|avi|mkv|wmv|flv|mpeg|mpg|mpe|ts|mts|m2ts|3gp|3g2)$/i.test(file.name));
  }
  function fileKind(file){
    const type=(file.type||'').toLowerCase();
    if(type.startsWith('audio/')) return 'audio';
    if(type.startsWith('video/')) return 'video';
    if(isGif(file)) return 'gif';
    if(type.startsWith('image/') || /\.(jpe?g|png|webp|avif|bmp|tiff?|heic|heif|jxl)$/i.test(file.name)) return 'image';
    if(/\.(mp3|wav|m4a|aac|flac|aiff|aif|caf|mka|m4b|wma)$/i.test(file.name)) return 'audio';
    if(/\.(webm|ogg|oga|opus)$/i.test(file.name)) return 'ambiguous-media';
    if(/\.(mp4|mov|m4v|ogv|avi|mkv|wmv|flv|mpeg|mpg|mpe|ts|mts|m2ts|3gp|3g2)$/i.test(file.name)) return 'video';
    if(file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'document';
    return 'other';
  }

  function resolveAmbiguousMediaKind(file){
    return new Promise((resolve,reject)=>{
      const url=URL.createObjectURL(file);
      const video=document.createElement('video');
      const audio=document.createElement('audio');
      video.preload='metadata'; video.muted=true; video.playsInline=true;
      audio.preload='metadata';
      let settled=false;
      let timer=null;
      const cleanup=()=>{
        if(timer) clearTimeout(timer);
        try{video.pause();audio.pause();}catch(e){}
        video.remove();audio.remove();URL.revokeObjectURL(url);
      };
      const finish=(kind)=>{ if(settled)return; settled=true; cleanup(); resolve(kind); };
      video.onloadedmetadata=()=>{ if(video.videoWidth>0 && video.videoHeight>0) finish('video'); };
      audio.onloadedmetadata=()=>{ if(video.videoWidth===0 && isFinite(audio.duration) && audio.duration>0) finish('audio'); };
      video.onerror=()=>{};
      audio.onerror=()=>{};
      video.src=url;
      audio.src=url;
      timer=setTimeout(()=>{ if(!settled){ cleanup(); reject(new Error('ambiguous-media')); } },2500);
    });
  }

  function videoCaptureSupported(){
    return typeof MediaRecorder !== 'undefined' &&
      typeof HTMLCanvasElement !== 'undefined' &&
      !!HTMLCanvasElement.prototype.captureStream &&
      !!pickVideoMime();
  }
  function escapeHtml(s){ return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }


  function applyTheme(theme){
    document.documentElement.dataset.theme = theme;
    if(themeToggle){
      themeToggle.innerHTML = mascotMarkup();
      themeToggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
      themeToggle.title = theme === 'dark' ? 'Switch to light mode · Broom' : 'Switch to dark mode · Moppy';
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if(meta) meta.content = theme === 'dark' ? '#171615' : '#f7f4ee';
  }
  let savedTheme = null;
  try{ savedTheme = localStorage.getItem('tidy-theme'); }catch(e){}
  applyTheme(savedTheme === 'dark' ? 'dark' : 'light');
  if(themeToggle){
    // Debounce rapid toggling: the switch itself is instant and synchronous
    // (no risk of desync), but a short cooldown stops very fast repeat
    // clicks/keypresses from spamming localStorage writes and log entries.
    const THEME_COOLDOWN_MS = 260;
    let themeCooling = false;
    themeToggle.addEventListener('click', () => {
      if(themeCooling) return;
      themeCooling = true;
      themeToggle.disabled = true;

      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try{ localStorage.setItem('tidy-theme', next); }catch(e){}
      updateHeroMascot();

      setTimeout(() => {
        themeCooling = false;
        themeToggle.disabled = false;
      }, THEME_COOLDOWN_MS);
    });
  }

  function broomMascot(){
    return `<svg class="mascot" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M64 8 L54 62" stroke="currentColor" stroke-width="9" stroke-linecap="round"/>
      <path d="M54 62 C50 58 34 58 30 66 C41 64 47 68 49 74 C52 68 58 66 66 68 C72 70 76 66 84 68 C78 60 68 58 62 62 C58 65 57 60 54 62Z" fill="currentColor"/>
      <g transform="translate(0,4)">
        <path d="M22 74 C18 96 26 108 40 112 C60 118 78 110 84 96 C88 86 82 78 70 78 C50 74 32 66 22 74Z" fill="currentColor" opacity=".12" stroke="currentColor" stroke-width="6"/>
        <path d="M30 92 L28 108 M42 96 L41 112 M55 97 L56 113 M68 94 L71 109" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>
      </g>
      <circle cx="52" cy="80" r="3.6" fill="currentColor"/>
      <circle cx="66" cy="79" r="3.6" fill="currentColor"/>
      <path d="M55 89 Q60 93 65 89" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
    </svg>`;
  }
  function mopMascot(){
    return `<svg class="mascot" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M62 8 L57 65" stroke="currentColor" stroke-width="9" stroke-linecap="round"/>
      <path d="M44 61 C39 55 28 57 25 65 C35 63 42 69 43 76 C47 69 53 67 61 69 C68 71 75 68 84 70 C78 61 66 58 58 63 C52 66 49 64 44 61Z" fill="currentColor"/>
      <path d="M26 73 C20 81 22 98 35 107 C48 117 70 116 83 105 C92 97 91 85 80 79 C64 70 42 68 26 73Z" fill="currentColor" opacity=".12" stroke="currentColor" stroke-width="6"/>
      <path d="M31 91 Q54 84 80 92 M31 99 Q56 91 80 99 M38 106 Q57 99 75 105" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>
      <circle cx="49" cy="82" r="3.6" fill="currentColor"/>
      <circle cx="65" cy="82" r="3.6" fill="currentColor"/>
      <path d="M53 92 Q58 96 63 92" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
    </svg>`;
  }
  function mascotMarkup(){ return document.documentElement.dataset.theme === 'dark' ? mopMascot() : broomMascot(); }
  function updateHeroMascot(){
    const hero = document.getElementById('heroMascot');
    if(hero) hero.innerHTML = mascotMarkup();
  }
  updateHeroMascot();

  // ---- Per-job processing log ----
  // Only real events from the file currently being processed are logged here.
  // Nothing about theme, Updates, Build, or panel open/close ever goes through this.
  function jlog(job, message){
    if(window.TidyTerminalLog) window.TidyTerminalLog.append(job, message);
  }
  function renderJobLog(job){
    if(window.TidyTerminalLog) window.TidyTerminalLog.render(job);
  }

  // ---- Custom themed confirm modal (replaces native confirm()) ----
  let confirmResolver = null;
  function showConfirm(message){
    return new Promise(resolve => {
      confirmResolver = resolve;
      confirmMessage.textContent = message;
      confirmOverlay.classList.add('show');
      confirmOk.focus();
    });
  }
  function resolveConfirm(value){
    confirmOverlay.classList.remove('show');
    const r = confirmResolver;
    confirmResolver = null;
    if(r) r(value);
  }
  if(confirmOk) confirmOk.addEventListener('click', () => resolveConfirm(true));
  if(confirmCancel) confirmCancel.addEventListener('click', () => resolveConfirm(false));
  if(confirmOverlay) confirmOverlay.addEventListener('click', e => { if(e.target === confirmOverlay) resolveConfirm(false); });

  function formatRemaining(totalSeconds){
    const s = Math.max(0, Math.round(totalSeconds));
    if(s < 60) return `About ${s} second${s === 1 ? '' : 's'} left`;
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    if(mins < 60){
      return secs > 0
        ? `About ${mins} min ${secs} sec left`
        : `About ${mins} minute${mins === 1 ? '' : 's'} left`;
    }
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return remMins > 0
      ? `About ${hours} hr ${remMins} min left`
      : `About ${hours} hour${hours === 1 ? '' : 's'} left`;
  }

  // ---- Working-state ticker: animated dots + real remaining-time estimate ----
  function startWorkingTicker(job){
    if(!job) return;
    stopWorkingTicker(job);
    let n = 0;
    job._tickTimer = setInterval(() => {
      n = (n % 3) + 1;
      const dotsEl = document.getElementById('workingDots');
      if(dotsEl) dotsEl.textContent = '.'.repeat(n);
      const etaEl = document.getElementById('workingEta');
      if(etaEl){
        let text = 'Getting it ready';
        if(typeof job.eta === 'function'){
          const e = job.eta();
          if(e && isFinite(e.elapsed) && isFinite(e.total) && e.total > 0){
            const remain = Math.max(0, Math.round(e.total - e.elapsed));
            if(remain > 0) text = formatRemaining(remain);
          }
        }
        etaEl.textContent = text;
      }
    }, 400);
  }
  function stopWorkingTicker(job){
    if(job && job._tickTimer){ clearInterval(job._tickTimer); job._tickTimer = null; }
  }

  const buildBtn = document.getElementById('buildBtn');
  const buildToast = document.getElementById('buildToast');
  let buildToastTimer = null;
  function showBuildInfo(){
    if(!buildToast) return;
    buildToast.classList.add('show');
    buildToast.setAttribute('aria-hidden','false');
    clearTimeout(buildToastTimer);
    buildToastTimer = setTimeout(() => {
      buildToast.classList.remove('show');
      buildToast.setAttribute('aria-hidden','true');
    }, 1800);
  }
  if(buildBtn) buildBtn.addEventListener('click', showBuildInfo);

  // ---- drop zone wiring ----
  function openPicker(){ input.click(); }
  chooseBtn.addEventListener('click', e => { e.stopPropagation(); openPicker(); });
  drop.addEventListener('click', openPicker);
  drop.addEventListener('keydown', e => { if(e.key==='Enter'||e.key===' '){ e.preventDefault(); openPicker(); } });
  ['dragenter','dragover'].forEach(evt => drop.addEventListener(evt, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave','drop'].forEach(evt => drop.addEventListener(evt, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => handleFiles(e.dataTransfer.files));
  input.addEventListener('change', () => {
    const files = input.files;
    handleFiles(files);
    input.value = '';
  });
  renderPendingBanner();

  if(localLink){
    localLink.addEventListener('click', e => { e.preventDefault(); renderLocalInfo(); openSheet(); });
  }

  function openUpdates(){
    updatesPanel.classList.add('show');
    panelOverlay.classList.add('show');
  }
  function closeUpdates(){
    updatesPanel.classList.remove('show');
    panelOverlay.classList.remove('show');
  }
  // Debounce rapid clicking: ignore repeat clicks for a short cooldown after
  // each open, and let the user know why nothing happened if they keep clicking.
  const UPDATES_COOLDOWN_MS = 450;
  let updatesCooling = false;
  let updatesHintTimer = null;
  function flashUpdatesHint(){
    if(!updatesHint) return;
    updatesHint.textContent = "Whoa, you're clicking too fast. Give me a moment.";
    updatesHint.classList.add('show');
    clearTimeout(updatesHintTimer);
    updatesHintTimer = setTimeout(() => updatesHint.classList.remove('show'), 1600);
  }
  if(updatesBtn) updatesBtn.addEventListener('click', () => {
    if(updatesCooling){ flashUpdatesHint(); return; }
    updatesCooling = true;
    updatesBtn.classList.add('is-cooling');
    openUpdates();
    setTimeout(() => {
      updatesCooling = false;
      updatesBtn.classList.remove('is-cooling');
    }, UPDATES_COOLDOWN_MS);
  });
  if(updatesClose) updatesClose.addEventListener('click', closeUpdates);
  if(panelOverlay) panelOverlay.addEventListener('click', closeUpdates);
  document.addEventListener('keydown', e => {
    if(e.key === 'Escape' && updatesPanel.classList.contains('show')) closeUpdates();
  });

  function handleFiles(files){
    if(!files || !files.length) return;
    const file = files[0];
    // Discard any previous not-yet-queued pending file before adopting the new one.
    if(pendingFile && !(activeJob && activeJob.file === pendingFile) && currentURL){
      URL.revokeObjectURL(currentURL); currentURL = null;
    }
    currentFile = file;
    pendingFile = file;
    currentURL = (isImage(file) && !isGif(file)) ? URL.createObjectURL(file) : null;
    renderPendingBanner();
    openSheet();
    if(file.size > BIG_FILE) renderBigFileWarning(file);
    else renderChoiceStep(file);
  }

  function renderPendingBanner(){
    if(!pendingBanner) return;
    const has = pendingFile && !(activeJob && activeJob.file === pendingFile);
    pendingBanner.style.display = has ? 'flex' : 'none';
    if(has){
      const nameEl = pendingBanner.querySelector('[data-pending-name]');
      if(nameEl) nameEl.textContent = pendingFile.name;
    }
  }
  const resumePendingBtn = document.getElementById('resumePending');
  const discardPendingBtn = document.getElementById('discardPending');
  if(resumePendingBtn) resumePendingBtn.addEventListener('click', () => {
    if(!pendingFile) return;
    openSheet();
    if(pendingFile.size > BIG_FILE) renderBigFileWarning(pendingFile);
    else renderChoiceStep(pendingFile);
  });
  if(discardPendingBtn) discardPendingBtn.addEventListener('click', () => {
    if(currentURL){ URL.revokeObjectURL(currentURL); currentURL = null; }
    pendingFile = null;
    currentFile = null;
    renderPendingBanner();
  });

  function addToQueue(file, mode){
    const item = { id: ++jobCounter, name:file.name, status:'Waiting', mode, file, cancelled:false };
    queue.push(item);
    activeJob = item;
    renderQueue();
    renderPendingBanner();
    return item;
  }
  function updateQueueStatus(name, status){
    const row = queue.slice().reverse().find(q => q.name === name && !q.cancelled);
    if(row){ row.status = status; renderQueue(); }
  }
  function updateJobStatus(job, status){
    if(!job || job.cancelled) return;
    job.status = status;
    renderQueue();
  }
  async function removeQueueItem(id){
    const index = queue.findIndex(q => q.id === id);
    if(index < 0) return;
    const item = queue[index];
    const message = item.status === 'Working'
      ? `Remove ${item.name}? This will cancel the current operation.`
      : `Remove ${item.name}?`;
    const ok = await showConfirm(message);
    if(!ok) return;
    item.cancelled = true;
    queue.splice(index, 1);
    if(activeJob && activeJob.id === id){
      stopWorkingTicker(activeJob);
      activeJob = null;
      if(item.cancel) item.cancel();
    }
    renderQueue();
  }
  async function closeAllQueue(){
    if(!queue.length) return;
    const hasWorking = queue.some(q => q.status === 'Working');
    const message = hasWorking
      ? `Close all ${queue.length} items? This will cancel any operation in progress.`
      : `Close all ${queue.length} items?`;
    const ok = await showConfirm(message);
    if(!ok) return;
    queue.forEach(item => {
      item.cancelled = true;
      if(activeJob && activeJob.id === item.id){
        stopWorkingTicker(activeJob);
        if(item.cancel) item.cancel();
      }
    });
    queue = [];
    activeJob = null;
    renderQueue();
  }
  function renderQueue(){
    if(!queue.length){
      queueEl.innerHTML = '';
      queueEl.style.display = 'none';
      return;
    }
    queueEl.innerHTML = `
      <div class="queue-heading"><strong>Queue</strong><span>${queue.length}</span><button type="button" class="queue-close-all" id="queueCloseAll">Close all</button></div>
      ${queue.map(q =>
        `<div class="qrow qrow-clickable" data-id="${q.id}" tabindex="0" role="button" aria-label="Reopen ${escapeHtml(q.name)}">
          <b>${escapeHtml(q.name)}</b>
          <span class="qright"><span class="st ${q.status==='Done'?'done':''}">${q.status}</span><button class="queue-remove" data-remove="${q.id}" aria-label="Remove ${escapeHtml(q.name)}">${xIconMarkup(1.8)}</button></span>
        </div>`).join('')}
    `;
    queueEl.style.display = 'block';
    queueEl.querySelectorAll('[data-remove]').forEach(btn => btn.addEventListener('click', (event) => {
      event.stopPropagation();
      removeQueueItem(Number(btn.dataset.remove));
    }));
    const closeAllBtn = queueEl.querySelector('#queueCloseAll');
    if(closeAllBtn) closeAllBtn.addEventListener('click', closeAllQueue);
    queueEl.querySelectorAll('.qrow-clickable').forEach(row => {
      const open = () => reopenQueueItem(Number(row.dataset.id));
      row.addEventListener('click', open);
      row.addEventListener('keydown', e => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); open(); } });
    });
  }

  function reopenQueueItem(id){
    const item = queue.find(q => q.id === id);
    if(!item || !item.file) return;
    openSheet();
    if(item.status === 'Done' && item.result){
      renderPreview(item.file, item.result, item.mode);
    } else if(item.status === 'Working'){
      activeJob = item;
      renderWorking(item.file, item.sub || 'Working', item);
    } else if(item.status === 'Waiting'){
      activeJob = item;
      if(item.mode === 'compress') renderCompressStep(item.file);
      else renderConvertStep(item.file);
    } else {
      // Failed or otherwise unresolved: let the user look at it again from the top.
      renderChoiceStep(item.file);
    }
  }

  function openSheet(){ overlay.classList.add('show'); }
  function closeSheet(){
    overlay.classList.remove('show');
    // Pending (not-yet-queued) files are kept so the user can come back to them
    // via the pending banner instead of losing their selection.
    renderPendingBanner();
  }
  function beginOperation(file, mode){
    pendingFile = null;
    const item = addToQueue(file, mode);
    currentFile = file;
    return item;
  }

  // ---- sheet plumbing ----
  overlay.addEventListener('click', e => { if(e.target === overlay) closeSheet(); });

  function topBar(file){
    return `<div class="sheet-top">
      <div class="filepill">
        <div class="dot">${ext(file.name).slice(0,2).toUpperCase() || 'F'}</div>
        <div class="name">${escapeHtml(file.name)}</div>
      </div>
      <button class="close" aria-label="Close">×</button>
    </div>`;
  }
  function plainTopBar(){
    return `<div class="sheet-top"><div></div><button class="close" aria-label="Close">×</button></div>`;
  }
  function wireClose(){
    const btn = sheet.querySelector('.close');
    if(btn) btn.addEventListener('click', closeSheet);
  }

  // ---- "What does local mean?" ----
  function renderLocalInfo(){
    setSheetView('');
    sheet.innerHTML = plainTopBar() + `
      <h2>Local means your file stays here.</h2>
      <div class="notice">
        <p>Tidy processes supported files in your browser instead of sending them to a remote server. That keeps the file under your control and avoids remote storage or retention for that operation.</p>
      </div>
      <div class="actions"><button id="gotIt">Got it</button></div>
    `;
    wireClose();
    sheet.querySelector('#gotIt').addEventListener('click', closeSheet);
  }

  // ---- Step 1: big file warning ----
  function renderBigFileWarning(file){
    setSheetView('');
    sheet.innerHTML = topBar(file) + `
      <h2>That's a big one.</h2>
      <div class="notice warn">
        <p>This file is ${fmtSize(file.size)}. Tidy can try to process it, but large files may use a lot of memory and can make your browser slow.</p>
      </div>
      <div class="actions">
        <button class="ghost" id="pickSmaller">Choose a smaller file</button>
        <button id="continueAnyway">Continue anyway</button>
      </div>
    `;
    wireClose();
    sheet.querySelector('#pickSmaller').addEventListener('click', () => { closeSheet(); openPicker(); });
    sheet.querySelector('#continueAnyway').addEventListener('click', () => renderChoiceStep(file));
  }

  // ---- Step 2: what do you want to do ----
  function renderChoiceStep(file){
    setSheetView('');
    sheet.innerHTML = topBar(file) + `
      <h2>What do you want to do?</h2>
      <div class="choices">
        <div class="choice" id="pickCompress">
          <div class="icon">↓</div>
          <div class="txt"><strong>Compress</strong><span>Make the file smaller.</span></div>
        </div>
        <div class="choice" id="pickConvert">
          <div class="icon">⇄</div>
          <div class="txt"><strong>Convert</strong><span>Change it to another file type.</span></div>
        </div>
      </div>
    `;
    wireClose();
    sheet.querySelector('#pickCompress').addEventListener('click', () => { beginOperation(file, 'compress'); renderCompressStep(file); });
    sheet.querySelector('#pickConvert').addEventListener('click', () => { beginOperation(file, 'convert'); renderConvertStep(file); });
  }

  // ---- Compress step ----
  function suggestedTargets(size){
    const kb = 1024;
    const mb = 1024*1024;
    const floorBytes = Math.max(8*kb, Math.round(size * 0.1));
    const values = [
      Math.round(size * 0.75),
      Math.round(size * 0.50),
      Math.max(floorBytes, Math.round(size * 0.25))
    ].map(v => Math.min(v, Math.max(floorBytes, size - 1)));
    const unique = [...new Set(values)].sort((x,y)=>y-x);
    const labels = unique.length === 3 ? ['Smaller', 'Half', 'Quarter'] : ['Smaller', 'Much smaller', 'Small'];
    return unique.map((bytes,i) => ({
      label: fmtSize(bytes), bytes,
      hint: labels[i] || 'Smaller'
    }));
  }

  function renderUnsupported(file, mode){
    const verb = mode === 'compress' ? 'compress' : 'convert';
    if(activeJob && activeJob.file === file && activeJob.status === 'Waiting'){
      activeJob.cancelled = true;
      queue = queue.filter(q => q.id !== activeJob.id);
      activeJob = null;
      renderQueue();
    }
    setSheetView('');
    sheet.innerHTML = topBar(file) + `
      <h2>Tidy can't do that here yet.</h2>
      <div class="notice"><p>Tidy doesn't have a local way to ${verb} .${escapeHtml(ext(file.name) || 'this')} files yet. Rather than fake a result, it's better to say so plainly.</p></div>
      <div class="actions"><button class="ghost" id="back">Go back</button></div>
    `;
    wireClose();
    sheet.querySelector('#back').addEventListener('click', () => renderChoiceStep(file));
  }

  function renderCompressStep(file){
    const kind=fileKind(file);
    if(kind==='ambiguous-media'){
      setSheetView('');
      sheet.innerHTML=topBar(file)+`<h2>Checking the file</h2><div class="status">${mascotMarkup()}<div class="status-copy"><strong>Reading the media<span class="working-dots" aria-hidden="true"><i></i><i></i><i></i></span></strong><span>Preparing the right controls</span></div><div class="spin"></div></div>`;
      wireClose();
      resolveAmbiguousMediaKind(file).then(resolved=>{
        if(resolved==='audio') renderAudioCompressStep(file);
        else if(resolved==='video') renderVideoCompressStep(file);
        else renderUnsupported(file,'compress');
      }).catch(()=>renderUnsupported(file,'compress'));
      return;
    }
    if(isGif(file)){
      setSheetView('');
      sheet.innerHTML = topBar(file) + `
        <h2>GIFs need a little more work.</h2>
        <div class="notice"><p>Tidy doesn't yet have a reliable local GIF compressor, so it won't pretend to process this one.</p></div>
        <div class="actions"><button class="ghost" id="back">Go back</button></div>
      `;
      wireClose();
      if(activeJob && activeJob.file === file && activeJob.status === 'Waiting'){
        activeJob.cancelled = true;
        queue = queue.filter(q => q.id !== activeJob.id);
        activeJob = null;
        renderQueue();
      }
      sheet.querySelector('#back').addEventListener('click', () => renderChoiceStep(file));
      return;
    }
    if(kind==='video'){
      renderVideoCompressStep(file);
      return;
    }
    if(kind === 'audio'){
      renderAudioCompressStep(file);
      return;
    }
    if(!isImage(file)){
      renderUnsupported(file, 'compress');
      return;
    }
    if(file.size < 300*1024){
      setSheetView('');
      sheet.innerHTML = topBar(file) + `
        <h2>This one's already tidy.</h2>
        <div class="notice"><p>${escapeHtml(file.name)} is already small (${fmtSize(file.size)}). There isn't much left to squeeze out.</p></div>
        <div class="actions">
          <button class="ghost" id="back">Go back</button>
          <button id="convertInstead">Convert instead</button>
        </div>
      `;
      wireClose();
      sheet.querySelector('#back').addEventListener('click', () => renderChoiceStep(file));
      sheet.querySelector('#convertInstead').addEventListener('click', () => renderConvertStep(file));
      return;
    }

    const targets = suggestedTargets(file.size);
    let chosenBytes = targets[0].bytes;
    let selectedPreset = 'balanced';
    const presetRatio = { quick: 0.6, balanced: 0.45, smaller: 0.28 };
    // How many times Tidy re-tries encoding at a lower quality to approach the
    // target size. Quick genuinely does less work (fewer attempts, coarser
    // steps) so it finishes sooner, at the cost of a less exact result.
    const presetEncodeEffort = { quick: 1, balanced: 4, smaller: 7 };
    let effortPasses = presetEncodeEffort[selectedPreset];

    sheet.dataset.view = 'image-compress';
    sheet.innerHTML = topBar(file) + `
      <h2>Make it smaller</h2>
      <div class="proc-layout">
        <div class="proc-main">
          <div class="proc-section proc-fileinfo">
            <div class="field-row">
              <span></span>
              <span class="cur">Original <b>${fmtSize(file.size)}</b></span>
            </div>
          </div>
          <div class="proc-section proc-presets">
            <p class="control-label">Preset</p>
            ${presetMarkup(selectedPreset)}
          </div>
        </div>
        <div class="proc-side">
          <div class="proc-section proc-advanced">
            <div class="manual-head"><p class="control-label">Manual settings</p><button type="button" class="manual-toggle" id="manualToggle">Use custom</button></div>
            <div id="manualControls" class="manual-controls is-disabled" aria-disabled="true">
              <div class="size-grid">
                ${targets.map((t,i) => `<button type="button" class="size-btn" data-bytes="${t.bytes}">${t.label}<small>${t.hint}</small></button>`).join('')}
              </div>
              <div class="custom-size">
                <input type="number" min="0.1" step="0.1" id="customMb" placeholder="Custom" disabled>
                <span>MB</span>
              </div>
            </div>
          </div>
        </div>
        <div class="proc-footer">
          ${estimateMarkup()}
          <div class="actions">
            <button class="ghost" id="back">Go back</button>
            <button id="go">Make it ${fmtSize(chosenBytes)}</button>
          </div>
        </div>
      </div>
    `;
    wireClose();
    const presetBtns = [...sheet.querySelectorAll('.preset-btn')];
    const sizeBtns = [...sheet.querySelectorAll('.size-btn[data-bytes]')];
    const goBtn = sheet.querySelector('#go');
    const customInput = sheet.querySelector('#customMb');
    const manualToggle = sheet.querySelector('#manualToggle');
    const manualControls = sheet.querySelector('#manualControls');
    const sizeEstimateEl = sheet.querySelector('#presetSizeEstimate');
    const timeEstimateEl = sheet.querySelector('#presetTimeEstimate');
    let manualMode = false;

    function setManualMode(enabled){
      manualMode = !!enabled;
      manualControls.classList.toggle('is-disabled', !manualMode);
      manualControls.setAttribute('aria-disabled', manualMode ? 'false' : 'true');
      customInput.disabled = !manualMode;
      sizeBtns.forEach(b => b.disabled = !manualMode);
      manualToggle.textContent = manualMode ? 'Use preset' : 'Use custom';
      if(manualMode){
        presetBtns.forEach(x=>x.classList.remove('active'));
        effortPasses = presetEncodeEffort.balanced;
      }
    }
    function refreshEstimates(){
      sizeEstimateEl.textContent = fmtSize(Math.min(file.size, chosenBytes));
      const secondsPerPass = Math.max(0.35, file.size / (18 * MB));
      timeEstimateEl.textContent = formatDuration(secondsPerPass * effortPasses);
    }
    function applyPreset(id){
      selectedPreset = id;
      manualMode = false;
      manualControls.classList.add('is-disabled');
      manualControls.setAttribute('aria-disabled','true');
      manualToggle.textContent = 'Use custom';
      customInput.disabled = true;
      presetBtns.forEach(b => b.classList.toggle('active', b.dataset.preset === id));
      sizeBtns.forEach(x => { x.classList.remove('active'); x.disabled = true; });
      customInput.value = '';
      chosenBytes = Math.min(file.size - 1, Math.max(50*1024, file.size * presetRatio[id]));
      effortPasses = presetEncodeEffort[id];
      goBtn.textContent = `Make it ${fmtSize(chosenBytes)}`;
      refreshEstimates();
    }
    manualToggle.addEventListener('click', () => {
      if(manualMode) applyPreset('balanced');
      else setManualMode(true);
      refreshEstimates();
    });
    presetBtns.forEach(b => b.addEventListener('click', () => applyPreset(b.dataset.preset)));
    sizeBtns.forEach(b => b.addEventListener('click', () => {
      if(b.disabled) return;
      setManualMode(true);
      sizeBtns.forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      customInput.value = '';
      chosenBytes = Math.min(file.size - 1, parseFloat(b.dataset.bytes));
      effortPasses = presetEncodeEffort.balanced;
      goBtn.textContent = `Make it ${fmtSize(chosenBytes)}`;
      refreshEstimates();
    }));
    customInput.addEventListener('input', () => {
      if(customInput.disabled) return;
      presetBtns.forEach(x=>x.classList.remove('active'));
      sizeBtns.forEach(x=>x.classList.remove('active'));
      const mb = parseFloat(customInput.value);
      if(mb > 0){
        chosenBytes = Math.min(file.size - 1, mb * MB);
        effortPasses = presetEncodeEffort.balanced;
        goBtn.textContent = `Make it ${fmtSize(chosenBytes)}`;
        refreshEstimates();
      }
    });
    applyPreset(selectedPreset);

    sheet.querySelector('#back').addEventListener('click', () => renderChoiceStep(file));
    goBtn.addEventListener('click', () => {
      if(chosenBytes >= file.size * 0.97){
        renderTooAggressive(file, true);
        return;
      }
      runCompress(file, chosenBytes, effortPasses);
    });
  }

  function renderTooAggressive(file, tooBig){
    setSheetView('');
    sheet.innerHTML = topBar(file) + `
      <h2>That's a little too far.</h2>
      <div class="notice"><p>${tooBig ? "That target isn't actually smaller than the original." : "Tidy can't get it that small without losing too much quality."}</p></div>
      <div class="actions">
        <button class="ghost" id="back">Go back</button>
      </div>
    `;
    wireClose();
    sheet.querySelector('#back').addEventListener('click', () => renderCompressStep(file));
  }

  function renderWorking(file, sub, job){
    if(job) job.sub = sub;
    setSheetView('');
    sheet.innerHTML = topBar(file) + `
      <h2>Working<span id="workingDots" class="working-dots-text">.</span></h2>
      <div class="status">
        ${mascotMarkup()}
        <div class="status-copy">
          <strong>${sub || 'Working'}</strong>
          <span id="workingEta">Getting it ready</span>
        </div>
        <div class="spin"></div>
      </div>
      <div class="job-log" id="jobLog">
        <div class="job-log-body" id="jobLogBody"></div>
      </div>
      <p class="processing-note">${PROCESSING_TIME_NOTE}</p>
    `;
    wireClose();
    updateQueueStatus(file.name, 'Working');
    if(job){
      renderJobLog(job);
      startWorkingTicker(job);
    }
  }

  // Real, local browser-based compression for supported images. No simulated results.
  function runCompress(file, targetBytes, maxDepth){
    const job = beginOperationIfMissing(file, 'compress');
    renderWorking(file, 'Compressing image', job);
    jlog(job, 'Preparing image...');
    jlog(job, 'Reading source');
    jlog(job, 'Encoding');
    compressImageToTarget(file, targetBytes, maxDepth).then(result => {
      if(job && job.cancelled) return;
      if(!result || !result.blob){ renderConvertFailed(file); return; }
      jlog(job, 'Finalizing file');
      jlog(job, 'Complete');
      stopWorkingTicker(job);
      renderPreview(file, result, 'compress');
    }).catch(() => { if(!(job && job.cancelled)) renderConvertFailed(file); });
  }

  function compressImageToTarget(file, targetBytes, maxDepth){
    const depthLimit = Number.isFinite(maxDepth) ? Math.max(1, maxDepth) : 6;
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        const outType = file.type === 'image/png' ? 'image/jpeg' : file.type;
        function tryQuality(q, depth){
          canvas.toBlob(blob => {
            // Encoding genuinely failed: resolve(null) so the caller shows an
            // honest error instead of silently "succeeding" with the original,
            // unmodified file.
            if(!blob) return resolve(null);
            if((blob.size <= targetBytes || q <= 0.15 || depth >= depthLimit)){
              resolve({blob, size: blob.size, url: URL.createObjectURL(blob), newExt: outType === 'image/jpeg' ? 'jpg' : null});
            } else {
              tryQuality(Math.max(0.15, q - 0.12), depth+1);
            }
          }, outType, q);
        }
        tryQuality(0.85, 0);
      };
      // Image couldn't be decoded at all: same honest-failure treatment.
      img.onerror = () => resolve(null);
      img.src = URL.createObjectURL(file);
    });
  }

  // ---- Audio compression / conversion ----
  const AUDIO_QUALITY_BPS = { high: 160000, medium: 96000, low: 64000 };

  function pickAudioMime(){
    if(typeof MediaRecorder === 'undefined') return null;
    const candidates = [
      'audio/webm;codecs=opus', 'audio/webm',
      'audio/ogg;codecs=opus', 'audio/ogg'
    ];
    return candidates.find(m => MediaRecorder.isTypeSupported(m)) || null;
  }

  function audioRecordSupported(){
    return !!pickAudioMime() && typeof AudioContext !== 'undefined' &&
      typeof MediaStreamAudioDestinationNode !== 'undefined';
  }

  function probeAudio(file){
    return new Promise((resolve,reject) => {
      const AC = window.AudioContext || window.webkitAudioContext;
      if(!AC) return reject(new Error('audio-api'));
      const ctx = new AC();
      file.arrayBuffer().then(buf => ctx.decodeAudioData(buf)).then(audio => {
        const info = {duration: audio.duration, sampleRate: audio.sampleRate, channels: audio.numberOfChannels};
        try{ ctx.close(); }catch(e){}
        resolve(info);
      }).catch(err => { try{ ctx.close(); }catch(e){} reject(err); });
    });
  }

  function wavBlobFromAudioBuffer(audio){
    const channels = audio.numberOfChannels;
    const sampleRate = audio.sampleRate;
    const frames = audio.length;
    const bytesPerSample = 2;
    const blockAlign = channels * bytesPerSample;
    const dataSize = frames * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    const write = (offset, str) => { for(let i=0;i<str.length;i++) view.setUint8(offset+i, str.charCodeAt(i)); };
    write(0,'RIFF'); view.setUint32(4,36+dataSize,true); write(8,'WAVE'); write(12,'fmt ');
    view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,channels,true);
    view.setUint32(24,sampleRate,true); view.setUint32(28,sampleRate*blockAlign,true);
    view.setUint16(32,blockAlign,true); view.setUint16(34,16,true); write(36,'data'); view.setUint32(40,dataSize,true);
    const channelData = [];
    for(let c=0;c<channels;c++) channelData.push(audio.getChannelData(c));
    let p=44;
    for(let i=0;i<frames;i++){
      for(let c=0;c<channels;c++){
        const s=Math.max(-1,Math.min(1,channelData[c][i]));
        view.setInt16(p, s < 0 ? s*0x8000 : s*0x7fff, true); p+=2;
      }
    }
    return new Blob([buffer],{type:'audio/wav'});
  }

  function renderAudioCompressStep(file){
    if(!audioRecordSupported() || !audioCompressionMime(file)){
      renderUnsupported(file,'compress');
      return;
    }
    let selectedPreset='balanced';
    const presetQuality={ quick:'medium', balanced:'medium', smaller:'low' };
    const presetRatio={ quick:0.55, balanced:0.4, smaller:0.25 };
    const presetPasses={ quick:1, balanced:2, smaller:3 };
    sheet.dataset.view = 'audio-compress';
    sheet.innerHTML = topBar(file) + `
      <h2>Make it smaller</h2>
      <div class="proc-layout">
        <div class="proc-main">
          <div class="proc-section proc-fileinfo">
            <div class="field-row"><span></span><span class="cur">Original <b>${fmtSize(file.size)}</b></span></div>
            <div class="video-meta"><span>Audio</span><span>·</span><span>${escapeHtml(file.type || ext(file.name))}</span></div>
          </div>
          <div class="proc-section proc-presets">
            <div class="control-label">Preset</div>
            ${presetMarkup(selectedPreset)}
          </div>
        </div>
        <div class="proc-side">
          <div class="proc-section proc-advanced">
            <div class="manual-head"><div class="control-label">Manual settings</div><button type="button" class="manual-toggle" id="manualToggle">Use custom</button></div>
            <div id="manualControls" class="manual-controls is-disabled" aria-disabled="true">
              <div class="control-label">Target size</div>
              <div class="pill-row" id="audioTargets"></div>
              <div class="control-label">Quality</div>
              <div class="pill-row" id="audioQuality">
                <button type="button" class="size-btn" data-quality="high">High</button>
                <button type="button" class="size-btn" data-quality="medium">Medium</button>
                <button type="button" class="size-btn" data-quality="low">Low</button>
              </div>
            </div>
          </div>
        </div>
        <div class="proc-footer">
          ${estimateMarkup()}
          <div class="actions"><button class="ghost" id="back">Go back</button><button id="go">Compress audio</button></div>
        </div>
      </div>
    `;
    wireClose();
    const presetBtns=[...sheet.querySelectorAll('.preset-btn')];
    const targetWrap=sheet.querySelector('#audioTargets');
    const qualityBtns=[...sheet.querySelectorAll('[data-quality]')];
    const manualToggle=sheet.querySelector('#manualToggle');
    const manualControls=sheet.querySelector('#manualControls');
    const sizeEstimateEl=sheet.querySelector('#presetSizeEstimate');
    const timeEstimateEl=sheet.querySelector('#presetTimeEstimate');
    const go=sheet.querySelector('#go');
    const targets=suggestedTargets(file.size);
    let targetBytes=Math.max(64*1024, Math.min(file.size-1, file.size * presetRatio[selectedPreset]));
    let quality=presetQuality[selectedPreset];
    let maxPasses=presetPasses[selectedPreset];
    let manualMode=false;
    let durationSeconds=null;
    targetWrap.innerHTML=targets.map(t=>`<button type="button" class="size-btn" data-bytes="${t.bytes}">${t.label}<small>${t.hint}</small></button>`).join('');
    const targetBtns=[...targetWrap.querySelectorAll('[data-bytes]')];
    function setManualMode(enabled){
      manualMode=!!enabled;
      manualControls.classList.toggle('is-disabled',!manualMode);
      manualToggle.textContent=manualMode?'Use preset':'Use custom';
      targetBtns.forEach(b=>b.disabled=!manualMode);
      qualityBtns.forEach(b=>b.disabled=!manualMode);
      if(!manualMode) qualityBtns.forEach(b=>b.classList.remove('active'));
    }
    function refresh(){
      const qualityBps = AUDIO_QUALITY_BPS[quality];
      const estimatedByBitrate = durationSeconds ? Math.round((qualityBps/8)*durationSeconds + 4096) : Math.round(file.size * (quality==='high'?0.7:quality==='medium'?0.5:0.35));
      const estimated=Math.max(1024,Math.min(file.size-1,Math.min(estimatedByBitrate,targetBytes)));
      sizeEstimateEl.textContent=fmtSize(estimated);
      const factor = maxPasses === 1 ? 1 : maxPasses === 2 ? 1.75 : 2.5;
      timeEstimateEl.textContent=durationSeconds ? formatDuration(Math.max(1,durationSeconds*factor)) : 'Estimating...';
    }
    function applyPreset(id){
      selectedPreset=id;
      setManualMode(false);
      presetBtns.forEach(b=>b.classList.toggle('active',b.dataset.preset===id));
      targetBtns.forEach(b=>b.classList.remove('active'));
      qualityBtns.forEach(b=>b.classList.remove('active'));
      targetBytes=Math.max(64*1024,Math.min(file.size-1,file.size*presetRatio[id]));
      quality=presetQuality[id];
      maxPasses=presetPasses[id];
      refresh();
    }
    presetBtns.forEach(b=>b.addEventListener('click',()=>applyPreset(b.dataset.preset)));
    manualToggle.addEventListener('click',()=>{ if(manualMode) applyPreset('balanced'); else setManualMode(true); refresh(); });
    targetBtns.forEach(b=>b.addEventListener('click',()=>{if(b.disabled)return;setManualMode(true);presetBtns.forEach(x=>x.classList.remove('active'));targetBtns.forEach(x=>x.classList.remove('active'));b.classList.add('active');targetBytes=Math.min(file.size-1,parseFloat(b.dataset.bytes));maxPasses=3;refresh();}));
    qualityBtns.forEach(b=>b.addEventListener('click',()=>{if(b.disabled)return;setManualMode(true);presetBtns.forEach(x=>x.classList.remove('active'));qualityBtns.forEach(x=>x.classList.remove('active'));b.classList.add('active');quality=b.dataset.quality;maxPasses=3;refresh();}));
    sheet.querySelector('#back').addEventListener('click',()=>renderChoiceStep(file));
    applyPreset(selectedPreset);
    probeAudio(file).then(info=>{durationSeconds=info.duration;refresh();}).catch(()=>{timeEstimateEl.textContent='-';});
    go.addEventListener('click',()=>runAudioCompress(file,{targetBytes,quality,maxPasses}));
  }

  async function decodeAudio(file){
    const AC=window.AudioContext||window.webkitAudioContext;
    if(!AC) throw new Error('audio-api');
    const ctx=new AC();
    try{return await ctx.decodeAudioData(await file.arrayBuffer());}finally{try{ctx.close()}catch(e){}}
  }

  async function runAudioCompress(file,settings){
    const job=beginOperationIfMissing(file,'compress');
    renderWorking(file,'Compressing audio',job);
    jlog(job,'Preparing audio');
    try{
      const audio=await decodeAudio(file);
      if(job&&job.cancelled) return;
      jlog(job,'Reading source');
      let bitrate=settings.quality==='high'?160000:settings.quality==='medium'?96000:64000;
      if(audio.duration>0){
        const sourceBps=(file.size*8)/audio.duration;
        const targetBps=settings.targetBytes ? Math.round(Math.max(24000,(settings.targetBytes*8)/audio.duration*0.94)) : sourceBps;
        bitrate=Math.min(bitrate, Math.max(24000, Math.round(sourceBps*0.9)), targetBps);
      }
      let result=null;
      const passes=Math.max(1,settings.maxPasses||1);
      for(let pass=1;pass<=passes;pass++){
        if(job&&job.cancelled) return;
        if(pass>1) jlog(job,'Adjusting bitrate');
        result=await recordAudio(audio,bitrate,job,audioCompressionMime(file));
        if(!result) throw new Error('audio encode');
        if(!settings.targetBytes || result.size<=settings.targetBytes*1.08 || pass===passes) break;
        const factor=Math.max(0.45,Math.min(0.9,settings.targetBytes/result.size));
        bitrate=Math.max(24000,Math.round(bitrate*factor));
      }
      if(job&&job.cancelled) return;
      jlog(job,'Writing output');
      jlog(job,'Complete');
      stopWorkingTicker(job);
      if(fileKind(file)==='audio' && result) result.newExt = ext(file.name) || result.newExt;
      renderPreview(file,result,'compress');
    }catch(e){
      if(job&&job.cancelled)return;
      jlog(job,'Failed'); stopWorkingTicker(job); renderAudioProcessFailed(file);
    }
  }

  function recordAudio(audio, bitrate, job, requestedMime){
    return new Promise((resolve,reject)=>{
      const AC=window.AudioContext||window.webkitAudioContext;
      const ctx=new AC();
      const source=ctx.createBufferSource();
      const dest=ctx.createMediaStreamDestination();
      source.buffer=audio; source.connect(dest);
      const mime=requestedMime || pickAudioMime();
      if(!mime){try{ctx.close()}catch(e){};return reject(new Error('no-audio-mime'));}
      let rec;
      try{rec=new MediaRecorder(dest.stream,{mimeType:mime,audioBitsPerSecond:bitrate});}
      catch(e){try{ctx.close()}catch(_){};return reject(e);}
      const chunks=[];
      let done=false;
      const finish=(value,error)=>{if(done)return;done=true;try{ctx.close()}catch(e){};if(error)reject(error);else resolve(value);};
      if(job) job.cancel=()=>{job.cancelled=true;try{if(rec.state!=='inactive')rec.stop()}catch(e){};finish(null);};
      rec.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data)};
      rec.onerror=()=>finish(null,new Error('audio encode'));
      rec.onstop=()=>{if(job&&job.cancelled)return finish(null);const blob=new Blob(chunks,{type:mime});if(!blob.size)return finish(null,new Error('empty'));const url=URL.createObjectURL(blob);finish({blob,size:blob.size,url,newExt:mime.includes('ogg')?'ogg':'webm',isAudio:true});};
      source.onended=()=>{if(rec.state!=='inactive')rec.stop();};
      try{
        const startedAt=ctx.currentTime;
        if(job) job.eta=()=>({elapsed:ctx.currentTime-startedAt, total:audio.duration});
        rec.start(200);source.start(0);
        jlog(job,'Encoding');
      }catch(e){finish(null,e);}
    });
  }

  function renderAudioProcessFailed(file){
    if(activeJob&&activeJob.file===file&&activeJob.status!=='Done'){ updateJobStatus(activeJob,'Failed'); activeJob=null; }
    setSheetView('');
    sheet.innerHTML=topBar(file)+`<h2>That didn't work.</h2><div class="notice"><p>Tidy couldn't process this audio file in your browser. Nothing was uploaded or changed.</p></div><div class="actions"><button class="ghost" id="back">Go back</button></div>`;
    wireClose(); sheet.querySelector('#back').addEventListener('click',()=>renderChoiceStep(file));
  }

  function audioOutputOptions(){
    const native = audioRecordSupported();
    const nativeMime = native ? pickAudioMime() : null;
    return [
      {fmt:'mp3', available:false, hint:'Needs an audio encoder'},
      {fmt:'wav', available:true},
      {fmt:'flac', available:false, hint:'Needs an audio encoder'},
      {fmt:'m4a', available:false, hint:'Browser support varies'},
      {fmt:'aac', available:false, hint:'Browser support varies'},
      {fmt:'ogg', available:native && !!nativeMime && nativeMime.includes('ogg')},
      {fmt:'opus', available:native && !!nativeMime && nativeMime.includes('ogg'), hint:'Uses Ogg/Opus when available'},
      {fmt:'webm', available:native && !!nativeMime && nativeMime.includes('webm')},
      {fmt:'aiff', available:false, hint:'Needs an audio encoder'}
    ];
  }
  function renderAudioConvertStep(file){
    const current=ext(file.name);
    const options=audioOutputOptions();
    sheet.dataset.view = 'audio-convert';
    sheet.innerHTML=topBar(file)+`<h2>Convert to</h2><div class="field-row"><span></span><span class="cur">Currently <b>.${escapeHtml(current||'audio')}</b></span></div><div class="fmt-grid audio-formats">${options.map(o=>`<button type="button" class="fmt-btn ${o.available?'':'unavailable'}" data-afmt="${o.fmt}" ${o.available?'':'disabled'} title="${escapeHtml(o.hint||'Not available in this browser')}">.${o.fmt}</button>`).join('')}</div><div class="actions"><button class="ghost" id="back">Go back</button><button id="go" disabled>Choose a format</button></div>`;
    wireClose();
    const btns=[...sheet.querySelectorAll('[data-afmt]')], go=sheet.querySelector('#go'); let chosen=null;
    btns.forEach(b=>b.addEventListener('click',()=>{const f=b.dataset.afmt;if(b.disabled)return;if(f===current){renderAlreadyFormat(file,f);return;}btns.forEach(x=>x.classList.remove('active'));b.classList.add('active');chosen=f;go.disabled=false;go.textContent=`Convert to .${f}`;}));
    sheet.querySelector('#back').addEventListener('click',()=>renderChoiceStep(file));
    go.addEventListener('click',()=>runAudioConvert(file,chosen));
  }

  function runAudioConvert(file,targetFmt){
    const job=beginOperationIfMissing(file,'convert');
    renderWorking(file,'Converting audio',job);
    jlog(job,'Preparing audio...');
    decodeAudio(file).then(audio=>{
      if(job&&job.cancelled) return;
      jlog(job,'Reading source');
      if(targetFmt==='wav'){ jlog(job,'Encoding'); return {blob:wavBlobFromAudioBuffer(audio), newExt:'wav', size:0, url:null, isAudio:true}; }
      return recordAudio(audio,128000,job).then(r=>({...r,newExt:targetFmt}));
    }).then(result=>{
      if(job&&job.cancelled)return;
      if(!result)throw new Error('audio encode');
      result.size=result.size||result.blob.size;
      result.url=result.url||URL.createObjectURL(result.blob);
      jlog(job,'Finalizing file');
      jlog(job,'Complete');
      stopWorkingTicker(job);
      renderPreview(file,result,'convert');
    }).catch(()=>{ if(!(job&&job.cancelled)){ jlog(job,'Failed'); stopWorkingTicker(job); renderAudioProcessFailed(file); } });
  }

  // ---- Video compression ----
  const VIDEO_QUALITY = { high: 0.09, medium: 0.05, low: 0.025 };
  const VIDEO_MIN_BPP = 0.012;
  const VIDEO_AUDIO_BPS = 96000;
  const VIDEO_OVERHEAD_BYTES = 4000;

  function pickVideoMime(preferred){
    const candidates = preferred === 'mp4' ? [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4'
    ] : preferred === 'webm' ? [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ] : [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4'
    ];
    return candidates.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || null;
  }

  function fpsOptions(originalFps){
    const opts = [{ value: originalFps || null, label: originalFps ? `Original · ${originalFps} fps` : 'Original' }];
    const round = originalFps ? Math.round(originalFps) : null;
    if(round){
      if(round > 30) opts.push({ value: 30, label: '30 fps' });
      if(round > 24) opts.push({ value: 24, label: '24 fps' });
    } else {
      // Unknown source fps: still offer sensible caps
      opts.push({ value: 30, label: '30 fps' });
      opts.push({ value: 24, label: '24 fps' });
    }
    return opts;
  }

  function detectFps(video){
    return new Promise(resolve => {
      if(!('requestVideoFrameCallback' in video)){ resolve(null); return; }
      const samples = [];
      let handle;
      const finish = (val) => {
        try{ video.pause(); video.currentTime = 0; }catch(e){}
        resolve(val);
      };
      const onFrame = (now, meta) => {
        samples.push(meta.mediaTime);
        if(samples.length >= 12){
          const span = samples[samples.length-1] - samples[0];
          const fps = span > 0 ? Math.round((samples.length-1) / span) : null;
          finish(fps && fps > 0 && fps < 240 ? fps : null);
          return;
        }
        handle = video.requestVideoFrameCallback(onFrame);
      };
      video.muted = true;
      video.play().then(() => {
        handle = video.requestVideoFrameCallback(onFrame);
      }).catch(() => finish(null));
      setTimeout(() => { if(samples.length < 2) finish(null); }, 1500);
    });
  }

  function probeVideo(file){
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const video = document.createElement('video');
      video.preload = 'auto';
      video.muted = true;
      video.defaultMuted = true;
      video.volume = 0;
      video.playsInline = true;
      video.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px';
      video.src = url;
      document.body.appendChild(video);

      video.addEventListener('error', () => {
        video.remove();
        URL.revokeObjectURL(url);
        reject(new Error('unreadable'));
      });

      video.addEventListener('loadedmetadata', async () => {
        const width = video.videoWidth, height = video.videoHeight, duration = video.duration;
        if(!width || !height || !isFinite(duration) || duration <= 0){
          video.remove();
          URL.revokeObjectURL(url);
          reject(new Error('unreadable'));
          return;
        }
        let hasAudio = false;
        try{
          const s = video.captureStream ? video.captureStream() : (video.mozCaptureStream ? video.mozCaptureStream() : null);
          if(s) hasAudio = s.getAudioTracks().length > 0;
        }catch(e){}
        const fps = await detectFps(video);
        video.remove();
        URL.revokeObjectURL(url);
        resolve({ width, height, duration, fps, hasAudio });
      });
    });
  }

  function estimateVideoBytes({ width, height, fps, duration, bpp, hasAudio }){
    const effectiveFps = fps || 30;
    const videoBits = bpp * width * height * effectiveFps * duration;
    const audioBits = hasAudio ? VIDEO_AUDIO_BPS * duration : 0;
    return Math.round((videoBits + audioBits) / 8) + VIDEO_OVERHEAD_BYTES;
  }

  function renderVideoProbeFailed(file){
    if(activeJob && activeJob.file === file && !activeJob.cancelled){ updateQueueStatus(file.name, 'Failed'); activeJob = null; }
    setSheetView('');
    sheet.innerHTML = topBar(file) + `
      <h2>Tidy can't read this video.</h2>
      <div class="notice"><p>Your browser couldn't open .${escapeHtml(ext(file.name) || 'this')} for local processing, so Tidy won't pretend to compress it.</p></div>
      <div class="actions"><button class="ghost" id="back">Go back</button></div>
    `;
    wireClose();
    sheet.querySelector('#back').addEventListener('click', () => renderChoiceStep(file));
  }

  function videoCompressionMime(file){
    const source = ext(file.name);
    if(source === 'mp4' || source === 'm4v') return pickVideoMime('mp4');
    if(['webm'].includes(source)) return pickVideoMime('webm');
    return null;
  }
  function audioCompressionMime(file){
    const source = ext(file.name);
    const mime = pickAudioMime();
    if(!mime) return null;
    if(source === 'webm' && mime.includes('webm')) return mime;
    if(['ogg','oga','opus'].includes(source) && mime.includes('ogg')) return mime;
    return null;
  }
  function compressionFormatMessage(file){
    const kind=fileKind(file);
    const type=kind==='video' ? 'video' : kind==='audio' ? 'audio' : 'file';
    return `Tidy can only compress this ${type} in this browser when it can keep the original format. Use Convert to change formats.`;
  }

  function renderVideoCompressStep(file){
    const compressionMime = videoCompressionMime(file);
    if(!videoCaptureSupported() || !compressionMime){
      // Same cleanup as the other "can't do that here" branches: don't leave
      // an orphaned "Waiting" row stuck in the queue forever.
      if(activeJob && activeJob.file === file && activeJob.status === 'Waiting'){
        activeJob.cancelled = true;
        queue = queue.filter(q => q.id !== activeJob.id);
        activeJob = null;
        renderQueue();
      }
      setSheetView('');
      sheet.innerHTML = topBar(file) + `
        <h2>Tidy can't do that here yet.</h2>
        <div class="notice"><p>${videoCaptureSupported() ? escapeHtml(compressionFormatMessage(file)) : "This browser doesn't support local video processing, so Tidy won't fake a result. Try a recent version of Chrome, Edge, or Firefox."}</p></div>
        <div class="actions"><button class="ghost" id="back">Go back</button></div>
      `;
      wireClose();
      sheet.querySelector('#back').addEventListener('click', () => renderChoiceStep(file));
      return;
    }

    setSheetView('');
    sheet.innerHTML = topBar(file) + `
      <h2>Reading the video</h2>
      <div class="status">
        ${mascotMarkup()}
        <div class="status-copy">
          <strong>Checking resolution, length, and frame rate<span class="working-dots" aria-hidden="true"><i></i><i></i><i></i></span></strong>
          <span>Getting it ready</span>
        </div>
        <div class="spin"></div>
      </div>
    `;
    wireClose();

    probeVideo(file).then(info => renderVideoControls(file, info)).catch(() => renderVideoProbeFailed(file));
  }

  function renderVideoControls(file, info){
    const { width, height, duration, fps, hasAudio } = info;
    const targets = suggestedTargets(file.size);
    const fpsOpts = fpsOptions(fps);

    const state = {
      targetBytes: null,          // set when user picks/types a target size
      fps: fpsOpts[0].value,      // default: keep original
      quality: 'high',            // default: preserve quality
      maxPasses: 3                // how many times Tidy may re-encode to try to hit a target size
    };
    let selectedPreset = 'balanced';

    // A quality preset should never intentionally exceed the source's own bit density,
    // so "Compress" doesn't produce a file bigger than what you started with.
    const sourceBpp = (file.size * 8) / (width * height * (fps || 30) * duration);

    function currentBpp(){
      if(state.targetBytes){
        const effectiveFps = state.fps || fps || 30;
        const bits = Math.max(0, (state.targetBytes - VIDEO_OVERHEAD_BYTES) * 8 - (hasAudio ? VIDEO_AUDIO_BPS * duration : 0));
        const bpp = bits / (width * height * effectiveFps * duration);
        return Math.max(0.004, bpp);
      }
      return Math.min(VIDEO_QUALITY[state.quality], sourceBpp > 0 ? sourceBpp : VIDEO_QUALITY[state.quality]);
    }

    function currentEstimate(){
      return estimateVideoBytes({ width, height, fps: state.fps, duration, bpp: currentBpp(), hasAudio });
    }

    function durationLabel(s){
      const m = Math.floor(s/60), sec = Math.round(s%60);
      return `${m}:${String(sec).padStart(2,'0')}`;
    }

    sheet.dataset.view = 'video-compress';
    sheet.innerHTML = topBar(file) + `
      <h2>Make it smaller</h2>
      <div class="proc-layout">
        <div class="proc-main">
          <div class="proc-section proc-fileinfo">
            <div class="video-meta">
              <span><b>${width}×${height}</b></span>
              <span>·</span>
              <span><b>${fps ? fps + ' fps' : 'fps unknown'}</b></span>
              <span>·</span>
              <span><b>${durationLabel(duration)}</b></span>
              <span>·</span>
              <span>Original <b>${fmtSize(file.size)}</b></span>
            </div>
          </div>
          <div class="proc-section proc-presets">
            <p class="control-label">Preset</p>
            ${presetMarkup(selectedPreset)}
          </div>
        </div>
        <div class="proc-side">
          <div class="proc-section proc-advanced">
            <div class="manual-head"><p class="control-label">Manual settings</p><button type="button" class="manual-toggle" id="manualToggle">Use custom</button></div>
            <div id="manualControls" class="manual-controls is-disabled" aria-disabled="true">
              <p class="control-label">Target size</p>
              <div class="size-grid">
                ${targets.map((t,i) => `<button type="button" class="size-btn" data-bytes="${t.bytes}">${t.label}<small>${t.hint}</small></button>`).join('')}
              </div>
              <div class="custom-size">
                <input type="number" min="0.1" step="0.1" id="customMb" placeholder="Custom" disabled>
                <span>MB</span>
              </div>

              <p class="control-label">Frame rate</p>
              <p class="control-hint">Lower frame rates can reduce file size by storing fewer frames.</p>
              <div class="pill-row" id="fpsRow">
                ${fpsOpts.map((o,i) => `<button type="button" class="size-btn ${i===0?'active':''}" data-fps="${o.value ?? ''}">${o.label}</button>`).join('')}
              </div>

              <p class="control-label">Quality</p>
              <div class="pill-row" id="qualityRow">
                <button type="button" class="size-btn active" data-quality="high">High</button>
                <button type="button" class="size-btn" data-quality="medium">Medium</button>
                <button type="button" class="size-btn" data-quality="low">Low</button>
              </div>
              <div id="qualityWarning"></div>
            </div>
          </div>
        </div>
        <div class="proc-footer">
          ${estimateMarkup()}
          <div class="actions">
            <button class="ghost" id="back">Go back</button>
            <button id="go">Compress video</button>
          </div>
        </div>
      </div>
    `;
    wireClose();

    const presetBtns = [...sheet.querySelectorAll('.preset-btn')];
    const sizeBtns = [...sheet.querySelectorAll('.size-btn[data-bytes]')];
    const fpsBtns = [...sheet.querySelectorAll('.size-btn[data-fps]')];
    const qualityBtns = [...sheet.querySelectorAll('.size-btn[data-quality]')];
    const customInput = sheet.querySelector('#customMb');
    const estimateEl = sheet.querySelector('#presetSizeEstimate');
    const timeEstimateEl = sheet.querySelector('#presetTimeEstimate');
    const warningEl = sheet.querySelector('#qualityWarning');
    const goBtn = sheet.querySelector('#go');
    const manualToggle = sheet.querySelector('#manualToggle');
    const manualControls = sheet.querySelector('#manualControls');
    let manualMode = false;

    function refresh(){
      const bpp = currentBpp();
      const estimate = Math.min(file.size, currentEstimate());
      estimateEl.textContent = fmtSize(estimate);
      // Video re-encoding plays through in real time, and Tidy may re-encode
      // more than once to try to hit a target size - each attempt takes
      // roughly as long as the clip itself.
      timeEstimateEl.textContent = formatDuration(Math.max(1, duration * state.maxPasses));
      warningEl.innerHTML = (state.targetBytes && bpp <= VIDEO_MIN_BPP)
        ? `<div class="quality-note">Getting this small will visibly reduce quality.</div>`
        : '';
      const disabled = !manualMode;
      manualControls.classList.toggle('is-disabled', disabled);
      manualControls.setAttribute('aria-disabled', disabled ? 'true' : 'false');
      sizeBtns.forEach(b => b.disabled = disabled);
      fpsBtns.forEach(b => b.disabled = disabled);
      qualityBtns.forEach(b => b.disabled = disabled);
    }
    function clearManualSelection(){
      sizeBtns.forEach(x=>x.classList.remove('active'));
      qualityBtns.forEach(x=>x.classList.remove('active'));
    }
    function applyPreset(id){
      selectedPreset = id;
      manualMode = false;
      presetBtns.forEach(b => b.classList.toggle('active', b.dataset.preset === id));
      clearManualSelection();
      customInput.value = '';
      manualToggle.textContent = 'Use custom';
      if(id === 'quick'){ state.targetBytes = Math.max(64*1024, Math.min(file.size-1, file.size*0.65)); state.quality = 'medium'; state.maxPasses = 1; }
      else if(id === 'smaller'){ state.targetBytes = Math.max(64*1024, Math.min(file.size-1, file.size*0.30)); state.quality = 'low'; state.maxPasses = 3; }
      else { state.targetBytes = Math.max(64*1024, Math.min(file.size-1, file.size*0.45)); state.quality = 'medium'; state.maxPasses = 2; }
      refresh();
    }
    function setManualMode(enabled){
      manualMode=!!enabled;
      if(manualMode) presetBtns.forEach(x=>x.classList.remove('active'));
      manualToggle.textContent=manualMode?'Use preset':'Use custom';
      refresh();
    }
    manualToggle.addEventListener('click',()=>{ if(manualMode) applyPreset('balanced'); else setManualMode(true); });
    presetBtns.forEach(b => b.addEventListener('click', () => applyPreset(b.dataset.preset)));
    sizeBtns.forEach(b => b.addEventListener('click', () => {
      if(b.disabled) return;
      setManualMode(true);
      presetBtns.forEach(x=>x.classList.remove('active'));
      sizeBtns.forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      customInput.value = '';
      state.targetBytes = parseFloat(b.dataset.bytes);
      state.maxPasses = 3;
      refresh();
    }));
    customInput.addEventListener('input', () => {
      if(customInput.disabled) return;
      setManualMode(true);
      presetBtns.forEach(x=>x.classList.remove('active'));
      sizeBtns.forEach(x=>x.classList.remove('active'));
      const mb = parseFloat(customInput.value);
      state.targetBytes = mb > 0 ? mb * MB : null;
      state.maxPasses = 3;
      refresh();
    });
    fpsBtns.forEach(b => b.addEventListener('click', () => {
      if(b.disabled) return;
      setManualMode(true);
      fpsBtns.forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      state.fps = b.dataset.fps ? parseInt(b.dataset.fps, 10) : null;
      refresh();
    }));
    qualityBtns.forEach(b => b.addEventListener('click', () => {
      if(b.disabled) return;
      setManualMode(true);
      presetBtns.forEach(x=>x.classList.remove('active'));
      qualityBtns.forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      state.quality = b.dataset.quality;
      refresh();
    }));
    applyPreset(selectedPreset);

    sheet.querySelector('#back').addEventListener('click', () => renderChoiceStep(file));
    goBtn.addEventListener('click', () => {
      runVideoCompress(file, { width, height, duration, hasAudio, fps: state.fps, bpp: currentBpp(), targetBytes: state.targetBytes, maxPasses: state.maxPasses, outputMime: videoCompressionMime(file) });
    });
  }

  function runVideoCompress(file, settings){
    const job = beginOperationIfMissing(file, 'compress');
    renderWorking(file, 'Re-encoding video', job);
    jlog(job, 'Preparing video...');
    (async () => {
      let result = null;
      let settingsPass = {...settings};
      const maxPasses = settings.targetBytes ? (settings.maxPasses || 3) : 1;
      for(let pass = 1; pass <= maxPasses; pass++){
        if(job && job.cancelled) return;
        jlog(job, pass === 1 ? 'Reading source' : 'Adjusting bitrate');
        result = await compressVideo(file, {...settingsPass, job});
        if(!result) break;
        if(!settings.targetBytes || result.size <= settings.targetBytes * 1.08) break;
        const factor = Math.max(0.35, Math.min(0.92, settings.targetBytes / result.size));
        settingsPass = {...settingsPass, bpp: Math.max(0.004, settingsPass.bpp * factor)};
      }
      if(job && job.cancelled) return;
      if(!result){
        jlog(job, 'Failed');
        stopWorkingTicker(job);
        renderVideoProcessFailed(file);
        return;
      }
      jlog(job, 'Finalizing file');
      jlog(job, 'Complete');
      stopWorkingTicker(job);
      renderPreview(file, result, 'compress');
    })().catch(() => {
      if(job && job.cancelled) return;
      jlog(job, 'Failed');
      stopWorkingTicker(job);
      renderVideoProcessFailed(file);
    });
  }

  function renderVideoProcessFailed(file){
    const failedJob = activeJob && activeJob.file === file ? activeJob : null;
    if(failedJob){ updateJobStatus(failedJob,'Failed'); activeJob=null; }
    setSheetView('');
    sheet.innerHTML = topBar(file) + `
      <h2>That didn't work.</h2>
      <div class="notice"><p>Tidy couldn't process this video in your browser. Nothing was uploaded or changed.</p></div>
      <div class="actions"><button class="ghost" id="back">Go back</button></div>
    `;
    wireClose();
    sheet.querySelector('#back').addEventListener('click', () => renderChoiceStep(file));
  }

  function compressVideo(file, { width, height, duration, hasAudio, fps, bpp, job, outputMime }){
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const video = document.createElement('video');
      video.preload = 'auto';
      video.playsInline = true;
      video.muted = true;
      video.volume = 0;
      video.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px';
      video.src = url;
      document.body.appendChild(video);

      let recorder = null;
      let sourceStream = null;
      let raf = 0;
      let settled = false;
      const cleanup = () => {
        if(raf) cancelAnimationFrame(raf);
        try{ video.pause(); }catch(e){}
        try{ if(sourceStream) sourceStream.getTracks().forEach(t => t.stop()); }catch(e){}
        video.remove();
        URL.revokeObjectURL(url);
      };
      const finish = (value, error) => {
        if(settled) return;
        settled = true;
        cleanup();
        if(error) reject(error); else resolve(value);
      };

      if(job){
        job.cancel = () => {
          job.cancelled = true;
          try{ if(recorder && recorder.state !== 'inactive') recorder.stop(); }catch(e){}
          finish(null);
        };
      }

      video.addEventListener('error', () => finish(null, new Error('playback failed')), { once:true });
      video.addEventListener('loadedmetadata', () => {
        if(job && job.cancelled){ finish(null); return; }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if(!ctx || !canvas.captureStream){ finish(null); return; }
        const outFps = Math.max(1, fps || 30);
        const stream = canvas.captureStream(outFps);
        sourceStream = stream;

        if(hasAudio){
          try{
            const src = video.captureStream ? video.captureStream() : (video.mozCaptureStream ? video.mozCaptureStream() : null);
            const at = src && src.getAudioTracks()[0];
            if(at) stream.addTrack(at);
          }catch(e){}
        }

        const mime = outputMime || pickVideoMime();
        if(!mime){ finish(null); return; }
        const videoBitsPerSecond = Math.max(80000, Math.round(bpp * width * height * outFps));
        try{
          recorder = new MediaRecorder(stream, {
            mimeType: mime,
            videoBitsPerSecond,
            audioBitsPerSecond: hasAudio ? VIDEO_AUDIO_BPS : undefined
          });
        }catch(e){ finish(null); return; }

        const chunks = [];
        recorder.ondataavailable = e => { if(e.data && e.data.size) chunks.push(e.data); };
        recorder.onerror = () => finish(null, new Error('encoding failed'));
        recorder.onstop = () => {
          if(job && job.cancelled){ finish(null); return; }
          const blob = new Blob(chunks, {type:mime});
          if(!blob.size){ finish(null); return; }
          const outExt = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
          const resultUrl = URL.createObjectURL(blob);
          // finish() revokes only the source URL, so preserve the result URL here.
          if(raf) cancelAnimationFrame(raf);
          try{ video.pause(); }catch(e){}
          try{ if(sourceStream) sourceStream.getTracks().forEach(t => t.stop()); }catch(e){}
          video.remove();
          URL.revokeObjectURL(url);
          settled = true;
          resolve({blob, size:blob.size, url:resultUrl, newExt:outExt, isVideo:true});
        };

        function draw(){
          if(settled || (job && job.cancelled) || video.ended || video.paused) return;
          try{ ctx.drawImage(video,0,0,width,height); }catch(e){ finish(null, e); return; }
          raf=requestAnimationFrame(draw);
        }
        video.addEventListener('ended', () => {
          if(job && job.cancelled){ finish(null); return; }
          if(recorder && recorder.state !== 'inactive') recorder.stop();
        }, {once:true});
        video.addEventListener('play', () => {
          if(job && job.cancelled){ finish(null); return; }
          try{
            recorder.start(200); draw();
            if(job) job.eta = () => ({ elapsed: video.currentTime, total: duration });
            jlog(job, 'Encoding');
          }catch(e){ finish(null,e); }
        }, {once:true});
        video.currentTime=0;
        video.play().catch(() => finish(null,new Error('playback failed')));
      }, {once:true});
    });
  }

  // ---- Convert step ----
  const FORMATS = ['jpg','png','webp'];
  function formatFromType(type){
    if(type === 'image/jpeg') return 'jpg';
    if(type === 'image/png') return 'png';
    if(type === 'image/webp') return 'webp';
    return '';
  }

  function renderConvertStep(file){
    const kind=fileKind(file);
    if(kind==='ambiguous-media'){
      setSheetView('');
      sheet.innerHTML=topBar(file)+`<h2>Checking the file</h2><div class="status">${mascotMarkup()}<div class="status-copy"><strong>Reading the media<span class="working-dots" aria-hidden="true"><i></i><i></i><i></i></span></strong><span>Preparing the right conversion options</span></div><div class="spin"></div></div>`;
      wireClose();
      resolveAmbiguousMediaKind(file).then(resolved=>{
        if(resolved==='audio') renderAudioConvertStep(file);
        else if(resolved==='video') renderVideoConvertStep(file);
        else renderUnsupported(file,'convert');
      }).catch(()=>renderUnsupported(file,'convert'));
      return;
    }
    if(kind==='video'){
      renderVideoConvertStep(file);
      return;
    }
    if(kind === 'audio'){
      renderAudioConvertStep(file);
      return;
    }
    if(isGif(file)){
      renderUnsupported(file, 'convert');
      return;
    }
    if(!isImage(file)){
      renderUnsupported(file, 'convert');
      return;
    }
    const currentFmt = formatFromType(file.type);

    setSheetView('convert');
    sheet.innerHTML = topBar(file) + `
      <h2>Convert to</h2>
      <div class="field-row"><span></span><span class="cur">Currently <b>.${currentFmt}</b></span></div>
      <div class="fmt-grid">
        ${FORMATS.map(f => `<div class="fmt-btn ${f===currentFmt?'active':''}" data-fmt="${f}">.${f}</div>`).join('')}
      </div>
      <div class="actions">
        <button class="ghost" id="back">Go back</button>
        <button id="go" disabled>Choose a format</button>
      </div>
    `;
    wireClose();
    const btns = [...sheet.querySelectorAll('.fmt-btn')];
    const goBtn = sheet.querySelector('#go');
    let chosen = null;
    btns.forEach(b => b.addEventListener('click', () => {
      const f = b.dataset.fmt;
      if(f === currentFmt){
        renderAlreadyFormat(file, f);
        return;
      }
      btns.forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      chosen = f;
      goBtn.disabled = false;
      goBtn.textContent = `Convert to .${f}`;
    }));
    sheet.querySelector('#back').addEventListener('click', () => renderChoiceStep(file));
    goBtn.addEventListener('click', () => { if(chosen) runConvert(file, chosen); });
  }


  function renderVideoConvertStep(file){
    const currentFmt = ext(file.name) || (file.type.split('/')[1] || '').toLowerCase();
    const candidates = [
      {fmt:'mp4', mime:'video/mp4'},
      {fmt:'webm', mime:'video/webm'},
      {fmt:'mov', mime:'video/mp4', unavailable:true},
      {fmt:'mkv', mime:'video/webm', unavailable:true},
      {fmt:'ogv', mime:'video/ogg', unavailable:true},
      {fmt:'avi', mime:'video/x-msvideo', unavailable:true},
      {fmt:'m4v', mime:'video/mp4', unavailable:true}
    ];
    const options = candidates.map(o => ({...o, available: !o.unavailable && !!window.MediaRecorder && MediaRecorder.isTypeSupported(o.mime)}));
    if(!options.some(o=>o.available)){
      renderUnsupported(file, 'convert');
      return;
    }
    setSheetView('video-convert');
    sheet.innerHTML = topBar(file) + `
      <h2>Convert to</h2>
      <div class="field-row"><span></span><span class="cur">Currently <b>.${escapeHtml(currentFmt || 'video')}</b></span></div>
      <div class="fmt-grid">
        ${options.map(o => `<button type="button" class="fmt-btn ${o.available?'':'unavailable'}" data-vfmt="${o.fmt}" ${o.available?'':'disabled'} title="${o.available?'':'Not available in this browser'}">.${o.fmt}</button>`).join('')}
      </div>
      <div class="actions">
        <button class="ghost" id="back">Go back</button>
        <button id="go" disabled>Choose a format</button>
      </div>
    `;
    wireClose();
    const btns=[...sheet.querySelectorAll('[data-vfmt]')], go=sheet.querySelector('#go');
    let chosen=null;
    btns.forEach(b=>b.addEventListener('click',()=>{
      const f=b.dataset.vfmt;
      if(b.disabled) return;
      if(f===currentFmt){ renderAlreadyFormat(file,f); return; }
      btns.forEach(x=>x.classList.remove('active')); b.classList.add('active'); chosen=f;
      go.disabled=false; go.textContent=`Convert to .${f}`;
    }));
    sheet.querySelector('#back').addEventListener('click',()=>renderChoiceStep(file));
    go.addEventListener('click',()=>{
      const job = beginOperationIfMissing(file,'convert');
      runVideoConvert(file, chosen, job);
    });
  }

  function beginOperationIfMissing(file, mode){
    if(!(activeJob && activeJob.file===file)) beginOperation(file, mode);
    return activeJob && activeJob.file === file ? activeJob : null;
  }

  function runVideoConvert(file, targetFmt, job){
    renderWorking(file, 'Converting video', job);
    jlog(job, 'Preparing video...');
    probeVideo(file).then(info => {
      if(job && job.cancelled) return;
      jlog(job, 'Reading source');
      const sourceBpp = (file.size * 8) / (info.width * info.height * (info.fps || 30) * info.duration);
      const outputMime = targetFmt === 'mp4' ? pickVideoMime('mp4') : pickVideoMime('webm');
      return compressVideo(file, {
        width: info.width, height: info.height, duration: info.duration, hasAudio: info.hasAudio,
        fps: info.fps || 30, bpp: Math.min(VIDEO_QUALITY.high, Math.max(0.004, sourceBpp)),
        outputMime, job
      }).then(result => {
        if(job && job.cancelled) return;
        if(!result) throw new Error('encode');
        // If the browser selected a different container than requested, reflect reality.
        const actualExt = result.newExt;
        jlog(job, 'Finalizing file');
        jlog(job, 'Complete');
        stopWorkingTicker(job);
        renderPreview(file, {...result, newExt: actualExt}, 'convert');
      });
    }).catch(() => { if(job && job.cancelled) return; jlog(job,'Failed'); stopWorkingTicker(job); renderVideoProcessFailed(file); });
  }

  function renderAlreadyFormat(file, fmt){
    setSheetView('');
    sheet.innerHTML = topBar(file) + `
      <h2>This is already a ${fmt.toUpperCase()}.</h2>
      <div class="notice"><p>You're already there. Converting it to the same format would not change it.</p></div>
      <div class="actions">
        <button class="ghost" id="chooseAnother">Choose another format</button>
        <button id="makeSmaller">Make smaller</button>
      </div>
    `;
    wireClose();
    sheet.querySelector('#chooseAnother').addEventListener('click', () => renderConvertStep(file));
    sheet.querySelector('#makeSmaller').addEventListener('click', () => renderCompressStep(file));
  }

  function runConvert(file, targetFmt){
    const job = beginOperationIfMissing(file, 'convert');
    renderWorking(file, 'Converting image', job);
    jlog(job, 'Preparing image...');
    const img = new Image();
    img.onload = () => {
      if(job && job.cancelled) return;
      jlog(job, 'Reading source');
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if(targetFmt === 'jpg'){ ctx.fillStyle = '#fff'; ctx.fillRect(0,0,canvas.width,canvas.height); }
      ctx.drawImage(img, 0, 0);
      const mime = targetFmt === 'jpg' ? 'image/jpeg' : `image/${targetFmt}`;
      jlog(job, 'Encoding');
      canvas.toBlob(blob => {
        if(!blob){
          renderConvertFailed(file);
          return;
        }
        const url = URL.createObjectURL(blob);
        if(job && job.cancelled){ URL.revokeObjectURL(url); return; }
        jlog(job, 'Finalizing file');
        jlog(job, 'Complete');
        stopWorkingTicker(job);
        renderPreview(file, {blob, size: blob.size, url, newExt: targetFmt}, 'convert');
      }, mime, 0.92);
    };
    img.onerror = () => renderConvertFailed(file);
    img.src = URL.createObjectURL(file);
  }

  function renderConvertFailed(file){
    if(activeJob){ jlog(activeJob, 'Failed'); stopWorkingTicker(activeJob); updateJobStatus(activeJob, 'Failed'); activeJob = null; }
    setSheetView('');
    sheet.innerHTML = topBar(file) + `
      <h2>That didn't work.</h2>
      <div class="notice"><p>Tidy couldn't convert this file in your browser. Nothing was uploaded or changed.</p></div>
      <div class="actions"><button class="ghost" id="back">Go back</button></div>
    `;
    wireClose();
    sheet.querySelector('#back').addEventListener('click', () => renderChoiceStep(file));
  }

  // ---- Preview + export ----
  function outputName(file, result){
    const base = baseName(file.name);
    const outExt = result.newExt || ext(file.name);
    return `${base} (Tidy).${outExt}`;
  }

  // ---- Small corner "Done" notification after a successful operation ----
  let completionToastTimer = null;
  function showCompletionToast(file, mode){
    const toast = document.getElementById('completionToast');
    if(!toast) return;
    const verb = mode === 'convert' ? 'converted' : 'compressed';
    toast.innerHTML = `<strong>Done</strong><span>${escapeHtml(file.name)} was successfully ${verb}.</span>`;
    toast.classList.add('show');
    if(completionToastTimer) clearTimeout(completionToastTimer);
    completionToastTimer = setTimeout(() => toast.classList.remove('show'), 5000);
  }

  function renderPreview(file, result, mode){
    if(activeJob && activeJob.file === file && activeJob.cancelled) return;
    const doneItem = (activeJob && activeJob.file === file) ? activeJob : queue.find(q => q.file === file && !q.cancelled);
    if(doneItem){ updateJobStatus(doneItem, 'Done'); }
    if(doneItem){ doneItem.result = result; doneItem.mode = mode; }
    if(activeJob && activeJob.file === file){
      activeJob = null;
      showCompletionToast(file, mode);
    }
    const smaller = result.size < file.size;
    const pct = Math.round((1 - result.size/file.size) * 100);
    const previewUrl = result.url || currentURL;
    const isVideoResult = result.isVideo || (result.blob && result.blob.type && result.blob.type.startsWith('video/'));
    const isAudioResult = result.isAudio || (result.blob && result.blob.type && result.blob.type.startsWith('audio/'));

    setSheetView('');
    sheet.innerHTML = topBar(file) + `
      <h2>${mode === 'compress' ? 'Here\u2019s the result' : 'Converted'}</h2>
      <div class="preview-box">${isVideoResult
          ? `<video src="${previewUrl}" controls playsinline></video>`
          : isAudioResult ? `<audio src="${previewUrl}" controls></audio>`
          : `<img src="${previewUrl}" alt="Preview of result">`}
        <div class="preview-meta">
          <span class="before">Before ${fmtSize(file.size)}</span>
          <span class="after ${smaller?'good':''}">${fmtSize(result.size)}${mode==='compress' && smaller ? ` · ${pct}% smaller` : ''}</span>
        </div>
      </div>
      <p style="color:var(--muted);font-size:13.5px;margin:0 0 18px">Take a look before you download it. If it's not right, go back and try a different setting.</p>
      <div class="actions">
        <button class="ghost" id="back">Try again</button>
        <button class="red" id="download">Download tidy file</button>
      </div>
    `;
    wireClose();
    sheet.querySelector('#back').addEventListener('click', () => mode === 'compress' ? renderCompressStep(file) : renderConvertStep(file));
    sheet.querySelector('#download').addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = result.url || previewUrl || URL.createObjectURL(result.blob);
      a.download = outputName(file, result);
      document.body.appendChild(a);
      a.click();
      a.remove();
      if(result.url && result.url !== currentURL){ setTimeout(()=>URL.revokeObjectURL(result.url), 1000); }
      pendingFile = null;
      currentFile = null;
      closeSheet();
    });
  }
})();
