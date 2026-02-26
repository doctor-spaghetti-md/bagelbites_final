/* =========================================================
   app.js (FULL UPDATED)
   Bagelbites / Bagelhole Restaurant Review Ecosystem
   - Loads ./data/restaurants.json (official list, ARRAY)
   - Loads ./data/reviews.json (bucket OR array; we use approved)
   - Suggestions live in ./data/suggestions.json (NOT merged here)
   - Desktop: sticky filters + sticky map (CSS), scroll results only
   - 15 results per page (Yelp-ish)
   - Leaflet map with pink Y2K pins
   - Mobile: overlays for Filters + Map
     - Filters overlay clones the sidebar UI
     - Map overlay temporarily moves the same #map into the modal (then back)
   ========================================================= */

function $(sel, root = document){ return root.querySelector(sel); }
function $all(sel, root = document){ return Array.from(root.querySelectorAll(sel)); }

function escapeHtml(str){
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function firstSentence(text){
  const t = String(text || "").trim().replace(/\s+/g, " ");
  if (!t) return "";
  const m = t.match(/^(.+?[.!?])(\s|$)/);
  return (m ? m[1] : t.slice(0, 140) + (t.length > 140 ? "…" : ""));
}

function uniq(arr){ return Array.from(new Set(arr)); }
function norm(s){ return String(s || "").toLowerCase().trim(); }

/* =========================================================
   FILES (YOUR NAMES)
   ========================================================= */
const RESTAURANTS_URL  = "./data/restaurants.json";     // official list (array)
const REVIEWS_URL      = "./data/review.json";         // bucket OR array (approved used)
const SUGGESTIONS_URL  = "./data/suggestions.json";     // not used in app.js (suggestion page only)
const PAGE_SIZE = 15;

/* =========================================================
   STATE
   ========================================================= */
let CATALOG = [];
let APPROVED_REVIEWS = []; // used for rating + counts
let filtered = [];
let page = 1;

let map = null;
let markerLayer = null;

let mapHomeParent = null;
let mapHomeNextSibling = null;

/* =========================================================
   HELPERS: BUCKET SUPPORT + NORMALIZATION
   ========================================================= */
function asArrayOrApprovedBucket(json){
  // supports either:
  // 1) [ ...items ]
  // 2) { approved:[...], pending:[...], rejected:[...] }
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object" && Array.isArray(json.approved)) return json.approved;
  return [];
}

function normalizeRestaurant(r){
  return {
    id: String(r.id),
    name: String(r.name),
    locationText: String(r.locationText || ""),
    neighborhood: String(r.neighborhood || ""),
    price: String(r.price || ""),
    lat: Number(r.lat ?? NaN),
    lng: Number(r.lng ?? NaN),
    tags: Array.isArray(r.tags) ? r.tags.map(String) : [],
    amenities: Array.isArray(r.amenities) ? r.amenities.map(String) : [],
    features: (r.features && typeof r.features === "object") ? r.features : {},
    hero: String(r.hero || ""),
    bagelholeReview: String(r.bagelholeReview || ""),
    highlights: Array.isArray(r.highlights) ? r.highlights : []
  };
}

function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

function computeRestaurantStats(restaurantId){
  const id = String(restaurantId);
  const mine = APPROVED_REVIEWS.filter(rv => String(rv.restaurantId || rv.restaurant_id || "") === id);

  const count = mine.length;
  if (!count) return { avg: 0, count: 0 };

  let sum = 0;
  let used = 0;

  for (const r of mine){
    const raw = r.rating ?? r.stars ?? r.score;
    const num = Number(raw);
    if (Number.isFinite(num)){
      sum += num;
      used += 1;
    }
  }

  const avg = used ? (sum / used) : 0;
  return { avg, count };
}

function starFillPct(avg){
  // avg 0..5 -> 0..100
  const a = clamp(Number(avg) || 0, 0, 5);
  return (a / 5) * 100;
}

/* =========================================================
   LOADERS
   ========================================================= */
async function loadCatalog(){
  const res = await fetch(RESTAURANTS_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not load ${RESTAURANTS_URL} (HTTP ${res.status})`);

  const base = await res.json();
  if (!Array.isArray(base)) throw new Error("restaurants.json must be an array");

  return base
    .filter(r => r && r.id && r.name)
    .map(normalizeRestaurant);
}

async function loadApprovedReviews(){
  try{
    const res = await fetch(REVIEWS_URL, { cache: "no-store" });
    if (!res.ok) return [];
    const json = await res.json();
    return asArrayOrApprovedBucket(json);
  }catch(e){
    return [];
  }
}

/* =========================================================
   FILTERS UI
   ========================================================= */
function buildFilters(){
  const host = $("#filterSidebar");
  if (!host) return;

  const neighborhoods = uniq(CATALOG.map(r => r.neighborhood).filter(Boolean)).sort((a,b)=>a.localeCompare(b));
  const tags = uniq(CATALOG.flatMap(r => r.tags || []).filter(Boolean)).sort((a,b)=>a.localeCompare(b));

  host.innerHTML = `
    <div class="filterBlock">
      <div class="filterTitle">Filters</div>

      <label class="filterLabel" for="q">Search</label>
      <input id="q" class="filterInput" type="search" placeholder="search restaurants…" autocomplete="off" />

      <label class="filterLabel" for="fNeighborhood">Neighborhood</label>
      <select id="fNeighborhood" class="filterSelect">
        <option value="all">All</option>
        ${neighborhoods.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("")}
      </select>

      <label class="filterLabel" for="fPrice">Price</label>
      <select id="fPrice" class="filterSelect">
        <option value="all">All</option>
        <option value="$">$</option>
        <option value="$$">$$</option>
        <option value="$$$">$$$</option>
        <option value="$$$$">$$$$</option>
      </select>

      <label class="filterLabel" for="fTag">Tag</label>
      <select id="fTag" class="filterSelect">
        <option value="all">All</option>
        ${tags.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("")}
      </select>

      <div class="filterRow">
        <label class="check">
          <input type="checkbox" id="fBar" />
          <span>Bar</span>
        </label>
        <label class="check">
          <input type="checkbox" id="fDelivery" />
          <span>Delivery</span>
        </label>
      </div>

      <div class="filterRow">
        <label class="check">
          <input type="checkbox" id="fPatio" />
          <span>Patio</span>
        </label>
        <label class="check">
          <input type="checkbox" id="fVegan" />
          <span>Vegan</span>
        </label>
      </div>

      <div class="filterRow">
        <label class="check">
          <input type="checkbox" id="fLateNight" />
          <span>Late night</span>
        </label>
      </div>

      <label class="filterLabel" for="sort">Sort</label>
      <select id="sort" class="filterSelect">
        <option value="name">Name (A–Z)</option>
        <option value="priceLow">Price (low → high)</option>
        <option value="priceHigh">Price (high → low)</option>
        <option value="neighborhood">Neighborhood</option>
      </select>

      <div class="filterActions">
        <button class="btn" id="btnClearFilters" type="button">Clear</button>
      </div>
    </div>
  `;

  const rerun = () => { page = 1; applyFiltersAndRender(); };

  $("#q")?.addEventListener("input", rerun);
  $("#fNeighborhood")?.addEventListener("change", rerun);
  $("#fPrice")?.addEventListener("change", rerun);
  $("#fTag")?.addEventListener("change", rerun);

  $("#fBar")?.addEventListener("change", rerun);
  $("#fDelivery")?.addEventListener("change", rerun);
  $("#fPatio")?.addEventListener("change", rerun);
  $("#fVegan")?.addEventListener("change", rerun);
  $("#fLateNight")?.addEventListener("change", rerun);

  $("#sort")?.addEventListener("change", rerun);

  $("#btnClearFilters")?.addEventListener("click", () => {
    $("#q").value = "";
    $("#fNeighborhood").value = "all";
    $("#fPrice").value = "all";
    $("#fTag").value = "all";
    $("#fBar").checked = false;
    $("#fDelivery").checked = false;
    $("#fPatio").checked = false;
    $("#fVegan").checked = false;
    $("#fLateNight").checked = false;
    $("#sort").value = "name";
    page = 1;
    applyFiltersAndRender();
  });
}

function getFilterState(){
  return {
    q: norm($("#q")?.value || ""),
    neighborhood: $("#fNeighborhood")?.value || "all",
    price: $("#fPrice")?.value || "all",
    tag: $("#fTag")?.value || "all",
    features: {
      bar: $("#fBar")?.checked || false,
      delivery: $("#fDelivery")?.checked || false,
      patio: $("#fPatio")?.checked || false,
      vegan: $("#fVegan")?.checked || false,
      latenight: $("#fLateNight")?.checked || false
    },
    sort: $("#sort")?.value || "name"
  };
}

function priceRank(p){
  const s = String(p || "");
  if (s === "$") return 1;
  if (s === "$$") return 2;
  if (s === "$$$") return 3;
  if (s === "$$$$") return 4;
  return 0;
}

function applyFilters(){
  const st = getFilterState();
  let out = CATALOG.slice();

  if (st.q){
    out = out.filter(r => {
      const hay = `${r.name} ${r.locationText} ${r.neighborhood} ${(r.tags||[]).join(" ")} ${r.bagelholeReview}`.toLowerCase();
      return hay.includes(st.q);
    });
  }

  if (st.neighborhood !== "all"){
    out = out.filter(r => r.neighborhood === st.neighborhood);
  }

  if (st.price !== "all"){
    out = out.filter(r => r.price === st.price);
  }

  if (st.tag !== "all"){
    out = out.filter(r => (r.tags || []).includes(st.tag));
  }

  for (const [k,v] of Object.entries(st.features)){
    if (v){
      out = out.filter(r => !!(r.features && r.features[k]));
    }
  }

  switch (st.sort){
    case "priceLow":
      out.sort((a,b) => priceRank(a.price) - priceRank(b.price) || a.name.localeCompare(b.name));
      break;
    case "priceHigh":
      out.sort((a,b) => priceRank(b.price) - priceRank(a.price) || a.name.localeCompare(b.name));
      break;
    case "neighborhood":
      out.sort((a,b) => (a.neighborhood||"").localeCompare(b.neighborhood||"") || a.name.localeCompare(b.name));
      break;
    default:
      out.sort((a,b) => a.name.localeCompare(b.name));
  }

  return out;
}

/* =========================================================
   RESULTS RENDERING
   ========================================================= */
function renderList(){
  const host = $("#resultsList");
  if (!host) return;

  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  page = Math.min(Math.max(1, page), pages);

  const start = (page - 1) * PAGE_SIZE;
  const slice = filtered.slice(start, start + PAGE_SIZE);

  host.innerHTML = "";

  if (!slice.length){
    host.innerHTML = `<div class="emptyState">No matches. Your filters are being picky. 🧃</div>`;
  } else {
    for (const r of slice){
      const hero = r.hero || "";
      const blurb = firstSentence(r.bagelholeReview || "");
      const tags = (r.tags || []).slice(0, 4).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("");

      const stats = computeRestaurantStats(r.id);
      const avgTxt = stats.count ? stats.avg.toFixed(1) : "—";
      const countTxt = stats.count ? `${stats.count} review${stats.count === 1 ? "" : "s"}` : "no reviews";
      const fill = starFillPct(stats.avg);

      const card = document.createElement("article");
      card.className = "rCard";
      card.innerHTML = `
        <a class="rLink" href="./restaurant.html?id=${encodeURIComponent(r.id)}" aria-label="Open ${escapeHtml(r.name)}">
          <div class="rThumb" style="background-image:url('${escapeHtml(hero)}')"></div>
          <div class="rBody">
            <div class="rTop">
              <div class="rName">${escapeHtml(r.name)}</div>
              <div class="rPrice">${escapeHtml(r.price || "")}</div>
            </div>

            <div class="rMeta">${escapeHtml(r.locationText || "")}</div>

            <div class="rRatingRow" aria-label="Rating summary">
              <div class="rStars" aria-hidden="true">
                <div class="starsBase">★★★★★</div>
                <div class="starsFill" style="width:${fill}%;"><span>★★★★★</span></div>
              </div>
              <div class="rRatingMeta">
                <span class="avg">${escapeHtml(avgTxt)}</span>
                <span class="dot">•</span>
                <span class="count">${escapeHtml(countTxt)}</span>
              </div>
            </div>

            <div class="rBlurb">${escapeHtml(blurb)}</div>
            <div class="rTags">${tags}</div>
          </div>
        </a>
      `;
      host.appendChild(card);
    }
  }

  // Pagination UI
  const prev = $("#btnPrev");
  const next = $("#btnNext");
  const meta = $("#pageMeta");

  if (meta) meta.textContent = `Page ${page} of ${pages} • ${total} total`;

  if (prev){
    prev.disabled = (page <= 1);
    prev.onclick = () => { page -= 1; renderList(); renderMarkers(); };
  }
  if (next){
    next.disabled = (page >= pages);
    next.onclick = () => { page += 1; renderList(); renderMarkers(); };
  }
}

/* =========================================================
   MAP
   ========================================================= */
function y2kPinIcon(){
  return L.divIcon({
    className: "y2kPin",
    html: `<div class="pinCore"></div>`,
    iconSize: [34, 52],
    iconAnchor: [17, 50]
  });
}

function initMap(){
  const el = $("#map");
  if (!el) return;
  if (typeof L === "undefined") return;

  // save home position so we can re-parent into mobile overlay
  mapHomeParent = el.parentElement;
  mapHomeNextSibling = el.nextSibling;

  const first = CATALOG.find(r => Number.isFinite(r.lat) && Number.isFinite(r.lng));
  const center = first ? [first.lat, first.lng] : [36.8508, -76.2859];

  map = L.map(el, { zoomControl: true, scrollWheelZoom: true }).setView(center, 12);

  // Dark basemap (CARTO)
  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png",
    {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      subdomains: "abcd",
      maxZoom: 20
    }
  ).addTo(map);

  markerLayer = L.layerGroup().addTo(map);

  setTimeout(() => map.invalidateSize(), 250);
  window.addEventListener("resize", () => setTimeout(() => map?.invalidateSize(), 100));
}

function renderMarkers(){
  if (!map || !markerLayer || typeof L === "undefined") return;

  markerLayer.clearLayers();

  // pins only for current page slice
  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const p = Math.min(Math.max(1, page), pages);
  const start = (p - 1) * PAGE_SIZE;
  const slice = filtered.slice(start, start + PAGE_SIZE);

  const pts = [];

  for (const r of slice){
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng)) continue;

    pts.push([r.lat, r.lng]);

    const popup = `
      <div class="mapPop">
        <div class="mapPopName">${escapeHtml(r.name)}</div>
        <div class="mapPopMeta">${escapeHtml(r.neighborhood || "")} ${escapeHtml(r.price || "")}</div>
        <a class="mapPopLink" href="./restaurant.html?id=${encodeURIComponent(r.id)}">Open</a>
      </div>
    `;

    L.marker([r.lat, r.lng], { icon: y2kPinIcon() })
      .addTo(markerLayer)
      .bindPopup(popup);
  }

  if (pts.length){
    const bounds = L.latLngBounds(pts);
    map.fitBounds(bounds.pad(0.22));
  }
}

/* =========================================================
   MOBILE OVERLAYS
   ========================================================= */
function setOpen(el, open){
  if (!el) return;
  el.classList.toggle("is-open", !!open);
  el.setAttribute("aria-hidden", open ? "false" : "true");
}

function cloneFiltersIntoMobile(){
  const src = $("#filterSidebar");
  const dest = $("#mobileFiltersBody");
  if (!src || !dest) return;

  // copy markup
  dest.innerHTML = src.innerHTML;

  // wire listeners INSIDE the mobile clone (scoped)
  const rerun = () => { page = 1; applyFiltersAndRender(); };

  const q = $("#q", dest);
  const fNeighborhood = $("#fNeighborhood", dest);
  const fPrice = $("#fPrice", dest);
  const fTag = $("#fTag", dest);
  const fBar = $("#fBar", dest);
  const fDelivery = $("#fDelivery", dest);
  const fPatio = $("#fPatio", dest);
  const fVegan = $("#fVegan", dest);
  const fLateNight = $("#fLateNight", dest);
  const sort = $("#sort", dest);
  const clear = $("#btnClearFilters", dest);

  // mirror helpers
  function mirrorValueToDesktop(desktopId, value){
    const d = document.getElementById(desktopId);
    if (d) d.value = value;
  }
  function mirrorCheckedToDesktop(desktopId, checked){
    const d = document.getElementById(desktopId);
    if (d) d.checked = checked;
  }

  q?.addEventListener("input", () => {
    mirrorValueToDesktop("q", q.value);
    rerun();
  });

  fNeighborhood?.addEventListener("change", () => { mirrorValueToDesktop("fNeighborhood", fNeighborhood.value); rerun(); });
  fPrice?.addEventListener("change", () => { mirrorValueToDesktop("fPrice", fPrice.value); rerun(); });
  fTag?.addEventListener("change", () => { mirrorValueToDesktop("fTag", fTag.value); rerun(); });
  sort?.addEventListener("change", () => { mirrorValueToDesktop("sort", sort.value); rerun(); });

  fBar?.addEventListener("change", () => { mirrorCheckedToDesktop("fBar", fBar.checked); rerun(); });
  fDelivery?.addEventListener("change", () => { mirrorCheckedToDesktop("fDelivery", fDelivery.checked); rerun(); });
  fPatio?.addEventListener("change", () => { mirrorCheckedToDesktop("fPatio", fPatio.checked); rerun(); });
  fVegan?.addEventListener("change", () => { mirrorCheckedToDesktop("fVegan", fVegan.checked); rerun(); });
  fLateNight?.addEventListener("change", () => { mirrorCheckedToDesktop("fLateNight", fLateNight.checked); rerun(); });

  clear?.addEventListener("click", () => {
    // click desktop clear so state stays consistent
    const d = document.getElementById("btnClearFilters");
    if (d) d.click();

    // then sync mobile UI to cleared defaults
    if (q) q.value = "";
    if (fNeighborhood) fNeighborhood.value = "all";
    if (fPrice) fPrice.value = "all";
    if (fTag) fTag.value = "all";
    if (fBar) fBar.checked = false;
    if (fDelivery) fDelivery.checked = false;
    if (fPatio) fPatio.checked = false;
    if (fVegan) fVegan.checked = false;
    if (fLateNight) fLateNight.checked = false;
    if (sort) sort.value = "name";

    rerun();
  });

  // sync mobile UI from desktop current state
  const dq = document.getElementById("q");
  const dNeighborhood = document.getElementById("fNeighborhood");
  const dPrice = document.getElementById("fPrice");
  const dTag = document.getElementById("fTag");
  const dBar = document.getElementById("fBar");
  const dDelivery = document.getElementById("fDelivery");
  const dPatio = document.getElementById("fPatio");
  const dVegan = document.getElementById("fVegan");
  const dLateNight = document.getElementById("fLateNight");
  const dSort = document.getElementById("sort");

  if (dq && q) q.value = dq.value;
  if (dNeighborhood && fNeighborhood) fNeighborhood.value = dNeighborhood.value;
  if (dPrice && fPrice) fPrice.value = dPrice.value;
  if (dTag && fTag) fTag.value = dTag.value;
  if (dBar && fBar) fBar.checked = dBar.checked;
  if (dDelivery && fDelivery) fDelivery.checked = dDelivery.checked;
  if (dPatio && fPatio) fPatio.checked = dPatio.checked;
  if (dVegan && fVegan) fVegan.checked = dVegan.checked;
  if (dLateNight && fLateNight) fLateNight.checked = dLateNight.checked;
  if (dSort && sort) sort.value = dSort.value;
}

function moveMapInto(container){
  const mapEl = $("#map");
  if (!mapEl || !container) return;
  container.appendChild(mapEl);
  setTimeout(() => map?.invalidateSize(), 120);
}

function moveMapHome(){
  const mapEl = $("#map");
  if (!mapEl || !mapHomeParent) return;

  if (mapHomeNextSibling){
    mapHomeParent.insertBefore(mapEl, mapHomeNextSibling);
  } else {
    mapHomeParent.appendChild(mapEl);
  }
  setTimeout(() => map?.invalidateSize(), 120);
}

function wireMobileOverlays(){
  const btnF = $("#btnOpenFilters");
  const btnM = $("#btnOpenMap");
  const panelF = $("#mobileFilters");
  const panelM = $("#mobileMap");
  const mapInner = $("#mobileMapInner");

  btnF?.addEventListener("click", () => {
    setOpen(panelF, true);
    cloneFiltersIntoMobile();
  });

  btnM?.addEventListener("click", () => {
    setOpen(panelM, true);
    if (mapInner) moveMapInto(mapInner);
  });

  for (const closeBtn of $all("[data-close]")){
    closeBtn.addEventListener("click", () => {
      setOpen(panelF, false);
      setOpen(panelM, false);
      moveMapHome();
    });
  }

  // click backdrop to close
  panelF?.addEventListener("click", (e) => {
    if (e.target === panelF) setOpen(panelF, false);
  });
  panelM?.addEventListener("click", (e) => {
    if (e.target === panelM){
      setOpen(panelM, false);
      moveMapHome();
    }
  });
}

/* =========================================================
   ORCHESTRATOR
   ========================================================= */
function applyFiltersAndRender(){
  filtered = applyFilters();
  renderList();
  renderMarkers();
}

/* =========================================================
   BOOT
   ========================================================= */
document.addEventListener("DOMContentLoaded", async () => {
  const host = $("#resultsList");

  try{
    CATALOG = await loadCatalog();
    APPROVED_REVIEWS = await loadApprovedReviews();
  }catch(err){
    console.error("[Bagelbites] Failed to load:", err);
    if (host){
      host.innerHTML = `
        <div class="emptyState">
          <div style="font-weight:900;margin-bottom:6px;">Couldn’t load data</div>
          <div class="muted">
            Make sure you are running a local server (not file://) and that
            <code>./data/restaurants.json</code> exists.
          </div>
        </div>
      `;
    }
    return;
  }

  buildFilters();
  initMap();
  wireMobileOverlays();

  filtered = CATALOG.slice();
  applyFiltersAndRender();

  console.log("[Bagelbites] restaurants:", CATALOG.length, "approved reviews:", APPROVED_REVIEWS.length);
});