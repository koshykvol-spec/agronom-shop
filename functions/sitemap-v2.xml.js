// Alias-роут sitemap-v2.xml — той самий вміст, що й /sitemap.xml.
// Потрібен, щоб обійти внутрішній error-cache Google Search Console
// для доменів у публічному суфіксі .pp.ua (відома проблема Googlebot).
import { onRequest as onSitemap } from './sitemap.xml.js';
export const onRequest = onSitemap;
