/**
 * Site-wide settings. SITE_URL is the production domain (Vercel project myudaks-projects/lensprout):
 * canonical URLs, the sitemap, RSS and Open Graph tags are all built from it.
 */
export const SITE_URL = 'https://lensprout.myudak.com';
export const SITE_NAME = 'Lensprout';
/** Placeholder until the Chrome Web Store listing exists: jumps to the "get it" section. */
export const CHROME_STORE_URL = '/#get';
/** Placeholder until the public repository exists. */
export const GITHUB_URL = '/#pricing';
export const GITHUB_IS_PLACEHOLDER = true;
/** Shown on the privacy policy page. */
export const CONTACT_EMAIL = 'yudaplzhacker@gmail.com';

export const NAV = [
  { href: '/#story', label: 'Tour' },
  { href: '/#features', label: 'Features' },
  { href: '/#how', label: 'How it works' },
  { href: '/#pricing', label: 'Pricing' },
  { href: '/#faq', label: 'FAQ' },
  { href: '/blog/', label: 'Blog' },
  { href: '/editor/', label: 'Editor' },
];
