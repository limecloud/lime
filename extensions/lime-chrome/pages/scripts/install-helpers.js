/**
 * Shared helper functions for install guide pages.
 */

function setupExtrasToggle(toggleId, contentId) {
  var toggle = document.getElementById(toggleId);
  var content = document.getElementById(contentId);
  if (!toggle || !content) return;
  toggle.addEventListener('click', function () {
    var expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!expanded));
    content.classList.toggle('open', !expanded);
  });
}

function setupAllStepExtras() {
  var toggles = document.querySelectorAll('.step-extras-toggle');
  toggles.forEach(function (toggle) {
    var contentId = toggle.getAttribute('data-target');
    if (!contentId) return;
    var content = document.getElementById(contentId);
    if (!content) return;
    toggle.addEventListener('click', function () {
      var expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!expanded));
      content.classList.toggle('open', !expanded);
    });
  });
}

function openChromeUrl(url) {
  if (window.installGuide && window.installGuide.openChromeUrl) {
    window.installGuide.openChromeUrl(url);
    var btn = event && event.currentTarget;
    if (btn && btn.classList) {
      var origText = btn.querySelector('[data-i18n]');
      btn.classList.add('clicked');
      if (origText) {
        var prev = origText.textContent;
        origText.textContent = '✓';
        setTimeout(function () {
          origText.textContent = prev;
          btn.classList.remove('clicked');
        }, 1500);
      } else {
        setTimeout(function () { btn.classList.remove('clicked'); }, 1500);
      }
    }
  } else {
    navigator.clipboard.writeText(url).then(function () {
      var btn = event && event.currentTarget;
      if (btn) {
        var origText = btn.querySelector('[data-i18n]');
        if (origText) {
          var prev = origText.textContent;
          origText.textContent = InstallI18n.t('click_to_copy') === '点击复制' ? '已复制！请粘贴到浏览器' : 'Copied! Paste in browser';
          setTimeout(function () { origText.textContent = prev; }, 2000);
        }
      }
    });
  }
}

function setupCopyBlock(blockId, textToCopy) {
  var block = document.getElementById(blockId);
  if (!block) return;
  block.addEventListener('click', function () {
    var label = block.querySelector('.copy-label');
    navigator.clipboard.writeText(textToCopy).then(function () {
      if (label) {
        var origText = label.textContent;
        label.textContent = '✓';
        setTimeout(function () { label.textContent = origText; }, 1500);
      }
    });
  });
}

function setupExtensionPath() {
  var params = new URLSearchParams(window.location.search);
  var extensionPath = params.get('extensionPath');
  if (!extensionPath) return;

  var el = document.getElementById('extension-path');
  if (el) {
    var sep = extensionPath.indexOf('/') >= 0 ? '/' : '\\';
    var parts = extensionPath.split(sep);
    var folderName = parts[parts.length - 1] || parts[parts.length - 2] || extensionPath;
    var parentParts = parts.slice(0, -1);
    var shortPrefix = parentParts.length > 2
      ? '…' + sep + parentParts.slice(-2).join(sep)
      : parentParts.join(sep);
    var shortPath = shortPrefix + sep;

    el.innerHTML = '<span class="path-short">' + shortPath + '<span class="path-highlight">' + folderName + '</span></span>'
      + '<span class="path-full">' + extensionPath.replace(new RegExp(folderName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'), '<span class="path-highlight">' + folderName + '</span>') + '</span>';
    el.title = extensionPath;
  }

  var copyBtn = document.getElementById('copy-path-btn');
  if (copyBtn) copyBtn.style.display = 'inline-flex';

  var openBtn = document.getElementById('open-folder-btn');
  if (openBtn) openBtn.style.display = 'inline-flex';
}

function openExtensionFolder() {
  var params = new URLSearchParams(window.location.search);
  var parentPath = params.get('extensionParentPath') || params.get('extensionPath');
  if (!parentPath) return;
  var normalized = parentPath.replace(/\\/g, '/');
  if (/^\/\//.test(normalized)) {
    // UNC path: \\server\share → file://server/share (RFC 8089)
    window.open('file:' + normalized);
  } else if (/^[A-Za-z]:/.test(normalized)) {
    // Windows drive: C:/path → file:///C:/path
    window.open('file:///' + normalized);
  } else {
    // Unix or already normalized
    window.open('file://' + normalized);
  }
}

function navigateToInstallPage(page) {
  var params = new URLSearchParams(window.location.search);
  window.location.href = page + '?' + params.toString();
}

var _copyBtnOrigHTML = '';
var _copyResetTimer = null;
function copyExtensionPath() {
  var params = new URLSearchParams(window.location.search);
  var extensionPath = params.get('extensionPath');
  if (!extensionPath) return;
  var btn = document.getElementById('copy-path-btn');
  if (btn && !_copyBtnOrigHTML) _copyBtnOrigHTML = btn.innerHTML;
  navigator.clipboard.writeText(extensionPath).then(function () {
    if (!btn) return;
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3 3 7-7"/></svg> ✓';
    if (_copyResetTimer) clearTimeout(_copyResetTimer);
    _copyResetTimer = setTimeout(function () {
      btn.innerHTML = _copyBtnOrigHTML;
      _copyResetTimer = null;
    }, 2000);
  });
}
