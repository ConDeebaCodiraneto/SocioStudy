/* legal.js — shared logic for the static Copyright/Privacy pages.
   Reuses the site's I18N module (so the language choice is shared across
   pages via SafeStorage), with one addition: I18N.applyStatic() replaces
   elements' textContent, which would silently strip any nested <b> or <a>
   tag. A handful of sentences on these pages need an embedded link or
   emphasis, so those use a separate data-i18n-html attribute (handled
   here, not in the shared i18n.js, so the site-wide behavior is untouched)
   whose translation string is set via innerHTML instead. */
(function () {
  'use strict';

  function renderHtmlStrings() {
    document.querySelectorAll('[data-i18n-html]').forEach(el => {
      const key = el.dataset.i18nHtml;
      if (I18N.STRINGS.en[key] != null) el.innerHTML = t(key);
    });
  }

  function renderTitle() {
    const key = document.body.dataset.titleKey;
    if (key && I18N.STRINGS.en[key] != null) document.title = t(key);
  }

  function renderAll() {
    I18N.applyStatic(); // plain data-i18n elements + the langToggle button label
    renderHtmlStrings();
    renderTitle();
  }

  I18N.init();
  renderAll();

  const btn = document.getElementById('langToggle');
  if (btn) {
    btn.addEventListener('click', () => {
      // I18N.setLang() also sets document.title to the main app's title;
      // renderAll() runs after it and corrects that back to this page's own title.
      I18N.setLang(I18N.lang === 'bg' ? 'en' : 'bg');
      renderAll();
    });
  }
})();
