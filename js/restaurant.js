/* =========================================================
   restaurant.js (FULL CLEAN + STARS)
   - Loads restaurant catalog from ./data/restaurants.json
   - Renders restaurant page by ?id=
   - Uses:
       * restaurant.initialReviews (seed reviews stored in JSON)
       * localStorage user reviews (write review form)
   - NO auto-seeding
   - Per-review: shows WHOLE rating + STAR ICONS (★★★★☆)
   ========================================================= */

function $(sel, root = document) { return root.querySelector(sel); }
function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

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

function ratingToPct(rating){
  const r = Math.max(0, Math.min(5, Number(rating) || 0));
  return (r / 5) * 100;
}

function getQueryId(){
  const p = new URLSearchParams(location.search);
  return p.get("id") || "";
}

const DATA_URL = "./data/restaurants.json";

/* ---------- Catalog loading ---------- */
async function loadCatalog(){
  const res = await fetch(DATA_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not load ${DATA_URL} (HTTP ${res.status})`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error("restaurants.json must be an array");
  return data;
}

function findRestaurant(catalog, id){
  return (catalog || []).find(r => String(r.id) === String(id)) || null;
}

/* ---------- Reviews storage (user submissions) ---------- */
const REV_KEY_VER = "v2";
function reviewStorageKey(id){ return `bagelbites_reviews_${REV_KEY_VER}_${id}`; }

function normalizeUserReview(rv){
  if (!rv) return null;

  const rating = Number(rv.rating);
  if (!(rating >= 1 && rating <= 5)) return null;

  const createdAt =
    Number.isFinite(rv.createdAt) ? rv.createdAt :
    (rv.createdAt ? Date.parse(rv.createdAt) : Date.now());

  return {
    id: String(rv.id || `user-${createdAt}`),
    author: String(rv.author || rv.name || "Anonymous"),
    rating,
    text: String(rv.text || "").trim(),
    photos: Array.isArray(rv.photos) ? rv.photos : [],
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now()
  };
}

function loadUserReviews(id){
  try{
    const raw = localStorage.getItem(reviewStorageKey(id));
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr.map(normalizeUserReview).filter(Boolean);
  }catch{
    return [];
  }
}

/* ---------- Seed reviews from JSON (initialReviews) ---------- */
function normalizeSeedReview(rv){
  if (!rv) return null;

  const rating = Number(rv.rating);
  const createdAt =
    Number.isFinite(rv.createdAt) ? rv.createdAt :
    (rv.createdAt ? Date.parse(rv.createdAt) : Date.now());

  return {
    id: String(rv.id || `seed-${createdAt}`),
    author: String(rv.author || rv.name || "Anonymous"),
    rating: Number.isFinite(rating) ? rating : 0,
    text: String(rv.text || ""),
    photos: Array.isArray(rv.photos) ? rv.photos : [],
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now()
  };
}

function getAllReviewsForRestaurant(restaurant){
  const id = String(restaurant?.id || "");
  const seed = (restaurant?.initialReviews || []).map(normalizeSeedReview).filter(Boolean);
  const user = loadUserReviews(id);
  return seed.concat(user);
}

/* ---------- Aggregates ---------- */
function computeAggregate(reviews){
  const n = reviews.length;
  if (!n) return { avg: 0, count: 0, breakdown: {1:0,2:0,3:0,4:0,5:0} };

  let sum = 0;
  const b = {1:0,2:0,3:0,4:0,5:0};

  for (const rv of reviews){
    const raw = Number(rv.rating);
    const bucket = Math.max(1, Math.min(5, Math.round(Number.isFinite(raw) ? raw : 0)));
    b[bucket] += 1;
    sum += Number.isFinite(raw) ? raw : bucket;
  }

  return { avg: sum / n, count: n, breakdown: b };
}

/* ---------- UI helpers ---------- */
function setRestaurantFont(fontName){
  if (!fontName) return;

  const link = $("#restaurantFontLink");
  if (link){
    const family = encodeURIComponent(fontName).replaceAll("%20", "+");
    link.href = `https://fonts.googleapis.com/css2?family=${family}&display=swap`;
  }

  document.documentElement.style.setProperty(
    "--restaurantFont",
    `'${fontName}', ${getComputedStyle(document.documentElement).getPropertyValue("--font")}`
  );
}

