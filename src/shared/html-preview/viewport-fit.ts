const VIEWPORT_FIT_STYLE = `<style id="keya-viewport-fit-style">
  html[data-keya-viewport-fit="ready"] {
    width: 100% !important;
    height: 100% !important;
    overflow: hidden !important;
    overscroll-behavior: none;
    scrollbar-width: none;
  }
  html[data-keya-viewport-fit="ready"] body {
    overflow: visible !important;
    transform-origin: 0 0 !important;
    transition: none !important;
    will-change: transform;
  }
  html[data-keya-viewport-fit="ready"] input[type="checkbox"],
  html[data-keya-viewport-fit="ready"] input[type="radio"] {
    min-width: 24px !important;
    min-height: 24px !important;
  }
  html[data-keya-viewport-fit="ready"] label:has(input[type="checkbox"]),
  html[data-keya-viewport-fit="ready"] label:has(input[type="radio"]) {
    min-height: 24px !important;
  }
  html[data-keya-viewport-fit="ready"][data-keya-canvas-mode="fluid"] {
    min-width: 0 !important;
    min-height: 0 !important;
    max-width: none !important;
    max-height: none !important;
    margin: 0 !important;
    box-sizing: border-box !important;
  }
  html[data-keya-viewport-fit="ready"][data-keya-canvas-mode="fluid"] body,
  html[data-keya-viewport-fit="ready"][data-keya-canvas-mode="fluid"] main {
    width: 100% !important;
    height: 100% !important;
    min-width: 0 !important;
    min-height: 0 !important;
    max-width: none !important;
    max-height: none !important;
    margin: 0 !important;
    box-sizing: border-box !important;
    overflow: visible !important;
  }
</style>`;

