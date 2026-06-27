(function () {
  function esc(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  window.NanoShared = {
    esc,
  };
  window.esc = esc;
})();