function renderTags(tags){
  const wrap = $("#tagRow");
  if (!wrap) return;
  wrap.innerHTML = "";
  for (const t of (tags || [])){
    const el = document.createElement("span");
    el.className = "tag";
    el.textContent = t;
    wrap.appendChild(el);
  }
}

function renderHighlights(list){
  const wrap = $("#highlights");
  if (!wrap) return;
  wrap.innerHTML = "";
  for (const h of (list || [])){
    const row = document.createElement("div");
    row.className = "highlight";
    row.innerHTML = `
      <div class="hiIcon" aria-hidden="true">${escapeHtml(h.icon || "✨")}</div>
      <div>
        <div class="hiTitle">${escapeHtml(h.title || "")}</div>
        <div class="muted small">${escapeHtml(h.desc || "")}</div>
      </div>
    `;
    wrap.appendChild(row);
  }
}

function renderAmenities(list){
  const wrap = $("#amenities");
  if (!wrap) return;
  wrap.innerHTML = "";
  for (const a of (list || [])){
    const row = document.createElement("div");
    row.className = "amenity";
    row.textContent = a;
    wrap.appendChild(row);
  }
}

function renderBreakdown(agg){
  const wrap = $("#breakdown");
  if (!wrap) return;
  wrap.innerHTML = "";

  const total = agg.count || 0;

  for (let stars = 5; stars >= 1; stars--){
    const count = agg.breakdown[stars] || 0;
    const pct = total ? (count / total) * 100 : 0;

    const row = document.createElement("div");
    row.className = "bdRow";
    row.innerHTML = `
      <div class="bdLabel">${stars} ★</div>
      <div class="bdBar"><div class="bdFill" style="width:${pct.toFixed(1)}%"></div></div>
      <div class="bdCount">${count}</div>
    `;
    wrap.appendChild(row);
  }
}

