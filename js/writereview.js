/* =========================================================
   writereview.js (FULL) — FIXED
   Bagelbites prototype moderation for reviews
   - Loads ./data/restaurants.json to populate dropdown
   - Supports locked restaurant via ?id=...
   - Submissions stored in localStorage as PENDING
   - Mod mode toggled via ?mod=1 or localStorage flag
   - Approve moves pending -> approved bucket
   - FIXES:
     - Removes duplicate submit handlers (was causing false "missing fields" error)
     - Removes half-star selection (mobile friendly)
     - Photo handling: compresses phone photos to fit localStorage
     - Shows "Submitted" success preview + thumbnails
   ========================================================= */

function $(sel, root = document){ return root.querySelector(sel); }
function $all(sel, root = document){ return Array.from(root.querySelectorAll(sel)); }

const DATA_URL = "../data/restaurants.json";

// Storage keys
const KEY_MOD_ON = "bb_mod_on";
const KEY_REV_PENDING = "bb_reviews_pending_v1";
const KEY_REV_APPROVED = "bb_reviews_approved_v1";

// Limits
const MAX_PHOTOS = 4;
const MAX_PHOTO_BYTES = 700_000; // target per photo after compression
const MAX_REVIEW_CHARS = 1200;

function uid(){
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(str){
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getQS(){
  const u = new URL(location.href);
  return {
    id: u.searchParams.get("id") || "",
    mod: u.searchParams.get("mod") || ""
  };
}

function lsGet(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  }catch{
    return fallback;
  }
}

function lsSet(key, value){
  localStorage.setItem(key, JSON.stringify(value));
}

function showNotice(msg, type="ok"){
  const box = $("#notice");
  if (!box) return;
  box.style.display = "block";
  box.style.borderStyle = "solid";
  box.style.borderWidth = "1px";
  box.style.borderColor = type === "bad" ? "rgba(255,120,120,.35)" : "rgba(56,246,255,.22)";
  box.style.background = type === "bad" ? "rgba(255,80,100,.08)" : "rgba(56,246,255,.06)";
  box.innerHTML = msg;
  box.scrollIntoView({ behavior:"smooth", block:"start" });
}

async function loadRestaurants(){
  const res = await fetch(DATA_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not load ${DATA_URL} (HTTP ${res.status})`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error("restaurants.json must be an array");
  return data
    .filter(r => r && r.id && r.name)
    .map(r => ({ id: String(r.id), name: String(r.name) }))
    .sort((a,b)=>a.name.localeCompare(b.name));
}

function populateDropdown(list, lockedId=""){
  const sel = $("#restaurantSelect");
  if (!sel) return;

  sel.innerHTML = `<option value="">Select…</option>` + list
    .map(r => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)}</option>`)
    .join("");

  if (lockedId){
    sel.value = lockedId;
    sel.disabled = true;
    const lh = $("#lockedHint");
    if (lh) lh.style.display = "block";
  }
}

/* ---------- Photos: compress big phone images ---------- */

function readFileAsDataURL(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("File read failed"));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image decode failed"));
    img.src = dataUrl;
  });
}

function canvasToDataUrl(canvas, quality){
  return canvas.toDataURL("image/jpeg", quality);
}

async function compressImageToBudget(file, budgetBytes){
  // Read original
  const original = await readFileAsDataURL(file);
  const img = await loadImage(original);

  // Resize to keep things sane (phone photos are huge)
  const maxSide = 1400;
  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;

  if (w > maxSide || h > maxSide){
    const scale = maxSide / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);

  // Try qualities down until under budget (or until we give up)
  let q = 0.86;
  let out = canvasToDataUrl(canvas, q);

  // Rough byte estimate for base64 data url
  const approxBytes = (dataUrl) => Math.ceil((dataUrl.length - dataUrl.indexOf(",") - 1) * 3/4);

  while (approxBytes(out) > budgetBytes && q > 0.45){
    q -= 0.08;
    out = canvasToDataUrl(canvas, q);
  }

  return out;
}

