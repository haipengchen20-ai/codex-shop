const { identifyStore, isAllowedImageUrl } = require('./platform-registry');

const LABELS = { switch: 'Switch', playstation: 'PlayStation', xbox: 'Xbox' };

function decode(value) {
  return String(value || '').replace(/&#(x[\da-f]+|\d+);|&(amp|quot|apos|lt|gt);/gi, (match, numeric, named) => {
    if (numeric) {
      const code = numeric[0].toLowerCase() === 'x' ? parseInt(numeric.slice(1), 16) : parseInt(numeric, 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' }[named.toLowerCase()];
  });
}

// Extract a JSON object without evaluating any storefront JavaScript.
function assignedJson(source, name) {
  const match = source.match(new RegExp(`\\b${name}\\s*=\\s*`));
  if (!match) return undefined;
  const start = match.index + match[0].length;
  if (source[start] !== '{') return undefined;
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try { return JSON.parse(source.slice(start, i + 1)); } catch { return undefined; }
    }
  }
  return undefined;
}

function parseStorePage({ platform, canonicalUrl, html }) {
  const label = LABELS[platform];
  if (!label) throw new Error('Unsupported store platform.');
  const metadata = {};
  for (const tag of String(html || '').match(/<meta\b[^>]*>/gi) || []) {
    const attrs = {};
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) attrs[match[1].toLowerCase()] = decode(match[2] ?? match[3] ?? match[4]);
    const key = (attrs.property || attrs.name || '').toLowerCase();
    if (key && attrs.content && !metadata[key]) metadata[key] = attrs.content;
  }
  const screenshots = [];
  let structuredCover;
  let structuredName;
  const scripts = [];
  let xboxState;
  for (const match of String(html || '').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    try { scripts.push(JSON.parse(match[1])); } catch { /* Ignore scripts that are not JSON. */ }
    if (platform === 'xbox' && !xboxState) xboxState = assignedJson(match[1], 'window\\.__PRELOADED_STATE__');
  }
  const productId = identifyStore(canonicalUrl).productId.toLowerCase();
  const matching = [];
  function collect(value) {
    if (Array.isArray(value)) return value.forEach(collect);
    if (!value || typeof value !== 'object') return;
    const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type'] ?? value.__typename];
    const entityId = types.some(type => /^(?:Product|VideoGame|Concept)$/i.test(type || '')) ? value.id : undefined;
    const id = value.productId ?? value.productID ?? entityId;
    let matches = typeof id === 'string' && id.toLowerCase() === productId;
    if (typeof value.url === 'string') {
      try {
        const found = identifyStore(new URL(value.url, canonicalUrl).href);
        matches ||= found.platform === platform && found.productId.toLowerCase() === productId;
      } catch { /* URL is not a recognized product route. */ }
    }
    if (matches) matching.push(value);
    Object.values(value).forEach(collect);
  }
  scripts.forEach(collect);
  // Anonymous entities may describe recommendations, not the current game.
  const product = matching.find(value => {
    const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type'] ?? value.__typename];
    return types.some(type => /^(?:Product|VideoGame)$/i.test(type || ''));
  }) || matching[0];
  function imageUrls(value) {
    if (typeof value === 'string') return isAllowedImageUrl(platform, value) ? [value] : [];
    if (Array.isArray(value)) return value.flatMap(imageUrls);
    if (value && typeof value === 'object') return ['url', 'contentUrl', 'src'].flatMap(key => imageUrls(value[key]));
    return [];
  }
  if (product) {
    structuredName = typeof product.name === 'string' ? product.name : typeof product.title === 'string' ? product.title : undefined;
    for (const [key, value] of Object.entries(product)) {
      if (/^screenshots?$/i.test(key)) screenshots.push(...imageUrls(value));
      else if (!structuredCover && /^(image|cover|boxart|poster)$/i.test(key)) structuredCover = imageUrls(value)[0];
    }
    if (platform === 'playstation') {
      const media = Array.isArray(product.personalizedMeta?.media) ? product.personalizedMeta.media : [];
      const mediaByRole = role => media.filter(item => item?.type === 'IMAGE' && item.role === role).flatMap(imageUrls);
      structuredCover ||= ['MASTER', 'GAMEHUB_COVER_ART', 'EDITION_KEY_ART'].flatMap(mediaByRole)[0];
      screenshots.push(...mediaByRole('SCREENSHOT'));
    }
  }
  if (platform === 'xbox') {
    const summaries = xboxState?.core2?.products?.productSummaries;
    const entry = summaries && Object.entries(summaries).find(([key, value]) => key.toLowerCase() === productId && typeof value?.productId === 'string' && value.productId.toLowerCase() === productId)?.[1];
    if (entry) screenshots.push(...imageUrls(entry.images?.screenshots));
  }
  if (platform === 'switch') {
    const imageObjects = [];
    function collectImages(value) {
      if (Array.isArray(value)) return value.forEach(collectImages);
      if (!value || typeof value !== 'object') return;
      if (value['@type'] === 'ImageObject' && isAllowedImageUrl(platform, value.contentUrl)) imageObjects.push(value.contentUrl);
      Object.values(value).forEach(collectImages);
    }
    scripts.forEach(collectImages);
    for (const script of scripts) {
      const state = script?.props?.pageProps?.initialApolloState;
      if (!state || typeof state !== 'object') continue;
      const entry = Object.values(state).find(value => value?.__typename === 'Product' && typeof value.urlKey === 'string' && value.urlKey.toLowerCase() === productId);
      if (!Array.isArray(entry?.productGallery)) continue;
      for (const asset of entry.productGallery) {
        if (asset?.resourceType !== 'image' || typeof asset.publicId !== 'string' || !/^[\w/-]+$/.test(asset.publicId)) continue;
        const url = imageObjects.find(candidate => new URL(candidate).pathname.endsWith('/' + asset.publicId));
        if (url) screenshots.push(url);
      }
    }
  }
  const cover = [metadata['og:image'], metadata['og:image:url'], metadata['twitter:image'], metadata['twitter:image:src'], structuredCover].find(url => isAllowedImageUrl(platform, url));
  const unique = [...new Set(screenshots)].filter(url => url !== cover).slice(0, 4);
  const items = [];
  if (cover) items.push({ id: 'capsule-0', kind: 'capsule', label: `${label} 封面图`, url: cover });
  unique.forEach((url, index) => items.push({ id: `screenshot-${index + 1}`, kind: 'screenshot', label: `${label} 游戏截图 ${index + 1}`, url }));
  const missing = [];
  if (!cover) missing.push('cover');
  if (!unique.length) missing.push('screenshots');
  return { name: metadata['og:title'] || metadata['twitter:title'] || structuredName || canonicalUrl, items, missing };
}

module.exports = { parseStorePage };
