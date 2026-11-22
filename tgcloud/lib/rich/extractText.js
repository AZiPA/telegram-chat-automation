export const MAX_EXTRACT_DEPTH = 32;

export function normalizeLineEndings(str) {
  return str.replace(/\r\n|\r/g, '\n');
}

export function collapseSpaces(str) {
  return normalizeLineEndings(str).replace(/[ \t\n]+/g, ' ').trim();
}

export function cleanMultilineText(str) {
  return normalizeLineEndings(str)
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractRichText(node, state, depth) {
  if (depth > MAX_EXTRACT_DEPTH || node === null || node === undefined) {
    return '';
  }
  if (typeof node === 'string') {
    return node;
  }
  if (Array.isArray(node)) {
    const parts = [];
    for (const item of node) {
      parts.push(extractRichText(item, state, depth + 1));
    }
    return parts.join('');
  }
  if (typeof node !== 'object') {
    return '';
  }

  switch (node.type) {
    case 'anchor':
      return '';
    case 'custom_emoji':
      return (
        extractRichText(node.alternative_text, state, depth + 1) ||
        extractRichText(node.text, state, depth + 1)
      );
    case 'mathematical_expression':
      return (
        extractRichText(node.expression, state, depth + 1) ||
        extractRichText(node.text, state, depth + 1)
      );
    case 'button':
      return node.button ? extractRichText(node.button.text, state, depth + 1) : '';
    case 'concat':
      return extractRichText(node.texts, state, depth + 1);
    case 'url':
      return extractRichText(node.text, state, depth + 1) || (typeof node.url === 'string' ? node.url : '');
    case 'email_address':
      return (
        extractRichText(node.text, state, depth + 1) ||
        (typeof node.email_address === 'string' ? node.email_address : '')
      );
    case 'phone_number':
      return (
        extractRichText(node.text, state, depth + 1) ||
        (typeof node.phone_number === 'string' ? node.phone_number : '')
      );
    case 'bank_card_number':
      return (
        extractRichText(node.text, state, depth + 1) ||
        (typeof node.bank_card_number === 'string' ? node.bank_card_number : '')
      );
    case 'mention':
      return (
        extractRichText(node.text, state, depth + 1) ||
        (typeof node.username === 'string' ? node.username : '')
      );
    case 'ton_address':
      return (
        extractRichText(node.text, state, depth + 1) ||
        (typeof node.address === 'string' ? node.address : '')
      );
    default:
      if (node.text !== undefined) {
        return extractRichText(node.text, state, depth + 1);
      }
      if (Array.isArray(node.texts)) {
        return extractRichText(node.texts, state, depth + 1);
      }
      if (typeof node.alternative_text === 'string') {
        return node.alternative_text;
      }
      if (typeof node.expression === 'string') {
        return node.expression;
      }
      return '';
  }
}

export function extractBlockCaption(caption, state, depth) {
  if (depth > MAX_EXTRACT_DEPTH || !caption) return '';
  if (typeof caption === 'string' || Array.isArray(caption)) {
    return cleanMultilineText(extractRichText(caption, state, depth + 1));
  }
  if (typeof caption !== 'object') return '';
  if (caption.type) {
    return cleanMultilineText(extractRichText(caption, state, depth + 1));
  }

  const main = cleanMultilineText(extractRichText(caption.text, state, depth + 1));
  const credit = cleanMultilineText(extractRichText(caption.credit, state, depth + 1));
  if (main && credit) return `${main} — ${credit}`;
  return main || credit;
}

export function formatQuotation(bodyText, creditText) {
  const lines = [];
  if (bodyText) {
    for (const line of bodyText.split('\n')) {
      lines.push(line.length > 0 ? `> ${line}` : '>');
    }
  }
  if (creditText) {
    lines.push(`> — ${creditText}`);
  }
  return lines.join('\n');
}
