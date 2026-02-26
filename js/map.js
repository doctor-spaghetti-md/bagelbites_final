function $(sel, root=document){ return root.querySelector(sel); }
const DATA_URL = "./data/restaurants.json";

function escapeHtml(str){
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function y2kPinIcon(){
  return L.divIcon({
    className: "y2kPin",
    html: `<div class="pinCore"></div>`,
    iconSize: [34, 44],
    iconAnchor: [17, 38]
  });
}

async function loadRestaurants(){
  const r = await fetch(DATA_URL, { cache:"no-store" });
  if (!r.ok) throw new Error(`Failed to load ${DATA_URL} (${r.status})`);
  const data = await r.json();
  if (!Array.isArray(data)) throw new Error("restaurants.json must be an array");
  return data;
}

document.addEventListener("DOMContentLoaded", async () => {
  const el = $("#fullMap");
  if (!el || typeof L === "undefined") return;

  try{
    const restaurants = await loadRestaurants();

    // Default center (fallback)
    let center = [36.8508, -76.2859];
    if (restaurants.length){
      // average lat/lng for initial view
      const avg = restaurants.reduce((a, r) => {
        a.lat += Number(r.lat) || 0;
        a.lng += Number(r.lng) || 0;
        return a;
      }, { lat:0, lng:0 });
      center = [avg.lat / restaurants.length, avg.lng / restaurants.length];
    }

    const m = L.map(el, { zoomControl:true }).setView(center, 12);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; OpenStreetMap contributors &copy; CARTO"
    }).addTo(m);

    const bounds = [];

    for (const r of restaurants){
      if (typeof r.lat !== "number" || typeof r.lng !== "number") continue;

      const pop = `
        <div class="mapPopName">${escapeHtml(r.name || "")}</div>
        <div class="mapPopMeta">${escapeHtml(r.locationText || "")}</div>
        <a class="mapPopLink" href="./restaurant.html?id=${encodeURIComponent(r.id)}">Open</a>
      `;

      const marker = L.marker([r.lat, r.lng], { icon: y2kPinIcon() })
        .addTo(m)
        .bindPopup(pop);

      bounds.push([r.lat, r.lng]);
    }

    if (bounds.length){
      m.fitBounds(bounds, { padding: [30, 30] });
    }

    setTimeout(() => m.invalidateSize(), 250);
  }catch(err){
    console.error(err);
    el.innerHTML = `<div class="pad muted">Map failed to load.</div>`;
  }
});