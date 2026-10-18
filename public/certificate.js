export {certificateSvg,sampleCertificate,certificateSample} from './certificate-design.js';

export function downloadCertificate({url,fileName,telegram,onStatus=()=>{}}) {
  if(telegram?.initData) {
    if(!telegram.downloadFile||!telegram.isVersionAtLeast?.('8.0'))return false;
    telegram.downloadFile({url,file_name:fileName},accepted=>onStatus(accepted?'Запрос на скачивание принят. Проверь папку «Загрузки».':'Скачивание отменено. Можно получить файл сообщением в боте.'));
    return true;
  }
  const link=document.createElement('a');link.href=url;link.download=fileName;link.rel='noreferrer';
  document.body.append(link);link.click();link.remove();
  onStatus('Открываем файл для сохранения. Проверь загрузки браузера.');
  return true;
}
