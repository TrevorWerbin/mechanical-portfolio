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
  var inserts = drawers.map(function (d) { return d.querySelector('.drawer-insert'); });
  var lightbox = document.getElementById('lightbox');
  var lbVideo = lightbox ? lightbox.querySelector('video') : null;
  var lbImage = lightbox ? lightbox.querySelector('.lb-image') : null;
  var lbCaption = lightbox ? lightbox.querySelector('.lb-caption') : null;
  var lastImageTrigger = null;
  var TARGET_TOP = 64;   /* projected sheet top when open (px, below header) */
  function targetTop(d) { return TARGET_TOP; }

  function frontOf(d)  { return d.querySelector('.drawer-front'); }
  function insertOf(d) { return inserts[drawers.indexOf(d)]; }
  function openDrawerEl() {
    return drawers.filter(function (d) { return d.classList.contains('open'); })[0] || null;
  }

  /* Read content outside the perspective tree. Native CSS zoom
     lays out text at its displayed size rather than enlarging a rasterized
     3D texture. Move the actual nodes so links, focus, scroll and video state
     survive; the empty hidden shells retain the physical drawer geometry. */
  var readableLayer = document.createElement('div');
  readableLayer.className = 'readable-layer';
  document.body.appendChild(readableLayer);
  var readableWallLayer = document.createElement('div');
  readableWallLayer.className = 'readable-layer readable-wall-layer';
  document.getElementById('stage').appendChild(readableWallLayer);
  var readableSurfaces = [];
  var readableFrame = 0;
  var fullscreenChangedAt = -Infinity;
  var desktopLayout = window.matchMedia('(min-width: 861px)');
  var homeSurfaces = [document.querySelector('.wall'), document.querySelector('.cabinet')];

  function moveNode(node, parent, before) {
    if (parent.moveBefore) parent.moveBefore(node, before || null);
    else parent.insertBefore(node, before || null);
  }

  function physicalInsertOf(d) {
    var insert = insertOf(d);
    var surface = readableSurfaces.filter(function (s) { return s.element === insert; })[0];
    return surface ? surface.shell : insert;
  }

  function positionReadable(surface, moving) {
    var rect = surface.shell.getBoundingClientRect();
    var stage = document.getElementById('stage').getBoundingClientRect();
    var scale = rect.width / surface.width;
    var pixelRatio = window.devicePixelRatio || 1;
    function snap(value) { return Math.round(value * pixelRatio) / pixelRatio; }
    readableLayer.style.top = stage.top + 'px';
    readableLayer.style.height = stage.height + 'px';
    readableWallLayer.style.height = stage.height + 'px';
    surface.holder.style.left = (surface.follow ? rect.left : snap(rect.left)) + 'px';
    surface.holder.style.top = (surface.follow ? rect.top - stage.top : snap(rect.top - stage.top)) + 'px';
    surface.holder.style.width = rect.width + 'px';
    surface.holder.style.height = rect.height + 'px';
    surface.holder.style.setProperty('--surface-width', surface.width + 'px');
    surface.holder.style.setProperty('--surface-height', surface.height + 'px');
    surface.holder.style.setProperty('--surface-scale', scale);
    surface.holder.style.transform = 'none';
    surface.holder.style.visibility = '';
    surface.holder.classList.toggle('readable-in-motion', !!moving && !!surface.drawer);
    if (!moving || !surface.follow) return;

    /* Follow the actual four corners of the animated 3D plane. Re-layout at
       its current screen scale before projecting, so the browser never
       magnifies a low-resolution page texture. At rest the projection is
       removed; the same live page stays in place without a clarity swap. */
    var points = surface.corners.map(function (corner) {
      var r = corner.getBoundingClientRect();
      return {x: r.left, y: r.top - stage.top};
    });
    if (surface.drawer) {
      if (rect.height < .5) {
        surface.holder.style.visibility = 'hidden';
        return;
      }
      /* The empty physical shell paints the original tilted paper underneath.
         Only its live contents use native screen dimensions, so typography
         needs no GPU projection or clipping layer during the text reveal. */
      surface.holder.style.setProperty('--surface-height', rect.height / scale + 'px');
      return;
    }
    var p = points.map(function (point) {
      return {x: point.x - points[0].x, y: point.y - points[0].y};
    });
    var dx1 = p[1].x - p[2].x, dx2 = p[3].x - p[2].x;
    var dx3 = p[0].x - p[1].x + p[2].x - p[3].x;
    var dy1 = p[1].y - p[2].y, dy2 = p[3].y - p[2].y;
    var dy3 = p[0].y - p[1].y + p[2].y - p[3].y;
    var determinant = dx1 * dy2 - dx2 * dy1;
    if (!isFinite(determinant) || Math.abs(determinant) < .01) {
      surface.holder.style.visibility = 'hidden';
      return;
    }
    var g = (dx3 * dy2 - dx2 * dy3) / determinant;
    var h = (dx1 * dy3 - dx3 * dy1) / determinant;
    scale = Math.min(4, Math.max(.1,
      Math.hypot(p[1].x, p[1].y) / surface.width,
      Math.hypot(p[2].x - p[3].x, p[2].y - p[3].y) / surface.width));
    var width = surface.width * scale, height = surface.height * scale;
    var a = (p[1].x + g * p[1].x) / width;
    var b = (p[3].x + h * p[3].x) / height;
    var d = (p[1].y + g * p[1].y) / width;
    var e = (p[3].y + h * p[3].y) / height;
    surface.holder.style.left = points[0].x + 'px';
    surface.holder.style.top = points[0].y + 'px';
    surface.holder.style.width = width + 'px';
    surface.holder.style.height = height + 'px';
    surface.holder.style.setProperty('--surface-scale', scale);
    surface.holder.style.transform = 'matrix3d(' +
      [a,d,0,g/width,b,e,0,h/height,0,0,1,0,0,0,0,1].join(',') + ')';
  }

  function promoteReadable(element, drawer, follow) {
    if (!element || !element.offsetWidth || !CSS.supports('zoom', '1')) return;
    var shell = document.createElement('div');
    shell.className = element.className + ' readable-placeholder';
    shell.setAttribute('aria-hidden', 'true');
    shell.inert = true;
    var holder = document.createElement('div');
    holder.className = drawer
      ? drawer.className + ' readable-surface readable-sheet'
      : 'readable-surface readable-home';
    var surface = {element: element, shell: shell, holder: holder,
                   width: element.offsetWidth, height: element.offsetHeight,
                   follow: !!follow, drawer: drawer};
    element.parentNode.insertBefore(shell, element);
    if (surface.follow) {
      if (drawer) {
        shell.classList.add('readable-paper');
        var paper = document.createElement('div');
        paper.className = 'ins-card';
        shell.appendChild(paper);
      }
      surface.corners = [[0,0],[100,0],[100,100],[0,100]].map(function (point) {
        var corner = document.createElement('span');
        corner.style.cssText = 'position:absolute;width:0;height:0;left:' + point[0] + '%;top:' + point[1] + '%;';
        shell.appendChild(corner);
        return corner;
      });
    }
    (element === homeSurfaces[0] ? readableWallLayer : readableLayer).appendChild(holder);
    positionReadable(surface);
    element.classList.add('readable-root');
    moveNode(element, holder);
    readableSurfaces.push(surface);
    return surface;
  }

  function restoreReadable(keep) {
    window.cancelAnimationFrame(readableFrame);
    var retained = [];
    readableSurfaces.forEach(function (surface) {
      if (keep && keep(surface)) {
        retained.push(surface);
        return;
      }
      var card = surface.element.querySelector('.ins-card');
      var scroll = card ? card.scrollTop : 0;
      surface.element.classList.remove('readable-root');
      moveNode(surface.element, surface.shell.parentNode, surface.shell);
      surface.shell.remove();
      surface.holder.remove();
      if (card) card.scrollTop = scroll;
    });
    readableSurfaces = retained;
  }

  function queueReadable() {
    window.cancelAnimationFrame(readableFrame);
    function settle() {
      if (!desktopLayout.matches) {
        document.body.classList.remove('scene-moving');
        return;
      }
      if (isFullscreen()) return;
      var world = document.getElementById('world');
      if (document.readyState !== 'complete' || document.fonts.status === 'loading') {
        readableFrame = window.requestAnimationFrame(settle);
        return;
      }
      if (world.getAnimations({subtree: true}).some(function (a) { return a.playState === 'running'; })) {
        readableSurfaces.forEach(function (surface) { if (surface.follow) positionReadable(surface, true); });
        readableFrame = window.requestAnimationFrame(settle);
        return;
      }
      var drawer = openDrawerEl();
      if (!drawer) restoreReadable(function (surface) { return !surface.drawer; });
      readableSurfaces.forEach(function (surface) {
        positionReadable(surface, !!drawer && !surface.drawer && surface.follow);
      });
      if (drawer) {
        if (!readableSurfaces.some(function (s) { return s.element === insertOf(drawer); })) {
          promoteReadable(insertOf(drawer), drawer, true);
        }
      } else homeSurfaces.forEach(function (element) {
        if (!readableSurfaces.some(function (s) { return s.element === element; })) promoteReadable(element);
      });
      document.body.classList.remove('scene-moving');
    }
    readableFrame = window.requestAnimationFrame(settle);
  }

  function applyOpen(d) {
    d.classList.add('open');
    frontOf(d).setAttribute('aria-expanded', 'true');
    document.body.classList.add('drawer-open');
    document.body.setAttribute('data-open', d.id);
    /* pivot the open-state camera swing at THIS drawer so every sheet
       lands face-on at a uniform size (origin left inline so it also
       governs the closing animation; it's irrelevant at identity) */
    var world = document.getElementById('world');
    if (world) {
      var frame = d.offsetParent;
      var cabinet = document.querySelector('.cabinet');
      var cabinetHeight = cabinet && cabinet.offsetHeight ? cabinet.offsetHeight : 752;
      var originY = frame
        ? -(cabinetHeight - (d.offsetTop + d.offsetHeight / 2))
        : -380;
      world.style.setProperty('--pivot-y', originY.toFixed(0) + 'px');
    }
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
    return Math.max(-600, Math.min(1600, s));
  }

  /* Measure final framing, then replay the physical opening. The native page
     and wall follow their real projected corners throughout that animation. */
  function calibrate(d) {
    var ins = physicalInsertOf(d);
    var wasInstant = document.body.classList.contains('no-anim');
    document.body.classList.add('no-anim');
    applyOpen(d);
    void ins.offsetWidth;
    var s = solveOty(ins, d);
    if (s !== null) document.body.style.setProperty('--s', s.toFixed(1));
    var sheet = promoteReadable(ins, d, true);
    var wall = promoteReadable(homeSurfaces[0], null, true);
    /* reset instantly, restore motion, then open for real (animated) */
    clearOpen(d);
    var world = document.getElementById('world');
    void world.offsetWidth;
    if (!wasInstant) document.body.classList.remove('no-anim');
    void world.offsetWidth;
    applyOpen(d);
    if (sheet) positionReadable(sheet, true);
    if (wall) positionReadable(wall, true);
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
    var ins = physicalInsertOf(d);
    var tries = 0;
    function step() {
      if (!desktopLayout.matches || !d || !d.classList.contains('open') || tries++ > 8) return;
      var top = ins.getBoundingClientRect().top;
      var err = targetTop(d) - top;
      if (Math.abs(err) < 3) return;
      var cur = parseFloat(document.body.style.getPropertyValue('--s'));
      if (!isFinite(cur)) {
        cur = parseFloat(getComputedStyle(document.body).getPropertyValue('--s'));
        if (!isFinite(cur)) cur = 900;
      }
      var next = Math.max(-600, Math.min(1600, cur + err / (2.2 * fitNow())));
      document.body.style.setProperty('--s', next.toFixed(1));
      window.requestAnimationFrame(step);
    }
    var i = delayFrames || 1;
    function tick() { if (--i > 0) window.requestAnimationFrame(tick); else step(); }
    window.requestAnimationFrame(tick);
  }

  function openDrawer(d, opts) {
    opts = opts || {};
    if (desktopLayout.matches) document.body.classList.add('scene-moving');
    restoreReadable();
    var current = openDrawerEl();
    if (current && current !== d) closeDrawer(current, { silent: true });

    if (!desktopLayout.matches) {
      applyOpen(d);
    } else if (opts.instant || NOCAL) {
      applyOpen(d);
      if (!NOCAL) recheck(d, 1);
    } else {
      calibrate(d);
      /* The calibrated native page already has its final framing. Avoid a
         delayed camera correction that could move the scene after opening. */
    }

    if (opts.updateHash !== false && history.replaceState) {
      history.replaceState(null, '', '#' + d.id);
    }
    if (!opts.silent) {
      window.setTimeout(function () {
        var ins = insertOf(d);
        if (d === openDrawerEl() && ins && document.activeElement !== ins) ins.focus({ preventScroll: true });
      }, 1000);
    }
    queueReadable();
  }

  function closeDrawer(d, opts) {
    opts = opts || {};
    if (!d || !d.classList.contains('open')) return;

    if (desktopLayout.matches) document.body.classList.add('scene-moving');
    /* Keep the sharp page attached to its moving shell during the closing
       fade as well; restore it only once the physical drawer is shut. */
    restoreReadable(function (surface) { return !!surface.drawer; });
    readableSurfaces.forEach(function (surface) { surface.holder.classList.add('readable-closing'); });

    d.classList.remove('open');
    frontOf(d).setAttribute('aria-expanded', 'false');
    document.body.style.removeProperty('--s');

    if (!openDrawerEl()) {
      /* Keep the pivot fixed. The closed CSS transform compensates its scale,
         landing on the same home geometry without an origin interpolation. */
      document.body.classList.remove('drawer-open');
      document.body.removeAttribute('data-open');
      if (opts.updateHash !== false && history.replaceState) {
        history.replaceState(null, '', location.pathname + location.search);
      }
    }
    if (desktopLayout.matches) {
      var wall = promoteReadable(homeSurfaces[0], null, true);
      if (wall) positionReadable(wall, true);
    }
    if (!opts.silent) frontOf(d).focus({ preventScroll: true });
    queueReadable();
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
    if (isFullscreen() || performance.now() - fullscreenChangedAt < 750) return;
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
  queueReadable();

  /* Fullscreen playback keeps the native reading surface and the live iframe
     in place. Ordinary window resizing measures the hidden 3D sheet instead,
     so reframing never needs to close the drawer or reload the player. */
  var resizeTimer = null;
  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }
  function fullscreenChanged() {
    fullscreenChangedAt = performance.now();
    if (!isFullscreen()) queueReadable();
  }
  document.addEventListener('fullscreenchange', fullscreenChanged);
  document.addEventListener('webkitfullscreenchange', fullscreenChanged);
  window.addEventListener('resize', function () {
    if (isFullscreen()) return;
    if (lightbox && lightbox.open) return;
    if (performance.now() - fullscreenChangedAt < 750) return;
    if (resizeTimer) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(function () {
      var current = openDrawerEl();
      if (isFullscreen() || performance.now() - fullscreenChangedAt < 750) return;
      if (!desktopLayout.matches || !current) {
        restoreReadable();
        queueReadable();
        return;
      }
      /* Measure the hidden physical sheet without moving the live player. */
      var wasInstant = document.body.classList.contains('no-anim');
      document.body.classList.add('no-anim');
      applyOpen(current);
      var s = solveOty(physicalInsertOf(current), current);
      if (s !== null) document.body.style.setProperty('--s', s.toFixed(1));
      readableSurfaces.forEach(function (surface) { positionReadable(surface); });
      void document.getElementById('world').offsetWidth;
      if (!wasInstant) document.body.classList.remove('no-anim');
      queueReadable();
    }, 140);
  });

  /* ---------- project image and video lightbox ---------- */
  if (lightbox && lbVideo) {
    function previewImage(img) {
      lastImageTrigger = img;
      lbVideo.pause();
      lbVideo.hidden = true;
      lbImage.hidden = false;
      lbImage.src = img.currentSrc || img.src;
      lbImage.alt = img.alt || 'Enlarged project image';
      var figure = img.parentElement;
      var caption = figure ? figure.querySelector('figcaption') : null;
      lbCaption.textContent = caption ? caption.textContent : img.alt;
      lightbox.setAttribute('aria-label', lbCaption.textContent || 'Enlarged project image');
      lightbox.showModal();
    }

    document.querySelectorAll('.story-photo img, .story-pair img').forEach(function (img) {
      img.setAttribute('tabindex', '0');
      img.setAttribute('role', 'button');
      img.setAttribute('aria-label', 'Click to magnify: ' + (img.alt || 'project picture'));
      img.addEventListener('click', function () { previewImage(img); });
      img.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          previewImage(img);
        }
      });
    });

    lightbox.addEventListener('close', function () {
      lbVideo.pause();
      lbVideo.removeAttribute('src');
      lbVideo.load();
      lbVideo.hidden = true;
      lbImage.hidden = true;
      lbImage.removeAttribute('src');
      lbCaption.textContent = '';
      lightbox.setAttribute('aria-label', 'Enlarged project image');
      if (lastImageTrigger && lastImageTrigger.isConnected) lastImageTrigger.focus();
      lastImageTrigger = null;
    });
    var lbClose = lightbox.querySelector('[data-lb-close]');
    if (lbClose) lbClose.addEventListener('click', function () { lightbox.close(); });
  }


  /* ---------- measurement hook (?measure=1): projected rects as JSON ---------- */
  if (MEASURE) {
    window.setTimeout(function () {
      var out = { vw: window.innerWidth, vh: window.innerHeight,
                  docH: document.documentElement.scrollHeight };
      var activeDrawer = openDrawerEl();
      var openIns = activeDrawer ? insertOf(activeDrawer) : null;
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
      ['wall-sign', 'pegboard', 'biz-card', 'wall-note', 'about-sheet', 'cabinet'].forEach(function (id) {
        var el = document.querySelector('.' + id);
        if (el) {
          var r = el.getBoundingClientRect();
          out[id] = [Math.round(r.top), Math.round(r.bottom), Math.round(r.left), Math.round(r.right)];
        }
      });
      /* axis probe: screen mapping of the sheet's local x / depth axes */
      var openDrawer = document.querySelector('.drawer.open');
      if (openDrawer) {
        var card = insertOf(openDrawer).querySelector('.ins-card');
        var cw = card.clientWidth, ch = card.clientHeight;
        var mk = function (lx, ly) {
          var d = document.createElement('div');
          d.style.cssText = 'position:absolute;left:' + lx + 'px;top:' + ly + 'px;width:4px;height:4px;background:#f00;z-index:99;';
          card.appendChild(d);
          var r = d.getBoundingClientRect();
          card.removeChild(d);
          return [r.left + r.width / 2, r.top + r.height / 2];
        };
        var A = mk(8, 8), B = mk(cw - 8, 8), C = mk(8, ch - 40);
        var xvec = [B[0] - A[0], B[1] - A[1]];
        var yvec = [C[0] - A[0], C[1] - A[1]];
        out.probe = {
          card: [cw, ch],
          xAxis: [Math.round(xvec[0]), Math.round(xvec[1])],
          yAxis: [Math.round(yvec[0]), Math.round(yvec[1])],
          xScale: +(Math.hypot(xvec[0], xvec[1]) / (cw - 16)).toFixed(3),
          yScale: +(Math.hypot(yvec[0], yvec[1]) / (ch - 48)).toFixed(3),
          anisotropy: +( (Math.hypot(yvec[0], yvec[1]) / (ch - 48)) / (Math.hypot(xvec[0], xvec[1]) / (cw - 16)) ).toFixed(3)
        };
      }
      var pre = document.createElement('pre');
      pre.id = 'measure-out';
      pre.setAttribute('aria-hidden', 'true');
      pre.style.cssText = 'position:fixed;left:-9999px;';
      pre.textContent = 'MEASURE:' + JSON.stringify(out);
      document.body.appendChild(pre);
    }, 180);
  }
})();
