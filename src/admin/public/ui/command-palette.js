// NanoCrab Command Palette — Quick page navigation & capability discovery
(function () {
  'use strict';

  var PALETTE_ID = 'nc-command-palette';
  var active = false;
  var results = [];
  var selectedIndex = -1;
  var input = null;
  var listEl = null;
  var overlay = null;
  var lastActiveElement = null;

  var MODE_MAP = null;
  var DRAWER_SECTIONS = null;

  function buildModeMap() {
    if (window.NanoModes && window.NanoModes.MODES) {
      MODE_MAP = {};
      var modes = window.NanoModes.MODES;
      var ids = window.NanoModes.MODE_ORDER || Object.keys(modes);
      for (var mi = 0; mi < ids.length; mi++) {
        var mode = modes[ids[mi]];
        MODE_MAP[mode.id] = mode.label;
      }
    }
    if (window.NanoShellNavigation) {
      DRAWER_SECTIONS = window.NanoShellNavigation.MORE_DRAWER_SECTIONS || [];
    }
  }

  function makeSectionLookup() {
    if (!DRAWER_SECTIONS) return {};
    var lookup = {};
    for (var si = 0; si < DRAWER_SECTIONS.length; si++) {
      var section = DRAWER_SECTIONS[si];
      for (var pi = 0; pi < section.pages.length; pi++) {
        lookup[section.pages[pi]] = section.title;
      }
    }
    return lookup;
  }

  function getAllPages() {
    if (!window.NanoShellNavigation) return [];
    var meta = window.NanoShellNavigation.PAGE_META || {};
    var sectionLookup = makeSectionLookup();
    var pages = [];
    var keys = Object.keys(meta);
    for (var ki = 0; ki < keys.length; ki++) {
      var id = keys[ki];
      var entry = meta[id];
      if (entry.palette === false) continue;
      var group = null;
      if (MODE_MAP) {
        var modeId = window.NanoModes && window.NanoModes.resolveMode(id);
        if (modeId) group = MODE_MAP[modeId];
      }
      if (!group) group = sectionLookup[id] || 'More';
      pages.push({
        id: id,
        label: entry.label,
        icon: entry.icon || 'link',
        group: group,
      });
    }
    return pages;
  }

  function fuzzyMatch(text, query) {
    if (!query) return true;
    var lower = text.toLowerCase();
    var q = query.toLowerCase();
    var qi = 0;
    for (var ti = 0; ti < lower.length && qi < q.length; ti++) {
      if (lower[ti] === q[qi]) qi++;
    }
    return qi === q.length;
  }

  function searchPages(query) {
    var all = getAllPages();
    if (!query) {
      var grouped = {};
      for (var gi = 0; gi < all.length; gi++) {
        var p = all[gi];
        if (!grouped[p.group]) grouped[p.group] = [];
        grouped[p.group].push(p);
      }
      var ordered = [];
      var groupOrder = [];
      if (MODE_MAP) {
        var modeIds = window.NanoModes && window.NanoModes.MODE_ORDER || Object.keys(MODE_MAP);
        for (var mi = 0; mi < modeIds.length; mi++) {
          groupOrder.push(MODE_MAP[modeIds[mi]]);
        }
      }
      if (DRAWER_SECTIONS) {
        for (var si = 0; si < DRAWER_SECTIONS.length; si++) {
          if (groupOrder.indexOf(DRAWER_SECTIONS[si].title) === -1) {
            groupOrder.push(DRAWER_SECTIONS[si].title);
          }
        }
      }
      for (var oi = 0; oi < groupOrder.length; oi++) {
        var g = groupOrder[oi];
        if (grouped[g]) {
          ordered.push({ group: g, pages: grouped[g] });
          delete grouped[g];
        }
      }
      var remaining = Object.keys(grouped);
      for (var ri = 0; ri < remaining.length; ri++) {
        ordered.push({ group: remaining[ri], pages: grouped[remaining[ri]] });
      }
      return ordered;
    }

    var flat = [];
    for (var fi = 0; fi < all.length; fi++) {
      var item = all[fi];
      if (fuzzyMatch(item.label, query) || fuzzyMatch(item.id, query) || fuzzyMatch(item.group, query)) {
        flat.push(item);
      }
    }
    return [{ group: 'Results', pages: flat }];
  }

  function render(term, preserveSelection) {
    if (!overlay || !listEl) return;
    results = searchPages(term);
    if (!preserveSelection) {
      selectedIndex = results.length > 0 && results[0].pages.length > 0 ? 0 : -1;
    }

    var html = '';
    var totalResults = 0;
    for (var ri = 0; ri < results.length; ri++) {
      var section = results[ri];
      if (section.pages.length === 0) continue;
      html += '<div class="cp-group" role="group" aria-label="' + escAttr(section.group) + '">';
      html += '<div class="cp-group-label">' + escHtml(section.group) + '</div>';
      for (var pi = 0; pi < section.pages.length; pi++) {
        var page = section.pages[pi];
        var icon = page.icon || 'link';
        var isSelected = totalResults === selectedIndex;
        html += '<button class="cp-item' + (isSelected ? ' cp-selected' : '') + '" data-page="' + escAttr(page.id) + '" role="option" aria-selected="' + (isSelected ? 'true' : 'false') + '">';
        html += '<span class="cp-item-icon cp-icon-' + escAttr(icon) + '"></span>';
        html += '<span class="cp-item-label">' + escHtml(page.label) + '</span>';
        html += '<span class="cp-item-group">' + escHtml(page.group) + '</span>';
        html += '</button>';
        totalResults++;
      }
      html += '</div>';
    }

    if (totalResults === 0) {
      html = '<div class="cp-empty">No pages match <strong>' + escHtml(term || '') + '</strong></div>';
    }

    listEl.innerHTML = html;
    const selected = listEl.querySelector('.cp-selected');
    if (selected) selected.scrollIntoView({ block: 'nearest' });
  }

  function escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function escAttr(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  function navigateTo(page) {
    close();
    if (window.navigate) {
      window.navigate(page);
    }
  }

  function selectHighlighted() {
    if (selectedIndex < 0) return;
    var flat = [];
    for (var ri = 0; ri < results.length; ri++) {
      var section = results[ri];
      for (var pi = 0; pi < section.pages.length; pi++) {
        flat.push(section.pages[pi]);
      }
    }
    if (flat[selectedIndex]) {
      navigateTo(flat[selectedIndex].id);
    }
  }

  function moveSelection(delta) {
    var flat = [];
    for (var ri = 0; ri < results.length; ri++) {
      var section = results[ri];
      for (var pi = 0; pi < section.pages.length; pi++) {
        flat.push(section.pages[pi]);
      }
    }
    if (flat.length === 0) return;
    selectedIndex = (selectedIndex + delta + flat.length) % flat.length;
    render(input ? input.value : '', true);
  }

  function close() {
    if (overlay) overlay.toggleAttribute('inert', true);
    if (!active) return;
    active = false;
    overlay.classList.remove('cp-visible');
    overlay.setAttribute('aria-hidden', 'true');
    if (lastActiveElement) {
      lastActiveElement.focus();
      lastActiveElement = null;
    }
  }

  function open() {
    if (active) return;
    buildModeMap();
    lastActiveElement = document.activeElement;
    active = true;
    overlay.classList.add('cp-visible');
    overlay.setAttribute('aria-hidden', 'false');
    overlay.toggleAttribute('inert', false);
    input.value = '';
    input.focus();
    render('');
  }

  function onKeydown(e) {
    if (!active) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveSelection(1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveSelection(-1);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      selectHighlighted();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        moveSelection(-1);
      } else {
        moveSelection(1);
      }
      return;
    }
  }

  function onInput() {
    render(input ? input.value : '');
  }

  function onClick(e) {
    var item = e.target.closest('.cp-item');
    if (item) {
      navigateTo(item.getAttribute('data-page'));
    }
  }

  document.addEventListener('keydown', function (e) {
    // Bind Cmd/Ctrl+K only. Cmd/Ctrl+P is left to the browser (print).
    if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (active) {
        close();
      } else {
        open();
      }
    }
  });

  function buildDOM() {
    if (document.getElementById(PALETTE_ID)) return document.getElementById(PALETTE_ID);
    var el = document.createElement('div');
    el.id = PALETTE_ID;
    el.className = 'cp-overlay';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Command palette');
    el.setAttribute('aria-hidden', 'true');
    el.toggleAttribute('inert', true);
    el.innerHTML =
      '<div class="cp-modal">' +
        '<div class="cp-header">' +
          '<span class="cp-search-icon"></span>' +
          '<input class="cp-input" type="text" placeholder="Search pages, tools, and views\u2026" aria-label="Search pages" spellcheck="false" autocomplete="off">' +
        '</div>' +
        '<div class="cp-results" role="listbox" aria-label="Matching pages"></div>' +
        '<div class="cp-footer">' +
          '<span>↑↓ navigate</span>' +
          '<span>↵ open</span>' +
          '<span>esc dismiss</span>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);
    return el;
  }

  function init() {
    if (window.NanoCommandPalette && window.NanoCommandPalette.initialized) return;
    overlay = buildDOM();
    input = overlay.querySelector('.cp-input');
    listEl = overlay.querySelector('.cp-results');
    input.addEventListener('keydown', onKeydown);
    input.addEventListener('input', onInput);
    listEl.addEventListener('click', onClick);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });
    window.NanoCommandPalette = {
      initialized: true,
      open: open,
      close: close,
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
