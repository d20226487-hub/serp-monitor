import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Документация — SERP Monitor",
  description: "Подробное руководство по работе с SERP Monitor (RU)",
};

/* Утилитарные стили: типографика для длинного текста на чистом Tailwind
   (без плагина @tailwindcss/typography). */
const H2 = "text-2xl font-semibold pt-10 mt-2 border-t dark:border-slate-800 pt-8 scroll-mt-20";
const H3 = "text-lg font-semibold mt-6 mb-2";
const H4 = "text-base font-semibold mt-4 mb-1";
const P = "text-sm leading-7 text-slate-700 dark:text-slate-300";
const UL = "list-disc list-outside ml-6 space-y-1 text-sm leading-7 text-slate-700 dark:text-slate-300";
const OL = "list-decimal list-outside ml-6 space-y-1 text-sm leading-7 text-slate-700 dark:text-slate-300";
const TABLE = "w-full text-sm border-collapse my-3";
const TH = "text-left font-semibold border-b dark:border-slate-700 px-3 py-2 align-top";
const TD = "border-b dark:border-slate-800 px-3 py-2 align-top text-slate-700 dark:text-slate-300";
const CODE = "font-mono text-[0.85em] bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded";
const PRE = "font-mono text-xs bg-slate-100 dark:bg-slate-800 rounded p-3 overflow-x-auto my-3 leading-relaxed";
const CALLOUT_NOTE = "border-l-4 border-blue-400 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/30 px-4 py-3 my-3 text-sm leading-7 text-slate-700 dark:text-slate-300";
const CALLOUT_WARN = "border-l-4 border-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 my-3 text-sm leading-7 text-slate-700 dark:text-slate-300";
const CALLOUT_TIP = "border-l-4 border-emerald-400 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-3 my-3 text-sm leading-7 text-slate-700 dark:text-slate-300";

const TOC: { id: string; title: string }[] = [
  { id: "intro", title: "Что делает SERP Monitor" },
  { id: "quickstart", title: "Быстрый старт" },
  { id: "providers", title: "Настройка провайдеров" },
  { id: "concepts", title: "canonical_name, yandex_lr и uule" },
  { id: "locations", title: "Управление локациями" },
  { id: "create-job", title: "Создание задачи" },
  { id: "cron", title: "Расписание (cron) и примеры" },
  { id: "results", title: "Просмотр результатов" },
  { id: "verify", title: "Проверка корректности (Verify scraped queries)" },
  { id: "troubleshooting", title: "Частые проблемы" },
];