function normalizePhotoSrc(p){
  let src = "";
  if (typeof p === "string") src = p;
  else if (p && typeof p === "object") src = p.value || p.url || "";

  src = String(src || "").trim();
  if (!src) return "";

  if (src.startsWith("./")) src = src.slice(2);
  if (src.startsWith("/")) src = src.slice(1);
  src = src.replace(/^data\//, "");

  return src;
}

function renderPhotoStrip(reviews){
  const strip = $("#photoStrip");
  if (!strip) return;

  const photos = [];
  for (const rv of (reviews || [])){
    const who = rv.author || "anonymous";
    for (const p of (Array.isArray(rv.photos) ? rv.photos : [])){
      const src = normalizePhotoSrc(p);
      if (!src) continue;
      photos.push({ src, who });
    }
  }

  if (!photos.length){
    strip.innerHTML = `<div class="pad muted">No reviewer photos yet. Be the first to drop the evidence.</div>`;
    return;
  }

  const row = document.createElement("div");
  row.className = "photoRow";

  for (const ph of photos){
    const fig = document.createElement("figure");
    fig.className = "photoItem";
    fig.innerHTML = `
      <img
        src="${escapeHtml(ph.src)}"
        alt="Photo uploaded by ${escapeHtml(ph.who)}"
        loading="lazy"
        decoding="async"
        onerror="this.style.display='none'; console.warn('Broken strip image:', this.src);"
      />
      <figcaption>by ${escapeHtml(ph.who)}</figcaption>
    `;
    row.appendChild(fig);
  }

  strip.innerHTML = "";
  strip.appendChild(row);

  startAutoScrollStrip(strip);
}

function starsText(rating){
  const n = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
  return "★".repeat(n) + "☆".repeat(5 - n);
}

function safeDate(d){
  const dt = new Date(d || Date.now());
  return Number.isNaN(dt.getTime()) ? new Date().toLocaleDateString() : dt.toLocaleDateString();
}

/* ---------- Reviews list (WITH STAR ICONS + WHOLE NUMBER) ---------- */
function renderReviewsList(reviews){
  const wrap = $("#reviewsList");
  if (!wrap) return;
  wrap.innerHTML = "";

  if (!reviews || !reviews.length){
    wrap.innerHTML = `<p class="muted" style="margin:0;">No reviews yet. The silence is loud.</p>`;
    return;
  }

  for (const rv of reviews){
    const name = rv.author || rv.name || "anonymous";
    const rating = Number(rv.rating ?? 0) || 0;
    const rounded = Math.max(0, Math.min(5, Math.round(rating)));

    const photoHtml = (Array.isArray(rv.photos) ? rv.photos : [])
      .map(ph => {
        const src = normalizePhotoSrc(ph);
        if (!src) return "";
        return `
          <img
            src="${escapeHtml(src)}"
            alt="Review photo"
            loading="lazy"
            decoding="async"
            onerror="this.style.display='none'; console.warn('Broken image:', this.src);"
          />
        `;
      })
      .filter(Boolean)
      .join("");

    const el = document.createElement("div");
    el.className = "review";
    el.innerHTML = `
      <div>
        <div class="reviewTop">
          <div>
            <div class="reviewName">${escapeHtml(name)}</div>

            <div class="reviewRating">
              <div class="starBar" aria-hidden="true">
                <div class="starFill" style="width:${ratingToPct(rating)}%"></div>
              </div>

              <span class="starNum" title="${rounded} out of 5">
                ${starsText(rounded)} <span class="muted">(${rounded})</span>
              </span>
            </div>
          </div>
          <div class="muted small">${safeDate(rv.createdAt)}</div>
        </div>

        <p class="reviewText">${escapeHtml(rv.text || "")}</p>

        ${photoHtml ? `<div class="rvPhotos">${photoHtml}</div>` : ``}
      </div>
    `;
    wrap.appendChild(el);
  }
}

/* ---------- Controls ---------- */
function applyReviewControls(all){
  const sort = $("#sortReviews")?.value || "newest";
  const stars = $("#filterStars")?.value || "all";
  const onlyPhotos = $("#onlyPhotos")?.checked || false;

  let out = all.slice();

  if (stars !== "all"){
    const n = Number(stars);
    out = out.filter(r => Math.round(Number(r.rating) || 0) === n);
  }

  if (onlyPhotos){
    out = out.filter(r => (r.photos || []).length > 0);
  }

  switch (sort){
    case "highest":
      out.sort((a,b) => (b.rating - a.rating) || (b.createdAt - a.createdAt));
      break;
    case "lowest":
      out.sort((a,b) => (a.rating - b.rating) || (b.createdAt - a.createdAt));
      break;
    case "photos":
      out.sort((a,b) => ((b.photos?.length || 0) - (a.photos?.length || 0)) || (b.createdAt - a.createdAt));
      break;
    default:
      out.sort((a,b) => (b.createdAt - a.createdAt));
  }

  return out;
}

function startAutoScrollStrip(stripEl){
  if (!stripEl) return;

  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (prefersReduced) return;

  const canScroll = stripEl.scrollWidth > stripEl.clientWidth + 10;
  if (!canScroll) return;

  let dir = 1;
  let paused = false;

  const tick = () => {
    if (!stripEl.isConnected) return;

    if (!paused){
      stripEl.scrollLeft += dir * 0.6;
      if (stripEl.scrollLeft <= 0) dir = 1;
      if (stripEl.scrollLeft + stripEl.clientWidth >= stripEl.scrollWidth - 2) dir = -1;
    }
    requestAnimationFrame(tick);
  };

  stripEl.addEventListener("mouseenter", () => paused = true);
  stripEl.addEventListener("mouseleave", () => paused = false);
  stripEl.addEventListener("touchstart", () => paused = true, { passive: true });
  stripEl.addEventListener("touchend", () => paused = false, { passive: true });

  requestAnimationFrame(tick);
}

/* ---------- Mini map ---------- */
function y2kPinIcon(){
  return L.divIcon({
    className: "y2kPin",
    html: `<div class="pinCore"></div>`,
    iconSize: [34, 44],
    iconAnchor: [17, 38]
  });
}

function initRestaurantMiniMap(lat, lng){
  const el = $("#rMap");
  if (!el || typeof L === "undefined") return;

  const m = L.map(el, { zoomControl: false, dragging: true, scrollWheelZoom: false })
    .setView([lat, lng], 14);

  // Dark mini map too (matches your vibe)
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png", {
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
    subdomains: "abcd",
    maxZoom: 20
  }).addTo(m);

  L.marker([lat, lng], { icon: y2kPinIcon() }).addTo(m);

  setTimeout(() => m.invalidateSize(), 250);
}

