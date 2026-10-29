const net = require('node:net');

const LOCAL_PROXY_URL = 'http://127.0.0.1:7897';

function checkLocalProxy(timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port: 7897 });
    const finish = (available) => {
      socket.destroy();
      resolve(available);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function createProxyAwareFetch(dependencies = {}) {
  const checkProxy = dependencies.checkProxy || checkLocalProxy;
  const fetchImpl = dependencies.fetchImpl || fetch;
  if (!await checkProxy()) return fetchImpl;

  const ProxyAgent = dependencies.ProxyAgent || require('undici').ProxyAgent;
  const dispatcher = new ProxyAgent(LOCAL_PROXY_URL);
  return (url, options = {}) => fetchImpl(url, { ...options, dispatcher });
}

module.exports = { LOCAL_PROXY_URL, checkLocalProxy, createProxyAwareFetch };
