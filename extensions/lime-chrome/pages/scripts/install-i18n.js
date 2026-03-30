/**
 * Shared i18n utilities for install guide pages.
 *
 * Detects language from ?lang= query parameter or navigator.language.
 * Each page registers its own translation strings, then calls applyI18n().
 */

var InstallI18n = (function () {
  var _strings = {};

  var SUPPORTED = ['zh', 'en', 'de', 'es', 'fr', 'pt'];

  function detectLang() {
    var params = new URLSearchParams(window.location.search);
    var lang = params.get('lang') || params.get('language');
    if (lang && SUPPORTED.indexOf(lang) !== -1) return lang;
    var nav = (navigator.language || '').toLowerCase();
    for (var i = 0; i < SUPPORTED.length; i++) {
      if (nav.startsWith(SUPPORTED[i])) return SUPPORTED[i];
    }
    return 'en';
  }

  function register(lang, translations) {
    _strings[lang] = Object.assign(_strings[lang] || {}, translations);
  }

  function apply(lang) {
    lang = lang || detectLang();
    var strings = _strings[lang] || _strings['en'] || {};
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (strings[key]) el.innerHTML = strings[key];
    });
    document.documentElement.lang = lang;
    if (strings.title) document.title = strings.title;
    return lang;
  }

  function t(key, lang) {
    lang = lang || detectLang();
    var strings = _strings[lang] || _strings['en'] || {};
    return strings[key] || key;
  }

  return {
    detectLang: detectLang,
    register: register,
    apply: apply,
    t: t,
  };
})();
