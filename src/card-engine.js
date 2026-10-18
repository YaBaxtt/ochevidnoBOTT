import { createHash } from 'node:crypto';

const today = () => new Date();

const number = (value, label, min = -1_000_000, max = 1_000_000) => {
  if (value === '' || value === null || value === undefined) throw new Error(`Заполните поле «${label}».`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`Поле «${label}» заполнено неверно.`);
  }
  return parsed;
};

const integer = (value, label, min = -1_000_000, max = 1_000_000) => {
  const parsed = number(value, label, min, max);
  if (!Number.isInteger(parsed)) throw new Error(`Поле «${label}» должно быть целым числом.`);
  return parsed;
};

const text = (value, label, max = 40) => {
  const cleaned = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!cleaned || cleaned.length > max) throw new Error(`Поле «${label}» заполнено неверно.`);
  return cleaned;
};

const pick = (seed, values) => {
  const digest = createHash('sha256').update(seed).digest();
  return values[digest.readUInt32BE(0) % values.length];
};

const asDate = (value) => {
  const normalized = text(value, 'дата рождения', 10);
  const match = normalized.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) throw new Error('Введите дату в формате ДД.ММ.ГГГГ.');
  const [, dd, mm, yyyy] = match;
  const date = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  if (date.getUTCFullYear() !== Number(yyyy) || date.getUTCMonth() !== Number(mm) - 1 || date.getUTCDate() !== Number(dd)) {
    throw new Error('Такой даты не бывает.');
  }
  if (date > new Date()) throw new Error('Дата не может быть в будущем.');
  return date;
};

