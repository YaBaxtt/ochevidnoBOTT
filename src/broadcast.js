export async function processDelivery({ store, telegram }) {
  const delivery = await store.claimDelivery();
  if (!delivery) return { idle: true };
  const campaign = delivery.campaign;
  try {
    await telegram.sendMessage(delivery.userId, `${campaign.title}\n\n${campaign.body}\n\nОтключить рассылку: /stop`, {
      link_preview_options: { is_disabled: true },
      ...(campaign.buttonUrl ? { reply_markup: { inline_keyboard: [[{ text: campaign.buttonText, url: campaign.buttonUrl }]] } } : {})
    });
    await store.finishDelivery(delivery.id, 'sent');
    return { sent: true };
  } catch (error) {
    const code = error.response?.error_code || error.code;
    const wait = Number(error.response?.parameters?.retry_after) || 0;
    if (code === 403) await store.setNotifications(delivery.userId, false);
    const retry = code === 429 || (code !== 400 && code !== 403 && delivery.attempts < 3);
    const retrySeconds = code === 429 ? Math.max(1, wait) : 10 * delivery.attempts;
    await store.finishDelivery(delivery.id, retry ? 'pending' : 'failed', retry ? retrySeconds : 0);
    if(!retry&&code!==403)await store.recordProblem?.({kind:'broadcast',title:'Есть ошибки рекламной рассылки',body:`Кампания ${campaign.id}. Проверьте счётчик ошибок в разделе «Реклама». Код Telegram: ${code||'network'}.`,dedupeKey:`campaign-failed:${campaign.id}`});
    return { failed: !retry, retryAfter: code === 429 ? retrySeconds : 0 };
  }
}

export function startBroadcastWorker({ store, telegram }) {
  let stopped = false;
  let timer;
  const tick = async () => {
    if (stopped) return;
    let delay = 1000;
    try {
      const result = await processDelivery({ store, telegram });
      delay = result.retryAfter ? result.retryAfter * 1000 : result.idle ? 1000 : 75;
    } catch (error) { console.error('broadcast worker:', error.name);await store.recordProblem?.({title:'Ошибка очереди рассылки',body:'Очередь повторит попытку. Проверьте состояние сервера.',dedupeKey:`broadcast:${Math.floor(Date.now()/300000)}`}).catch(()=>{});delay = 5000; }
    if (!stopped) { timer = setTimeout(tick, delay); timer.unref?.(); }
  };
  tick();
  return () => { stopped = true; clearTimeout(timer); };
}
