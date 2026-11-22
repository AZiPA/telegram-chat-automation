import {
  MAX_EXTRACT_DEPTH,
  cleanMultilineText,
  collapseSpaces,
  extractBlockCaption,
  extractRichText,
  formatQuotation,
  normalizeLineEndings,
} from './extractText.js';

const MEDIA_BLOCK_PLACEHOLDERS = {
  photo: '[Photo]',
  video: '[Video]',
  audio: '[Audio]',
  voice_note: '[Voice Note]',
  animation: '[Animation]',
  document: '[Document]',
};

function extractListItemPrefix(item, index) {
  if (item.has_checkbox) {
    return item.is_checked ? '[x]' : '[ ]';
  }
  if (typeof item.label === 'string' && item.label.trim().length > 0) {
    return item.label.trim();
  }
  if (typeof item.value === 'number' && Number.isFinite(item.value)) {
    return `${item.value}.`;
  }
  if (item.type === '1' || item.type === 'a' || item.type === 'A' || item.type === 'i' || item.type === 'I') {
    return `${index + 1}.`;
  }
  return '•';
}

function extractListBlock(block, state, depth) {
  if (!Array.isArray(block.items) || block.items.length === 0) return '';
  const renderedItems = [];

  for (let i = 0; i < block.items.length; i += 1) {
    const item = block.items[i];
    if (!item || typeof item !== 'object') continue;

    let body = Array.isArray(item.blocks)
      ? extractBlocks(item.blocks, state, depth + 1)
      : '';
    if (!body && item.text !== undefined) {
      body = cleanMultilineText(extractRichText(item.text, state, depth + 1));
    }
    if (!body) continue;

    const prefix = extractListItemPrefix(item, i);
    const bodyLines = body.split('\n');
    const formattedLines = [`${prefix} ${bodyLines[0]}`];
    for (let j = 1; j < bodyLines.length; j += 1) {
      formattedLines.push(bodyLines[j].length > 0 ? `  ${bodyLines[j]}` : '');
    }
    renderedItems.push(formattedLines.join('\n'));
  }

  return renderedItems.join('\n');
}

function extractTableBlock(block, state, depth) {
  const renderedRows = [];
  if (Array.isArray(block.cells)) {
    for (const row of block.cells) {
      if (!Array.isArray(row)) continue;
      const cellTexts = [];
      for (const cell of row) {
        if (!cell || typeof cell !== 'object') continue;
        const cellText = collapseSpaces(extractRichText(cell.text, state, depth + 1));
        if (cellText) cellTexts.push(cellText);
      }
      if (cellTexts.length > 0) {
        renderedRows.push(cellTexts.join(' | '));
      }
    }
  }

  const caption = extractBlockCaption(block.caption, state, depth + 1);
  return [caption, renderedRows.join('\n')].filter(Boolean).join('\n');
}

function extractMediaBlock(block, state, depth) {
  state.hasMedia = true;
  let header = MEDIA_BLOCK_PLACEHOLDERS[block.type] || '[Media]';

  if (block.type === 'document' && block.document?.file_name) {
    const name = collapseSpaces(String(block.document.file_name));
    if (name) header = `${header} ${name}`;
  } else if (block.type === 'map') {
    const loc = block.location;
    if (loc && typeof loc.latitude === 'number' && typeof loc.longitude === 'number') {
      header = `[Map] (${loc.latitude}, ${loc.longitude})`;
    } else {
      header = '[Map]';
    }
  }

  const caption = extractBlockCaption(block.caption, state, depth + 1);
  return caption ? `${header}\n${caption}` : header;
}

function extractContainerMediaBlock(block, state, depth) {
  state.hasMedia = true;
  const inner = extractBlocks(block.blocks, state, depth + 1);
  const caption = extractBlockCaption(block.caption, state, depth + 1);
  const combined = [inner, caption].filter(Boolean).join('\n');
  if (combined) return combined;
  return block.type === 'collage' ? '[Collage]' : '[Slideshow]';
}

