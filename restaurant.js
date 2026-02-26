/* =========================================================
   restaurant.js (FULL REWRITE)
   - Loads restaurant catalog from ./data/restaurants.json
   - Renders restaurant page by ?id=
   - Stores hero + firstline as data attributes (for optional index scraping)
   - Uses localStorage for reviews (kept as-is)
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

/* ---------- Reviews storage ---------- */
function storageKey(id){ return `bagelbites_reviews_${id}`; }

function loadReviews(id){
  try{
    const raw = localStorage.getItem(storageKey(id));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  }catch{
    return [];
  }
}

function saveReviews(id, reviews){
  localStorage.setItem(storageKey(id), JSON.stringify(reviews));
}

/* Seed one staff review if none exist (nice for demo)
   Uses r.seedRating if present, else 4.5 */
function ensureSeedReview(r){
  const existing = loadReviews(r.id);
  if (existing.length) return existing;

  const seeded = [
    {
      id: crypto.randomUUID?.() || String(Date.now()),
      name: "Bagelhole Desk",
      rating: Number.isFinite(Number(r.seedRating)) ? Number(r.seedRating) : 4.5,
      text: firstSentence(r.bagelholeReview) + " (Filed under: important culinary evidence.)",
      photos: [],
      createdAt: Date.now() - 1000 * 60 * 60 * 24 * 5
    }
  ];
  saveReviews(r.id, seeded);
  return seeded;
}

function computeAggregate(reviews){
  const n = reviews.length;
  if (!n) return { avg: 0, count: 0, breakdown: {1:0,2:0,3:0,4:0,5:0} };

  let sum = 0;
  const b = {1:0,2:0,3:0,4:0,5:0};

  for (const rv of reviews){
    const rating = Math.max(1, Math.min(5, Math.round(Number(rv.rating) || 0)));
    b[rating] += 1;
    sum += Number(rv.rating) || rating;
  }

  return { avg: sum / n, count: n, breakdown: b };
}

function setRestaurantFont(fontName){
  if (!fontName) return;

  const link = $("#restaurantFontLink");
  if (link){
    const family = encodeURIComponent(fontName).replaceAll("%20", "+");
    link.href = `https://fonts.googleapis.com/css2?family=${family}&display=swap`;
  }

  // Apply via CSS variable so style.css can use it
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

function renderPhotoStrip(reviews){
  const strip = $("#photoStrip");
  if (!strip) return;

  const photos = [];
  for (const rv of reviews){
    for (const p of (rv.photos || [])){
      photos.push({ src: p, who: rv.name });
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
      <img src="${escapeHtml(ph.src)}" alt="Photo uploaded by ${escapeHtml(ph.who)}" loading="lazy" />
      <figcaption>by ${escapeHtml(ph.who)}</figcaption>
    `;
    row.appendChild(fig);
  }

  strip.innerHTML = "";
  strip.appendChild(row);

  startAutoScrollStrip(strip);
}

function renderReviewsList(reviews){
  const wrap = $("#reviewsList");
  if (!wrap) return;
  wrap.innerHTML = "";

  if (!reviews.length){
    wrap.innerHTML = `<p class="muted" style="margin:0;">No reviews yet. The silence is loud.</p>`;
    return;
  }

  for (const rv of reviews){
    const photos = (rv.photos || []).map(p => `<img src="${escapeHtml(p)}" alt="Review photo" loading="lazy" />`).join("");

    const el = document.createElement("div");
    el.className = "review";
    el.innerHTML = `

      <div>
        <div class="reviewTop">
          <div>
            <div class="reviewName">${escapeHtml(rv.name)}</div>
            <div class="reviewRating">
              <div class="starBar" aria-hidden="true">
                <div class="starFill" style="width:${ratingToPct(rv.rating)}%"></div>
              </div>
              <span class="starNum">${Number(rv.rating).toFixed(1)}</span>
            </div>
          </div>
          <div class="muted small">${new Date(rv.createdAt || Date.now()).toLocaleDateString()}</div>
        </div>

        <p class="reviewText">${escapeHtml(rv.text || "")}</p>

        ${photos ? `<div class="rvPhotos">${photos}</div>` : ``}
      </div>
    `;
    wrap.appendChild(el);
  }
}

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

  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO"
  }).addTo(m);

  L.marker([lat, lng], { icon: y2kPinIcon() }).addTo(m);

  setTimeout(() => m.invalidateSize(), 250);
}

function wireRestaurantControls(allReviews, r){
  const rerender = () => {
    const filtered = applyReviewControls(allReviews);
    renderReviewsList(filtered);

    const meta = $("#reviewHeaderMeta");
    if (meta) meta.textContent = `${allReviews.length} total • showing ${filtered.length}`;
  };

  $("#sortReviews")?.addEventListener("change", rerender);
  $("#filterStars")?.addEventListener("change", rerender);
  $("#onlyPhotos")?.addEventListener("change", rerender);

  $("#btnAddPhotos")?.addEventListener("click", () => {
    alert("Photo upload is coming next (writereview.html + storage). For now it’s vibes only.");
  });

  // Make the Write Review button carry the restaurant id
  const wr = $("#btnWriteReview");
  if (wr) wr.href = `./writereview.html?id=${encodeURIComponent(r.id)}`;

  rerender();
}

function renderRestaurant(r){
  $("#crumbName") && ($("#crumbName").textContent = r.name);

  $("#rName") && ($("#rName").textContent = r.name);
  $("#rMeta") && ($("#rMeta").textContent = `${r.locationText} • ${r.price}`);

  renderTags(r.tags);

  // hero
  const heroEl = $("#heroImg");
  if (heroEl){
    heroEl.style.backgroundImage = `url("${r.hero}")`;
    heroEl.dataset.hero = r.hero;
  }

  // font
  setRestaurantFont(r.fontGoogle);

  // Bagelhole review
  const reviewEl = $("#bagelholeReview");
  if (reviewEl){
    const safe = escapeHtml(r.bagelholeReview).replace(/\n/g, "<br><br>");
    reviewEl.innerHTML = safe;

    const first = firstSentence(reviewEl.textContent || "");
    reviewEl.dataset.firstline = first;
  }

  // sidebar content
  renderHighlights(r.highlights);
  renderAmenities(r.amenities);

  // Reviews (localStorage)
  const stored = ensureSeedReview(r);
  const agg = computeAggregate(stored);

  $("#avgNum") && ($("#avgNum").textContent = agg.avg ? agg.avg.toFixed(1) : "—");
  $("#revCount") && ($("#revCount").textContent = `${agg.count} reviews`);
  $("#avgFill") && ($("#avgFill").style.width = `${ratingToPct(agg.avg)}%`);

  renderBreakdown(agg);
  renderPhotoStrip(stored);

  $("#reviewHeaderMeta") && ($("#reviewHeaderMeta").textContent = `${agg.count} total`);
  wireRestaurantControls(stored, r);

  // mini map
  if (Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lng))){
    initRestaurantMiniMap(r.lat, r.lng);
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
    $("#bagelholeReview") && ($("#bagelholeReview").textContent = "Couldn’t load ./data/restaurants.json. Make sure you’re running a local server, not file://.");
    return;
  }

  const r = findRestaurant(catalog, id);

  if (!r){
    $("#rName") && ($("#rName").textContent = "Restaurant not found");
    $("#crumbName") && ($("#crumbName").textContent = "Not found");
    $("#bagelholeReview") && ($("#bagelholeReview").textContent = "Try going back to the index and clicking a restaurant card again.");
    return;
  }

  renderRestaurant(r);
});