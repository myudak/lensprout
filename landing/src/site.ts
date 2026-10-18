/**
 * Site-wide settings. SITE_URL is a placeholder: set the real domain before deploying, because
 * canonical URLs, the sitemap, RSS and Open Graph tags are all built from it.
 */
export const SITE_URL = 'https://lensprout.example';
export const SITE_NAME = 'Lensprout';
/** Placeholder until the Chrome Web Store listing exists: jumps to the "get it" section. */
export const CHROME_STORE_URL = '/#get';
/** Placeholder until the public repository exists. */
export const GITHUB_URL = '/#pricing';
export const GITHUB_IS_PLACEHOLDER = true;

export const NAV = [
  { href: '/#story', label: 'Tour' },
  { href: '/#features', label: 'Features' },
  { href: '/#how', label: 'How it works' },
  { href: '/#pricing', label: 'Pricing' },
  { href: '/#faq', label: 'FAQ' },
  { href: '/blog/', label: 'Blog' },
];
