import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { seoForPath } from '../lib/seo';

function setMeta(attr: 'name' | 'property', key: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = content;
}

function setCanonical(href: string | null): void {
  const existing = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!href) {
    existing?.remove();
    return;
  }
  const el = existing ?? document.head.appendChild(document.createElement('link'));
  el.rel = 'canonical';
  el.href = href;
}

/**
 * Keeps <title>, the meta description, robots and canonical in step with the
 * current route (see lib/seo.ts). Google renders JavaScript, so this is what
 * it indexes for /about, /contact and the rest. Link-preview bots (WhatsApp,
 * LinkedIn, X) don't run JavaScript: they read the static tags in
 * web/index.html, which describe the home page.
 */
export function RouteSeo() {
  const { pathname } = useLocation();

  useEffect(() => {
    const seo = seoForPath(pathname);
    document.title = seo.title;
    setMeta('name', 'description', seo.description);
    setMeta('property', 'og:title', seo.title);
    setMeta('property', 'og:description', seo.description);
    setMeta('name', 'twitter:title', seo.title);
    setMeta('name', 'twitter:description', seo.description);
    setMeta('name', 'robots', seo.index ? 'index, follow' : 'noindex, nofollow');
    setCanonical(seo.canonicalUrl);
    if (seo.canonicalUrl) setMeta('property', 'og:url', seo.canonicalUrl);
  }, [pathname]);

  return null;
}