export default function DocsPage() {
  return (
    <article className="max-w-3xl mx-auto pb-20">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">Документация</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
          Подробное руководство по работе с SERP Monitor — на русском, единое для обоих
          языков интерфейса.
        </p>
      </header>

      {/* Содержание */}
      <nav
        aria-label="Содержание"
        className="border rounded-md p-4 my-6 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40"
      >
        <div className="text-sm font-semibold mb-2">Содержание</div>
        <ol className="list-decimal list-outside ml-5 space-y-1 text-sm">
          {TOC.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="text-blue-700 dark:text-blue-300 hover:underline">
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {/* ───────────────────────── Что делает SERP Monitor ───────────────────────── */}
      <section id="intro">
        <h2 className={H2}>1. Что делает SERP Monitor</h2>
        <p className={P}>
          SERP Monitor — внутренний инструмент мониторинга поисковой выдачи Google и
          Яндекса. Он позволяет:
        </p>
        <ul className={UL}>
          <li>Создавать задачи (jobs) с десятками ключевых слов и снимать SERP по разным комбинациям параметров;</li>
          <li>Запускать задачи вручную или по расписанию (cron);</li>
          <li>Сохранять результаты в локальной БД и экспортировать в CSV;</li>
          <li>Сравнивать выдачу из разных гео и на разных устройствах (desktop / mobile);</li>
          <li>Подключать трёх провайдеров: <strong>SerpAPI</strong>, <strong>Bright Data</strong>, <strong>Oxylabs</strong> — на выбор для каждой задачи.</li>
        </ul>
        <p className={P}>
          Один запуск задачи раскрывается в декартово произведение по осям{" "}
          <code className={CODE}>поисковики × устройства × локации × языки × домены_google</code>{" "}
          и шлёт по одному запросу к провайдеру на каждую комбинацию.
        </p>
      </section>

      {/* ───────────────────────── Быстрый старт ───────────────────────── */}
      <section id="quickstart">
        <h2 className={H2}>2. Быстрый старт</h2>
        <p className={P}>
          Если вы только что развернули инструмент, эти 5 шагов проведут вас от пустой базы
          до первого результата:
        </p>
        <ol className={OL}>
          <li>
            Откройте <strong>Настройки</strong> → раздел <strong>Провайдеры</strong>. Введите
            ключ хотя бы одного провайдера. Самый простой старт — <strong>SerpAPI</strong>.
          </li>
          <li>
            Нажмите <strong>Проверить</strong>. Должно появиться сообщение «✓ … работает» с
            названием тарифа и остатком запросов.
          </li>
          <li>
            (Опционально) В этом же разделе ниже добавьте нужные локации в{" "}
            <strong>Сохранённые локации</strong>. Для городского таргетинга Яндекса
            обязательно укажите <code className={CODE}>yandex_lr</code> — числовой ID
            региона.
          </li>
          <li>
            Перейдите в <strong>Новая задача</strong>, заполните поля (название, ключевые
            слова, поисковики, устройства, локации, языки), нажмите{" "}
            <strong>Создать и запустить</strong>.
          </li>
          <li>
            Когда статус запуска станет «завершено», откройте его — увидите сгруппированные
            по ключевым словам результаты с цветными чипами по осям.
          </li>
        </ol>
        <div className={CALLOUT_TIP}>
          <strong>Совет:</strong> начните с одного ключевого слова, одного поисковика и одной
          локации, чтобы убедиться, что провайдер настроен корректно. Только потом
          разворачивайте задачу до полного объёма.
        </div>
      </section>

      {/* ───────────────────────── Провайдеры ───────────────────────── */}
      <section id="providers">
        <h2 className={H2}>3. Настройка провайдеров</h2>
        <p className={P}>
          Каждый провайдер настраивается на странице <strong>Настройки → Провайдеры</strong>.
          Все три провайдера сохраняются независимо; в задачах на форме «Провайдер»
          выбирается тот, чьи учётные данные настроены.
        </p>
        <p className={P}>
          Статус карточки провайдера: <strong>не задано</strong>, <strong>частично</strong>{" "}
          (заполнены не все поля), <strong>настроено</strong> (все поля заполнены).
        </p>

        <h3 className={H3}>SerpAPI</h3>
        <ul className={UL}>
          <li>Где взять ключ: <a className="underline" href="https://serpapi.com/manage-api-key" target="_blank" rel="noreferrer">serpapi.com/manage-api-key</a></li>
          <li>Самый простой вариант: один ключ покрывает и Google, и Яндекс.</li>
          <li>
            Значение в БД (то, что вы вводите на этой странице) <strong>переопределяет</strong>{" "}
            переменную окружения <code className={CODE}>SERPAPI_KEY</code> из{" "}
            <code className={CODE}>.env</code> — отдельный перезапуск контейнера не нужен.
          </li>
          <li>
            Кнопка <strong>Проверить</strong> делает тестовый запрос к SerpAPI и показывает
            ваш тариф и остаток запросов.
          </li>
        </ul>
        <div className={CALLOUT_WARN}>
          <strong>Нюанс по Яндексу:</strong> на большинстве тарифов SerpAPI Яндекс работает
          только в <em>десктопном</em> режиме. Поле <code className={CODE}>device</code> в
          задаче для Яндекса через SerpAPI <strong>не учитывается на стороне поиска</strong> —
          оно лишь записывается в результаты для последующей фильтрации. Если нужна точная
          мобильная выдача Яндекса — используйте Bright Data или Oxylabs.
        </div>

        <h3 className={H3}>Bright Data</h3>
        <p className={P}>
          Для Bright Data нужны <strong>две зоны</strong> в личном кабинете:
        </p>
        <ul className={UL}>
          <li>
            <strong>Зона типа «Full JSON»</strong> (поле <code className={CODE}>zone</code>) —
            используется для Google. Bright Data сама парсит ответ и возвращает JSON.
          </li>
          <li>
            <strong>Зона типа «Raw HTML»</strong> (поле <code className={CODE}>zone_raw</code>) —
            используется для Яндекса. На большинстве тарифов Full-JSON-парсер Bright Data
            не покрывает Яндекс, поэтому мы запрашиваем сырой HTML и парсим его собственным
            экстрактором.
          </li>
        </ul>
        <p className={P}>
          Поле <code className={CODE}>API token</code> — Bearer-токен из панели Bright Data.
        </p>
        <div className={CALLOUT_NOTE}>
          Если работаете <em>только</em> с Google — поле <code className={CODE}>zone_raw</code>{" "}
          можно оставить пустым. Если в задаче будет Яндекс, а <code className={CODE}>zone_raw</code>{" "}
          не задана — задача упадёт с ошибкой <code className={CODE}>ProviderConfigError</code>{" "}
          и понятным сообщением.
        </div>

        <h3 className={H3}>Oxylabs</h3>
        <ul className={UL}>
          <li>
            Используется SERP Scraper API (endpoint{" "}
            <code className={CODE}>realtime.oxylabs.io</code>).
          </li>
          <li>
            Поля <strong>Username</strong> и <strong>Password</strong> — это учётка
            суб-аккаунта <em>Oxylabs SERP Scraper</em>, не основного аккаунта.
          </li>
        </ul>
        <div className={CALLOUT_WARN}>
          <strong>Нюансы по Яндексу через Oxylabs:</strong>
          <ul className={UL + " mt-1"}>
            <li>
              Старый источник <code className={CODE}>yandex_search</code> у Oxylabs{" "}
              <strong>списан</strong>. Мы используем <code className={CODE}>source: universal</code>{" "}
              с собственноручно собранным URL Яндекса.
            </li>
            <li>
              Параметр <code className={CODE}>parse: true</code> для Яндекса через universal-source
              <em>не работает</em> (отдаёт пустой parsed-контент). Поэтому мы парсим HTML сами.
            </li>
            <li>
              <strong>Обязательно</strong> в теле запроса должен быть{" "}
              <code className={CODE}>geo_location</code> (страна) — иначе Oxylabs выберет
              случайный прокси по миру, и Яндекс выдаст выдачу не из того региона. Мы
              автоматически передаём код страны в верхнем регистре или вычисляем его из
              указанного <code className={CODE}>yandex_domain</code>.
            </li>
          </ul>
        </div>

        <h3 className={H3}>DataForSEO</h3>
        <div className={CALLOUT_WARN}>
          <strong>Только Google.</strong> У DataForSEO <strong>нет</strong> эндпоинта для
          Яндекса — их SERP API покрывает Google, Bing, YouTube, Yahoo, Baidu, Naver и
          Seznam. Если в задаче выбран DataForSEO и Яндекс, запросы к Яндексу завершатся
          понятной ошибкой, а Google в той же задаче отработает нормально. Форма задачи
          предупредит об этом заранее.
        </div>
        <ul className={UL}>
          <li>
            Учётные данные: <strong>Логин (email)</strong> и <strong>API-пароль</strong> со
            страницы <code className={CODE}>app.dataforseo.com/api-access</code>.{" "}
            <strong>API-пароль генерируется автоматически и НЕ совпадает с паролем от
            аккаунта</strong> — частая причина ошибки авторизации.
          </li>
          <li>
            Кнопка <strong>Проверить</strong> здесь <strong>бесплатна</strong>: она
            обращается к <code className={CODE}>/v3/appendix/user_data</code> и показывает
            баланс, не тратя кредиты (в отличие от Bright Data и Oxylabs, где проверка
            стоит ~1 запрос).
          </li>
          <li>
            Режим <strong>Live</strong>: ~<code className={CODE}>$0.002</code> за запрос,
            результат за несколько секунд. У DataForSEO есть более дешёвая очередь задач
            (<code className={CODE}>$0.0006</code>), но она требует схемы
            POST → опрос → GET с задержкой ~5 минут; это отложено на будущее.
          </li>
          <li>
            <strong>Локации работают «из коробки»:</strong> поле{" "}
            <code className={CODE}>location_name</code> у DataForSEO использует тот же
            формат Google Ads (<code className={CODE}>Город,Регион,Страна</code>), что и{" "}
            <code className={CODE}>canonical_name</code> у SerpAPI. Все сохранённые локации
            подходят без изменений.
          </li>
          <li>
            <strong>Локация обязательна.</strong> В отличие от SerpAPI, у DataForSEO нет
            режима «без гео»: если в задаче не выбрана локация и страну не удаётся
            определить, запрос завершится понятной ошибкой.
          </li>
        </ul>

        <h3 className={H3}>Сравнительная таблица — что honor'ит каждый провайдер</h3>
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <thead>
              <tr>
                <th className={TH}>Поле</th>
                <th className={TH}>SerpAPI</th>
                <th className={TH}>Bright Data</th>
                <th className={TH}>Oxylabs</th>
                <th className={TH}>DataForSEO</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={TD}>Google страна (<code className={CODE}>gl=</code>)</td>
                <td className={TD}>✓</td>
                <td className={TD}>✓</td>
                <td className={TD}>✓ через <code className={CODE}>geo_location</code></td>
                <td className={TD}>✓ через <code className={CODE}>location_name</code></td>
              </tr>
              <tr>
                <td className={TD}>Google город</td>
                <td className={TD}><code className={CODE}>location=&lt;canonical&gt;</code></td>
                <td className={TD}>сгенерированный <code className={CODE}>uule=</code></td>
                <td className={TD}><code className={CODE}>geo_location=&lt;canonical&gt;</code> (best-effort)</td>
                <td className={TD}><code className={CODE}>location_name=&lt;canonical&gt;</code></td>
              </tr>
              <tr>
                <td className={TD}>Google устройство</td>
                <td className={TD}><code className={CODE}>device=mobile/desktop</code></td>
                <td className={TD}><code className={CODE}>brd_mobile=0/1</code></td>
                <td className={TD}><code className={CODE}>user_agent_type</code></td>
                <td className={TD}><code className={CODE}>device=mobile/desktop</code></td>
              </tr>
              <tr>
                <td className={TD}>Yandex страна</td>
                <td className={TD}><code className={CODE}>yandex_domain=</code></td>
                <td className={TD}><code className={CODE}>yandex_domain=</code></td>
                <td className={TD}><code className={CODE}>yandex_domain=</code></td>
                <td className={TD}>— не поддерживается</td>
              </tr>
              <tr>
                <td className={TD}>Yandex город</td>
                <td className={TD}><code className={CODE}>lr=&lt;id&gt;</code></td>
                <td className={TD}><code className={CODE}>lr=&lt;id&gt;</code> через raw zone</td>
                <td className={TD}><code className={CODE}>lr=&lt;id&gt;</code> в URL + <code className={CODE}>geo_location: КОД</code> в теле</td>
                <td className={TD}>— не поддерживается</td>
              </tr>
              <tr>
                <td className={TD}>Yandex устройство</td>
                <td className={TD}>только desktop</td>
                <td className={TD}><code className={CODE}>brd_mobile=0/1</code></td>
                <td className={TD}><code className={CODE}>user_agent_type</code></td>
                <td className={TD}>— не поддерживается</td>
              </tr>
              <tr>
                <td className={TD}>Бесплатная проверка ключа</td>
                <td className={TD}>✓ <code className={CODE}>/account</code></td>
                <td className={TD}>— стоит ~1 запрос</td>
                <td className={TD}>— стоит ~1 запрос</td>
                <td className={TD}>✓ <code className={CODE}>/appendix/user_data</code></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ───────────────────────── Концепции ───────────────────────── */}
      <section id="concepts">
        <h2 className={H2}>4. <code className={CODE}>canonical_name</code>, <code className={CODE}>yandex_lr</code> и <code className={CODE}>uule</code></h2>
        <p className={P}>
          Три ключевых идентификатора, без понимания которых легко получить выдачу не из
          того региона.
        </p>

        <h3 className={H3}>canonical_name — эталонное имя локации (формат SerpAPI)</h3>
        <p className={P}>
          Это разделённый запятыми список от меньшего к большему: «Город, Регион/Область,
          Страна». Пишется на английском (как в базе SerpAPI).
        </p>
        <pre className={PRE}>
{`Almaty,Almaty Province,Kazakhstan
Tashkent,Tashkent Region,Uzbekistan
Moscow,Moscow,Russia
Saint Petersburg,Saint Petersburg,Russia
Bishkek,Bishkek,Kyrgyzstan`}
        </pre>
        <p className={P}>
          Все провайдеры используют этот формат по-своему:
        </p>
        <ul className={UL}>
          <li><strong>SerpAPI</strong> — передаёт <code className={CODE}>location=&lt;canonical_name&gt;</code> напрямую;</li>
          <li><strong>Bright Data Google</strong> — мы кодируем <code className={CODE}>canonical_name</code> в <code className={CODE}>uule=</code> (см. ниже);</li>
          <li><strong>Oxylabs Google</strong> — передаёт как <code className={CODE}>geo_location</code> (best-effort matching по их базе локаций).</li>
        </ul>

        <h3 className={H3}>yandex_lr — числовой ID региона Яндекса</h3>
        <p className={P}>
          Яндекс не понимает текстовых названий городов в URL — он использует свои
          внутренние числовые коды (параметр <code className={CODE}>lr=</code>). Без
          указания <code className={CODE}>lr=</code> Яндекс отдаст выдачу уровня страны
          (определяется доменом <code className={CODE}>yandex.ru</code> /{" "}
          <code className={CODE}>yandex.kz</code> и т. д.).
        </p>
        <p className={P}>Подтверждённые значения для основных городов:</p>
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <thead>
              <tr><th className={TH}>Город</th><th className={TH}>lr</th><th className={TH}>Город</th><th className={TH}>lr</th></tr>
            </thead>
            <tbody>
              <tr><td className={TD}>Москва</td><td className={TD}>213</td><td className={TD}>Алматы</td><td className={TD}>162</td></tr>
              <tr><td className={TD}>Санкт-Петербург</td><td className={TD}>2</td><td className={TD}>Астана</td><td className={TD}>163</td></tr>
              <tr><td className={TD}>Новосибирск</td><td className={TD}>65</td><td className={TD}>Ташкент</td><td className={TD}><strong>10335</strong></td></tr>
              <tr><td className={TD}>Екатеринбург</td><td className={TD}>54</td><td className={TD}>Бишкек</td><td className={TD}>28658</td></tr>
              <tr><td className={TD}>Минск</td><td className={TD}>157</td><td className={TD}>Тбилиси</td><td className={TD}>10277</td></tr>
            </tbody>
          </table>
        </div>
        <div className={CALLOUT_WARN}>
          <strong>Важно про Ташкент:</strong> в старых источниках часто фигурирует значение{" "}
          <code className={CODE}>11353</code> — оно неправильное. Подтверждённое
          пользователем значение — <code className={CODE}>10335</code>. Если ваша задача
          по Узбекистану выдаёт результаты не по Ташкенту — первым делом проверьте это
          поле.
        </div>

        <h4 className={H4}>Как самостоятельно узнать lr для города</h4>
        <ol className={OL}>
          <li>Откройте <code className={CODE}>https://yandex.ru/search/?text=пицца</code> (запрос неважен).</li>
          <li>В правом верхнем углу нажмите на название текущего региона → <strong>Изменить</strong>.</li>
          <li>Выберите нужный город из списка/подсказки.</li>
          <li>После перехода обратно к поиску в URL появится параметр <code className={CODE}>lr=&lt;число&gt;</code>. Это и есть искомое значение.</li>
        </ol>

        <h3 className={H3}>uule — закодированный гео-параметр Google</h3>
        <p className={P}>
          Google аналогично не принимает в URL текстовые названия — для городского
          таргетинга используется параметр <code className={CODE}>uule=</code>. Это
          закодированная Base64-строка с <code className={CODE}>canonical_name</code> в
          формате UULE-v2:
        </p>
        <pre className={PRE}>
{`w+CAIQICI<длина-символ><base64(canonical_name)>

Пример для "Almaty,Almaty Province,Kazakhstan":
w+CAIQICIfQWxtYXR5LEFsbWF0eSBQcm92aW5jZSxLYXpha2hzdGFu`}
        </pre>
        <p className={P}>
          Мы вычисляем <code className={CODE}>uule</code> автоматически из{" "}
          <code className={CODE}>canonical_name</code>. На странице{" "}
          <strong>Настройки</strong> в таблице сохранённых локаций есть колонка{" "}
          <strong>uule (Bright Data Google)</strong> — там можно скопировать готовое значение
          (тултип покажет полное, кнопка-копия скопирует в буфер).
        </p>
        <p className={P}>Кто из провайдеров с чем работает:</p>
        <ul className={UL}>
          <li><strong>Bright Data Google</strong> — мы автоматически добавляем <code className={CODE}>uule=</code> в URL запроса;</li>
          <li><strong>Oxylabs Google</strong> — передаёт <code className={CODE}>geo_location=&lt;canonical_name&gt;</code> (без uule, через свою БД локаций);</li>
          <li><strong>SerpAPI Google</strong> — использует <code className={CODE}>location=&lt;canonical_name&gt;</code> (uule не нужен).</li>
        </ul>
      </section>

      {/* ───────────────────────── Локации ───────────────────────── */}
      <section id="locations">
        <h2 className={H2}>5. Управление локациями (раздел «Настройки»)</h2>
        <p className={P}>
          Сохранённые локации — единственный источник истины для городского таргетинга.
          Сидер при первом запуске на пустой БД заполняет ~30 городов СНГ/Евразии. Все
          ваши последующие правки <strong>сохраняются между перезапусками</strong> и не
          перезаписываются сидом.
        </p>

        <h3 className={H3}>Добавить одну локацию</h3>
        <p className={P}>В блоке «Добавить локацию» заполните:</p>
        <ul className={UL}>
          <li><strong>canonical_name</strong> — обязательно, формат SerpAPI;</li>
          <li><strong>отображаемое имя</strong> — короткое имя для удобства (Алматы);</li>
          <li><strong>cc</strong> — двухбуквенный код страны в нижнем регистре (kz, ru, uz);</li>
          <li><strong>тип</strong> — Country / Region / City / Other (для маркировки);</li>
          <li><strong>yandex_lr</strong> — числовой ID региона Яндекса, если планируете снимать Яндекс на уровне города.</li>
        </ul>

        <h3 className={H3}>Массовый импорт</h3>
        <p className={P}>
          Одна запись на строку. Колонки разделены табуляцией <em>или</em> вертикальной
          чертой <code className={CODE}>|</code>. Только первая колонка обязательна;
          остальные опциональны. Дубликаты пропускаются автоматически (по
          <code className={CODE}>canonical_name</code>).
        </p>
        <pre className={PRE}>
{`canonical_name | name | country_code | target_type | yandex_lr

Almaty,Almaty Province,Kazakhstan | Almaty | kz | City | 162
Tashkent,Tashkent Region,Uzbekistan | Tashkent | uz | City | 10335
Moscow,Moscow,Russia | Moscow | ru | City | 213
Saint Petersburg,Saint Petersburg,Russia | SPB | ru | City | 2
Bishkek,Bishkek,Kyrgyzstan | Bishkek | kg | City | 28658`}
        </pre>

        <h3 className={H3}>Редактирование, фильтр, удаление</h3>
        <ul className={UL}>
          <li><strong>Карандаш (✎)</strong> рядом с записью — режим редактирования. Сохранить — зелёная галочка, отменить — крестик.</li>
          <li><strong>Корзина (🗑)</strong> — удаление с подтверждением.</li>
          <li><strong>Фильтр</strong> в правом верхнем углу — поиск по <code className={CODE}>canonical_name</code>, имени, коду страны.</li>
        </ul>

        <h3 className={H3}>Что попадает в запросы из строки локации</h3>
        <ul className={UL}>
          <li><strong>SerpAPI:</strong> <code className={CODE}>location=&lt;canonical_name&gt;</code> + <code className={CODE}>gl=&lt;cc&gt;</code></li>
          <li><strong>Bright Data Google:</strong> <code className={CODE}>gl=&lt;cc&gt;</code> + сгенерированный <code className={CODE}>uule=</code></li>
          <li><strong>Bright Data Yandex:</strong> URL <code className={CODE}>https://yandex.&lt;tld&gt;/search/?text=...&amp;lr=&lt;yandex_lr&gt;</code> через raw-zone</li>
          <li><strong>Oxylabs Google:</strong> <code className={CODE}>geo_location=&lt;canonical_name&gt;</code></li>
          <li><strong>Oxylabs Yandex:</strong> <code className={CODE}>lr=&lt;yandex_lr&gt;</code> в URL + <code className={CODE}>geo_location: КОД</code> в теле</li>
        </ul>
      </section>

      {/* ───────────────────────── Создание задачи ───────────────────────── */}
      <section id="create-job">
        <h2 className={H2}>6. Создание задачи — что заполнять</h2>
        <p className={P}>
          Открывается со страницы <strong>Новая задача</strong>. Все поля связаны;
          под формой в реальном времени отображается оценка количества запросов
          провайдера.
        </p>

        <h3 className={H3}>Поля формы</h3>
        <ol className={OL}>
          <li><strong>Название</strong> — любое короткое осмысленное (например, «Бренд X — KZ/RU»).</li>
          <li><strong>Ключевые слова</strong> — по одному на строку, <strong>не более 100</strong>. Лишние молча отбрасываются. Регистр и пунктуация сохраняются как написано.</li>
          <li><strong>Провайдер</strong> — выберите того, у кого заполнены учётные данные на странице Настроек.</li>
          <li><strong>Поисковики</strong> — Google и/или Яндекс (можно оба сразу).</li>
          <li><strong>Устройства</strong> — desktop и/или mobile.</li>
          <li><strong>Геолокации</strong> — выбираются из сохранённых (помечены звездой ★) или ищутся через SerpAPI live (минимум 2 символа). Сохранённые показываются всегда, live-результаты — ниже.</li>
          <li><strong>Языки</strong> — например <code className={CODE}>ru</code>, <code className={CODE}>kk</code>, <code className={CODE}>en</code>. Влияет на <code className={CODE}>hl=</code> (Google) и <code className={CODE}>lang=</code> (Яндекс).</li>
          <li><strong>Домены Google (необязательно)</strong> — если оставить пустым, домен подставится автоматически из <code className={CODE}>country_code</code> локации (kz → google.kz, ru → google.ru). Если задаёте вручную — каждый домен умножает количество запросов.</li>
          <li><strong>Поля для извлечения</strong> — что записывать в результаты: URL, заголовок, мета-описание.</li>
          <li><strong>Топ N позиций</strong> — сколько верхних позиций сохранять (по умолчанию 10).</li>
        </ol>

        <h3 className={H3}>Панель «Фактический таргетинг»</h3>
        <p className={P}>
          Сразу под полем «Геолокации» появляется блок, который для каждой выбранной
          локации × поисковика показывает, что именно будет передано выбранному
          провайдеру:
        </p>
        <ul className={UL}>
          <li>зелёный значок <strong>город</strong> — будет городской таргетинг;</li>
          <li>оранжевый <strong>страна</strong> — только страна (это часто означает что-то не настроено);</li>
          <li>серый <strong>без гео</strong> — никакого таргетинга.</li>
        </ul>
        <p className={P}>
          Если для локации <strong>не задан yandex_lr</strong>, под ней появится оранжевое
          предупреждение: задача отработает, но даст выдачу уровня страны, не города.
        </p>

        <h3 className={H3}>Декартово произведение и оценка стоимости</h3>
        <p className={P}>
          Каждая комбинация = один запрос к провайдеру. Формула:
        </p>
        <pre className={PRE}>
{`Google:  ключевые × устройства × локации × языки × домены_google
Yandex:  ключевые × устройства × локации × языки   (домены не множат)
ИТОГО:   Google + Yandex`}
        </pre>
        <p className={P}>
          Под формой блок <strong>Расчётное число запросов SerpAPI за один прогон</strong>{" "}
          обновляется при любом изменении полей. Бэкенд в момент запуска удаляет дубликаты
          вариантов, поэтому фактическое число запросов может быть чуть меньше оценки.
        </p>

        <h3 className={H3}>На что обратить внимание</h3>
        <div className={CALLOUT_WARN}>
          <ul className={UL + " mt-0"}>
            <li>
              <strong>Не выбирайте все локации сразу.</strong> 100 ключевых × 2 устройства ×
              30 локаций × 2 языка = 12 000 запросов на одну задачу. Большинство тарифов
              этого не выдержат за один прогон.
            </li>
            <li>
              <strong>Bright Data + Yandex без zone_raw</strong> — задача упадёт с ошибкой{" "}
              <code className={CODE}>ProviderConfigError</code>. Зайдите в Настройки → Bright
              Data, заполните <code className={CODE}>zone_raw</code>.
            </li>
            <li>
              <strong>Mobile Yandex через SerpAPI</strong> — на большинстве тарифов это
              эквивалент desktop. Используйте Bright Data или Oxylabs если нужна именно
              мобильная выдача Яндекса.
            </li>
            <li>
              <strong>Кириллица vs латиница для одного бренда</strong> — Яндекс и Google
              нормализуют их по-разному. Если вам важно отслеживать оба написания —
              добавляйте оба варианта как разные ключевые слова.
            </li>
            <li>
              <strong>Языки</strong> — при пустом списке языков провайдер сам выберет язык по
              домену; результат может быть непредсказуемым. Лучше явно указывать хотя бы
              один.
            </li>
            <li>
              <strong>Кнопка «Сохранить»</strong> создаёт задачу без запуска;{" "}
              <strong>«Создать и запустить»</strong> создаёт и сразу запускает.
            </li>
          </ul>
        </div>

        <h3 className={H3}>Редактирование существующей задачи</h3>
        <p className={P}>
          На странице задачи кнопка <strong>Изменить</strong> открывает ту же форму. Можно
          поправить любое поле, нажать <strong>Сохранить изменения</strong> или{" "}
          <strong>Сохранить и запустить</strong>. История запусков сохраняется — старые
          запуски остаются с их параметрами на момент запуска.
        </p>
      </section>

      {/* ───────────────────────── Cron ───────────────────────── */}
      <section id="cron">
        <h2 className={H2}>7. Расписание (cron) — формат и примеры</h2>

        <h3 className={H3}>Формат cron-выражения</h3>
        <p className={P}>Пять полей, разделённых пробелами:</p>
        <pre className={PRE}>
{`┌─── минуты      (0-59)
│ ┌─ часы        (0-23)
│ │ ┌ день_месяца (1-31)
│ │ │ ┌ месяц    (1-12)
│ │ │ │ ┌ день_недели (0-6, где 0=воскресенье; также принимается 7)
│ │ │ │ │
* * * * *`}
        </pre>
        <p className={P}>Специальные символы:</p>
        <ul className={UL}>
          <li><code className={CODE}>*</code> — любое значение;</li>
          <li><code className={CODE}>,</code> — список (например, <code className={CODE}>9,12,15</code>);</li>
          <li><code className={CODE}>-</code> — диапазон (<code className={CODE}>1-5</code> = пн-пт в поле дня недели);</li>
          <li><code className={CODE}>/</code> — шаг (<code className={CODE}>*/15</code> = каждые 15 единиц поля).</li>
        </ul>

        <h3 className={H3}>Часовой пояс</h3>
        <p className={P}>
          По умолчанию расписание считается <strong>в UTC</strong> (надпись «Cron-выражение в
          часовом поясе UTC» под полем). Чтобы поменять, нужно отредактировать{" "}
          <code className={CODE}>backend/app/scheduler.py</code> (строку{" "}
          <code className={CODE}>timezone=&quot;UTC&quot;</code> на нужный, например{" "}
          <code className={CODE}>&quot;Asia/Almaty&quot;</code>) и перезапустить контейнер{" "}
          <code className={CODE}>api</code>:
        </p>
        <pre className={PRE}>{`docker compose restart api`}</pre>
        <p className={P}>
          На странице задачи в блоке «Расписание» отображается{" "}
          <strong>Следующий запуск: &lt;дата&gt; (ваше время)</strong> — это уже преобразовано
          в часовой пояс вашего браузера, чтобы было удобно сверить.
        </p>
        <div className={CALLOUT_TIP}>
          <strong>Перевод локального времени в UTC:</strong> вычтите свой UTC-offset. Для
          Алматы (UTC+5) «09:00 локально» = «04:00 UTC». Для Москвы (UTC+3) — «06:00 UTC».
          Зимнее/летнее время в большинстве стран СНГ не действует, проверять не нужно.
        </div>

        <h3 className={H3}>Готовые шаблоны (кнопки под полем)</h3>
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <thead>
              <tr><th className={TH}>Кнопка</th><th className={TH}>Выражение</th><th className={TH}>Когда срабатывает</th></tr>
            </thead>
            <tbody>
              <tr><td className={TD}>Каждый час</td><td className={TD}><code className={CODE}>0 * * * *</code></td><td className={TD}>В начале каждого часа: 00:00, 01:00, 02:00…</td></tr>
              <tr><td className={TD}>Каждые 6 ч</td><td className={TD}><code className={CODE}>0 */6 * * *</code></td><td className={TD}>00:00, 06:00, 12:00, 18:00</td></tr>
              <tr><td className={TD}>Ежедневно 06:00</td><td className={TD}><code className={CODE}>0 6 * * *</code></td><td className={TD}>Раз в сутки в 6 утра</td></tr>
              <tr><td className={TD}>Ежедневно 09:00 + 21:00</td><td className={TD}><code className={CODE}>0 9,21 * * *</code></td><td className={TD}>Дважды в день</td></tr>
              <tr><td className={TD}>Будни 08:00</td><td className={TD}><code className={CODE}>0 8 * * 1-5</code></td><td className={TD}>Понедельник–пятница в 8:00</td></tr>
            </tbody>
          </table>
        </div>

        <h3 className={H3}>Дополнительные примеры</h3>
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <thead>
              <tr><th className={TH}>Задача</th><th className={TH}>Cron</th><th className={TH}>Пояснение</th></tr>
            </thead>
            <tbody>
              <tr><td className={TD}>Каждые 30 минут</td><td className={TD}><code className={CODE}>*/30 * * * *</code></td><td className={TD}>В <code className={CODE}>:00</code> и <code className={CODE}>:30</code></td></tr>
              <tr><td className={TD}>Каждые 15 минут</td><td className={TD}><code className={CODE}>*/15 * * * *</code></td><td className={TD}>В :00, :15, :30, :45</td></tr>
              <tr><td className={TD}>Каждые 5 минут</td><td className={TD}><code className={CODE}>*/5 * * * *</code></td><td className={TD}>Для отладки. Внимание к лимитам провайдера.</td></tr>
              <tr><td className={TD}>Раз в неделю, понедельник 09:00</td><td className={TD}><code className={CODE}>0 9 * * 1</code></td><td className={TD}>1 = понедельник</td></tr>
              <tr><td className={TD}>Раз в неделю, воскресенье 23:00</td><td className={TD}><code className={CODE}>0 23 * * 0</code></td><td className={TD}>0 (или 7) = воскресенье</td></tr>
              <tr><td className={TD}>Раз в месяц, 1-го числа в 06:00</td><td className={TD}><code className={CODE}>0 6 1 * *</code></td><td className={TD}>Первый день каждого месяца</td></tr>
              <tr><td className={TD}>Каждые 2 часа</td><td className={TD}><code className={CODE}>0 */2 * * *</code></td><td className={TD}>00:00, 02:00, 04:00, …, 22:00</td></tr>
              <tr><td className={TD}>Каждые 3 часа с 9 до 18 в будни</td><td className={TD}><code className={CODE}>0 9,12,15,18 * * 1-5</code></td><td className={TD}>4 запуска в рабочий день</td></tr>
              <tr><td className={TD}>Только пятница 17:30</td><td className={TD}><code className={CODE}>30 17 * * 5</code></td><td className={TD}>Для еженедельного отчёта</td></tr>
              <tr><td className={TD}>1-го числа квартала</td><td className={TD}><code className={CODE}>0 8 1 1,4,7,10 *</code></td><td className={TD}>Январь / апрель / июль / октябрь</td></tr>
              <tr><td className={TD}>Раз в полугодие</td><td className={TD}><code className={CODE}>0 8 1 1,7 *</code></td><td className={TD}>1 января и 1 июля</td></tr>
              <tr><td className={TD}>Каждые 10 минут в рабочие часы</td><td className={TD}><code className={CODE}>*/10 9-18 * * 1-5</code></td><td className={TD}>Только пн-пт 09:00–18:50</td></tr>
              <tr><td className={TD}>Дважды в час: :00 и :30</td><td className={TD}><code className={CODE}>0,30 * * * *</code></td><td className={TD}>48 запусков в сутки</td></tr>
              <tr><td className={TD}>Каждое утро 04:00 (UTC) = 09:00 Almaty</td><td className={TD}><code className={CODE}>0 4 * * *</code></td><td className={TD}>Если планировщик в UTC, а вы в UTC+5</td></tr>
              <tr><td className={TD}>Будни 10:00 + 14:00 + 18:00</td><td className={TD}><code className={CODE}>0 10,14,18 * * 1-5</code></td><td className={TD}>Три захода за рабочий день</td></tr>
              <tr><td className={TD}>В выходные днём</td><td className={TD}><code className={CODE}>0 12 * * 6,0</code></td><td className={TD}>Сб и вс в полдень</td></tr>
            </tbody>
          </table>
        </div>

        <h3 className={H3}>Чекбокс «Включено»</h3>
        <div className={CALLOUT_WARN}>
          Само заполнение поля cron <strong>не запускает</strong> расписание. Чтобы планировщик
          его принял, нужно <strong>поставить галочку «Включено» и сохранить задачу</strong>.
          После сохранения на странице задачи в блоке «Расписание» появится «включено» и
          «Следующий запуск: &lt;дата&gt; (ваше время)» — это сигнал, что планировщик принял
          задачу. Если видите «⚠ не зарегистрировано в планировщике» — переключите чекбокс
          выкл/вкл и сохраните ещё раз.
        </div>

        <h3 className={H3}>Поведение при выключенном или спящем компьютере</h3>
        <p className={P}>(Актуально для локального запуска через Docker Compose. На VPS этот сценарий не возникает.)</p>
        <ul className={UL}>
          <li>
            Параметры планировщика: <code className={CODE}>misfire_grace_time=None</code> +{" "}
            <code className={CODE}>coalesce=True</code>. Если вы пропустили несколько
            триггеров, пока компьютер был выключен, при пробуждении задача запустится{" "}
            <strong>один раз</strong> (не ноль и не за все пропущенные).
          </li>
          <li>
            Если <code className={CODE}>api</code> перезапустился прямо во время выполнения
            задачи, её статус автоматически переведётся в <strong>failed</strong> с пометкой
            «process restarted while running» — нажмите <strong>Перезапустить</strong>.
          </li>
        </ul>
      </section>

      {/* ───────────────────────── Результаты ───────────────────────── */}
      <section id="results">
        <h2 className={H2}>8. Просмотр результатов запуска</h2>

        <h3 className={H3}>Структура страницы</h3>
        <ul className={UL}>
          <li><strong>Шапка:</strong> номер запуска, дата, статус, прогресс <code className={CODE}>выполнено/всего</code>, число ошибок (красным, если есть).</li>
          <li><strong>Экспорт топ N + Скачать CSV</strong> — выгрузка в стандартном табличном формате с шапкой.</li>
          <li><strong>Скопировать всё</strong> — TSV (табы как разделители) в буфер обмена для вставки в Excel/Google Sheets.</li>
          <li><strong>Фильтр по ключевому слову</strong> — клиентский поиск по тексту.</li>
          <li><strong>Verify scraped queries</strong> (раскрывающийся блок) — проверка точных URL запросов. Подробно см. следующий раздел.</li>
          <li><strong>Группы по ключевым словам</strong> — каждая группа подсвечена цветной рамкой; внутри — варианты с цветными чипами.</li>
        </ul>

        <h3 className={H3}>Цветные чипы (вариант = engine × device × location × language)</h3>
        <p className={P}>
          Каждая ось получает свой цвет, чтобы при просмотре длинного запуска было видно
          <em>что именно отличается</em> между двумя строками:
        </p>
        <ul className={UL}>
          <li>🟪 <strong>Фиолетовый</strong> — поисковик (engine);</li>
          <li>🟩 <strong>Зелёный</strong> — устройство (device);</li>
          <li>🟨 <strong>Жёлтый</strong> — локация (страна/город);</li>
          <li>🟥 <strong>Розовый</strong> — язык.</li>
        </ul>

        <h3 className={H3}>Имя файла CSV</h3>
        <pre className={PRE}>
{`<slug-задачи>_DD-MM-YYYY_H.MM.SS-AM/PM_run<id>_top<N>.csv

Пример:
brand-monitoring_05-05-2026_3.42.18-PM_run17_top10.csv`}
        </pre>

        <h3 className={H3}>Кнопка «Копировать» рядом с ключевым словом</h3>
        <p className={P}>
          Копирует только результаты по этому ключевому слову в TSV-формате (позиция,
          поисковик, устройство, URL, заголовок, описание). Отсортировано по
          поисковик+устройство+позиция.
        </p>
      </section>

      {/* ───────────────────────── Verify scraped queries ───────────────────────── */}
      <section id="verify">
        <h2 className={H2}>9. Проверка корректности (раздел «Проверить выполненные запросы»)</h2>

        <p className={P}>
          Это <strong>самый важный инструмент контроля</strong>. После каждого запуска,
          особенно после смены провайдера или добавления новой локации,{" "}
          <strong>обязательно</strong> сверьте хотя бы несколько вариантов вручную, прежде
          чем доверять цифрам.
        </p>

        <h3 className={H3}>Что показывает блок</h3>
        <ul className={UL}>
          <li>Список <strong>уникальных пар «ключевое слово × вариант»</strong>, по которым были запросы;</li>
          <li>Для каждой — кликабельная ссылка вида:</li>
        </ul>
        <pre className={PRE}>
{`https://www.google.kz/search?q=acme&gl=kz&hl=ru&uule=w+CAIQICI...
https://yandex.kz/search/?text=acme&lr=162&lang=ru`}
        </pre>
        <p className={P}>
          Это <strong>читаемые человеком URL</strong> — тот вид, который принимает сам
          Google/Яндекс. Провайдер-специфичные параметры (<code className={CODE}>brd_json</code>,{" "}
          <code className={CODE}>parse</code>, <code className={CODE}>source</code> и т. п.)
          вырезаны: то, что вы видите в браузере, и есть то, что мы запрашивали у поиска.
        </p>

        <h3 className={H3}>Как правильно проверить Yandex</h3>
        <p className={P}>Откройте URL в браузере и проверьте поэлементно:</p>
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <thead>
              <tr>
                <th className={TH}>Параметр в URL</th>
                <th className={TH}>Что должно быть</th>
                <th className={TH}>Что увидите если неправильно</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={TD}><code className={CODE}>text=</code></td>
                <td className={TD}>То же ключевое слово, что в задаче</td>
                <td className={TD}>Другое ключевое слово — баг в задаче или неправильно скопировано</td>
              </tr>
              <tr>
                <td className={TD}><code className={CODE}>lr=</code></td>
                <td className={TD}>Соответствует выбранному городу (см. таблицу регионов выше)</td>
                <td className={TD}>Если пусто — выдача уровня страны; если число неправильное — выдача из другого города. Проверьте поле <code className={CODE}>yandex_lr</code> в Настройках для этой локации.</td>
              </tr>
              <tr>
                <td className={TD}><code className={CODE}>lang=</code></td>
                <td className={TD}>Язык, выбранный в задаче (<code className={CODE}>ru</code>, <code className={CODE}>kk</code>, <code className={CODE}>en</code>)</td>
                <td className={TD}>Другой язык; пустота = язык по умолчанию для региона</td>
              </tr>
              <tr>
                <td className={TD}>Домен (<code className={CODE}>yandex.ru</code>, <code className={CODE}>yandex.kz</code>, …)</td>
                <td className={TD}>Соответствует стране локации</td>
                <td className={TD}>Другой домен — проверьте <code className={CODE}>country_code</code> локации</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className={P}>
          После открытия в браузере сверьте: <strong>топ-3 видимых результатов</strong> на
          странице должны примерно совпадать с тем, что в группе результатов в нашей системе.
          Маленькое расхождение (1–2 позиции) нормально — Яндекс персонализирует выдачу даже
          в анонимном режиме. Большое расхождение (≥5 отличий из 10) — сигнал, что что-то не
          так с гео или прокси.
        </p>

        <h3 className={H3}>Как правильно проверить Google</h3>
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <thead>
              <tr>
                <th className={TH}>Параметр в URL</th>
                <th className={TH}>Что должно быть</th>
                <th className={TH}>Что увидите если неправильно</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={TD}><code className={CODE}>q=</code></td>
                <td className={TD}>Ваше ключевое слово</td>
                <td className={TD}>Другое слово — баг сериализации</td>
              </tr>
              <tr>
                <td className={TD}><code className={CODE}>gl=</code></td>
                <td className={TD}>Код страны (<code className={CODE}>kz</code>, <code className={CODE}>ru</code>, <code className={CODE}>uz</code>…)</td>
                <td className={TD}>Пустота = глобальная выдача; другой код = выдача из другой страны</td>
              </tr>
              <tr>
                <td className={TD}><code className={CODE}>hl=</code></td>
                <td className={TD}>Код языка интерфейса</td>
                <td className={TD}>Другой язык — проверьте поле «Языки» в задаче</td>
              </tr>
              <tr>
                <td className={TD}><code className={CODE}>uule=</code></td>
                <td className={TD}>Длинная Base64-строка для городского таргетинга</td>
                <td className={TD}>Если нет — выдача уровня страны (<code className={CODE}>gl=</code>); неправильный — выдача с другого города</td>
              </tr>
              <tr>
                <td className={TD}>Домен (<code className={CODE}>google.kz</code>, <code className={CODE}>google.ru</code>…)</td>
                <td className={TD}>Соответствует стране локации</td>
                <td className={TD}>Другой домен — проверьте <code className={CODE}>country_code</code> локации или поле «Домены Google»</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className={P}>
          <code className={CODE}>uule</code> в браузере декодировать напрямую не получится —
          он закодирован. Чтобы убедиться, что это «тот самый» город, скопируйте{" "}
          <code className={CODE}>canonical_name</code> из таблицы сохранённых локаций и
          сравните с предпросмотром <code className={CODE}>uule</code> в той же таблице
          (колонка <strong>uule (Bright Data Google)</strong>) — должно совпасть с тем, что
          вы видите в URL.
        </p>

        <h3 className={H3}>Мобильная выдача</h3>
        <p className={P}>
          URL для desktop и mobile <strong>выглядит одинаково</strong> у обоих поисковиков —
          мобильная выдача определяется <strong>User-Agent</strong> браузера. Чтобы проверить
          мобильный скрап:
        </p>
        <ol className={OL}>
          <li>Откройте Chrome → DevTools (<code className={CODE}>F12</code>);</li>
          <li>Включите режим адаптивной вёрстки: <code className={CODE}>Ctrl+Shift+M</code> (Win) / <code className={CODE}>Cmd+Shift+M</code> (Mac);</li>
          <li>Выберите устройство сверху (например, iPhone 14 Pro или Pixel 7);</li>
          <li>Перезагрузите страницу — теперь вы видите мобильный SERP.</li>
        </ol>
        <p className={P}>
          Если в нашей системе у строки <code className={CODE}>device=mobile</code>, а вживую
          через мобильный User-Agent выдача в браузере совпадает с нашей — всё корректно.
        </p>

        <h3 className={H3}>Когда стоит сверять</h3>
        <ul className={UL}>
          <li><strong>Первый запуск новой задачи</strong> — обязательно;</li>
          <li><strong>После смены провайдера</strong> — обязательно (разные провайдеры по-разному обрабатывают локации);</li>
          <li><strong>После добавления нового города</strong> — особенно если <code className={CODE}>yandex_lr</code> вы подставили вручную или из неподтверждённого источника;</li>
          <li><strong>При резком изменении</strong> числа результатов или появлении нерелевантных доменов в выдаче;</li>
          <li><strong>Раз в 1–2 месяца</strong> для постоянных задач — на случай, если Яндекс или Google поменяли вёрстку и парсер начал ловить не то.</li>
        </ul>

        <h3 className={H3}>Плохие сигналы при ручной проверке</h3>
        <div className={CALLOUT_WARN}>
          <ul className={UL + " mt-0"}>
            <li>
              <strong>Открывается капча Яндекса</strong> → провайдер словил блокировку.
              Попробуйте перезапустить или сменить зону Bright Data; для Oxylabs проверьте,
              что страна задана правильно.
            </li>
            <li>
              <strong>Открывается главная страница</strong> Яндекса/Google вместо страницы
              выдачи → парсер скорее всего вернул нули. Проверьте логи API:
              <code className={CODE}>docker compose logs api --since=10m</code>.
            </li>
            <li>
              <strong>Открывается выдача из другого региона</strong>, чем ожидалось →
              проверьте <code className={CODE}>lr=</code> в URL для Яндекса или{" "}
              <code className={CODE}>uule=</code> для Google. Возможно, в таблице
              сохранённых локаций неправильное значение <code className={CODE}>yandex_lr</code>.
            </li>
            <li>
              <strong>Топ-3 в браузере и в нашей системе совсем не совпадают</strong> →
              если разница больше 50%, проверьте время запуска (выдача могла обновиться) и
              регион выдачи. Если расхождение стабильное — вероятно, у провайдера прокси
              из не той страны.
            </li>
          </ul>
        </div>
      </section>

      {/* ───────────────────────── Troubleshooting ───────────────────────── */}
      <section id="troubleshooting">
        <h2 className={H2}>10. Частые проблемы</h2>

        <h3 className={H3}>Яндекс возвращает пустой результат</h3>
        <ul className={UL}>
          <li>На стороне Яндекса сработал rate limit или капча — попробуйте перезапустить через 10–15 минут.</li>
          <li>Bright Data: проверьте, что зона <code className={CODE}>zone_raw</code> (Raw HTML) активна и в плане есть лимит на Yandex.</li>
          <li>Oxylabs: проверьте, что в учётных данных правильный <em>SERP-суб-аккаунт</em>, а не основной аккаунт.</li>
          <li>Логи: <code className={CODE}>docker compose logs api --since=10m | findstr /i yandex</code> (Windows) или <code className={CODE}>| grep -i yandex</code> (Linux/Mac).</li>
        </ul>

        <h3 className={H3}>Расписание не запускается</h3>
        <ul className={UL}>
          <li>Убедитесь, что чекбокс «Включено» поставлен и задача сохранена.</li>
          <li>На странице задачи в блоке «Расписание» должно быть «включено» + «Следующий запуск: &lt;дата&gt;».</li>
          <li>Если видно «⚠ не зарегистрировано в планировщике» — переключите чекбокс выкл/вкл и сохраните ещё раз.</li>
          <li>Проверьте, что часовой пояс — UTC (если в <code className={CODE}>scheduler.py</code> ничего не меняли). Запуск, который ожидался «в 09:00 локального времени», в UTC-настройках мог уже произойти или ещё впереди.</li>
        </ul>

        <h3 className={H3}>CSV открывается в Excel «кашей» из-за кириллицы</h3>
        <p className={P}>
          Старые версии Excel ожидают кодировку Windows-1251 для CSV; мы экспортируем в
          UTF-8. Варианты:
        </p>
        <ul className={UL}>
          <li>Откройте файл в Google Sheets (импорт CSV → автоопределение кодировки);</li>
          <li>В Excel: <strong>Данные → Из текста/CSV</strong>, в окне импорта выберите кодировку <strong>UTF-8</strong>;</li>
          <li>Используйте кнопку <strong>Скопировать всё</strong> — в буфер копируется TSV в UTF-8, Excel вставляет корректно.</li>
        </ul>

        <h3 className={H3}>Один и тот же город — разные значения yandex_lr в разных источниках</h3>
        <p className={P}>
          Источник истины — <strong>сам Яндекс</strong>: откройте поиск из нужного города,
          в URL будет <code className={CODE}>lr=&lt;число&gt;</code>. Внесите это значение в
          нашу таблицу через Настройки.
        </p>
        <div className={CALLOUT_TIP}>
          Ваши правки UI <strong>не перезаписываются</strong> при перезапуске — переживут
          все будущие deploy. Сидер заполняет только пустые (<code className={CODE}>NULL</code>)
          значения <code className={CODE}>yandex_lr</code>, и только при первом запуске на
          пустой БД.
        </div>

        <h3 className={H3}>Ошибка ProviderConfigError при запуске</h3>
        <p className={P}>Это означает, что выбранный провайдер не может выполнить задачу с текущими настройками. Самые частые случаи:</p>
        <ul className={UL}>
          <li><strong>Bright Data + Yandex</strong>, но не задана <code className={CODE}>zone_raw</code> → откройте Настройки → Bright Data, заполните зону Raw HTML.</li>
          <li><strong>SerpAPI</strong>, но ключ не введён или просрочен → проверьте баланс на serpapi.com и обновите ключ.</li>
          <li><strong>Oxylabs</strong>, но в Username/Password ошибка → используйте именно SERP Scraper-сабаккаунт.</li>
        </ul>

        <h3 className={H3}>Сборка контейнера не подхватывает изменения исходников</h3>
        <p className={P}>
          Иногда Docker BuildKit на Windows кеширует слой <code className={CODE}>COPY . .</code>{" "}
          мимо реальных изменений. Если только что отредактировали файлы, а в контейнере
          всё ещё старая версия — пересоберите без кеша:
        </p>
        <pre className={PRE}>
{`docker compose stop web
docker compose rm -f web
docker compose build --no-cache web
docker compose up -d web`}
        </pre>
        <p className={P}>
          Проверка, что новая версия попала в образ:
        </p>
        <pre className={PRE}>
{`docker compose exec web sh -c "grep -rl 'фрагмент-вашего-кода' .next/server | head -3"`}
        </pre>
      </section>

      <footer className="mt-16 pt-6 border-t dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400">
        <p>
          Не нашли ответа на свой вопрос? Откройте логи API через{" "}
          <code className={CODE}>docker compose logs api --since=15m</code> — большинство проблем
          оставляют там понятный след.
        </p>
      </footer>
    </article>
  );
}
