const MULTIPLE_QUESTION_COUNT_PATTERN =
  /(?:(?<!\d)(?:[2-9]\d*|1\d+)|[二两三四五六七八九十百千万][一二两三四五六七八九十百千万]*)(?=\s*(?:道|个)[^。！？!?，,；;]{0,80}(?:选择题|测验题|题目|问题))/u;

/** 判断文字是否要求在单个 choice 画布中承载多道题。 */
export function claimsMultipleChoiceQuestions(value: string) {
  return MULTIPLE_QUESTION_COUNT_PATTERN.test(value);
}

/** 将上游偶发的多题措辞收敛为固定画布真正能承载的一道题。 */
export function normalizeSingleChoiceWording(value: string) {
  return value.replace(
    new RegExp(MULTIPLE_QUESTION_COUNT_PATTERN.source, "gu"),
    "1",
  );
}
