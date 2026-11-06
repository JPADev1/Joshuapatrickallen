/* Site menu (every page) + footer links.
   Fill these two in once and every page picks them up:
     venmo        your Venmo handle without the @, e.g. "JPA-Stats"
     suggestForm  the share link of your Google Form, e.g. "https://forms.gle/abc123"
   Until they're filled in, the Tip jar and Suggestions pages say "coming soon". */
var SITE = { venmo: "JPADev", suggestForm: "https://forms.gle/Fw46NaV3WLKChEew8" };

(function () {
  var here = location.pathname.replace(/\/$/, "/index.html").split("/").pop() || "index.html";
  var items = [
    ["index.html", "/", "Stats & records"],
    ["matchup.html", "matchup.html", "Next game"],
    ["touchdown-mountain.html", "touchdown-mountain.html", "Touchdown Mountain"],
    ["mountain.html", "mountain.html", "Stat mountains"],
    null,
    ["about.html", "about.html", "About"],
    ["suggest.html", "suggest.html", "Site suggestions"],
    ["tip.html", "tip.html", "Tip jar"],
    ["disclaimer.html", "disclaimer.html", "Disclaimer"]
  ];
  var esc = function (s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;"); };
  var btn = document.createElement("button");
  btn.type = "button"; btn.className = "mbtn"; btn.setAttribute("aria-label", "Menu");
  btn.setAttribute("aria-expanded", "false"); btn.setAttribute("aria-controls", "sitemenu");
  btn.innerHTML = "<span></span><span></span><span></span>";
  var panel = document.createElement("nav");
  panel.id = "sitemenu"; panel.className = "mpanel"; panel.setAttribute("aria-label", "Site menu"); panel.hidden = true;
  panel.innerHTML = '<div class="mhead">Joshua Patrick Allen</div><ul>' + items.map(function (it) {
    if (!it) return '<li class="msep" role="separator"></li>';
    return '<li><a href="' + it[1] + '"' + (it[0] === here ? ' aria-current="page"' : "") + ">" + esc(it[2]) + "</a></li>";
  }).join("") + "</ul>";
  var shade = document.createElement("div"); shade.className = "mshade"; shade.hidden = true;
  function set(open) {
    panel.hidden = !open; shade.hidden = !open; btn.setAttribute("aria-expanded", String(open));
    document.documentElement.classList.toggle("mopen", open);
    if (open) { var a = panel.querySelector("a"); a && a.focus(); } else { btn.focus({ preventScroll: true }); }
  }
  btn.addEventListener("click", function () { set(panel.hidden); });
  shade.addEventListener("click", function () { set(false); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !panel.hidden) set(false); });
  document.body.appendChild(shade); document.body.appendChild(panel); document.body.appendChild(btn);

  // Footer links under the existing footer line
  var foot = document.querySelector("footer");
  if (foot) {
    var p = document.createElement("p"); p.className = "flinks";
    p.innerHTML = '<a href="about.html">About</a> &middot; <a href="suggest.html">Suggestions</a> &middot; <a href="tip.html">Tip jar</a> &middot; <a href="disclaimer.html">Disclaimer</a>';
    foot.parentNode.insertBefore(p, foot.nextSibling);
  }

  // Tip jar and suggestions pages: fill in the links when they're set
  var v = document.getElementById("venmoBox");
  if (v) {
    v.innerHTML = SITE.venmo
      ? '<a class="cta venmo" href="https://venmo.com/u/' + encodeURIComponent(SITE.venmo) + '" target="_blank" rel="noopener noreferrer">Tip on Venmo <small>@' + esc(SITE.venmo) + "</small></a>"
      : '<p class="soon">The tip jar is coming soon.</p>';
  }
  var s = document.getElementById("suggestBox");
  if (s) {
    s.innerHTML = SITE.suggestForm
      ? '<a class="cta" href="' + esc(SITE.suggestForm) + '" target="_blank" rel="noopener noreferrer">Open the suggestion form</a>'
      : '<p class="soon">The suggestion form is coming soon.</p>';
  }
})();
