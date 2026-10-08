/* ==========================================================================
   THE TOOL CABINET — drawer state machine
   One drawer open at a time. Click a drawer front: the drawer slides toward
   you, the camera rises to look down into it, and the project card hinges up
   out of the drawer. Esc / close button / clicking another drawer closes it.
   Deep-linkable: #drawer-id or ?open=drawer-id.
   The open-state framing (--oty, how far the world slides down) is
   self-calibrated at runtime against the real viewport, so the card always
   lands just under the header on any screen.
   ========================================================================== */
(function () {
  'use strict';

  var MEASURE = /[?&]measure=1/.test(location.search);
  var NOCAL = /[?&]nocal=1/.test(location.search); /* skip runtime framing (CSS fallback only) */
  if (MEASURE || /[?&]test=1/.test(location.search)) {
    document.body.classList.add('no-anim');
  }

  var drawers = Array.prototype.slice.call(document.querySelectorAll('.drawer'));
  var lightbox = document.getElementById('lightbox');
  var lbVideo = lightbox ? lightbox.querySelector('video') : null;
  var TARGET_TOP = 64;   /* projected card top when open (px, below header) */
  function targetTop(d) { return d && d.id === 'about' ? 48 : TARGET_TOP; }

  function frontOf(d)  { return d.querySelector('.drawer-front'); }
  function insertOf(d) { return d.querySelector('.drawer-insert'); }
  function openDrawerEl() {
    return drawers.filter(function (d) { return d.classList.contains('open'); })[0] || null;
  }

  function applyOpen(d) {
    d.classList.add('open');
    frontOf(d).setAttribute('aria-expanded', 'true');
    document.body.classList.add('drawer-open');
    document.body.setAttribute('data-open', d.id);
  }

  function clearOpen(d) {
    d.classList.remove('open');
    frontOf(d).setAttribute('aria-expanded', 'false');
    if (!openDrawerEl()) {
      document.body.classList.remove('drawer-open');
      document.body.removeAttribute('data-open');
    }
  }

  /* Probe the card's projected top at two --oty values (instant, no paint
     in between) and solve for the --oty that centers the card under the
     header on this viewport. */
  function solveOty(ins, d) {
    var b = document.body.style;
    b.setProperty('--s', '0');
    void ins.offsetWidth;
    var t0 = ins.getBoundingClientRect().top;
    b.setProperty('--s', '300');
    void ins.offsetWidth;
    var t1 = ins.getBoundingClientRect().top;
    b.removeProperty('--s');
    if (!isFinite(t0) || !isFinite(t1) || Math.abs(t1 - t0) < 0.5) return null;
    var s = 300 * (targetTop(d) - t0) / (t1 - t0);
    if (!isFinite(s)) return null;
    return Math.max(300, Math.min(1600, s));
  }

  /* Calibrate the framing, then replay the open animation into it.
     Everything below runs synchronously — the user only sees the animation. */
  function calibrate(d) {
    var ins = insertOf(d);
    var wasInstant = document.body.classList.contains('no-anim');
    document.body.classList.add('no-anim');
    applyOpen(d);
    void ins.offsetWidth;
    var s = solveOty(ins, d);
    if (s !== null) document.body.style.setProperty('--s', s.toFixed(1));
    /* reset instantly, restore motion, then open for real (animated) */
    clearOpen(d);
    void ins.offsetWidth;
    if (!wasInstant) document.body.classList.remove('no-anim');
    void ins.offsetWidth;
    applyOpen(d);
  }

  /* Verify the calibration against real (flushed) layout and nudge --oty
     until the card sits at TARGET_TOP. Converges even if the synchronous
     probes above returned stale values (some pipelines batch recalcs). */
  function fitNow() {
    var w = document.getElementById('world');
    var f = parseFloat(getComputedStyle(w).getPropertyValue('--fit'));
    return isFinite(f) && f > 0 ? f : 0.9;
  }

  function recheck(d, delayFrames) {
    var ins = insertOf(d);
    var tries = 0;
    function step() {
      if (!d || !d.classList.contains('open') || tries++ > 8) return;
      var top = ins.getBoundingClientRect().top;
      var err = targetTop(d) - top;
      if (Math.abs(err) < 3) return;
      var cur = parseFloat(document.body.style.getPropertyValue('--s'));
      if (!isFinite(cur)) cur = 900;
      var next = Math.max(300, Math.min(1600, cur + err / (2.2 * fitNow())));
      document.body.style.setProperty('--s', next.toFixed(1));
      window.requestAnimationFrame(step);
    }
    var i = delayFrames || 1;
    function tick() { if (--i > 0) window.requestAnimationFrame(tick); else step(); }
    window.requestAnimationFrame(tick);
  }

  function openDrawer(d, opts) {
    opts = opts || {};
    var current = openDrawerEl();
    if (current && current !== d) closeDrawer(current, { silent: true });

    if (opts.instant || NOCAL) {
      applyOpen(d);
      if (!NOCAL) recheck(d, 1);
    } else {
      calibrate(d);
      /* with motion disabled (test/measure) verify immediately; otherwise
         let the animation finish, then settle the camera precisely */
      if (document.body.classList.contains('no-anim')) recheck(d, 1);
      else window.setTimeout(function () { recheck(d, 1); }, 1150);
    }

    if (opts.updateHash !== false && history.replaceState) {
      history.replaceState(null, '', '#' + d.id);
    }
    if (!opts.silent) {
      window.setTimeout(function () {
        var ins = insertOf(d);
        if (ins && document.activeElement !== ins) ins.focus({ preventScroll: true });
      }, 1000);
    }
  }

  function closeDrawer(d, opts) {
    opts = opts || {};
    if (!d || !d.classList.contains('open')) return;

    d.classList.remove('open');
    frontOf(d).setAttribute('aria-expanded', 'false');
    document.body.style.removeProperty('--s');

    if (!openDrawerEl()) {
      document.body.classList.remove('drawer-open');
      document.body.removeAttribute('data-open');
      if (opts.updateHash !== false && history.replaceState) {
        history.replaceState(null, '', location.pathname + location.search);
      }
    }
    if (!opts.silent) frontOf(d).focus({ preventScroll: true });
  }

  function drawerFromHash() {
    var id = location.hash.replace('#', '');
    if (!id) {
      var m = location.search.match(/[?&]open=([^&]+)/);
      if (m) id = decodeURIComponent(m[1]);
    }
    if (!id) return null;
    return drawers.filter(function (d) { return d.id === id; })[0] || null;
  }

  /* ---------- wiring ---------- */
  drawers.forEach(function (d) {
    frontOf(d).addEventListener('click', function () {
      if (d.classList.contains('open')) closeDrawer(d);
      else openDrawer(d);
    });
    var closer = d.querySelector('[data-close]');
    if (closer) closer.addEventListener('click', function () { closeDrawer(d); });
  });

  /* Escape closes the open drawer (unless the video dialog has it) */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (lightbox && lightbox.open) return; /* dialog handles its own Esc */
    var d = openDrawerEl();
    if (d) closeDrawer(d);
  });

  /* clicking the shop (wall / floor / anywhere outside) pushes the drawer shut */
  document.getElementById('stage').addEventListener('click', function (e) {
    if (e.target.closest('.drawer') || e.target.closest('a') || e.target.closest('button')) return;
    var d = openDrawerEl();
    if (d) closeDrawer(d);
  });

  /* deep links: #drawer-id / ?open=drawer-id, and back/forward */
  function syncFromHash() {
    var d = drawerFromHash();
    if (d) openDrawer(d, { silent: true, updateHash: false });
    else {
      var cur = openDrawerEl();
      if (cur) closeDrawer(cur, { silent: true, updateHash: false });
    }
  }
  window.addEventListener('hashchange', syncFromHash);
  syncFromHash();

  /* keep the open card framed on viewport resize */
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    var d = openDrawerEl();
    if (!d) return;
    if (resizeTimer) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(function () {
      recheck(d, 1);
    }, 140);
  });

  /* ---------- demo-video lightbox ---------- */
  if (lightbox && lbVideo) {
    document.querySelectorAll('[data-video]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        lbVideo.src = btn.getAttribute('data-video');
        lightbox.showModal();
        var p = lbVideo.play();
        if (p && p.catch) p.catch(function () { /* user will press play */ });
      });
    });
    lightbox.addEventListener('close', function () {
      lbVideo.pause();
      lbVideo.removeAttribute('src');
      lbVideo.load();
    });
    var lbClose = lightbox.querySelector('[data-lb-close]');
    if (lbClose) lbClose.addEventListener('click', function () { lightbox.close(); });
  }


  /* ---------- measurement hook (?measure=1): projected rects as JSON ---------- */
  if (MEASURE) {
    window.setTimeout(function () {
      var out = { vw: window.innerWidth, vh: window.innerHeight,
                  docH: document.documentElement.scrollHeight };
      var openIns = document.querySelector('.drawer.open .drawer-insert');
      if (openIns) {
        var r = openIns.getBoundingClientRect();
        var card = openIns.querySelector('.ins-card');
        out.open = {
          top: Math.round(r.top), bottom: Math.round(r.bottom),
          left: Math.round(r.left), right: Math.round(r.right),
          cardOverflowY: card.scrollHeight - card.clientHeight
        };
      }
      var foot = document.querySelector('.shop-footer');
      if (foot) {
        var fr = foot.getBoundingClientRect();
        out.footer = [Math.round(fr.top), Math.round(fr.bottom), Math.round(fr.left), Math.round(fr.right)];
      }
      /* what extends below the footer? */
      if (foot) {
        var fbot = foot.getBoundingClientRect().bottom;
        var leakers = [];
        document.querySelectorAll('body *').forEach(function (el) {
          var r = el.getBoundingClientRect();
          if (r.bottom > fbot + 4 && r.height > 0) {
            leakers.push(el.tagName + '.' + (el.className && el.className.toString().split(' ')[0] || '') +
              ' b=' + Math.round(r.bottom) + ' h=' + Math.round(r.height));
          }
        });
        out.leakers = leakers.slice(0, 12);
        var scrollers = [];
        document.querySelectorAll('body *').forEach(function (el) {
          var r = el.getBoundingClientRect();
          if (r.height > 0 && el.scrollHeight > r.height + 20) {
            scrollers.push(el.tagName + '.' + (el.className && el.className.toString().split(' ')[0] || '') +
              ' rectH=' + Math.round(r.height) + ' scrollH=' + el.scrollHeight +
              ' bottom=' + Math.round(r.bottom));
          }
        });
        out.scrollers = scrollers.slice(0, 12);
      }
      out.comp = {
        htmlH: getComputedStyle(document.documentElement).height,
        bodyH: getComputedStyle(document.body).height,
        bodySH: document.body.scrollHeight,
        htmlSH: document.documentElement.scrollHeight
      };
      out.fronts = Array.prototype.map.call(
        document.querySelectorAll('.drawer-front'),
        function (b) {
          var r = b.getBoundingClientRect();
          return [Math.round(r.top), Math.round(r.bottom), Math.round(r.left), Math.round(r.right)];
        });
      ['wall-sign', 'pegboard', 'biz-card', 'wall-record', 'wall-note', 'cabinet'].forEach(function (id) {
        var el = document.querySelector('.' + id);
        if (el) {
          var r = el.getBoundingClientRect();
          out[id] = [Math.round(r.top), Math.round(r.bottom), Math.round(r.left), Math.round(r.right)];
        }
      });
      var pre = document.createElement('pre');
      pre.id = 'measure-out';
      pre.setAttribute('aria-hidden', 'true');
      pre.style.cssText = 'position:fixed;left:-9999px;';
      pre.textContent = 'MEASURE:' + JSON.stringify(out);
      document.body.appendChild(pre);
    }, 180);
  }
})();