const VIEWPORT_FIT_SCRIPT = `<script id="keya-viewport-fit">
  (() => {
    "use strict";
    const root = document.documentElement;
    const body = document.body;
    if (!root || !body) return;

    const watchedImages = new WeakSet();
    let animationFrame = 0;
    let fitting = false;

    root.dataset.keyaViewportFit = "ready";

    const normalizeFluidCanvas = () => {
      if (root.dataset.keyaCanvasMode !== "fluid") return;

      const canvasNodes = [
        root,
        body,
        body.querySelector("main"),
      ];
      for (const node of canvasNodes) {
        if (!(node instanceof HTMLElement)) continue;
        node.style.setProperty("width", "100%", "important");
        node.style.setProperty("height", "100%", "important");
        node.style.setProperty("min-width", "0", "important");
        node.style.setProperty("min-height", "0", "important");
        node.style.setProperty("max-width", "none", "important");
        node.style.setProperty("max-height", "none", "important");
        node.style.setProperty("margin", "0", "important");
        node.style.setProperty("box-sizing", "border-box", "important");
      }
      body.style.setProperty("overflow", "visible", "important");
      const lessonRoot = body.querySelector("main");
      if (lessonRoot instanceof HTMLElement) {
        lessonRoot.style.setProperty("overflow", "visible", "important");
      }
    };

    const resetCanvasTransform = () => {
      // body 是播放器拥有的固定画布。忽略作者在 media query 中附加的整页
      // scale，避免它与 contain-fit 再次相乘；页面内部元素的 transform 不受影响。
      body.style.setProperty("transform", "none", "important");
      body.style.setProperty("transform-origin", "0 0", "important");
    };

    const measureContentBounds = (viewportWidth, viewportHeight) => {
      const lessonRoot = body.querySelector("main");
      // 固定课件的缩放基准是作者声明的 body/main 舞台，不是所有后代元素的
      // scroll bounds。光晕、轨道等装饰经常有意越过 1920×1080 后由舞台
      // 裁切；把它们计入 contain-fit 会让整页缩成 94%，制造黑边和无效返工。
      if (root.dataset.keyaCanvasMode !== "fluid") {
        const bodyRect = body.getBoundingClientRect();
        const lessonRect =
          lessonRoot instanceof HTMLElement
            ? lessonRoot.getBoundingClientRect()
            : undefined;
        return {
          left: Math.min(0, bodyRect.left, lessonRect?.left ?? 0),
          top: Math.min(0, bodyRect.top, lessonRect?.top ?? 0),
          width: Math.max(
            1,
            viewportWidth,
            body.offsetWidth,
            lessonRoot instanceof HTMLElement ? lessonRoot.offsetWidth : 0,
          ),
          height: Math.max(
            1,
            viewportHeight,
            body.offsetHeight,
            lessonRoot instanceof HTMLElement ? lessonRoot.offsetHeight : 0,
          ),
        };
      }

      let left = 0;
      let top = 0;
      let right = Math.max(viewportWidth, root.scrollWidth, body.scrollWidth);
      let bottom = Math.max(viewportHeight, root.scrollHeight, body.scrollHeight);
      const elements = [body, ...body.querySelectorAll("*")];
      for (const node of elements) {
        if (!(node instanceof HTMLElement || node instanceof SVGElement)) continue;
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") continue;
        const rect = node.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        left = Math.min(left, rect.left);
        top = Math.min(top, rect.top);
        right = Math.max(right, rect.right);
        bottom = Math.max(bottom, rect.bottom);
      }
      return {
        left,
        top,
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top),
      };
    };

    const fit = () => {
      animationFrame = 0;
      if (fitting) return;
      fitting = true;
      try {
        resetCanvasTransform();
        normalizeFluidCanvas();
        root.style.setProperty("overflow", "visible", "important");
        body.style.setProperty("overflow", "visible", "important");
        const viewportWidth = Math.max(1, window.innerWidth || root.clientWidth);
        const viewportHeight = Math.max(
          1,
          window.innerHeight || root.clientHeight,
        );
        const bounds = measureContentBounds(viewportWidth, viewportHeight);
        const scale = Math.min(
          1,
          viewportWidth / bounds.width,
          viewportHeight / bounds.height,
        );
        const offsetX =
          (viewportWidth - bounds.width * scale) / 2 - bounds.left * scale;
        const offsetY =
          (viewportHeight - bounds.height * scale) / 2 - bounds.top * scale;
        const transform =
          "translate(" +
          offsetX +
          "px, " +
          offsetY +
          "px) scale(" +
          scale +
          ")";

        body.style.setProperty("transform-origin", "0 0", "important");
        body.style.setProperty("transform", transform, "important");
        root.style.setProperty("overflow", "hidden", "important");
        body.style.setProperty("overflow", "visible", "important");
        root.dataset.keyaViewportFitScale = String(scale);

        const bodyBackground = getComputedStyle(body).backgroundColor;
        if (
          bodyBackground &&
          bodyBackground !== "transparent" &&
          bodyBackground !== "rgba(0, 0, 0, 0)"
        ) {
          root.style.backgroundColor = bodyBackground;
        }
      } finally {
        fitting = false;
      }
    };

    const scheduleFit = () => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(fit);
    };

    const watchImages = () => {
      for (const image of document.images) {
        if (watchedImages.has(image)) continue;
        watchedImages.add(image);
        if (!image.complete) {
          image.addEventListener("load", scheduleFit, { once: true });
          image.addEventListener("error", scheduleFit, { once: true });
        }
      }
    };

    watchImages();
    window.addEventListener("load", scheduleFit, { once: true });
    window.addEventListener("resize", scheduleFit, { passive: true });
    window.addEventListener("keya:viewport-fit", scheduleFit);
    document.addEventListener("toggle", scheduleFit, true);
    document.fonts?.ready.then(scheduleFit, scheduleFit);

    const mutationObserver = new MutationObserver(() => {
      watchImages();
      scheduleFit();
    });
    mutationObserver.observe(body, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    if ("ResizeObserver" in window) {
      const resizeObserver = new ResizeObserver(scheduleFit);
      resizeObserver.observe(body);
      const lessonRoot = body.querySelector("main");
      if (lessonRoot instanceof HTMLElement) resizeObserver.observe(lessonRoot);
    }

    scheduleFit();
  })();
</script>`;

/**
 * 为已通过 HTML 合同与安全预检的课程文档注入平台固定的 contain-fit 运行时。
 * 该运行时不绑定课程互动、不发送消息，也不开放任何网络或同源能力。
 */
export function buildFittedLessonSrcDoc(html: string) {
  const withStyle = /<\/head\s*>/i.test(html)
    ? html.replace(
        /<\/head\s*>/i,
        () => `${VIEWPORT_FIT_STYLE}</head>`,
      )
    : html;

  return /<\/body\s*>/i.test(withStyle)
    ? withStyle.replace(
        /<\/body\s*>/i,
        () => `${VIEWPORT_FIT_SCRIPT}</body>`,
      )
    : withStyle;
}
