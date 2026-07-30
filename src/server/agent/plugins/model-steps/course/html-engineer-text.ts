export function normalizeVisibleText(html: string) {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i)?.[1] ?? html;
  return normalizeText(
    decodeHtmlEntities(
      body
        .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

/** Prompt 合同只允许这组基础命名实体；其他字符必须使用原字符或数字实体。 */
export function decodeHtmlEntities(value: string) {
  const namedEntities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return value.replace(
    /&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi,
    (entity, decimal: string, hexadecimal: string, named: string) => {
      if (decimal || hexadecimal) {
        const codePoint = decimal
          ? Number(decimal)
          : Number.parseInt(hexadecimal, 16);
        return Number.isInteger(codePoint) && codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : entity;
      }

      return namedEntities[named.toLowerCase()] ?? entity;
    },
  );
}

export function normalizeText(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function containsTrustedText(visibleText: string, requiredText: string) {
  const required = normalizeTrustedText(requiredText);
  if (!required) {
    return normalizeText(visibleText).includes(normalizeText(requiredText));
  }
  return normalizeTrustedText(visibleText).includes(required);
}

function normalizeTrustedText(value: string) {
  return normalizeText(value).replace(
    /[\s`*_~，,。.;；:：、"'“”‘’（）()\[\]{}]/gu,
    "",
  );
}