async function collectPhotos(){
  const input = $("#photos");
  const files = input?.files ? Array.from(input.files) : [];
  if (!files.length) return { photos: [], warnings: [] };

  const chosen = files.slice(0, MAX_PHOTOS);
  const photos = [];
  const warnings = [];

  for (const f of chosen){
    if (!f.type.startsWith("image/")){
      warnings.push(`${escapeHtml(f.name)} skipped (not an image).`);
      continue;
    }

    try{
      // If already small enough, store directly
      if (f.size <= MAX_PHOTO_BYTES){
        const dataUrl = await readFileAsDataURL(f);
        photos.push({ name: f.name, type: f.type, dataUrl });
      }else{
        // Compress to fit
        const dataUrl = await compressImageToBudget(f, MAX_PHOTO_BYTES);
        photos.push({ name: f.name, type: "image/jpeg", dataUrl });
        warnings.push(`${escapeHtml(f.name)} was compressed to fit.`);
      }
    }catch(err){
      console.warn("Photo failed:", f.name, err);
      warnings.push(`${escapeHtml(f.name)} could not be processed.`);
    }
  }

  return { photos, warnings };
}

function renderPhotoPreview(){
  const host = $("#photoPreview");
  const input = $("#photos");
  if (!host || !input) return;

  host.innerHTML = "";
  const files = input.files ? Array.from(input.files).slice(0, MAX_PHOTOS) : [];

  for (const f of files){
    const chip = document.createElement("div");
    chip.className = "pillBtn";
    chip.style.cursor = "default";
    chip.style.userSelect = "none";
    chip.textContent = f.name.length > 28 ? (f.name.slice(0, 25) + "…") : f.name;
    host.appendChild(chip);
  }

  if (input.files && input.files.length > MAX_PHOTOS){
    const warn = document.createElement("div");
    warn.className = "muted small";
    warn.style.marginTop = "8px";
    warn.textContent = `Only the first ${MAX_PHOTOS} photos will be used.`;
    host.appendChild(warn);
  }
}

function initCharCount(){
  const ta = $("#reviewText");
  const cc = $("#charCount");
  if (!ta || !cc) return;

  const max = MAX_REVIEW_CHARS;
  const upd = () => {
    if (ta.value.length > max) ta.value = ta.value.slice(0, max);
    cc.textContent = `${ta.value.length} / ${max}`;
  };
  ta.addEventListener("input", upd);
  upd();
}

/* ---------- Stars: whole stars only ---------- */

function initStarPicker(){
  const host = $("#starPicker");
  const input = $("#rating");
  const label = $("#ratingLabel");
  if (!host || !input || !label) return;

  host.innerHTML = "";
  for (let i=1; i<=5; i++){
    const b = document.createElement("button");
    b.type = "button";
    b.className = "starBtn";
    b.dataset.value = String(i);
    b.innerHTML = `<span class="starGlyph">★</span>`;
    host.appendChild(b);
  }

  function setRating(val){
    const n = Math.max(0, Math.min(5, Math.round(Number(val) || 0)));
    input.value = String(n);
    label.textContent = n ? String(n) : "—";

    $all(".starBtn", host).forEach(btn => {
      const v = Number(btn.dataset.value);
      btn.classList.toggle("is-on", v <= n);
      btn.classList.remove("is-half"); // ensure no half class exists
    });
  }

  host.addEventListener("click", (e) => {
    const btn = e.target?.closest?.(".starBtn");
    if (!btn) return;
    setRating(btn.dataset.value);
  });

  setRating(0);
}

/* ---------- Validation + storage ---------- */

function validateForm(){
  const rid = $("#restaurantSelect")?.value || "";
  const name = $("#displayName")?.value?.trim() || "";
  const rating = Number($("#rating")?.value || 0);
  const txt = $("#reviewText")?.value?.trim() || "";

  const problems = [];
  if (!rid) problems.push("Pick a restaurant.");
  if (!name) problems.push("Add your name.");
  if (!(rating > 0)) problems.push("Add a rating.");
  if (!txt) problems.push("Write the review.");

  return { ok: problems.length === 0, problems, rid, name, rating, txt };
}

function enqueuePendingReview(payload){
  const pending = lsGet(KEY_REV_PENDING, []);
  pending.unshift(payload);
  lsSet(KEY_REV_PENDING, pending);
}

