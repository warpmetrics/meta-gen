import { useEffect } from 'react';

/**
 * useMeta hook for dynamically updating meta tags based on route
 *
 * @param {Object} metaTagsImport - Imported meta.json file
 * @param {string} pathOverride - Optional path override (defaults to current location)
 *
 * Usage:
 *   import metaTags from './meta.json';
 *   useMeta(metaTags);
 */
export function useMeta(metaTagsImport, pathOverride) {
  // Get current path
  const path = pathOverride || (typeof window !== 'undefined' ? window.location.pathname : '/');

  useEffect(() => {
    const meta = metaTagsImport[path];
    if (!meta) return;

    // Update title
    document.title = meta.title;

    // Update meta tags
    const updates = [
      ['name', 'description', meta.description],
      ['property', 'og:title', meta.title],
      ['property', 'og:description', meta.description],
      ['property', 'twitter:title', meta.title],
      ['property', 'twitter:description', meta.description],
    ];

    updates.forEach(([attr, value, content]) => {
      let tag = document.querySelector(`meta[${attr}="${value}"]`);
      if (!tag) {
        tag = document.createElement('meta');
        tag.setAttribute(attr, value);
        document.head.appendChild(tag);
      }
      tag.content = content;
    });
  }, [path, metaTagsImport]);
}

/**
 * Version that accepts path from TanStack Router
 *
 * Usage:
 *   import metaTags from './meta.json';
 *   import { useRouterState } from '@tanstack/react-router';
 *
 *   const { location } = useRouterState();
 *   useMeta(metaTags, location.pathname);
 */
