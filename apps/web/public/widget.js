/*!
 * SplitStream embeddable TipJar widget.
 *
 * Drop this on any site to monetize a piece — one payment splits to every
 * contributor on Arc, no wallet required:
 *
 *   <script src="https://YOUR-SITE/widget.js" data-piece="PIECE_ID"></script>
 *
 * Optional attributes:
 *   data-width="360"   iframe width (px or any CSS width; default 360px)
 *   data-base="https://your-site"   override the SplitStream origin (defaults
 *                                    to where this script is served from)
 *
 * The script replaces itself with a responsive, auto-resizing iframe.
 */
(function () {
  var s = document.currentScript;
  if (!s) {
    var all = document.getElementsByTagName("script");
    s = all[all.length - 1];
  }
  var piece = s.getAttribute("data-piece");
  if (!piece) {
    console.error("[SplitStream] widget: a data-piece attribute is required.");
    return;
  }
  var base = s.getAttribute("data-base");
  if (!base) {
    try { base = new URL(s.src).origin; } catch (e) { base = ""; }
  }
  var width = s.getAttribute("data-width") || "360";

  var iframe = document.createElement("iframe");
  iframe.src = base + "/embed/" + encodeURIComponent(piece);
  iframe.title = "SplitStream — support the creators";
  iframe.loading = "lazy";
  iframe.setAttribute("scrolling", "no");
  iframe.setAttribute("allowtransparency", "true");
  iframe.style.width = /^[0-9]+$/.test(width) ? width + "px" : width;
  iframe.style.maxWidth = "100%";
  iframe.style.height = "240px"; // provisional; resized via postMessage below
  iframe.style.border = "0";
  iframe.style.overflow = "hidden";
  iframe.style.colorScheme = "light";

  // Resize the iframe to match the widget's real height (per-piece scoped).
  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || d.type !== "splitstream:resize" || d.piece !== piece) return;
    if (typeof d.height === "number" && d.height > 0) {
      iframe.style.height = Math.ceil(d.height) + "px";
    }
  });

  s.parentNode.insertBefore(iframe, s);
})();
