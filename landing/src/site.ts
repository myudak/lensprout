/**
 * Site-wide settings. SITE_URL is the production domain (Vercel project myudaks-projects/lensprout):
 * canonical URLs, the sitemap, RSS and Open Graph tags are all built from it.
 */
export const SITE_URL = 'https://lensprout.myudak.com';
export const SITE_NAME = 'Lensprout';
/** The Chrome Web Store listing. */
export const CHROME_STORE_URL = 'https://chromewebstore.google.com/detail/lensprout/eoikohnhcikanpomopphklcicidmlkaj';
/** The public source repository. */
export const GITHUB_URL = 'https://github.com/myudak/lensprout';
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
