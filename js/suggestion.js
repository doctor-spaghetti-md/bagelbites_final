/* =========================================================
   suggestion.js (FULL CLEAN REWRITE)
   Bagelbites prototype moderation for restaurant suggestions
   - Submissions stored in localStorage as PENDING suggestions
   - Mod mode toggled via ?mod=1 or localStorage flag
   - Approve moves suggestion -> user restaurants bucket
   ========================================================= */

function $(sel, root = document){ return root.querySelector(sel); }
function $all(sel, root = document){ return Array.from(root.querySelectorAll(sel)); }

const KEY_MOD_ON = "bb_mod_on";
const KEY_SUG_PENDING = "bb_suggestions_pending_v1";
const KEY_USER_RESTAURANTS = "bb_restaurants_user_v1";

const MAX_HERO_BYTES = 800_000; // ~0.8MB

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

function getQS(){
  const u = new URL(location.href);
  return { mod: u.searchParams.get("mod") || "" };
}

function isModMode(){
  const { mod } = getQS();
  if (mod === "1") return true;
  return localStorage.getItem(KEY_MOD_ON) === "1";
}
function setModMode(on){
  localStorage.setItem(KEY_MOD_ON, on ? "1" : "0");
}

/* ---------- toast (submitted bar) ---------- */
function ensureSuggestToast(){
  let bar = $("#suggestToast");
  if (bar) return bar;

  const form = $("#suggestForm");
  if (!form) return null;

  bar = document.createElement("div");
  bar.id = "suggestToast";
  bar.hidden = true;

  form.parentElement?.insertBefore(bar, form);
  return bar;
}

function showSuggestSubmittedToast(){
  const bar = ensureSuggestToast();
  if (!bar) return;

  bar.className = "neonToast";
  bar.innerHTML = `
    <div class="neonToastRow">
      <div>
        <div class="neonToastTitle">Submitted ✅</div>
        <div class="neonToastSub">Your restaurant suggestion is in the moderation tunnel.</div>
      </div>

      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <a class="neonSuggestBtn" href="../index.html" style="text-decoration:none;">
          Back to Main Page
        </a>
        <button class="pillBtn" type="button" id="btnSuggestNew">Submit Another</button>
      </div>
    </div>
  `;

  bar.hidden = false;

  const form = $("#suggestForm");
  if (form){
    form.reset();
    form.style.display = "none";
  }

  // Clear any preview box if you have it
  $("#heroPreview") && ($("#heroPreview").innerHTML = "");
  $("#whyCount") && ($("#whyCount").textContent = "0 / 900");

  $("#btnSuggestNew")?.addEventListener("click", () => {
    bar.hidden = true;
    if (form) form.style.display = "";
    form?.scrollIntoView({ behavior:"smooth", block:"start" });
  });

  bar.scrollIntoView({ behavior:"smooth", block:"start" });
}

/* ---------- notice box (optional for errors) ---------- */
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

/* ---------- hero upload ---------- */
function readFileAsDataURL(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("File read failed"));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

async function collectHero(){
  const input = $("#heroPhoto");
  const file = input?.files?.[0];
  if (!file) return null;
  if (!file.type.startsWith("image/")) return null;
  if (file.size > MAX_HERO_BYTES) return null;

  const dataUrl = await readFileAsDataURL(file);
  return { name: file.name, type: file.type, dataUrl };
}

/* ---------- validation ---------- */
function validateForm(){
  const placeName = $("#placeName")?.value?.trim() || "";
  const locationText = $("#locationText")?.value?.trim() || "";
  const neighborhood = $("#neighborhood")?.value?.trim() || "";
  const price = $("#price")?.value || "";
  const website = $("#website")?.value?.trim() || "";
  const tagsRaw = $("#tags")?.value?.trim() || "";
  const why = $("#why")?.value?.trim() || "";

  const tags = tagsRaw
    ? tagsRaw.split(",").map(t => t.trim()).filter(Boolean).slice(0, 12)
    : [];

  const problems = [];
  if (!placeName) problems.push("Restaurant name is required.");
  if (!locationText) problems.push("Location is required.");
  if (!why) problems.push("Why you’re suggesting it is required.");

  return { ok: problems.length === 0, problems, placeName, locationText, neighborhood, price, website, tags, why };
}

/* ---------- storage ops ---------- */
function enqueuePendingSuggestion(payload){
  const pending = lsGet(KEY_SUG_PENDING, []);
  pending.unshift(payload);
  lsSet(KEY_SUG_PENDING, pending);
}

function purgePending(){
  lsSet(KEY_SUG_PENDING, []);
}

function approveSuggestion(id){
  const pending = lsGet(KEY_SUG_PENDING, []);
  const idx = pending.findIndex(x => x.id === id);
  if (idx < 0) return;

  const item = pending.splice(idx, 1)[0];

  const userRests = lsGet(KEY_USER_RESTAURANTS, []);
  const newRestaurant = {
    id: `user_${uid()}`,
    name: item.placeName,
    locationText: item.locationText,
    neighborhood: item.neighborhood || "",
    price: item.price || "",
    lat: NaN,
    lng: NaN,
    tags: item.tags || [],
    amenities: [],
    features: {},
    hero: item.hero?.dataUrl || "",
    fontGoogle: "Inter",
    bagelholeReview: `Suggested: ${item.why}`,
    highlights: [],
    initialReviews: []
  };

  userRests.unshift(newRestaurant);

  lsSet(KEY_SUG_PENDING, pending);
  lsSet(KEY_USER_RESTAURANTS, userRests);
}

