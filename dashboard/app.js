// Token Radar dashboard: renders the board from window.BOARD (written
// by main.ts as data.js beside this page), with search, filters, sorting
// and a detail view for every protocol. No network: every byte the page
// needs is local.

(function () {
  "use strict";

  var board = window.BOARD || { as_of: "", rows: [] };
  var rows = board.rows || [];

  var params = new URLSearchParams(window.location.search);
  var state = {
    q: params.get("q") || "",
    cat: params.get("cat") || "",
    chain: params.get("chain") || "",
    watchOnly: params.get("watchlist") === "1",
    sort: params.get("sort") || "implied",
    slug: params.get("slug") || "",
  };

  function $(id) {
    return document.getElementById(id);
  }

  function money(value) {
    if (value >= 1e9) return "$" + (value / 1e9).toFixed(2) + "B";
    if (value >= 1e6) return "$" + (value / 1e6).toFixed(1) + "M";
    if (value >= 1e3) return "$" + (value / 1e3).toFixed(1) + "K";
    return "$" + Math.round(value);
  }

  function pct(value) {
    if (value === null || value === undefined) return "n/a";
    var sign = value > 0 ? "+" : "";
    return sign + value.toFixed(1) + "%";
  }

  function esc(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fillSelect(select, values) {
    values.forEach(function (value) {
      var opt = document.createElement("option");
      opt.value = value;
      opt.textContent = value;
      select.appendChild(opt);
    });
  }

  // Controls: categories and chains come from the board itself.
  var categories = Array.from(new Set(rows.map(function (r) { return r.category || "Uncategorised"; }))).sort();
  var chains = Array.from(new Set(rows.flatMap(function (r) { return r.chains; }))).sort();
  fillSelect($("cat"), categories);
  fillSelect($("chain"), chains);
  $("q").value = state.q;
  $("cat").value = state.cat;
  $("chain").value = state.chain;
  $("watchOnly").checked = state.watchOnly;
  $("sort").value = state.sort;

  // Stats strip.
  var totalImplied = rows.reduce(function (sum, r) { return sum + r.implied_value_usd; }, 0);
  var changes = rows.map(function (r) { return r.change_7d; }).filter(function (v) { return v !== null; }).sort(function (a, b) { return a - b; });
  var medianChange = changes.length ? changes[Math.floor(changes.length / 2)] : null;
  $("stats").innerHTML =
    '<div class="stat"><b>' + rows.length + '</b><span>protocols ranked</span></div>' +
    '<div class="stat"><b>' + rows.filter(function (r) { return r.watchlist; }).length + ' / 40</b><span>watchlist covered</span></div>' +
    '<div class="stat"><b>' + money(totalImplied) + '</b><span>total implied value</span></div>' +
    '<div class="stat"><b>' + pct(medianChange) + '</b><span>median 7-day change</span></div>';
  $("snapLine").textContent =
    "Snapshot " + board.as_of + " · 758 protocols tracked · " + rows.length + " ranked";

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    var list = rows.filter(function (r) {
      if (state.watchOnly && !r.watchlist) return false;
      if (state.cat && (r.category || "Uncategorised") !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) === -1) return false;
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var key = state.sort;
    list.sort(function (a, b) {
      if (key === "tvl") return b.tvl_usd - a.tvl_usd;
      if (key === "growth") return (b.change_7d || 0) - (a.change_7d || 0);
      if (key === "name") return a.name.localeCompare(b.name);
      return a.rank - b.rank;
    });
    return list;
  }

  function renderRows() {
    var list = visibleRows();
    $("count").textContent = list.length + " of " + rows.length + " rows";
    var body = $("rows");
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="7" class="empty">No protocols match this filter.</td></tr>';
      return;
    }
    body.innerHTML = list.map(function (r) {
      var change = r.change_7d === null
        ? '<span>n/a</span>'
        : '<span class="' + (r.change_7d >= 0 ? "up" : "down") + '">' + pct(r.change_7d) + "</span>";
      return (
        '<tr data-slug="' + esc(r.slug) + '"' + (r.slug === state.slug ? ' class="sel"' : "") + ">" +
        '<td><span class="rank">' + r.rank + "</span></td>" +
        '<td><span class="name">' + esc(r.name) + "</span>" +
        (r.watchlist ? '<span class="badge">WATCHLIST</span>' : "") +
        '<br><span class="sub">' + esc(r.slug) + "</span></td>" +
        "<td>" + esc(r.category || "—") + "</td>" +
        "<td>" + esc(r.chains.slice(0, 3).join(", ")) + (r.chains.length > 3 ? " +" + (r.chains.length - 3) : "") + "</td>" +
        '<td class="num">' + money(r.tvl_usd) + "</td>" +
        '<td class="num">' + change + "</td>" +
        '<td class="num imp">' + money(r.implied_value_usd) + "</td>" +
        "</tr>"
      );
    }).join("");
    body.querySelectorAll("tr[data-slug]").forEach(function (tr) {
      tr.addEventListener("click", function () {
        state.slug = tr.getAttribute("data-slug");
        renderDetail();
        renderRows();
      });
    });
  }

  function renderDetail() {
    var panel = $("detail");
    var row = rows.find(function (r) { return r.slug === state.slug; }) || rows[0];
    if (!row) {
      panel.innerHTML = "<p class=\"empty\">No protocol selected.</p>";
      return;
    }
    var f = row.factors || { growth: 1, age: 1, breadth: 1 };
    var steps = row.farm_steps.map(function (s, i) {
      return "<li>" + esc(s) + "</li>";
    }).join("");
    panel.innerHTML =
      "<h2>" + esc(row.name) + "</h2>" +
      '<p class="slug">rank ' + row.rank + " · " + esc(row.slug) +
      (row.watchlist ? ' · <span class="badge">WATCHLIST</span>' : "") + "</p>" +
      '<div class="kv">' +
      "<div><b>" + money(row.implied_value_usd) + "</b><span>implied value</span></div>" +
      "<div><b>" + money(row.tvl_usd) + "</b><span>TVL</span></div>" +
      "<div><b>" + pct(row.change_7d) + "</b><span>7-day change</span></div>" +
      "<div><b>" + row.age_years.toFixed(1) + " yrs</b><span>tracked, no token</span></div>" +
      "</div>" +
      '<p class="formula"><b>Implied = TVL × growth × age × breadth</b><br>' +
      money(row.tvl_usd) + " × " + f.growth.toFixed(2) + " × " + f.age.toFixed(2) + " × " + f.breadth.toFixed(2) +
      " = " + money(row.implied_value_usd) + "</p>" +
      "<h3>How to farm it</h3>" +
      '<ol class="steps">' + steps + "</ol>" +
      '<p class="note">' + esc(row.name) + " records no token in the snapshot — no CoinGecko id and no ticker. " +
      "That is the record, not proof: a protocol may hold a token its record does not carry. " +
      "Category: " + esc(row.category || "not named") + ". Chains: " + esc(row.chains.join(", ")) + ".</p>";
  }

  $("q").addEventListener("input", function (e) { state.q = e.target.value; renderRows(); });
  $("cat").addEventListener("change", function (e) { state.cat = e.target.value; renderRows(); });
  $("chain").addEventListener("change", function (e) { state.chain = e.target.value; renderRows(); });
  $("watchOnly").addEventListener("change", function (e) { state.watchOnly = e.target.checked; renderRows(); });
  $("sort").addEventListener("change", function (e) { state.sort = e.target.value; renderRows(); });

  renderRows();
  renderDetail();
})();
