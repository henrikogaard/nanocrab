(function () {
  var esc =
    (window.NanoShared && window.NanoShared.esc) ||
    window.esc ||
    function (value) {
      return String(value || '');
    };

  function toast(msg, type) {
    var container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    var el = document.createElement('div');
    var tone = ['success', 'error', 'info', 'warning'].includes(type)
      ? type
      : 'info';
    el.className = 'toast toast-' + tone;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(function () {
      el.classList.add('is-leaving');
      setTimeout(function () {
        el.remove();
      }, 300);
    }, 4000);
  }

  function closeCopyFallback() {
    document.getElementById('copy-fallback-overlay')?.remove();
  }

  function showCopyFallback(title, text) {
    closeCopyFallback();
    var overlay = document.createElement('div');
    overlay.id = 'copy-fallback-overlay';
    overlay.className = 'copy-fallback-overlay';
    overlay.innerHTML =
      '<section class="copy-fallback-panel" role="dialog" aria-modal="true" aria-labelledby="copy-fallback-title">' +
      '<div class="copy-fallback-head">' +
      '<div>' +
      '<span>Manual copy</span>' +
      '<h3 id="copy-fallback-title">' +
      esc(title || 'Copy text') +
      '</h3>' +
      '<p>Clipboard access was blocked. Select the text below and copy it manually.</p>' +
      '</div>' +
      '<button class="btn btn-sm btn-ghost" type="button" onclick="closeCopyFallback()" aria-label="Close copy panel">Close</button>' +
      '</div>' +
      '<textarea class="copy-fallback-text" readonly></textarea>' +
      '<div class="copy-fallback-actions">' +
      '<button class="btn btn-sm btn-primary" type="button" onclick="selectCopyFallbackText()">Select text</button>' +
      '<button class="btn btn-sm btn-ghost" type="button" onclick="closeCopyFallback()">Done</button>' +
      '</div>' +
      '</section>';
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) closeCopyFallback();
    });
    document.body.appendChild(overlay);
    var textarea = overlay.querySelector('.copy-fallback-text');
    textarea.value = text || '';
    setTimeout(function () {
      textarea.focus();
      textarea.select();
    }, 0);
  }

  function selectCopyFallbackText() {
    var textarea = document.querySelector('.copy-fallback-text');
    textarea?.focus();
    textarea?.select();
  }

  async function copyTextWithFallback(
    text,
    successMessage,
    fallbackTitle,
  ) {
    try {
      await navigator.clipboard.writeText(text);
      toast(successMessage || 'Copied', 'success');
      return true;
    } catch {
      showCopyFallback(fallbackTitle || 'Copy text', text);
      toast('Clipboard access blocked. Copy from the panel.', 'warning');
      return false;
    }
  }

  window.NanoFeedback = {
    toast,
    closeCopyFallback,
    showCopyFallback,
    selectCopyFallbackText,
    copyTextWithFallback,
  };
  window.toast = toast;
  window.closeCopyFallback = closeCopyFallback;
  window.showCopyFallback = showCopyFallback;
  window.selectCopyFallbackText = selectCopyFallbackText;
  window.copyTextWithFallback = copyTextWithFallback;
})();
