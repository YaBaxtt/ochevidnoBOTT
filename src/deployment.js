export function publicAppUrlFromEnv(env = process.env) {
  return (env.PUBLIC_APP_URL?.trim() || (env.RAILWAY_PUBLIC_DOMAIN?.trim() ? `https://${env.RAILWAY_PUBLIC_DOMAIN.trim()}` : '')).replace(/\/$/, '');
}

export function validatePublicAppUrl(value) {
  let url;
  try { url = new URL(value); } catch {
    throw new Error('PUBLIC_APP_URL: нужен публичный адрес мини-аппа https://…up.railway.app из Railway → Settings → Networking → Generate Domain.');
  }
  if (['railway.com', 'www.railway.com', 'github.com', 'www.github.com'].includes(url.hostname)) {
    throw new Error('PUBLIC_APP_URL — это адрес самого мини-аппа, не страница настроек Railway или GitHub. Создайте домен: Settings → Networking → Generate Domain.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      ['localhost', '127.0.0.1', '[::1]', 'your-project.up.railway.app'].includes(url.hostname) || url.hostname.endsWith('.railway.internal')) {
    throw new Error('PUBLIC_APP_URL: укажите публичный HTTPS-домен без пути, параметров, пароля и #. Пример: https://имя-проекта.up.railway.app.');
  }
  return url.origin;
}

export function appConnection(value) {
  try { return { publicAppUrl: validatePublicAppUrl(value), appSetupIssue: '' }; }
  catch (error) { return { publicAppUrl: '', appSetupIssue: error.message }; }
}