function extractBlock(block, state, depth) {
  if (depth > MAX_EXTRACT_DEPTH || !block || typeof block !== 'object') {
    return '';
  }
  state.blockCount += 1;

  switch (block.type) {
    case 'anchor':
      return '';
    case 'divider':
      return '---';
    case 'paragraph':
    case 'heading':
    case 'footer':
    case 'thinking':
      return cleanMultilineText(extractRichText(block.text, state, depth + 1));
    case 'pre':
      return normalizeLineEndings(extractRichText(block.text, state, depth + 1)).replace(
        /^\n+|\n+$/g,
        ''
      );
    case 'mathematical_expression':
      return cleanMultilineText(
        extractRichText(block.expression ?? block.text, state, depth + 1)
      );
    case 'list':
      return extractListBlock(block, state, depth);
    case 'blockquote':
    case 'expandable_blockquote':
    case 'pullquote': {
      const fromBlocks = Array.isArray(block.blocks)
        ? extractBlocks(block.blocks, state, depth + 1)
        : '';
      const fromText =
        block.text !== undefined
          ? cleanMultilineText(extractRichText(block.text, state, depth + 1))
          : '';
      const body = [fromBlocks, fromText].filter(Boolean).join('\n\n');
      const credit =
        block.credit !== undefined
          ? collapseSpaces(extractRichText(block.credit, state, depth + 1))
          : '';
      return formatQuotation(body, credit);
    }
    case 'table':
      return extractTableBlock(block, state, depth);
    case 'details': {
      const summary = cleanMultilineText(extractRichText(block.summary, state, depth + 1));
      const body = extractBlocks(block.blocks, state, depth + 1);
      return [summary, body].filter(Boolean).join('\n');
    }
    case 'collage':
    case 'slideshow':
      return extractContainerMediaBlock(block, state, depth);
    case 'photo':
    case 'video':
    case 'audio':
    case 'voice_note':
    case 'animation':
    case 'document':
    case 'map':
      return extractMediaBlock(block, state, depth);
    case 'buttons': {
      if (!Array.isArray(block.buttons)) return '';
      const labels = block.buttons
        .map((btn) => (btn ? collapseSpaces(extractRichText(btn.text, state, depth + 1)) : ''))
        .filter(Boolean)
        .map((label) => `[${label}]`);
      return labels.join(' ');
    }
    default: {
      const fallbackParts = [];
      if (block.text !== undefined) {
        fallbackParts.push(cleanMultilineText(extractRichText(block.text, state, depth + 1)));
      }
      if (block.expression !== undefined) {
        fallbackParts.push(
          cleanMultilineText(extractRichText(block.expression, state, depth + 1))
        );
      }
      if (Array.isArray(block.blocks)) {
        fallbackParts.push(extractBlocks(block.blocks, state, depth + 1));
      }
      if (block.caption !== undefined) {
        fallbackParts.push(extractBlockCaption(block.caption, state, depth + 1));
      }
      return fallbackParts.filter(Boolean).join('\n');
    }
  }
}

function extractBlocks(blocks, state, depth) {
  if (depth > MAX_EXTRACT_DEPTH || !Array.isArray(blocks) || blocks.length === 0) {
    return '';
  }

  const parts = [];
  for (const block of blocks) {
    const text = extractBlock(block, state, depth);
    if (text) parts.push(text);
  }
  return parts.join('\n\n');
}

/**
 * Extracts readable plain text and compact metadata from an incoming Bot API `RichMessage`.
 *
 * @param {object|null|undefined} richMessage
 * @returns {{ text: string, blockCount: number, hasMedia: boolean }}
 */
export function extractRichMessage(richMessage) {
  if (!richMessage || typeof richMessage !== 'object' || !Array.isArray(richMessage.blocks)) {
    return { text: '', blockCount: 0, hasMedia: false };
  }

  const state = { blockCount: 0, hasMedia: false };
  const rawText = extractBlocks(richMessage.blocks, state, 0);
  const text = normalizeLineEndings(rawText).replace(/\n{3,}/g, '\n\n').trim();

  return {
    text,
    blockCount: state.blockCount,
    hasMedia: state.hasMedia,
  };
}
