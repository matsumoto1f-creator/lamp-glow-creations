/** Metricool's public website tag, loaded once per document after its library is ready. */
export const METRICOOL_SCRIPT = `(function () {
  var script = document.createElement("script");
  script.type = "text/javascript";
  script.async = true;
  script.src = "https://tracker.metricool.com/resources/be.js";
  script.onload = function () {
    beTracker.t({ hash: "d109dea0291b67a685c212489ab8f468" });
  };
  document.head.appendChild(script);
})();`;