/* ---------- Wiring ---------- */
function wireRestaurantControls(allReviews, r){
  const rerender = () => {
    const filteredList = applyReviewControls(allReviews);
    renderReviewsList(filteredList);

    const meta = $("#reviewHeaderMeta");
    if (meta){
      meta.textContent = `${allReviews.length} total • showing ${filteredList.length}`;
    }
  };

  $("#sortReviews")?.addEventListener("change", rerender);
  $("#filterStars")?.addEventListener("change", rerender);
  $("#onlyPhotos")?.addEventListener("change", rerender);

  $("#btnAddPhotos")?.addEventListener("click", () => {
    alert("Photo upload happens on the Write Review form. 📸");
  });

  const wr = $("#btnWriteReview");
  if (wr) wr.href = `./assets/writereview.html?id=${encodeURIComponent(r.id)}`;

  rerender();
}

function renderRestaurant(r){
  $("#crumbName") && ($("#crumbName").textContent = r.name);
  $("#rName") && ($("#rName").textContent = r.name);
  $("#rMeta") && ($("#rMeta").textContent = `${r.locationText || ""}${r.price ? ` • ${r.price}` : ""}`);

  renderTags(r.tags);

  const heroEl = $("#heroImg");
  if (heroEl){
    heroEl.style.backgroundImage = r.hero ? `url("${r.hero}")` : "";
    heroEl.dataset.hero = r.hero || "";
  }

  setRestaurantFont(r.fontGoogle);

  const reviewEl = $("#bagelholeReview");
  if (reviewEl){
    const safe = escapeHtml(r.bagelholeReview || "").replace(/\n/g, "<br><br>");
    reviewEl.innerHTML = safe;
    reviewEl.dataset.firstline = firstSentence(reviewEl.textContent || "");
  }

  renderHighlights(r.highlights);
  renderAmenities(r.amenities);

  const allReviews = getAllReviewsForRestaurant(r);
  const agg = computeAggregate(allReviews);
  const hasRatings = agg.count > 0;

  const avgNum = $("#avgNum");
  if (avgNum) avgNum.textContent = hasRatings ? String(Math.round(agg.avg)) : "No ratings yet";

  const revCount = $("#revCount");
  if (revCount) revCount.textContent = hasRatings ? `${agg.count} reviews` : "Be the first to review";

  const avgFill = $("#avgFill");
  if (avgFill) avgFill.style.width = hasRatings ? `${ratingToPct(agg.avg)}%` : "0%";

  renderBreakdown(agg);
  renderPhotoStrip(allReviews);

  const hdrMeta = $("#reviewHeaderMeta");
  if (hdrMeta) hdrMeta.textContent = hasRatings ? `${agg.count} total` : "No reviews yet";

  wireRestaurantControls(allReviews, r);

  if (Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lng))){
    initRestaurantMiniMap(Number(r.lat), Number(r.lng));
  }
}

/* ---------- Boot ---------- */
document.addEventListener("DOMContentLoaded", async () => {
  const id = getQueryId();

  let catalog = [];
  try{
    catalog = await loadCatalog();
  }catch(err){
    console.error("[Bagelhole] Failed to load catalog:", err);
    $("#rName") && ($("#rName").textContent = "Catalog not loading");
    $("#crumbName") && ($("#crumbName").textContent = "Error");
    $("#bagelholeReview") && ($("#bagelholeReview").textContent =
      "Couldn’t load ./data/restaurants.json. Make sure you’re running a local server, not file://."
    );
    return;
  }

  const r = findRestaurant(catalog, id);
  if (!r){
    $("#rName") && ($("#rName").textContent = "Restaurant not found");
    $("#crumbName") && ($("#crumbName").textContent = "Not found");
    $("#bagelholeReview") && ($("#bagelholeReview").textContent =
      "Try going back to the index and clicking a restaurant card again."
    );
    return;
  }

  renderRestaurant(r);
});