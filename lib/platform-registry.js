const IMAGE_HOSTS = {
  steam: ['steamstatic.com', 'steamusercontent.com'],
  switch: ['nintendo.com', 'nintendo.net'],
  playstation: ['playstation.com', 'sonyinteractive.com'],
  xbox: ['xbox.com', 'microsoft.com', 'microsoftstore.com', 'xboxlive.com', 's-microsoft.com'],
};

function identifyStore(input) {
  const value = typeof input === 'string' ? input.trim() : '';
  if (/^\d{1,12}$/.test(value)) {
    return { platform: 'steam', canonicalUrl: `https://store.steampowered.com/app/${value}/`, productId: value };
  }

  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid store URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('Invalid store URL.');

  let match;
  if (url.hostname === 'store.steampowered.com' && (match = url.pathname.match(/^\/app\/(\d{1,12})(?:\/|$)/))) {
    return { platform: 'steam', canonicalUrl: `https://store.steampowered.com/app/${match[1]}/`, productId: match[1] };
  }

  let platform;
  if (['www.nintendo.com', 'nintendo.com'].includes(url.hostname) && (match = url.pathname.match(/^\/[a-z]{2}(?:-[a-z]{2})?\/store\/products\/([^/]+)\/?$/i))) platform = 'switch';
  else if (url.hostname === 'ec.nintendo.com' && (match = url.pathname.match(/^\/[a-z]{2}\/[a-z]{2}\/titles\/(\d{1,20})\/?$/i))) platform = 'switch';
  else if (url.hostname === 'store.playstation.com' && (match = url.pathname.match(/^\/[a-z]{2}(?:-[a-z]{2,4}){1,2}\/(?:product|concept)\/([^/]+)\/?$/i))) platform = 'playstation';
  else if (['www.playstation.com', 'playstation.com'].includes(url.hostname) && (match = url.pathname.match(/^\/[a-z]{2}(?:-[a-z]{2,4}){0,2}\/games\/([^/]+)\/?$/i))) platform = 'playstation';
  else if (['www.xbox.com', 'xbox.com'].includes(url.hostname) && (match = url.pathname.match(/^\/[a-z]{2}-[a-z]{2}\/games\/store\/[^/]+\/([^/]+)\/?$/i))) platform = 'xbox';
  if (!platform) throw new Error('Unsupported store URL.');
  url.search = '';
  url.hash = '';
  return { platform, canonicalUrl: url.href, productId: match[1] };
}

function isAllowedImageUrl(platform, value) {
  const hosts = Object.hasOwn(IMAGE_HOSTS, platform) ? IMAGE_HOSTS[platform] : [];
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

module.exports = { identifyStore, isAllowedImageUrl };