function rejectSuggestion(id){
  const pending = lsGet(KEY_SUG_PENDING, []);
  lsSet(KEY_SUG_PENDING, pending.filter(x => x.id !== id));
}

/* ---------- mod panel ---------- */
function renderModPanel(){
  const panel = $("#modPanel");
  const list = $("#pendingList");
  if (!panel || !list) return;

  const on = isModMode();
  panel.style.display = on ? "block" : "none";
  if (!on) return;

  const pending = lsGet(KEY_SUG_PENDING, []);
  if (!pending.length){
    list.innerHTML = `<div class="emptyState">No pending suggestions. The tip line is silent. 📵</div>`;
    return;
  }

  list.innerHTML = pending.map(p => {
    const tags = (p.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("");
    const hero = p.hero?.dataUrl
      ? `<img src="${escapeHtml(p.hero.dataUrl)}" alt="Hero" style="width:92px;height:72px;object-fit:cover;border-radius:12px;border:1px solid rgba(255,255,255,.14);" />`
      : `<div class="pillBtn" style="cursor:default;user-select:none;">no photo</div>`;

    const when = (() => {
      const dt = new Date(p.createdAt || Date.now());
      return Number.isNaN(dt.getTime()) ? "" : dt.toLocaleString();
    })();

    return `
      <div class="review">
        <div style="display:grid;place-items:center;gap:10px;">
          ${hero}
        </div>

        <div>
          <div class="reviewTop">
            <div>
              <div class="reviewName">${escapeHtml(p.placeName)}</div>
              <div class="muted small">${escapeHtml(p.locationText)}</div>
              ${when ? `<div class="muted small">${escapeHtml(when)}</div>` : ``}
            </div>
            <div class="pillBtn" style="cursor:default;user-select:none;">
              ${escapeHtml(p.price || "—")}
            </div>
          </div>

          ${p.neighborhood ? `<div class="muted small" style="margin-top:6px;">Neighborhood: ${escapeHtml(p.neighborhood)}</div>` : ``}
          ${p.website ? `<div class="muted small" style="margin-top:6px;">Link: ${escapeHtml(p.website)}</div>` : ``}
          ${tags ? `<div class="rTags" style="margin-top:10px;">${tags}</div>` : ``}

          <p class="reviewText">${escapeHtml(p.why || "")}</p>

          <div class="filterRow" style="margin-top:10px;">
            <button class="btn" data-approve="${escapeHtml(p.id)}" type="button">Approve (adds to restaurants)</button>
            <button class="pillBtn" data-reject="${escapeHtml(p.id)}" type="button">Reject</button>
          </div>
        </div>
      </div>
    `;
  }).join("");

  $all("[data-approve]", list).forEach(btn => {
    btn.addEventListener("click", () => {
      approveSuggestion(btn.getAttribute("data-approve"));
      renderModPanel();
      showNotice("Approved. Added to your user restaurants bucket (localStorage).", "ok");
    });
  });

  $all("[data-reject]", list).forEach(btn => {
    btn.addEventListener("click", () => {
      rejectSuggestion(btn.getAttribute("data-reject"));
      renderModPanel();
      showNotice("Rejected. Deleted from pending.", "ok");
    });
  });
}

/* ---------- misc UI ---------- */
function initWhyCount(){
  const why = $("#why");
  const cc = $("#whyCount");
  if (!why || !cc) return;

  const max = 900;
  const upd = () => cc.textContent = `${why.value.length} / ${max}`;
  why.addEventListener("input", upd);
  upd();
}

/* ---------- boot ---------- */
async function init(){
  // Turn mod mode on via query param if used
  if (getQS().mod === "1") setModMode(true);

  initWhyCount();
  renderModPanel();

  $("#btnModOff")?.addEventListener("click", () => {
    setModMode(false);
    renderModPanel();
    showNotice("Mod mode off.", "ok");
  });

  $("#btnPurgePending")?.addEventListener("click", () => {
    if (!confirm("Purge ALL pending suggestions?")) return;
    purgePending();
    renderModPanel();
    showNotice("Pending suggestions purged.", "ok");
  });

  $("#btnClear")?.addEventListener("click", () => {
    $("#suggestForm")?.reset();
    $("#heroPreview") && ($("#heroPreview").innerHTML = "");
    $("#whyCount") && ($("#whyCount").textContent = "0 / 900");
    $("#notice") && ($("#notice").style.display = "none");
  });

  $("#suggestForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const v = validateForm();
    if (!v.ok){
      showNotice(
        `<div style="font-weight:900;margin-bottom:6px;">Missing required fields</div>
         <ul style="margin:0;padding-left:18px;">${v.problems.map(p=>`<li>${escapeHtml(p)}</li>`).join("")}</ul>`,
        "bad"
      );
      return;
    }

    let hero = null;
    try{
      hero = await collectHero();
      if (!hero && $("#heroPhoto")?.files?.[0]){
        showNotice("Photo too large or not an image. Try a smaller file.", "bad");
        return;
      }
    }catch(err){
      console.warn("Hero read failed:", err);
    }

    const payload = {
      id: uid(),
      placeName: v.placeName,
      locationText: v.locationText,
      neighborhood: v.neighborhood,
      price: v.price,
      website: v.website,
      tags: v.tags,
      why: v.why,
      hero,
      status: "pending",
      createdAt: new Date().toISOString()
    };

    enqueuePendingSuggestion(payload);

    // Show the neon bar and hide/clear form
    showSuggestSubmittedToast();

    // If mod mode is on, refresh panel so it appears instantly
    renderModPanel();
  });
}

document.addEventListener("DOMContentLoaded", init);