function approveReview(id){
  const pending = lsGet(KEY_REV_PENDING, []);
  const idx = pending.findIndex(x => x.id === id);
  if (idx < 0) return;

  const item = pending.splice(idx, 1)[0];
  item.status = "approved";
  item.approvedAt = new Date().toISOString();

  const approved = lsGet(KEY_REV_APPROVED, []);
  approved.unshift(item);

  lsSet(KEY_REV_PENDING, pending);
  lsSet(KEY_REV_APPROVED, approved);
}

function rejectReview(id){
  const pending = lsGet(KEY_REV_PENDING, []);
  const next = pending.filter(x => x.id !== id);
  lsSet(KEY_REV_PENDING, next);
}

function purgePending(){
  lsSet(KEY_REV_PENDING, []);
}

function isModMode(){
  const { mod } = getQS();
  if (mod === "1") return true;
  return localStorage.getItem(KEY_MOD_ON) === "1";
}

function setModMode(on){
  localStorage.setItem(KEY_MOD_ON, on ? "1" : "0");
}

function renderModPanel(){
  const panel = $("#modPanel");
  const list = $("#pendingList");
  if (!panel || !list) return;

  panel.style.display = isModMode() ? "block" : "none";
  if (!isModMode()) return;

  const pending = lsGet(KEY_REV_PENDING, []);
  if (!pending.length){
    list.innerHTML = `<div class="emptyState">No pending reviews. The queue is quiet. 🕯️</div>`;
    return;
  }

  list.innerHTML = pending.map(p => {
    const photoCount = (p.photos || []).length;
    return `
      <div class="review">
        <div style="display:grid;place-items:center;">
          <div class="pillBtn" style="cursor:default;user-select:none;">🕵️</div>
        </div>
        <div>
          <div class="reviewTop">
            <div>
              <div class="reviewName">${escapeHtml(p.displayName)} <span class="muted small">(${escapeHtml(p.restaurantId)})</span></div>
              <div class="muted small">${escapeHtml(new Date(p.createdAt).toLocaleString())}</div>
            </div>
            <div class="pillBtn" style="cursor:default;user-select:none;">
              ★ ${escapeHtml(p.rating)}
            </div>
          </div>

          <p class="reviewText">${escapeHtml(p.reviewText)}</p>

          <div class="muted small" style="margin-top:8px;">
            Photos: ${photoCount}
          </div>

          <div class="filterRow" style="margin-top:10px;">
            <button class="btn" data-approve="${escapeHtml(p.id)}" type="button">Approve</button>
            <button class="pillBtn" data-reject="${escapeHtml(p.id)}" type="button">Reject</button>
          </div>
        </div>
      </div>
    `;
  }).join("");

  $all("[data-approve]", list).forEach(b => {
    b.addEventListener("click", () => {
      approveReview(b.getAttribute("data-approve"));
      renderModPanel();
      showNotice("Approved. It will show publicly wherever you render approved reviews.", "ok");
    });
  });

  $all("[data-reject]", list).forEach(b => {
    b.addEventListener("click", () => {
      rejectReview(b.getAttribute("data-reject"));
      renderModPanel();
      showNotice("Rejected. It is gone (into the void).", "ok");
    });
  });
}

/* ---------- Success preview "page" ---------- */

function ensureSuccessBox(){
  let box = $("#reviewSuccess");
  if (box) return box;

  // If user didn’t add it to HTML, create it right above the form
  const form = $("#reviewForm");
  if (!form) return null;

  box = document.createElement("div");
  box.id = "reviewSuccess";
  box.hidden = true;
  form.parentElement?.insertBefore(box, form);
  return box;
}