export const DEFAULT_CARDS = [
  {
    id: 'birth-year', category: 'АРХИВ', priceStars: 10, accent: 'violet',
    title: 'Узнай год рождения', subtitle: 'Возраст + месяц. Секретная математика.',
    fields: [{ key: 'age', label: 'Сколько тебе полных лет?', type: 'number', min: 0, max: 120 }, { key: 'month', label: 'Месяц рождения (1–12)', type: 'number', min: 1, max: 12 }]
  },
  {
    id: 'age-minus-ten', category: 'МАШИНА ВРЕМЕНИ', priceStars: 5, accent: 'blue',
    title: 'Тебе 10 лет назад', subtitle: 'Величайшее открытие дня.',
    fields: [{ key: 'age', label: 'Сколько тебе полных лет?', type: 'number', min: 0, max: 120 }]
  },
  {
    id: 'hundredth-year', category: 'КАЛЕНДАРЬ', priceStars: 10, accent: 'amber',
    title: 'Год твоего 100-летия', subtitle: 'Есть время подготовить речь.',
    fields: [{ key: 'birthYear', label: 'Год рождения', type: 'number', min: 1900, max: 2026 }]
  },
  {
    id: 'sum-two', category: 'КАЛЬКУЛЯТОР', priceStars: 5, accent: 'cyan',
    title: 'Сложи два числа', subtitle: 'Мы сделали это премиально.',
    fields: [{ key: 'a', label: 'Первое число', type: 'number' }, { key: 'b', label: 'Второе число', type: 'number' }]
  },
  {
    id: 'older-today', category: 'ТОЧНОСТЬ', priceStars: 5, accent: 'blue',
    title: 'Насколько ты старше утром', subtitle: 'Честный ответ. Не всем понравится.', fields: []
  },
  {
    id: 'mondays', category: 'АРХИВ', priceStars: 10, accent: 'indigo',
    title: 'Пережитые понедельники', subtitle: 'Сильные цифры. Держись.',
    fields: [{ key: 'age', label: 'Сколько тебе полных лет?', type: 'number', min: 0, max: 120 }]
  },
  {
    id: 'days-alive', category: 'АРХИВ', priceStars: 10, accent: 'violet',
    title: 'Дней на планете', subtitle: 'Почти научно. Очень лично.',
    fields: [{ key: 'birthDate', label: 'Дата рождения', placeholder: 'ДД.ММ.ГГГГ', type: 'text', maxLength: 10 }]
  },
  {
    id: 'answer-later', category: 'ДИАГНОСТИКА', priceStars: 10, accent: 'pink',
    title: 'Индекс «отвечу потом»', subtitle: 'Беспристрастно оценим твою тишину.',
    fields: [{ key: 'unread', label: 'Непрочитанных сообщений', type: 'number', min: 0, max: 100000 }]
  },
  {
    id: 'main-character', category: 'СТАТУС', priceStars: 5, accent: 'cyan',
    title: 'Главный герой сегодня', subtitle: 'Только один эмодзи — и всё ясно.',
    fields: [{ key: 'emoji', label: 'Выбери один эмодзи', type: 'text', maxLength: 8 }]
  },
  {
    id: 'pizza-payer', category: 'СОЦИАЛЬНОЕ', priceStars: 15, accent: 'amber',
    title: 'Кто платит за пиццу', subtitle: 'Алгоритм не врёт. Наверное.',
    fields: [{ key: 'first', label: 'Первое имя', type: 'text', maxLength: 24 }, { key: 'second', label: 'Второе имя', type: 'text', maxLength: 24 }]
  },
  {
    id: 'emoji-aura', category: 'СКАНЕР', priceStars: 10, accent: 'violet',
    title: 'Аура по эмодзи', subtitle: 'Прибор выглядит дорого, значит работает.',
    fields: [{ key: 'emoji', label: 'Отправь любимый эмодзи', type: 'text', maxLength: 8 }]
  },
  {
    id: 'fridge-thoughts', category: 'ОБЪЕКТИВНО', priceStars: 10, accent: 'blue',
    title: 'Мысли холодильника', subtitle: 'Он видел тебя ночью.',
    fields: [{ key: 'snack', label: 'Что ты ел последним?', type: 'text', maxLength: 32 }]
  },
  {
    id: 'magic-school', category: 'РАСПРЕДЕЛЕНИЕ', priceStars: 10, accent: 'indigo',
    title: 'Школа магии', subtitle: 'Факультет уже выбрал тебя.',
    fields: [{ key: 'name', label: 'Твоё имя', type: 'text', maxLength: 24 }]
  },
  {
    id: 'monday-certificate', category: 'ДОКУМЕНТ', priceStars: 15, accent: 'cyan',
    title: 'Сертификат: пережил понедельник', subtitle: 'Официальнее уже не будет.',
    fields: [{ key: 'name', label: 'Имя на сертификате', type: 'text', maxLength: 24 }]
  },
  {
    id: 'tired-reference', category: 'СПРАВКА', priceStars: 15, accent: 'pink',
    title: 'Справка: ты устал', subtitle: 'Подтверждено совершенно независимым ботом.',
    fields: [{ key: 'wakeHour', label: 'Во сколько ты проснулся?', type: 'number', min: 0, max: 23 }]
  },
  {
    id: 'read-no-reply', category: 'НАГРАДА', priceStars: 15, accent: 'amber',
    title: 'Медаль «Прочитал — не ответил»', subtitle: 'За выдержку и уведомления.',
    fields: [{ key: 'unread', label: 'Сколько сообщений ждут ответа?', type: 'number', min: 0, max: 100000 }]
  },
  {
    id: 'flashlight', category: 'ОПАСНЫЙ РЕЖИМ', priceStars: 5, accent: 'white',
    title: 'Фонарик', subtitle: 'Белый экран. Бесплатный выход всегда рядом.', fields: []
  }
];

