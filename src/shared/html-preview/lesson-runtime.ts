import type {
  LessonRuntime,
  PageContentInteraction,
} from "@/shared/course-schema";

import { buildFittedLessonSrcDoc } from "./viewport-fit";

export const TRUSTED_LESSON_RUNTIME_CHANNEL = "keya.lesson-runtime";

export type TrustedLessonRuntimeConfig = {
  pageId: string;
  runtime: LessonRuntime;
  interaction: PageContentInteraction;
};

export type TrustedLessonRuntimeOptions = {
  /** 学习端默认启用；QA 可关闭，以测量模型 HTML 的真实布局而不是缩放结果。 */
  viewportFit?: boolean;
};

/**
 * 只在生成 HTML 通过合同与安全预检后调用。生成内容仍无脚本；这里注入的是
 * 平台维护的固定运行时，并由 iframe 的 allow-scripts + 非同源 sandbox 执行。
 */
export function buildTrustedLessonSrcDoc(
  html: string,
  config: TrustedLessonRuntimeConfig,
  options: TrustedLessonRuntimeOptions = {},
) {
  const configJson = JSON.stringify(config)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
  const style = `<style id="keya-trusted-runtime-style">
    [data-keya-runtime-feedback] { margin-top: 12px; padding: 12px 14px; border-radius: 12px; background: #edf5ee; color: #2d332b; }
    [data-keya-runtime-feedback][data-result="incorrect"] { background: #fff0eb; color: #7d3f31; }
    [data-keya-runtime-submit] { min-width: 44px; min-height: 44px; cursor: pointer; }
    [data-keya-runtime-motion="pending"] { opacity: 0; transform: translateY(8px); }
    [data-keya-runtime-motion="visible"] { opacity: 1; transform: none; transition: opacity var(--keya-runtime-duration, 420ms) ease, transform var(--keya-runtime-duration, 420ms) ease; }
    [data-keya-runtime-highlight="true"] { outline: 3px solid color-mix(in srgb, #397a52 55%, transparent); outline-offset: 4px; }
    @media (prefers-reduced-motion: reduce) {
      [data-keya-runtime-motion] { opacity: 1 !important; transform: none !important; transition: none !important; }
    }
  </style>`;
  const script = `<script id="keya-trusted-runtime">
  (() => {
    "use strict";
    const config = ${configJson};
    const channel = ${JSON.stringify(TRUSTED_LESSON_RUNTIME_CHANNEL)};
    const root = document.querySelector('main[data-page-id="' + cssEscape(config.pageId) + '"]');
    const post = (type, detail = {}) => {
      window.parent.postMessage({ channel, type, pageId: config.pageId, runtimeVersion: config.runtime.runtimeVersion, ...detail }, "*");
    };
    const fail = (code) => post("section-error", { code });
    const complete = () => post("section-completed");
    const showFeedback = (interactionRoot, text, result) => {
      let region = interactionRoot.querySelector("[data-keya-runtime-feedback]");
      if (!(region instanceof HTMLElement)) {
        region = document.createElement("div");
        region.setAttribute("data-keya-runtime-feedback", "true");
        region.setAttribute("role", "status");
        region.setAttribute("aria-live", "polite");
        interactionRoot.append(region);
      }
      region.hidden = false;
      region.dataset.result = result;
      region.textContent = text;
    };
    const markStarted = (interactionId) => post("interaction-started", { interactionId });
    const interactionRoot = root?.querySelector("[data-interaction-type]");
    if (!root) {
      fail("RUNTIME_PAGE_ROOT_MISSING");
      return;
    }

    document.documentElement.dataset.keyaRuntime = "ready";
    for (const node of root.querySelectorAll("[data-feedback-kind]")) {
      if (node instanceof HTMLElement) node.hidden = true;
    }

    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const cue of config.runtime.motionPlan.cuePoints) {
      if (!cue.targetId || cue.action === "wait-for-interaction") continue;
      const selector = '[data-runtime-target-id="' + cssEscape(cue.targetId) + '"], [data-block-id="' + cssEscape(cue.targetId) + '"], [data-interaction-item-id="' + cssEscape(cue.targetId) + '"], [data-question-id="' + cssEscape(cue.targetId) + '"]';
      const target = root.querySelector(selector);
      if (!(target instanceof HTMLElement)) continue;
      if (reduced || config.runtime.motionPlan.intensity === "none") {
        target.dataset.keyaRuntimeMotion = "visible";
        continue;
      }
      if (cue.action === "draw" && target instanceof SVGGeometryElement) {
        const length = target.getTotalLength();
        target.style.strokeDasharray = String(length);
        target.style.strokeDashoffset = String(length);
        target.style.transition = "stroke-dashoffset " + cue.durationMs + "ms ease";
        window.setTimeout(() => {
          target.style.strokeDashoffset = "0";
        }, cue.delayMs);
        continue;
      }
      target.dataset.keyaRuntimeMotion = "pending";
      target.style.setProperty("--keya-runtime-duration", cue.durationMs + "ms");
      window.setTimeout(() => {
        target.dataset.keyaRuntimeMotion = "visible";
        if (cue.action === "highlight") {
          target.dataset.keyaRuntimeHighlight = "true";
          window.setTimeout(() => delete target.dataset.keyaRuntimeHighlight, cue.durationMs);
        }
      }, cue.delayMs);
    }

    try {
      bindInteraction(interactionRoot);
      post("section-ready");
      if (config.runtime.completionRule.type === "view") {
        window.setTimeout(complete, reduced ? 0 : 180);
      }
    } catch {
      fail("RUNTIME_BIND_FAILED");
    }

    function bindInteraction(container) {
      if (!(container instanceof HTMLElement)) return;
      const interactionId = container.dataset.interactionId || "interaction-" + config.pageId;
      const interaction = config.interaction;
      if (interaction.type === "choice") {
        let attempts = 0;
        let submit = container.querySelector("[data-runtime-submit]");
        if (!(submit instanceof HTMLButtonElement)) {
          submit = document.createElement("button");
          submit.type = "button";
          submit.textContent = "提交答案";
          submit.setAttribute("data-runtime-submit", "true");
          container.append(submit);
        }
        submit.addEventListener("click", () => {
          attempts += 1;
          markStarted(interactionId);
          let answered = 0;
          let correct = 0;
          const messages = [];
          for (const question of interaction.questions) {
            const questionSelector = '[data-question-id="' + cssEscape(question.id) + '"]';
            const questionRoot = container.matches(questionSelector)
              ? container
              : container.querySelector(questionSelector) || container;
            const inputs = Array.from(questionRoot.querySelectorAll('input[type="radio"],input[type="checkbox"]'));
            const selected = inputs.find((input) => input instanceof HTMLInputElement && input.checked);
            if (!(selected instanceof HTMLInputElement)) {
              messages.push("请先完成所有题目。");
              continue;
            }
            answered += 1;
            const selectedIndex = inputs.indexOf(selected);
            const selectedId = selected.value && selected.value !== "on"
              ? selected.value
              : question.options[selectedIndex]?.id;
            if (selectedId === question.correctOptionId) {
              correct += 1;
              messages.push(question.feedback.success);
            } else {
              messages.push(question.feedback.retry);
            }
          }
          const allCorrect = correct === interaction.questions.length;
          const result = allCorrect ? "correct" : answered > 0 && correct > 0 ? "partial" : "incorrect";
          showFeedback(container, messages.join(" "), result);
          post("interaction-submitted", { interactionId, attempt: attempts, result });
          if (allCorrect) complete();
        });
        return;
      }

      if (interaction.type === "reveal") {
        const opened = new Set();
        const items = Array.from(
          container.querySelectorAll("[data-interaction-item-id]"),
        );
        items.forEach((item, index) => {
          const reveal = () => {
            markStarted(interactionId);
            opened.add(index);
            if (item instanceof HTMLElement) {
              item.dataset.keyaRuntimeHighlight = "true";
            }
            if (opened.size >= Math.max(1, interaction.items.length)) complete();
          };
          if (item instanceof HTMLDetailsElement) {
            item.addEventListener("toggle", () => {
              if (item.open) reveal();
            });
            return;
          }
          if (!(item instanceof HTMLElement)) return;
          if (!item.hasAttribute("tabindex")) item.tabIndex = 0;
          if (!item.hasAttribute("role")) item.setAttribute("role", "button");
          item.addEventListener("click", reveal);
          item.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              reveal();
            }
          });
        });
        return;
      }

      if (interaction.type === "explore") {
        const explored = new Set();
        const items = Array.from(container.querySelectorAll("[data-interaction-item-id]"));
        items.forEach((item) => {
          if (!(item instanceof HTMLElement)) return;
          if (!item.hasAttribute("tabindex")) item.tabIndex = 0;
          const explore = () => {
            markStarted(interactionId);
            explored.add(item.dataset.interactionItemId);
            item.dataset.keyaRuntimeHighlight = "true";
            if (explored.size >= Math.max(1, interaction.items.length)) complete();
          };
          item.addEventListener("click", explore);
          item.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              explore();
            }
          });
        });
        return;
      }

      if (interaction.type === "sort") {
        const items = Array.from(
          container.querySelectorAll("[data-interaction-item-id]"),
        ).filter((item) => item instanceof HTMLElement);
        let dragged = null;
        items.forEach((item) => {
          item.draggable = true;
          item.addEventListener("dragstart", () => {
            dragged = item;
            markStarted(interactionId);
          });
          item.addEventListener("dragover", (event) => event.preventDefault());
          item.addEventListener("drop", (event) => {
            event.preventDefault();
            if (!(dragged instanceof HTMLElement) || dragged === item) return;
            const rect = item.getBoundingClientRect();
            const after = event.clientY > rect.top + rect.height / 2;
            item.parentElement?.insertBefore(
              dragged,
              after ? item.nextElementSibling : item,
            );
          });
        });
        const submit = container.querySelector("[data-runtime-submit],button");
        submit?.addEventListener("click", () => {
          markStarted(interactionId);
          const order = Array.from(
            container.querySelectorAll("[data-interaction-item-id]"),
          ).map((item) => item.getAttribute("data-interaction-item-id"));
          const correct = interaction.correctOrderIds.every(
            (id, index) => order[index] === id,
          );
          showFeedback(
            container,
            correct ? interaction.feedback.success : interaction.feedback.retry,
            correct ? "correct" : "incorrect",
          );
          post("interaction-submitted", {
            interactionId,
            attempt: 1,
            result: correct ? "correct" : "incorrect",
          });
          if (correct) complete();
        });
        return;
      }

      if (interaction.type === "input") {
        const submit = container.querySelector("[data-runtime-submit],button");
        submit?.addEventListener("click", () => {
          const field = container.querySelector(
            '[data-runtime-input="true"],textarea,input',
          );
          if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) || !field.value.trim()) {
            showFeedback(container, "请先写下你的回答。", "incorrect");
            return;
          }
          markStarted(interactionId);
          showFeedback(container, interaction.feedback.success, "correct");
          post("interaction-submitted", {
            interactionId,
            attempt: 1,
            result: "correct",
          });
          complete();
        });
        return;
      }

      if (interaction.type === "navigate") {
        container.addEventListener("click", () => complete(), { once: true });
      }
    }

    function cssEscape(value) {
      return String(value).replace(/["\\\\]/g, "\\\\$&");
    }
  })();
  </script>`;

  const runtimeHtml =
    options.viewportFit === false ? html : buildFittedLessonSrcDoc(html);
  const withStyle = /<\/head\s*>/i.test(runtimeHtml)
    ? runtimeHtml.replace(/<\/head\s*>/i, () => `${style}</head>`)
    : runtimeHtml;
  return /<\/body\s*>/i.test(withStyle)
    ? withStyle.replace(/<\/body\s*>/i, () => `${script}</body>`)
    : withStyle;
}