function showSuccessPreview(payload, warnings=[]){
  const box = ensureSuccessBox();
  if (!box) return;

  const stars = "★".repeat(payload.rating) + "☆".repeat(5 - payload.rating);
  const photoCount = (payload.photos?.length || 0);

  const thumbs = (payload.photos || []).slice(0, MAX_PHOTOS).map(p => {
    return `<img src="${p.dataUrl}" alt="${escapeHtml(p.name)}"
      style="width:72px;height:72px;object-fit:cover;border-radius:12px;border:1px solid rgba(255,255,255,.14);" />`;
  }).join("");

  const warnHtml = warnings.length
    ? `<div class="muted small" style="margin-top:10px;">
         ${warnings.map(w => `• ${w}`).join("<br>")}
       </div>`
    : "";

  box.className = "successCard";
  box.innerHTML = `
    <div class="title">Your review has been submitted ✅</div>
    <div class="successPreview">
      <div style="font-weight:900; letter-spacing:.2px;">${stars}
        <span class="muted">(${payload.rating}/5)</span>
      </div>

      <div style="margin-top:8px; white-space:pre-wrap;">${escapeHtml(payload.reviewText || "")}</div>

      <div class="muted small" style="margin-top:10px;">Photos attached: ${photoCount}</div>

      ${thumbs ? `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;">${thumbs}</div>` : ""}

      ${warnHtml}

      <div style="margin-top:14px;">
        <a href="../index.html" class="neonSuggestBtn" style="text-decoration:none;">Back to Main Site</a>
      </div>
    </div>
  `;

  box.hidden = false;

  // Hide form so it feels like a confirmation page
  const form = $("#reviewForm");
  if (form) form.style.display = "none";

  box.scrollIntoView({ behavior:"smooth", block:"start" });
}

/* ---------- Init + submit ---------- */

async function init(){
  // Populate dropdown
  const { id } = getQS();
  try{
    const list = await loadRestaurants();
    populateDropdown(list, id);
  }catch(err){
    console.error(err);
    const sel = $("#restaurantSelect");
    if (sel) sel.innerHTML = `<option value="">Couldn’t load restaurants</option>`;
    showNotice(`Couldn’t load restaurant list. Make sure you’re running a server and <code>data/restaurants.json</code> exists.`, "bad");
  }

  initStarPicker();
  initCharCount();

  $("#photos")?.addEventListener("change", renderPhotoPreview);

  // Mod panel wiring
  $("#btnModOff")?.addEventListener("click", () => {
    setModMode(false);
    renderModPanel();
    showNotice("Mod mode off.", "ok");
  });

  $("#btnPurgePending")?.addEventListener("click", () => {
    if (!confirm("Purge ALL pending reviews?")) return;
    purgePending();
    renderModPanel();
    showNotice("Pending queue purged.", "ok");
  });

  // Turn mod mode on via query param if used
  if (getQS().mod === "1") setModMode(true);
  renderModPanel();

  // Form submit (SINGLE source of truth)
  $("#reviewForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const v = validateForm();
    if (!v.ok){
      showNotice(
        `<div style="font-weight:900;margin-bottom:6px;">Missing required fields</div>
         <ul style="margin:0;padding-left:18px;">
           ${v.problems.map(p=>`<li>${escapeHtml(p)}</li>`).join("")}
         </ul>`,
        "bad"
      );
      return;
    }

    // Photos
    let photos = [];
    let warnings = [];
    try{
      const result = await collectPhotos();
      photos = result.photos;
      warnings = result.warnings;
    }catch(err){
      console.warn("Photo read failed:", err);
      warnings = ["Photos could not be processed."];
    }

    const payload = {
      id: uid(),
      restaurantId: v.rid,
      displayName: v.name,
      rating: v.rating,
      reviewText: v.txt,
      photos,
      status: "pending",
      createdAt: new Date().toISOString()
    };

    enqueuePendingReview(payload);

    // Show confirmation "page"
    showSuccessPreview(payload, warnings);

    // Keep mod panel up to date (if visible)
    renderModPanel();
  });

  $("#btnClear")?.addEventListener("click", () => {
    const locked = $("#restaurantSelect")?.disabled;
    $("#displayName").value = "";
    $("#rating").value = "0";
    $("#ratingLabel").textContent = "—";
    $("#reviewText").value = "";
    $("#photos").value = "";
    $("#photoPreview").innerHTML = "";
    $all(".starBtn", $("#starPicker")).forEach(b => b.classList.remove("is-on","is-half"));
    $("#charCount").textContent = `0 / ${MAX_REVIEW_CHARS}`;
    if (!locked) $("#restaurantSelect").value = "";
  });
}

document.addEventListener("DOMContentLoaded", init);