const named = [{ key: 'name', label: 'Имя в документе', type: 'text', maxLength: 40 }];
const editions = [
  ['rest-license', 'Лицензия на отдых', 'Разрешение ничего не делать. С печатью.', 20],
  ['adult-diploma', 'Диплом взрослого человека', 'За самостоятельное решение, что на ужин.', 20],
  ['meeting-survivor', 'Грамота за выживание на созвоне', 'Микрофон был выключен. Достоинство — нет.', 15],
  ['tomorrow-master', 'Магистр «сделаю завтра»', 'Перенос дедлайнов как академическая дисциплина.', 20],
  ['sofa-resident', 'Резидент дивана', 'Постоянное место в зоне комфорта.', 15],
  ['expensive-nothing', 'Ничего. Премиум.', '100 Stars за документальное подтверждение ничего.', 100],
  ['important-person', 'Очень важная персона', 'Вход без очереди. В собственную комнату.', 150],
  ['decision-director', 'Директор очевидных решений', 'Полномочия сказать: «Ну это очевидно».', 200],
  ['luxury-pause', 'Пауза класса люкс', '500 Stars. Никаких преимуществ, кроме красивой грамоты.', 500],
  ['patron-of-obvious', 'Меценат очевидности', '1000 Stars за поддержку абсурда. Без призов и доходности.', 1000]
];
for (const [id, title, subtitle, priceStars] of editions) DEFAULT_CARDS.push({ id, title, subtitle, priceStars, category: priceStars >= 100 ? 'ЧАСТНАЯ КОЛЛЕКЦИЯ' : 'ДОКУМЕНТ', accent: priceStars >= 100 ? 'amber' : 'blue', fields: named, kind: 'certificate', premium: priceStars >= 100 });
const documentIds = ['monday-certificate', 'tired-reference', 'read-no-reply', 'flashlight', ...editions.map(([id]) => id)];
for (const card of DEFAULT_CARDS) if (documentIds.includes(card.id)) { card.kind = 'certificate'; if (['tired-reference','read-no-reply'].includes(card.id)) card.fields = [...named, ...card.fields]; }
for (const [id, title, subtitle, priceStars, bundleItems] of [
  ['bundle-office', 'Офисный комплект', 'Три документа: понедельник, созвон и право на отдых.', 35, ['monday-certificate','meeting-survivor','rest-license']],
  ['bundle-weekend', 'Пакет «не беспокоить»', 'Резидент дивана, магистр завтра и лицензия на отдых.', 40, ['sofa-resident','tomorrow-master','rest-license']],
  ['bundle-important', 'Папка важных бумаг', 'Три грамоты для человека с полномочиями.', 350, ['important-person','decision-director','adult-diploma']]
]) DEFAULT_CARDS.push({ id, title, subtitle, priceStars, bundleItems, kind: 'bundle', category: 'НАБОР', premium: priceStars >= 100, accent: 'indigo', fields: named });

export function getCardDefinition(cardId) {
  return DEFAULT_CARDS.find((card) => card.id === cardId) ?? null;
}

export function makeResult(cardId, answers = {}, now = today()) {
  const definition = getCardDefinition(cardId);
  if (definition?.bundleItems) {
    const items = definition.bundleItems.map((id) => ({ cardId: id, title: getCardDefinition(id).title, result: makeResult(id, answers, now) }));
    return { kind: 'bundle', headline: `${items.length} документа в коллекции`, detail: 'Каждый можно открыть и скачать отдельно.', badge: 'КОМПЛЕКТ ВЫДАН', items };
  }
  const result = calculateResult(cardId, answers, now);
  if (definition?.kind !== 'certificate') return result;
  const recipient = text(answers.name || 'Владелец этой грамоты', 'имя', 40);
  return { ...result, kind: 'certificate', documentTitle: definition.title.replace(/^Сертификат: /, '').replace(/^Справка: /, ''), recipient, citation: result.detail,
    serial: createHash('sha256').update(`${cardId}:${JSON.stringify(answers)}:${now.toISOString()}`).digest('hex').slice(0, 12).toUpperCase(), issuedAt: now.toISOString(), rank: definition.premium ? 'Частная коллекция' : 'Коллекция личных достижений' };
}

