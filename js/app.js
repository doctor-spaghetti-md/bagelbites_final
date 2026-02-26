/* =========================================================
   app.js (FULL)
   Bagelhole Restaurant Review Ecosystem
   - Loads ./data/restaurants.json
   - Desktop: sticky filters + sticky map (CSS), scroll results only
   - 15 results per page (Yelp-ish)
   - Leaflet map with pink Y2K pins
   - Mobile: overlays for Filters + Map
     - Filters overlay clones the sidebar UI
     - Map overlay temporarily moves the same #map into the modal (then back)
   - Main page cards show:
     - star rating (partial fill)
     - avg rating number
     - review count (from localStorage)
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

function ratingToPct(rating){
  const r = Math.max(0, Math.min(5, Number(rating) || 0));
  return (r / 5) * 100;
}

/* ---------- Reviews storage (for main page aggregates) ---------- */
const REV_KEY_VER = "v2";
function reviewStorageKey(id){
  return `bagelbites_reviews_${REV_KEY_VER}_${id}`;
}

function loadReviews(id){
  try{
    const raw = localStorage.getItem(reviewStorageKey(id));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  }catch{
    return [];
  }
}

function computeAggregate(reviews){
  const n = reviews.length;
  if (!n) return { avg: 0, count: 0 };

  let sum = 0;
  for (const rv of reviews){
    const val = Number(rv.rating);
    sum += Number.isFinite(val) ? val : 0;
  }
  return { avg: sum / n, count: n };
}

function formatCount(n){
  const x = Number(n) || 0;
  return `${x} review${x === 1 ? "" : "s"}`;
}


/* ---------- Reviews merge: JSON seed + localStorage ---------- */
function normalizeSeedReview(rv){
  if (!rv) return null;
  const rating = Number(rv.rating);
  const createdAt = rv.createdAt ? Date.parse(rv.createdAt) : NaN;
  return {
    id: String(rv.id || `seed_${Math.random().toString(16).slice(2)}`),
    name: String(rv.name || "Anonymous"),
    rating: Number.isFinite(rating) ? rating : 0,
    text: String(rv.text || ""),
    photos: Array.isArray(rv.photos) ? rv.photos : [],
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now()
  };
}

function getAllReviewsForRestaurant(r){
  const seed = (r?.initialReviews || []).map(normalizeSeedReview).filter(Boolean);
  const user = loadReviews(r.id);
  return seed.concat(user);
}

const DATA_URL = "./data/restaurants.json";
const PAGE_SIZE = 15;

let CATALOG = [];
let filtered = [];
let page = 1;

let map = null;
let markerLayer = null;

let mapHomeParent = null;
let mapHomeNextSibling = null;

