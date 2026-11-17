import { formatForwardOrigin } from './formatting.js';

const OTHER_CONTENT_FIELDS = [
  'game',
  'invoice',
  'successful_payment',
  'refunded_payment',
  'story',
  'paid_media',
  'live_photo',
  'checklist',
  'checklist_tasks_done',
  'checklist_tasks_added',
  'users_shared',
  'chat_shared',
  'gift',
  'unique_gift',
  'pinned_message',
  'giveaway',
  'giveaway_winners',
  'passport_data',
  'connected_website',
  'web_app_data',
  'proximity_alert_triggered',
  'message_auto_delete_timer_changed',
  'suggested_post_info',
  'suggested_post_approved',
  'suggested_post_approval_failed',
  'suggested_post_declined',
  'suggested_post_paid',
  'suggested_post_refunded',
];

function extractBaseStructuredContent(msg) {
  if (msg?.contact) {
    const c = msg.contact;
    const name = [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || 'Unnamed';
    const parts = [`📇 Contact: ${name}`];
    if (c.phone_number) parts.push(`📞 ${c.phone_number}`);
    if (c.user_id != null) parts.push(`[${c.user_id}]`);
    return { kind: 'contact', summary: parts.join(' | '), contact: c };
  }

  if (msg?.venue) {
    const v = msg.venue;
    const coords = v.location ? ` (${v.location.latitude}, ${v.location.longitude})` : '';
    const addr = v.address ? ` — ${v.address}` : '';
    return {
      kind: 'venue',
      summary: `📍 Venue: ${v.title || 'Untitled'}${addr}${coords}`,
      venue: v,
    };
  }

  if (msg?.location) {
    const l = msg.location;
    const live = l.live_period ? ` (Live location: ${l.live_period}s)` : '';
    return {
      kind: 'location',
      summary: `📍 Location: ${l.latitude}, ${l.longitude}${live}`,
      location: l,
    };
  }

  if (msg?.poll) {
    const p = msg.poll;
    const opts = Array.isArray(p.options)
      ? p.options.map((o, idx) => `${idx + 1}. ${o.text}`).join('\n')
      : '';
    const kindLabel = p.type === 'quiz' ? 'Quiz' : 'Poll';
    return {
      kind: 'poll',
      summary: `📊 ${kindLabel}: ${p.question || ''}${opts ? `\n${opts}` : ''}`,
      poll: p,
    };
  }

  if (msg?.dice) {
    const d = msg.dice;
    return {
      kind: 'dice',
      summary: `🎲 ${d.emoji || '🎲'} (Value: ${d.value})`,
      dice: d,
    };
  }

  for (const field of OTHER_CONTENT_FIELDS) {
    if (msg?.[field] !== undefined) {
      return {
        kind: field,
        summary: `📦 Special content (${field})`,
        [field]: msg[field],
      };
    }
  }

  return null;
}

/**
 * Extracts structured metadata (contact, venue, location, poll, dice, forward_origin, etc.)
 * stored in the `messages.extra` JSON column.
 *
 * @param {object|null|undefined} msg
 * @returns {object|null}
 */
export function buildStructuredExtra(msg) {
  const forwardOrigin = msg?.forward_origin
    ? formatForwardOrigin(msg.forward_origin)
    : null;
  const base = extractBaseStructuredContent(msg);

  if (base) {
    return forwardOrigin ? { ...base, forwardOrigin } : base;
  }
  return forwardOrigin ? { forwardOrigin } : null;
}