function calculateResult(cardId, answers = {}, now = today()) {
  const seed = `${cardId}:${JSON.stringify(answers)}:${now.toISOString().slice(0, 10)}`;
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  switch (cardId) {
    case 'birth-year': {
      const age = integer(answers.age, 'возраст', 0, 120);
      const birthMonth = integer(answers.month, 'месяц', 1, 12);
      const main = year - age - (birthMonth > month ? 1 : 0);
      return { headline: birthMonth === month ? `${main} или ${main - 1}` : `${main} год`, detail: birthMonth === month ? 'Месяц совпадает с текущим: без дня рождения остаются два варианта.' : 'Рассчитано по полному возрасту и месяцу рождения. Теперь это официально очевидно.', badge: 'АРХИВ РАСКРЫТ' };
    }
    case 'age-minus-ten': {
      const age = integer(answers.age, 'возраст', 0, 120);
      return { headline: `${age - 10} лет`, detail: 'Ровно столько тебе было десять лет назад. Мы перепроверили дважды.', badge: 'ВРЕМЯ ОТМОТАНО' };
    }
    case 'hundredth-year': {
      const birthYear = integer(answers.birthYear, 'год рождения', 1900, year);
      return { headline: `${birthYear + 100} год`, detail: 'Пожалуйста, сохрани это для будущей очень длинной речи.', badge: 'КАЛЕНДАРЬ ОТКРЫТ' };
    }
    case 'sum-two': {
      const a = number(answers.a, 'первое число');
      const b = number(answers.b, 'второе число');
      return { headline: String(a + b), detail: `${a} + ${b} = ${a + b}. Технологии служат человеку.`, badge: 'ВЫЧИСЛЕНО' };
    }
    case 'older-today': {
      const minutes = now.getHours() * 60 + now.getMinutes();
      return { headline: `На ${minutes} мин.`, detail: 'Именно настолько ты старше, чем в 00:00. С фактами не спорят.', badge: 'ТОЧНО ДО МИНУТЫ' };
    }
    case 'mondays': {
      const age = integer(answers.age, 'возраст', 0, 120);
      const mondays = Math.round(age * 52.1775);
      return { headline: `≈ ${mondays} понедельников`, detail: 'И это без учёта тех, которые ощущались как два.', badge: 'ВЫДЕРЖКА ЕСТЬ' };
    }
    case 'days-alive': {
      const birthday = asDate(answers.birthDate);
      const days = Math.floor((now.getTime() - birthday.getTime()) / 86_400_000);
      return { headline: `${days.toLocaleString('ru-RU')} дней`, detail: 'Вот столько раз Земля успела сделать вид, что всё под контролем.', badge: 'СЧЁТЧИК ЖИЗНИ' };
    }
    case 'answer-later': {
      const unread = integer(answers.unread, 'количество сообщений', 0, 100000);
      const score = Math.min(100, Math.round(22 + Math.log10(unread + 1) * 27));
      return { headline: `${score}% «отвечу потом»`, detail: unread === 0 ? 'Подозрительно. Либо ты дисциплинирован, либо все сдались.' : `У ${unread} сообщений есть шанс увидеть ответ. Когда-нибудь.`, badge: 'ДИАГНОСТИКА' };
    }
    case 'main-character': {
      const emoji = text(answers.emoji, 'эмодзи', 8);
      const role = pick(seed, ['герой в отпуске', 'таинственный второстепенный персонаж', 'директор по красивому безделью', 'человек, который знает короткий путь', 'легенда, но после обеда']);
      return { headline: `Ты — ${role}`, detail: `Эмодзи ${emoji} запустил протокол уверенности. Сегодня сюжет крутится вокруг тебя.`, badge: 'СЦЕНАРИЙ ОБНОВЛЁН' };
    }
    case 'pizza-payer': {
      const first = text(answers.first, 'первое имя', 24);
      const second = text(answers.second, 'второе имя', 24);
      const payer = pick(seed, [first, second]);
      return { headline: `Платит ${payer}`, detail: 'Алгоритм учёл космический фон, настроение курьера и ничего больше.', badge: 'СЧЁТ ЗАКРЫТ' };
    }
    case 'emoji-aura': {
      const emoji = text(answers.emoji, 'эмодзи', 8);
      const aura = pick(seed, ['ультрафиолетовая уверенность', 'лазерное спокойствие', 'голубой режим «не трогайте»', 'янтарная продуктивность на 12 минут', 'серебряная ирония']);
      return { headline: aura, detail: `Эмодзи ${emoji} прошёл через наш очень серьёзный сканер.`, badge: 'АУРА ОБНАРУЖЕНА' };
    }
    case 'fridge-thoughts': {
      const snack = text(answers.snack, 'последний перекус', 32);
      return { headline: '«Мы уже знакомы»', detail: `Холодильник запомнил ${snack.toLowerCase()} и считает это началом крепкой дружбы.`, badge: 'МНЕНИЕ ХОЛОДИЛЬНИКА' };
    }
    case 'magic-school': {
      const name = text(answers.name, 'имя', 24);
      const faculty = pick(seed, ['Факультет красивых оправданий', 'Кафедра случайной продуктивности', 'Дом ночных холодильников', 'Школа уверенных «сейчас сделаю»', 'Орден тихих уведомлений']);
      return { headline: faculty, detail: `${name}, распределяющая шляпа думала 0,3 секунды.`, badge: 'ЗАЧИСЛЕН' };
    }
    case 'monday-certificate': {
      const name = text(answers.name, 'имя', 40);
      return { headline: `${name}, ты справился`, detail: 'Сертификат подтверждает: понедельник был, а ты остался.', badge: 'ОФИЦИАЛЬНЫЙ ДОКУМЕНТ' };
    }
    case 'tired-reference': {
      const wakeHour = integer(answers.wakeHour, 'время подъёма', 0, 23);
      const level = wakeHour < 7 ? 'критически заслуженно' : wakeHour < 10 ? 'вполне убедительно' : 'неожиданно, но официально';
      return { headline: `Ты устал — ${level}`, detail: `Подъём в ${String(wakeHour).padStart(2, '0')}:00 принят комиссией как серьёзное доказательство.`, badge: 'СПРАВКА ГОТОВА' };
    }
    case 'read-no-reply': {
      const unread = integer(answers.unread, 'количество сообщений', 0, 100000);
      return { headline: 'Медаль вручена', detail: `За ${unread} непрочитанных сообщений и железную выдержку. Ответить можно завтра.`, badge: 'НАГРАДА' };
    }
    case 'flashlight':
      return { headline: 'Темнота восстановлена', detail: 'Ты пережил свет. Это было официальное испытание характера.', badge: 'РЕЖИМ ПОГАШЕН' };
    default:
      if (editions.some(([id]) => id === cardId)) {
        const name = text(answers.name, 'имя', 40);
        const citations = {
          'rest-license': 'Предоставляется полное шуточное право на отдых без объяснения причин. Диван, чай и тишина одобрены комиссией.',
          'adult-diploma': 'За выдающиеся достижения в самостоятельной оплате интернета и выборе ужина без подсказок старших.',
          'meeting-survivor': 'За стойкость на совещании, которое вполне могло быть одним сообщением. Формулировка «меня слышно?» выдержана с честью.',
          'tomorrow-master': 'Присуждается степень магистра по переносу несрочных дел на более подходящее завтра.',
          'sofa-resident': 'Подтверждается статус постоянного резидента дивана с правом занимать наиболее удобный угол.',
          'expensive-nothing': 'Настоящим подтверждается получение абсолютно ничего, оформленного с исключительным вниманием к деталям.',
          'important-person': 'За исключительную способность выглядеть занятым и многозначительно смотреть на часы.',
          'decision-director': 'Уполномочен принимать очевидные решения и произносить их с достаточной уверенностью.',
          'luxury-pause': 'Предоставляется одна представительная пауза. Дышать, смотреть в окно и не принимать решений разрешено.',
          'patron-of-obvious': 'С благодарностью за добровольную поддержку проекта и вклад в сохранение культурного наследия очевидных ответов.'
        };
        return { headline: `${name}, документ выдан`, detail: citations[cardId], badge: 'ИМЕННАЯ ГРАМОТА' };
      }
      throw new Error('Такой карточки не существует.');
  }
}