/* ---------- Load catalog ---------- */
async function loadCatalog(){
  const res = await fetch(DATA_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not load ${DATA_URL} (HTTP ${res.status})`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error("restaurants.json must be an array");

  return data
    .filter(r => r && r.id && r.name)
    .map(r => ({
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
      highlights: Array.isArray(r.highlights) ? r.highlights : [],
      initialReviews: Array.isArray(r.initialReviews) ? r.initialReviews : []
    }));
}

/* ---------- Filters UI ---------- */
function buildFilters(){
  const host = $("#filterSidebar");
  if (!host) return;

  const neighborhoods = uniq(CATALOG.map(r => r.neighborhood).filter(Boolean)).sort((a,b)=>a.localeCompare(b));
  const tags = uniq(CATALOG.flatMap(r => r.tags || []).filter(Boolean)).sort((a,b)=>a.localeCompare(b));

  host.innerHTML = `
    <div class="filterBlock">
      <div class="filterTitle">Filters</div>

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
          <span>Late Night</span>
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
$("#fNeighborhood")?.addEventListener("change", rerun);
  $("#fPrice")?.addEventListener("change", rerun);
  $("#fTag")?.addEventListener("change", rerun);

  $("#fBar")?.addEventListener("change", rerun);
  $("#fDelivery")?.addEventListener("change", rerun);
  $("#fPatio")?.addEventListener("change", rerun);
  $("#fVegan")?.addEventListener("change", rerun);
  $("#fLateNight")?.addEventListener("change", rerun);

  $("#sort")?.addEventListener("change", rerun);

  $("#btnClearFilters")?.addEventListener("click", () => {    $("#fNeighborhood").value = "all";
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
  return {    neighborhood: $("#fNeighborhood")?.value || "all",
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

/* ---------- Results rendering ---------- */
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

      // NEW: rating + count from localStorage
      const reviews = getAllReviewsForRestaurant(r);
      const agg = computeAggregate(reviews);
      const avgText = agg.avg ? agg.avg.toFixed(1) : "—";
      const countText = formatCount(agg.count);
      const pct = ratingToPct(agg.avg);

      const ratingRow = `
        <div class="rRatingRow">
          <div class="rStars" aria-label="${escapeHtml(avgText)} out of 5 stars">
            <div class="starsBase">★★★★★</div>
            <div class="starsFill" style="width:${pct}%;">★★★★★</div>
          </div>
          <div class="rRatingMeta">
            <span class="avg">${escapeHtml(avgText)}</span>
            <span class="dot">•</span>
            <span>${escapeHtml(countText)}</span>
          </div>
        </div>
      `;

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

            ${ratingRow}

            <div class="rMeta">${escapeHtml(r.locationText || "")}</div>
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

/* ---------- Map ---------- */
function y2kPinIcon(){
  return L.divIcon({
    className: "y2kPin",
    html: `<div class="pinCore"></div>`,
    iconSize: [34, 44],
    iconAnchor: [17, 38]
  });
}

function initMap(){
  const el = $("#map");
  if (!el) return;
  if (typeof L === "undefined") return;

  // save the home position so we can re-parent into mobile overlay
  mapHomeParent = el.parentElement;
  mapHomeNextSibling = el.nextSibling;

  const first = CATALOG.find(r => Number.isFinite(r.lat) && Number.isFinite(r.lng));
  const center = first ? [first.lat, first.lng] : [36.8508, -76.2859];

  map = L.map(el, { zoomControl: true, scrollWheelZoom: true }).setView(center, 12);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO"
  }).addTo(map);

  markerLayer = L.layerGroup().addTo(map);

  setTimeout(() => map.invalidateSize(), 250);
  window.addEventListener("resize", () => setTimeout(() => map?.invalidateSize(), 100));
}

function renderMarkers(){
  if (!map || !markerLayer || typeof L === "undefined") return;

  markerLayer.clearLayers();

  // pin only current page slice
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

/* ---------- Mobile overlays ---------- */
function setOpen(el, open){
  if (!el) return;
  el.classList.toggle("is-open", !!open);
  el.setAttribute("aria-hidden", open ? "false" : "true");
}

function cloneFiltersIntoMobile(){
  const src = $("#filterSidebar");
  const dest = $("#mobileFiltersBody");
  if (!src || !dest) return;

  dest.innerHTML = src.innerHTML;

  const rerun = () => { page = 1; applyFiltersAndRender(); };

  // Proper scoping: find elements inside dest by their ids
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

  function mirrorSelect(mobileEl, desktopId){
    mobileEl?.addEventListener("change", () => {
      const d = document.getElementById(desktopId);
      if (d && d !== mobileEl) d.value = mobileEl.value;
      rerun();
    });
  }

  function mirrorCheck(mobileEl, desktopId){
    mobileEl?.addEventListener("change", () => {
      const d = document.getElementById(desktopId);
      if (d && d !== mobileEl) d.checked = mobileEl.checked;
      rerun();
    });
  }

  mirrorSelect(fNeighborhood, "fNeighborhood");
  mirrorSelect(fPrice, "fPrice");
  mirrorSelect(fTag, "fTag");
  mirrorSelect(sort, "sort");

  mirrorCheck(fBar, "fBar");
  mirrorCheck(fDelivery, "fDelivery");
  mirrorCheck(fPatio, "fPatio");
  mirrorCheck(fVegan, "fVegan");
  mirrorCheck(fLateNight, "fLateNight");

  clear?.addEventListener("click", () => {
    const d = document.getElementById("btnClearFilters");
    if (d && d !== clear) d.click();
    fNeighborhood.value = "all";
    fPrice.value = "all";
    fTag.value = "all";
    fBar.checked = false;
    fDelivery.checked = false;
    fPatio.checked = false;
    fVegan.checked = false;
    fLateNight.checked = false;
    sort.value = "name";
    rerun();
  });
  // Sync mobile UI from desktop current state once
  const dNeighborhood = document.getElementById("fNeighborhood");
  const dPrice = document.getElementById("fPrice");
  const dTag = document.getElementById("fTag");
  const dBar = document.getElementById("fBar");
  const dDelivery = document.getElementById("fDelivery");
  const dPatio = document.getElementById("fPatio");
  const dVegan = document.getElementById("fVegan");
  const dLateNight = document.getElementById("fLateNight");
  const dSort = document.getElementById("sort");
  if (dNeighborhood && dNeighborhood !== fNeighborhood) fNeighborhood.value = dNeighborhood.value;
  if (dPrice && dPrice !== fPrice) fPrice.value = dPrice.value;
  if (dTag && dTag !== fTag) fTag.value = dTag.value;
  if (dBar && dBar !== fBar) fBar.checked = dBar.checked;
  if (dDelivery && dDelivery !== fDelivery) fDelivery.checked = dDelivery.checked;
  if (dPatio && dPatio !== fPatio) fPatio.checked = dPatio.checked;
  if (dVegan && dVegan !== fVegan) fVegan.checked = dVegan.checked;
  if (dLateNight && dLateNight !== fLateNight) fLateNight.checked = dLateNight.checked;
  if (dSort && dSort !== sort) sort.value = dSort.value;
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

/* ---------- Orchestrator ---------- */
function applyFiltersAndRender(){
  filtered = applyFilters();
  renderList();
  renderMarkers();
}

/* ---------- Boot ---------- */
document.addEventListener("DOMContentLoaded", async () => {
  const host = $("#resultsList");

  try{
    CATALOG = await loadCatalog();
  }catch(err){
    console.error("[Bagelhole] Failed to load catalog:", err);
    if (host){
      host.innerHTML = `
        <div class="emptyState">
          <div style="font-weight:900;margin-bottom:6px;">Couldn’t load restaurants.json</div>
          <div class="muted">Make sure you are running a local server (not file://) and that <code>./data/restaurants.json</code> exists.</div>
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

  console.log("[Bagelhole] Loaded:", CATALOG.map(r => r.id));
});
