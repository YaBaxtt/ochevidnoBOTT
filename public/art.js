// Generated source PNGs remain in assets/art-v3. The UI loads optimized derivatives.
export const ART_SLUGS = Object.freeze([
  'birth-year','age-minus-ten','hundredth-year','sum-two','older-today',
  'hero','premium','bundles','certificate-classic','certificate-rest',
  'certificate-award','certificate-tired','messages','aura','food','flashlight',
  'premium-nothing','premium-vip','premium-director','premium-pause'
]);

export const CARD_ART = Object.freeze({
  'birth-year': 'birth-year',
  'age-minus-ten': 'age-minus-ten',
  'hundredth-year': 'hundredth-year',
  'sum-two': 'sum-two',
  'older-today': 'older-today',
  'mondays': 'birth-year',
  'days-alive': 'age-minus-ten',
  'answer-later': 'messages',
  'main-character': 'aura',
  'pizza-payer': 'food',
  'emoji-aura': 'aura',
  'fridge-thoughts': 'food',
  'magic-school': 'aura',
  'monday-certificate': 'certificate-classic',
  'tired-reference': 'certificate-tired',
  'read-no-reply': 'certificate-award',
  'flashlight': 'flashlight',
  'rest-license': 'certificate-rest',
  'adult-diploma': 'certificate-classic',
  'meeting-survivor': 'certificate-classic',
  'tomorrow-master': 'certificate-award',
  'sofa-resident': 'certificate-rest',
  'expensive-nothing': 'premium-nothing',
  'important-person': 'premium-vip',
  'decision-director': 'premium-director',
  'luxury-pause': 'premium-pause',
  'patron-of-obvious': 'premium',
  'bundle-office': 'bundles',
  'bundle-weekend': 'certificate-rest',
  'bundle-important': 'premium'
});

export const ART_BASE = '/assets/art-v3/';
export function artworkSlug(cardId) { return CARD_ART[cardId] || 'birth-year'; }
export function artImage(slug, { className = '', eager = false, sizes = '(min-width:600px) 270px, 50vw' } = {}) {
  if (!ART_SLUGS.includes(slug)) slug = 'birth-year';
  return `<img class="${className}" src="${ART_BASE}${slug}-720.webp" srcset="${ART_BASE}${slug}-360.webp 360w, ${ART_BASE}${slug}-720.webp 720w" sizes="${sizes}" width="720" height="720" alt="" loading="${eager?'eager':'lazy'}" decoding="async"${eager?' fetchpriority="high"':''}>`;
}
