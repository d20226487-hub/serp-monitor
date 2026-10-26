import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Документация — SERP Monitor",
  description: "Подробное руководство по работе с SERP Monitor (RU)",
};

/* Утилитарные стили: типографика для длинного текста на чистом Tailwind
   (без плагина @tailwindcss/typography). */
const H2 = "text-[28px] font-semibold tracking-tight pt-10 mt-2 border-t border-slate-200 dark:border-slate-800 pt-8 scroll-mt-20";
const H3 = "text-xl font-semibold tracking-tight mt-7 mb-2";
const H4 = "text-lg font-semibold mt-5 mb-1";
const P = "text-base leading-7 text-slate-800 dark:text-slate-200 my-3";
const UL = "list-disc list-outside ml-6 space-y-1.5 text-base leading-7 text-slate-800 dark:text-slate-200 my-3";
const OL = "list-decimal list-outside ml-6 space-y-1.5 text-base leading-7 text-slate-800 dark:text-slate-200 my-3";
const TABLE = "w-full text-[15px] border-collapse my-4";
const TH = "text-left font-semibold border-b border-slate-200 dark:border-slate-700 px-3 py-2.5 align-top";
const TD = "border-b border-slate-100 dark:border-slate-800 px-3 py-2.5 align-top leading-relaxed text-slate-800 dark:text-slate-200";
const CODE = "font-mono text-[0.85em] bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded";
const PRE = "font-mono text-[13px] bg-slate-100 dark:bg-slate-800 rounded-lg p-3.5 overflow-x-auto my-4 leading-relaxed";
const CALLOUT_NOTE = "border-l-4 border-sky-400 dark:border-sky-700 bg-sky-50 dark:bg-sky-950/30 rounded-r-lg px-4 py-3.5 my-4 text-base leading-7 text-slate-800 dark:text-slate-200";
const CALLOUT_WARN = "border-l-4 border-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 rounded-r-lg px-4 py-3.5 my-4 text-base leading-7 text-slate-800 dark:text-slate-200";
const CALLOUT_TIP = "border-l-4 border-emerald-400 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 rounded-r-lg px-4 py-3.5 my-4 text-base leading-7 text-slate-800 dark:text-slate-200";

const TOC: { id: string; title: string }[] = [
  { id: "intro", title: "Что делает SERP Monitor" },
  { id: "quickstart", title: "Быстрый старт" },
  { id: "providers", title: "Настройка провайдеров" },
  { id: "concepts", title: "canonical_name, yandex_lr и uule" },
  { id: "locations", title: "Управление локациями" },
  { id: "create-job", title: "Создание задачи" },
  { id: "cron", title: "Расписание (cron) и примеры" },
  { id: "results", title: "Просмотр результатов" },
  { id: "analyzer", title: "Анализатор выдачи (режим 2)" },
  { id: "compare", title: "Сравнение SERP API (режим 3)" },
  { id: "projects", title: "Проекты и отслеживание позиций" },
  { id: "visibility", title: "Видимость и монополизация" },
  { id: "shown-host", title: "AMP, CDN и подменённые хосты" },
  { id: "verify", title: "Проверка корректности («Проверить выполненные запросы»)" },
  { id: "troubleshooting", title: "Частые проблемы" },
];

/** Номер раздела берётся из порядка в оглавлении, а не проставляется руками:
 *  вставка раздела в середину иначе молча расходится с содержанием. */
const NUM: Record<string, number> = Object.fromEntries(
  TOC.map((s, i) => [s.id, i + 1]),
);

export default function DocsPage() {
  return (
    <article className="mx-auto max-w-4xl pb-20">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Документация</h1>
        <p className="mt-1.5 text-base text-slate-600 dark:text-slate-400">
          Подробное руководство по работе с SERP Monitor — на русском, единое для обоих
          языков интерфейса.
        </p>
      </header>

      {/* Содержание */}
      <nav
        aria-label="Содержание"
        className="my-6 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/40"
      >
        <div className="mb-2.5 text-base font-semibold">Содержание</div>
        <ol className="ml-5 list-outside list-decimal space-y-1.5 text-base">
          {TOC.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="text-sky-700 hover:underline dark:text-sky-300">
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {/* ───────────────────────── Что делает SERP Monitor ───────────────────────── */}
      <section id="intro">
        <h2 className={H2}>{NUM["intro"]}. Что делает SERP Monitor</h2>
        <p className={P}>
          SERP Monitor — внутренний инструмент мониторинга поисковой выдачи Google и
          Яндекса. Он позволяет:
        </p>
        <ul className={UL}>
          <li>Создавать задачи (jobs) с сотнями ключевых слов и снимать SERP по разным комбинациям параметров;</li>
          <li>Запускать задачи вручную или по расписанию (cron);</li>
          <li>Сохранять результаты в локальной БД и экспортировать в CSV;</li>
          <li>Сравнивать выдачу из разных гео и на разных устройствах (desktop / mobile);</li>
          <li>Подключать четырёх провайдеров: <strong>SerpAPI</strong>, <strong>Bright Data</strong>, <strong>Oxylabs</strong>, <strong>DataForSEO</strong> — на выбор для каждой задачи, и видеть стоимость каждого прогона;</li>
          <li><strong>Анализировать выдачу</strong> (режим 2): метрики Ahrefs по каждому URL и домену, возраст доменов, вердикт AI о сложности, отчёт для печати — см. раздел «Анализатор выдачи»;</li>
          <li><strong>Сравнивать провайдеров</strong> (режим 3): одни и те же запросы через нескольких провайдеров рядом — см. «Сравнение SERP API»;</li>
          <li><strong>Отслеживать позиции проекта</strong>: набор доменов, позиции по периодам, монополизация выдачи и видимость, загрузка выдачи из CSV другого инструмента — см. «Проекты и отслеживание позиций»;</li>
          <li><strong>Проверять блокировки</strong>: отправлять найденные в выдаче домены проекта в Proxy Checker — или выбранные домены по расписанию, без выдачи, — и видеть статус каждого прокси, получать AMP-домены из AMP Rotator — см. там же.</li>
        </ul>
        <p className={P}>
          Интерфейс — на русском и английском (переключатель RU / EN вверху), со светлой и
          тёмной темой. Эта документация — на русском для обоих языков.
        </p>
        <p className={P}>
          Один запуск задачи раскрывается в декартово произведение по осям{" "}
          <code className={CODE}>поисковики × устройства × локации × языки × домены_google</code>{" "}
          и шлёт по одному запросу к провайдеру на каждую комбинацию.
        </p>
      </section>

      {/* ───────────────────────── Быстрый старт ───────────────────────── */}
      <section id="quickstart">
        <h2 className={H2}>{NUM["quickstart"]}. Быстрый старт</h2>
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
            (Опционально) На той же вкладке ниже добавьте нужные локации карточками{" "}
            <strong>«Добавить локацию»</strong> или <strong>«Массовый импорт»</strong> — они
            появятся в списке «Сохранённые локации». Для городского таргетинга Яндекса
            обязательно укажите <code className={CODE}>yandex_lr</code> — числовой ID
            региона.
          </li>
          <li>
            Перейдите в <strong>Новая задача</strong>, заполните поля (название, ключевые
            слова, поисковики, устройства, локации, языки), нажмите{" "}
            <strong>Создать и запустить</strong> (или <strong>Создать задачу</strong> и позже{" "}
            <strong>Запустить сейчас</strong> на странице задачи).
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
        <h2 className={H2}>{NUM["providers"]}. Настройка провайдеров</h2>
        <p className={P}>
          Страница «Настройки» разделена на вкладки: <strong>Мониторинг выдачи</strong> (доступы
          к SERP API, стоимость запроса, веса видимости, локации), <strong>Анализатор выдачи</strong>{" "}
          (Ahrefs, AI-провайдеры, промпт оценки сложности, формула возможности) и{" "}
          <strong>Подключение инструментов</strong> (Proxy Checker и AMP Rotator). Вкладка запоминается в адресе
          (<code className={CODE}>/settings#analyzer</code>), а введённое, но не сохранённое
          при переключении вкладок не теряется.
          Каждый провайдер настраивается в <strong>Настройки → Мониторинг выдачи → Провайдеры</strong>.
          Все четыре провайдера сохраняются независимо; в задачах на форме «Провайдер»
          выбирается тот, чьи учётные данные настроены.
        </p>
        <p className={P}>
          Там же, на вкладке «Мониторинг выдачи», — карточка <strong>«Стоимость запросов»</strong>:
          цена одного запроса у каждого провайдера (по умолчанию SerpAPI $0,010, Bright Data
          $0,0015, Oxylabs $0,002, DataForSEO $0,002). По ней считаются расчётная стоимость в
          форме задачи и стоимость прогона на его странице.
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
          Поле <strong>«API-токен»</strong> — Bearer-токен из панели Bright Data.
        </p>
        <p className={P}>
          <strong>Глубина Google = страницы.</strong> Один запрос к Bright Data — одна страница
          выдачи Google: Google больше не учитывает параметр <code className={CODE}>num</code>{" "}
          (замер 2026-10-01: при <code className={CODE}>num=20</code> приходило 7–10 органических
          результатов). Поэтому для Топ N = 20 мы запрашиваем и вторую страницу
          (<code className={CODE}>start=10</code>), продолжая нумерацию позиций, — и каждая
          страница оплачивается отдельно: стоимость прогона считается по числу фактически
          отправленных запросов. Если у первой страницы нет ссылки на следующую (так бывает у
          брендовых запросов: «kaspi вход» — 5 результатов и конец выдачи), вторая страница не
          запрашивается и не оплачивается. Результат, повторившийся на второй странице, отбрасывается: страницы —
          это два отдельных запроса, и иногда Bright Data получает на них разные версии выдачи.
          Режим вывода зоны (JSON или Raw HTML) на Google не влияет — мы всегда добавляем{" "}
          <code className={CODE}>brd_json=1</code>.
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
            Поля <strong>«Имя пользователя»</strong> и <strong>«Пароль»</strong> — это учётка
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
            <strong>У DataForSEO своя база локаций.</strong> Она, как и у SerpAPI, построена
            на гео-таргетах Google, но названия расходятся: «Almaty,Almaty Province,Kazakhstan»
            у SerpAPI — это «Almaty,Almaty Region,Kazakhstan» у DataForSEO, и чужое название
            он отклоняет. Общее у них — числовой ID места, поэтому SERP Monitor держит копию
            базы DataForSEO (обновляется раз в 30 дней) и отправляет запрос по{" "}
            <code className={CODE}>location_code</code>, а не по названию.
            Когда в задаче выбран DataForSEO, в списке локаций остаются только места, которые
            он поддерживает; в режиме сравнения — только общие для всех выбранных провайдеров.
            Локации, сохранённые раньше под названиями SerpAPI, сопоставляются автоматически;
            если место сопоставить нельзя, форма предупредит об этом до запуска.
            <br />
            <strong>Bright Data и Oxylabs</strong> работают по списку гео-таргетов Google
            (оба провайдера называют его полным списком своих локаций): он тоже скопирован
            целиком (≈270 тыс. мест) и обновляется раз в 30 дней. При выборе этих провайдеров
            поиск локаций идёт по нему, а в запрос уходит <em>актуальное</em> название места.
            Если локации в списке Google нет, запрос не падает — Google её просто игнорирует
            и отвечает по всей стране, — поэтому форма показывает жёлтое предупреждение.
          </li>
          <li>
            <strong>России и Беларуси в базе DataForSEO нет вообще</strong> — ни стран, ни
            городов, поэтому эти локации для него недоступны.
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
                <td className={TD}>✓ через <code className={CODE}>location_code</code> (без локации в задаче — <code className={CODE}>location_name</code> страны)</td>
              </tr>
              <tr>
                <td className={TD}>Google город</td>
                <td className={TD}><code className={CODE}>location=&lt;canonical&gt;</code></td>
                <td className={TD}><code className={CODE}>uule=</code> из актуального названия места по списку гео-таргетов Google</td>
                <td className={TD}><code className={CODE}>geo_location=</code> актуальное название места (best-effort)</td>
                <td className={TD}><code className={CODE}>location_code=</code> ID места из базы DataForSEO</td>
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
                <td className={TD}>домен Яндекса в адресе запроса</td>
                <td className={TD}>домен Яндекса в адресе запроса</td>
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
        <h2 className={H2}>{NUM["concepts"]}. <code className={CODE}>canonical_name</code>, <code className={CODE}>yandex_lr</code> и <code className={CODE}>uule</code></h2>
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
          <li><strong>Bright Data Google</strong> — мы кодируем в <code className={CODE}>uule=</code> <em>актуальное</em> название места из списка гео-таргетов Google (см. ниже); оно может отличаться от <code className={CODE}>canonical_name</code>, например «Almaty Region» вместо «Almaty Province»;</li>
          <li><strong>Oxylabs Google</strong> — передаёт то же актуальное название как <code className={CODE}>geo_location</code> (best-effort matching по их базе локаций);</li>
          <li><strong>DataForSEO</strong> — передаёт не название, а числовой ID места из своей базы (<code className={CODE}>location_code</code>).</li>
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
          (тултип покажет полное, кнопка-копия скопирует в буфер). Колонка считается из{" "}
          <code className={CODE}>canonical_name</code>; если в списке Google место называется
          иначе, Bright Data на деле получает uule от актуального названия.
        </p>
        <p className={P}>Кто из провайдеров с чем работает:</p>
        <ul className={UL}>
          <li><strong>Bright Data Google</strong> — мы автоматически добавляем <code className={CODE}>uule=</code> (от актуального названия места) в URL запроса;</li>
          <li><strong>Oxylabs Google</strong> — передаёт <code className={CODE}>geo_location=</code> с актуальным названием места (без uule, через свою БД локаций);</li>
          <li><strong>SerpAPI Google</strong> — использует <code className={CODE}>location=&lt;canonical_name&gt;</code> (uule не нужен).</li>
        </ul>
      </section>

      {/* ───────────────────────── Локации ───────────────────────── */}
      <section id="locations">
        <h2 className={H2}>{NUM["locations"]}. Управление локациями (раздел «Настройки»)</h2>
        <p className={P}>
          Сохранённые локации — единственный источник истины для городского таргетинга.
          Сидер при первом запуске на пустой БД заполняет 66 мест: 54 города и 12 стран — в
          основном СНГ, а также Мексика, Турция, США, Бразилия, ОАЭ и Сингапур. Ваши
          последующие правки <strong>сохраняются между перезапусками</strong> и не
          перезаписываются сидом — с одним исключением: если у места из сида очистить{" "}
          <code className={CODE}>yandex_lr</code>, при следующем запуске оно снова
          заполнится значением из сида.
        </p>

        <h3 className={H3}>Добавить одну локацию</h3>
        <p className={P}>В блоке «Добавить локацию» заполните:</p>
        <ul className={UL}>
          <li><strong>canonical_name</strong> — обязательно, формат SerpAPI;</li>
          <li><strong>отображаемое имя</strong> — короткое имя для удобства (Алматы);</li>
          <li><strong>cc</strong> — двухбуквенный код страны в нижнем регистре (kz, ru, uz);</li>
          <li><strong>тип</strong> — Страна / Регион / Город / Другое (для маркировки);</li>
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
          <li><strong>Карандаш (✎)</strong> рядом с записью — режим редактирования. Сохранить — зелёная галочка, отменить — крестик. Переименование места меняет его и во всех задачах, где оно выбрано.</li>
          <li><strong>Корзина (🗑)</strong> — удаление с подтверждением.</li>
          <li><strong>Фильтр</strong> в правом верхнем углу — поиск по <code className={CODE}>canonical_name</code>, имени, коду страны.</li>
        </ul>

        <h3 className={H3}>Что попадает в запросы из строки локации</h3>
        <ul className={UL}>
          <li><strong>SerpAPI:</strong> <code className={CODE}>location=&lt;canonical_name&gt;</code> + <code className={CODE}>gl=&lt;cc&gt;</code></li>
          <li><strong>Bright Data Google:</strong> <code className={CODE}>gl=&lt;cc&gt;</code> + <code className={CODE}>uule=</code> от актуального названия места</li>
          <li><strong>Bright Data Yandex:</strong> URL <code className={CODE}>https://yandex.&lt;tld&gt;/search/?text=...&amp;lr=&lt;yandex_lr&gt;</code> через raw-zone</li>
          <li><strong>Oxylabs Google:</strong> <code className={CODE}>geo_location=</code> актуальное название места</li>
          <li><strong>Oxylabs Yandex:</strong> <code className={CODE}>lr=&lt;yandex_lr&gt;</code> в URL + <code className={CODE}>geo_location: КОД</code> в теле</li>
          <li><strong>DataForSEO Google:</strong> <code className={CODE}>location_code=</code> ID места из базы DataForSEO</li>
        </ul>
      </section>

      {/* ───────────────────────── Создание задачи ───────────────────────── */}
      <section id="create-job">
        <h2 className={H2}>{NUM["create-job"]}. Создание задачи — что заполнять</h2>
        <p className={P}>
          Открывается со страницы <strong>Новая задача</strong>. Все поля связаны;
          под формой в реальном времени отображаются расчётное число запросов и расчётная
          стоимость прогона.
        </p>

        <h3 className={H3}>Поля формы</h3>
        <ol className={OL}>
          <li><strong>Название</strong> — любое короткое осмысленное (например, «Бренд X — KZ/RU»).</li>
          <li><strong>Проект</strong> (необязательно) — задача попадёт в папку проекта и начнёт питать его страницу позиций. См. «Проекты и отслеживание позиций».</li>
          <li><strong>Приводить AMP и CDN к показанному сайту</strong> — считать, что ранжируется сайт, который поисковик <em>напечатал</em>, а не тот, куда ведёт ссылка. Подробно и с предостережением — в разделе «AMP, CDN и подменённые хосты».</li>
          <li><strong>Ключевые слова</strong> — по одному на строку, <strong>не более 1000</strong>. Строки сверх лимита не сохраняются, и форма об этом предупреждает. Регистр и пунктуация сохраняются как написано.</li>
          <li><strong>Режим</strong> — <strong>1 · Мониторинг выдачи</strong> (только снять SERP), <strong>2 · Анализатор выдачи</strong> (снять и разобрать: метрики, возраст доменов, вердикт AI) или <strong>3 · Сравнение SERP API</strong> (одни и те же запросы через нескольких провайдеров, см. <a href="#compare" className="text-sky-700 hover:underline dark:text-sky-300">раздел {NUM["compare"]}</a>). Режим определяет, какие поля формы появятся ниже.</li>
          <li><strong>Провайдер</strong> — выберите того, у кого заполнены учётные данные на странице Настроек.</li>
          <li><strong>Поисковики</strong> — Google и/или Яндекс (можно оба сразу).</li>
          <li><strong>Устройства</strong> — desktop и/или mobile.</li>
          <li><strong>Геолокации</strong> — выбираются из сохранённых (помечены звездой ★) или ищутся по списку мест выбранного провайдера (минимум 2 символа): у SerpAPI — живым поиском, у DataForSEO, Bright Data и Oxylabs — по их скопированным спискам. Сохранённые показываются всегда, найденные — ниже.</li>
          <li><strong>Языки</strong> — например <code className={CODE}>ru</code>, <code className={CODE}>kk</code>, <code className={CODE}>en</code>. Влияет на <code className={CODE}>hl=</code> (Google) и <code className={CODE}>lang=</code> (Яндекс).</li>
          <li><strong>Домены Google (необязательно)</strong> — если оставить пустым, домен подставится автоматически из <code className={CODE}>country_code</code> локации (kz → google.kz, ru → google.ru). Если задаёте вручную — каждый домен умножает количество запросов.</li>
          <li><strong>Топ N позиций</strong> — сколько верхних позиций сохранять (по умолчанию 10, не больше 100). У Bright Data и DataForSEO Топ N больше 10 умножает стоимость: Bright Data берёт плату за каждую страницу Google (~10 результатов), DataForSEO — за каждые 10 результатов; форма предупреждает об этом.</li>
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
          Под формой блоки <strong>«Расчётное число запросов за прогон»</strong> и{" "}
          <strong>«Расчётная стоимость прогона»</strong> (по ценам из карточки «Стоимость
          запросов» в настройках) обновляются при любом изменении полей. Бэкенд в момент запуска удаляет дубликаты
          вариантов, поэтому фактическое число запросов может быть чуть меньше оценки.
        </p>

        <h3 className={H3}>На что обратить внимание</h3>
        <div className={CALLOUT_WARN}>
          <ul className={UL + " mt-0"}>
            <li>
              <strong>Не выбирайте все локации сразу.</strong> 100 ключевых × 2 устройства ×
              30 локаций × 2 языка = 12 000 запросов на одну задачу. Большинство тарифов
              этого не выдержат за один прогон. Верхний предел на прогон —
              <code className={CODE}>MAX_QUERIES_PER_RUN</code> (по умолчанию 2000; в режиме
              сравнения считаются запросы ко всем провайдерам вместе); форма его не
              проверяет, поэтому считайте сами — прогон сверх предела завершится ошибкой.
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
              <strong>Кнопка «Создать задачу»</strong> создаёт задачу без запуска;{" "}
              <strong>«Создать и запустить»</strong> создаёт и сразу запускает.
            </li>
          </ul>
        </div>

        <h3 className={H3}>Редактирование существующей задачи</h3>
        <p className={P}>
          На странице задачи кнопка <strong>Изменить</strong> открывает ту же форму. Можно
          поправить любое поле, нажать <strong>Сохранить изменения</strong> или{" "}
          <strong>Сохранить и запустить</strong>. Результаты прошлых запусков остаются как
          были. Параметры задачи запуск не запоминает (кроме провайдера): повтор ошибочных
          запросов и сравнение берут задачу такой, какая она сейчас.
        </p>
      </section>

      {/* ───────────────────────── Cron ───────────────────────── */}
      <section id="cron">
        <h2 className={H2}>{NUM["cron"]}. Расписание (cron) — формат и примеры</h2>

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
        <p className={P}>
          День недели можно писать и названиями: <code className={CODE}>mon-fri</code>,{" "}
          <code className={CODE}>sat,sun</code>.
        </p>
        <div className={CALLOUT_NOTE}>
          До 14.10.2026 номера дней недели сдвигались на день: <code className={CODE}>1-5</code>{" "}
          срабатывало со вторника по субботу (так работал и шаблон «Будни 08:00»), а{" "}
          <code className={CODE}>7</code> не принималось. Исправлено — номера значат то же, что в
          обычном cron, как и написано выше. Задачи с названиями дней (<code className={CODE}>mon-fri</code>)
          это не затронуло.
        </div>

        <h3 className={H3}>Часовой пояс</h3>
        <p className={P}>
          По умолчанию расписание считается <strong>в UTC</strong> (надпись «Cron-выражение в
          часовом поясе UTC» под полем). Чтобы поменять, нужно отредактировать{" "}
          <code className={CODE}>backend/app/scheduler.py</code> (строку{" "}
          <code className={CODE}>timezone=&quot;UTC&quot;</code> на нужный, например{" "}
          <code className={CODE}>&quot;Asia/Almaty&quot;</code>) и пересобрать контейнер{" "}
          <code className={CODE}>api</code> — код бэкенда входит в образ, простой перезапуск
          правку не подхватит:
        </p>
        <pre className={PRE}>{`docker compose up -d --build api`}</pre>
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
            «process restarted while running» — запустите задачу заново кнопкой{" "}
            <strong>«Запустить сейчас»</strong> на её странице (у анализатора и сравнения на
            странице прогона есть «Повторить: N» / «Повторить ошибочные: N» — они дошлют только
            недостающие запросы).
          </li>
        </ul>
      </section>

      {/* ───────────────────────── Результаты ───────────────────────── */}
      <section id="results">
        <h2 className={H2}>{NUM["results"]}. Просмотр результатов запуска</h2>

        <h3 className={H3}>Структура страницы</h3>
        <ul className={UL}>
          <li><strong>Шапка:</strong> номер запуска, дата, статус, прогресс <code className={CODE}>выполнено/всего</code>, число ошибок (красным, если есть) и стоимость прогона; если прогон упал — блок с текстом ошибки.</li>
          <li><strong>Этапы</strong> — полоска хода прогона по этапам (снятие выдачи, метрики, возраст доменов, оценка AI — какие есть в режиме задачи).</li>
          <li><strong>«Обзор»</strong> — сколько разных доменов и URL нашлось по каждому поисковику; <strong>«Полный разбор →»</strong> открывает отдельную страницу с разбивкой по поисковику, гео, языку и устройству.</li>
          <li><strong>«Экспортировать топ» [N] + «Скачать CSV»</strong> — выгрузка в стандартном табличном формате с шапкой. Файл открывается в Excel двойным кликом: в русском интерфейсе поля разделены «;» (так ждёт Excel с русскими региональными настройками), в английском — «,».</li>
          <li><strong>Скопировать всё</strong> — TSV (табы как разделители) в буфер обмена для вставки в Excel/Google Sheets.</li>
          <li><strong>Фильтр по ключевому слову</strong> — клиентский поиск по тексту.</li>
          <li><strong>«Проверить выполненные запросы»</strong> (раскрывающийся блок) — проверка точных URL запросов. Подробно см. раздел «Проверка корректности».</li>
          <li><strong>Группы по ключевым словам</strong> — каждая группа подсвечена цветной рамкой; внутри — варианты с цветными чипами. Группы свёрнуты, пока их не откроют; у прогонов сравнения (режим 3) их нет — там свои таблицы.</li>
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

      {/* ───────────────────────── Анализатор ───────────────────────── */}
      <section id="analyzer">
        <h2 className={H2}>{NUM["analyzer"]}. Анализатор выдачи (режим 2)</h2>
        <p className={P}>
          Второй режим задачи отвечает на другой вопрос. Мониторинг показывает,
          <em>кто</em> стоит в выдаче; анализатор — <em>насколько тяжело туда попасть</em>.
          Сначала выдача снимается как обычно, затем по каждому найденному URL
          запрашиваются метрики, и по каждому ключевому слову считается порог входа.
        </p>

        <h3 className={H3}>Что подключается на форме задачи</h3>
        <ul className={UL}>
          <li>
            <strong>Метрики Ahrefs по страницам</strong> — набор выбирается из 14 метрик
            Ahrefs, у каждой видна цена в юнитах; по умолчанию UR и DR. Запрашиваются в
            режиме точного URL, поэтому UR считается по странице, а не по домену.
          </li>
          <li>
            <strong>Метрики уровня домена</strong> — отдельный проход в режиме
            <code className={CODE}>subdomains</code>. Именно они отличают слабую страницу
            на <em>сильном</em> сайте от слабой страницы на слабом: по метрикам страницы
            это не видно. Домены дедуплицируются гораздо сильнее URL, поэтому проход
            заметно дешевле основного. По умолчанию — ссылающиеся домены (dofollow) и
            органические ключевые слова.
          </li>
          <li>
            <strong>Возраст домена (WHOIS)</strong> — дата регистрации. Сначала спрашивается
            бесплатный RDAP; DataForSEO WHOIS — только для доменов, на которые RDAP не
            отвечает (в основном национальные зоны: .kz, .ru, .by, .uz). DataForSEO берёт
            плату за <em>запрос</em> (~$0,12), а не за домен. Ответы хранятся 180 дней,
            «не найден» — 14 дней. Без доступов DataForSEO прогон не падает: у таких доменов
            возраста просто не будет.
          </li>
          <li>
            <strong>Вердикт AI</strong> — «сложность выдачи» по каждому ключевому слову.
            Провайдер, модель и сам промпт настраиваются в Настройках; для метрик уровня
            домена есть отдельный промпт.
          </li>
        </ul>

        <h3 className={H3}>Как читать таблицу</h3>
        <p className={P}>
          Строка — ключевое слово. Метрики в ней — это <strong>среднее по когорте самых
          слабых доменов</strong> в выбранной глубине (топ-3 / топ-5 / топ-10 / вся), а не
          среднее по всей выдаче. Вопрос анализатора — «какой порог входа», а не «какие
          тут есть сильные сайты»: сильные ничего не говорят о том, можно ли влезть.
        </p>
        <ul className={UL}>
          <li><strong>Профиль выдачи</strong> — полоски по слотам глубины: сколько из них слабые, «за счёт домена» (слабая страница на сильном домене), средние и сильные.</li>
          <li><strong>Слабых позиций</strong> — сколько слотов занимают слабые страницы на слабых доменах. Это реалистичные цели.</li>
          <li><strong>Проанализировано</strong> — по скольким из слотов глубины Ahrefs вообще вернул метрики.</li>
          <li><strong>Сложность выдачи</strong> — вердикт AI, <strong>Перспективность</strong> — итоговая оценка возможности.</li>
        </ul>
        <p className={P}>
          <strong>Перспективность</strong> — взвешенное геометрическое среднее частотности и
          «выигрываемости». Ползунок на панели над таблицей смещает вес: слева — быстрые
          победы, справа — крупные цели. Константы формулы меняются глобально в «Настройки →
          Анализатор выдачи → Формула перспективности»; прогон можно посчитать и по своей
          формуле, не трогая глобальную, — кнопка <strong>«Формула»</strong> на странице прогона.
        </p>

        <h3 className={H3}>Частотность</h3>
        <p className={P}>
          Частотность не приходит из выдачи — её вставляют. Кнопка{" "}
          <strong>«Вставить частотности»</strong> принимает строки прямо из Ahrefs
          Keywords Explorer или из CSV-выгрузки, вместе с шапкой. Частотность привязана
          к стране, и если в выгрузке указана не та страна, форма об этом предупредит.
          Частотность одного запроса можно ввести и прямо в строке таблицы —{" "}
          <strong>«+ добавить»</strong>.
        </p>

        <h3 className={H3}>Экспорт</h3>
        <p className={P}>
          <strong>«Выгрузить таблицу»</strong> сохраняет CSV на выбранной глубине.
          Кнопка <strong>«Столбцы»</strong> открывает список колонок: отмеченные
          попадают в файл, а нижняя строка показывает точный порядок, в котором они
          будут записаны. Выбор запоминается между прогонами — метрика, которую добавит
          более поздний прогон, экспортируется, пока её не снять.
        </p>
        <p className={P}>
          Кнопка <strong>«Отчёт»</strong> на странице прогона открывает версию для печати и
          сохранения в PDF.
        </p>

        <h3 className={H3}>Настройки анализатора</h3>
        <p className={P}>Вкладка «Настройки → Анализатор выдачи»:</p>
        <ul className={UL}>
          <li><strong>Ahrefs</strong> — API-ключ и <strong>«Кэш метрик»</strong>: сколько дней уже купленная метрика переиспользуется в следующих прогонах вместо новой покупки (по умолчанию 7); «Очистить кэш» сбрасывает его.</li>
          <li><strong>AI-провайдеры</strong> — Gemini через AI Studio или Vertex (сервисный аккаунт или Express-ключ), с проверкой. <strong>«Провайдер для оценки»</strong>: автоматически, конкретный провайдер или «Выключено — только метрики» (тогда вердикта AI нет). Там же — креативность (temperature), бюджет рассуждений и лимит ответа в токенах.</li>
          <li><strong>Промпт оценки сложности</strong> — текст, по которому AI выносит вердикт; есть отдельный промпт для метрик уровня домена и кнопка «Загрузить русскую версию».</li>
          <li><strong>Формула перспективности</strong> — константы формулы (см. выше).</li>
        </ul>

        <div className={CALLOUT_NOTE}>
          <strong>Юниты Ahrefs.</strong> Каждый <em>запрос</em> тарифицируется как
          max(50, строк × за_строку) юнитов. Минимум в 50 юнитов за запрос означает, что
          на небольшом прогоне дополнительные метрики фактически бесплатны — они
          укладываются в тот же минимум.
        </div>

        <h3 className={H3}>Если прогон оборвался</h3>
        <ul className={UL}>
          <li>
            <strong>Нет части выдачи.</strong> На странице запуска появится
            «Повторить: N» — отправятся только недостающие запросы, остальной прогон не
            пересобирается и не оплачивается заново.
          </li>
          <li>
            <strong>Нет вердиктов AI.</strong> Над таблицей появится оранжевая полоса со
            счётчиком и кнопкой <strong>«Оценить оставшиеся: N»</strong>. Судятся только
            ключи без вердикта, выдача и метрики берутся уже снятые — платите только за
            токены на недостающее.
          </li>
        </ul>
      </section>

      {/* ───────────────────────── Сравнение SERP API ───────────────────────── */}
      <section id="compare">
        <h2 className={H2}>{NUM["compare"]}. Сравнение SERP API (режим 3)</h2>
        <p className={P}>
          Третий режим отвечает на вопрос «какому провайдеру верить». Одни и те же
          запросы — те же ключевые слова, поисковики, устройства, локации и языки —
          отправляются <strong>каждому</strong> выбранному провайдеру одновременно, и
          ответы кладутся рядом. Видно, где провайдеры совпадают, а где один видит сайты,
          которых нет у другого, ставит их на другие позиции или вообще возвращает
          ошибку.
        </p>

        <h3 className={H3}>Создание задачи</h3>
        <ul className={UL}>
          <li>
            В поле «Режим» выберите <strong>«3 · Сравнение SERP API»</strong> и отметьте
            минимум <strong>двух</strong> провайдеров. С одним сравнивать не с чем —
            задача не сохранится.
          </li>
          <li>
            Каждый запрос уходит к каждому провайдеру, и каждый провайдер берёт плату за
            свои запросы. Оценка внизу формы показывает число запросов и стоимость{" "}
            <strong>по каждому провайдеру отдельно</strong> и их сумму.
          </li>
          <li>
            Для каждого провайдера показана своя панель «как он таргетирует гео» — то,
            как провайдер понимает локацию, само по себе одна из причин расхождений.
          </li>
        </ul>
        <div className={CALLOUT_WARN}>
          <strong>DataForSEO не умеет Яндекс.</strong> Если в задаче есть Яндекс, ячейки
          DataForSEO по нему помечаются <strong>«н/д»</strong>: такие запросы{" "}
          <em>не отправляются и не оплачиваются</em>, и в сравнении они не считаются
          расхождениями — это известное ограничение, а не ошибка.
          <br />
          Кроме того, DataForSEO <strong>требует язык</strong> в каждом запросе (у Google
          есть язык по умолчанию, у DataForSEO нет). Без выбранного языка его запросы
          отклоняются ещё до отправки — форма предупредит об этом.
        </div>

        <h3 className={H3}>Что показывает прогон</h3>
        <p className={P}>
          Сверху — таблица <strong>«Провайдеры»</strong>: сколько запросов каждый из них
          ответил, сколько завершилось ошибкой, сколько не поддерживается, сколько
          результатов в среднем на выдачу и во что он обошёлся. Если есть ошибки, там же
          кнопка <strong>«Повторить ошибочные»</strong> — она перезапрашивает только
          пары «провайдер × запрос» без ответа и докладывает их стоимость к прогону.
        </p>
        <h4 className={H4}>Автоматические повторы</h4>
        <p className={P}>
          Временные сбои провайдера повторяются <strong>автоматически</strong>, до трёх
          попыток с паузами 4 и 10 секунд, — и только потом запрос считается ошибочным.
          Временными считаются: пустой ответ Bright Data при <em>активной</em> зоне,
          упавшее задание Oxylabs (статус 613 и подобные внутри ответа 200), страница с
          капчей Яндекса (прокси меняет IP на каждый запрос). Постоянные ошибки —
          отключённая зона, неверный ключ, отсутствующий язык у DataForSEO — не
          повторяются: они упадут так же, только позже. Повторы работают во всех режимах,
          а кнопка «Повторить ошибочные» — для того, что не удалось и после них.
        </p>
        <p className={P}>
          В сравнении повторы <strong>видны</strong>, а не спрятаны: колонка{" "}
          <strong>«Повторы»</strong> показывает, сколько запросов провайдеру понадобилось
          повторить, а ответ, полученный не с первой попытки, помечен{" "}
          <strong>↻2</strong> или <strong>↻3</strong>. Результат при этом хороший, а вот
          провайдер — нет, и для выбора провайдера это важно.
        </p>
        <p className={P}>
          Ниже — вкладки по поисковикам (Google / Яндекс). Каждый поисковик сравнивается
          отдельно и только среди провайдеров, которые его поддерживают. Внутри вкладки
          три таблицы и выдача по ключам:
        </p>
        <table className={TABLE}>
          <thead>
            <tr>
              <th className={TH}>Таблица</th>
              <th className={TH}>Что в ней</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={TD}><strong>Домены</strong></td>
              <td className={TD}>
                Каждый домен против каждого провайдера: сколько раз он встретился и его
                средняя позиция (<code className={CODE}>3 #2.0</code> = три результата, в
                среднем на 2-м месте). Красная ячейка — провайдер этот домен{" "}
                <em>не вернул</em>. «Нашли» — сколько провайдеров из сравниваемых его
                видят.
              </td>
            </tr>
            <tr>
              <td className={TD}><strong>URL</strong></td>
              <td className={TD}>То же самое по отдельным страницам.</td>
            </tr>
            <tr>
              <td className={TD}><strong>Результаты по SERP</strong></td>
              <td className={TD}>
                Каждый запрос (ключ + устройство + гео + язык) против каждого провайдера:
                сколько результатов вернулось, <strong>ошибка</strong> (наведите — будет
                причина) или <strong>н/д</strong>. Строка подсвечена, если провайдеры
                вернули разное количество или кто-то упал.
              </td>
            </tr>
            <tr>
              <td className={TD}><strong>Выдача по ключевым словам</strong></td>
              <td className={TD}>
                Свёрнутые блоки по ключам; внутри — выдача каждого провайдера бок о бок,
                позиция к позиции. Подсветка: <strong>без цвета</strong> — URL есть у
                всех; <strong>жёлтый</strong> — сайт у остальных есть, но другая
                страница; <strong>красный</strong> — сайта нет в выдаче другого
                провайдера.
              </td>
            </tr>
          </tbody>
        </table>
        <p className={P}>
          Переключатель <strong>«Только расхождения»</strong> скрывает всё, в чём
          провайдеры совпадают, — во всех таблицах сразу.
        </p>

        <h3 className={H3}>Почему часть запросов не входит в таблицы доменов и URL</h3>
        <p className={P}>
          Таблицы доменов и URL считаются только по тем запросам, на которые{" "}
          <strong>ответили все</strong> сравниваемые провайдеры. Если один провайдер
          упал на каком-то запросе, все домены той выдачи иначе выглядели бы у него
          «пропавшими» — ошибка выдавала бы себя за расхождение. Над таблицами написано,
          по скольким запросам из скольких идёт подсчёт; упавшие запросы видны в
          «Результатах по SERP». Провайдер, который не ответил по поисковику ни на один
          запрос, помечается «нет ответов» и в сравнении не участвует.
        </p>
        <div className={CALLOUT_NOTE}>
          <strong>Как сравниваются URL.</strong> Не учитываются http/https, ведущий{" "}
          <code className={CODE}>www.</code>, завершающий слэш и{" "}
          <code className={CODE}>#якорь</code> — провайдеры расходятся в этом для одной и
          той же страницы. Путь и параметры запроса должны совпадать. Домены
          сравниваются без <code className={CODE}>www.</code>.
        </div>
        <div className={CALLOUT_TIP}>
          <strong>Bright Data и URL.</strong> Для Google Bright Data отдаёт вместо адреса
          результата редирект Google (<code className={CODE}>/goto?url=…</code>), поэтому
          инструмент берёт отображаемый адрес — а в нём только домен. В таблице доменов
          Bright Data сравнивается честно, но в таблице URL его строки часто будут
          «главной страницей сайта» там, где у других провайдеров полный путь. Это
          реальное отличие провайдера, а не ошибка сравнения.
        </div>

        <h3 className={H3}>AMP и CDN в сравнении</h3>
        <p className={P}>
          Провайдеры по-разному сообщают, <em>какой</em> хост стоит в выдаче. Bright
          Data для Google отдаёт показанный адрес (издателя), а SerpAPI и DataForSEO —
          саму ссылку. Для AMP- или CDN-результата это значит, что один провайдер
          покажет <code className={CODE}>by.tribuna.com</code>, а другой —{" "}
          <code className={CODE}>d1234.cloudfront.net</code>, хотя нашли они одно и то же.
        </p>
        <div className={CALLOUT_TIP}>
          Включите в задаче <strong>«Приводить AMP и CDN к показанному сайту»</strong>{" "}
          (см. <a href="#shown-host" className="text-sky-700 hover:underline dark:text-sky-300">раздел {NUM["shown-host"]}</a>),
          если сравниваете провайдеров, которые сообщают хосты по-разному. Тогда
          домены считаются так, как их показал поисковик, и такие результаты
          совпадают. Приведённые результаты помечены <strong>⇄</strong> (наведите —
          будет видно, куда вела ссылка); если провайдер не сообщил показанный сайт,
          остаётся исходная ссылка и ставится <strong>?</strong>. URL при этом
          по-прежнему сравниваются по ссылке — путь CDN ничего не говорит о странице
          издателя. Опция читается из задачи в её текущем состоянии: её можно
          выключить, и старые сравнения пересчитаются без повторного прогона.
        </div>
      </section>

      {/* ───────────────────────── Проекты ───────────────────────── */}
      <section id="projects">
        <h2 className={H2}>{NUM["projects"]}. Проекты и отслеживание позиций</h2>
        <p className={P}>
          Проект — это <strong>набор доменов</strong> плюс папка для задач. Домены
          вставляются списком (по одному на строку или через запятую); схема, путь,{" "}
          <code className={CODE}>www.</code> и мусор вокруг отрезаются, дубликаты
          схлопываются. У задачи есть необязательное поле «Проект»: её прогоны начинают
          питать страницу позиций этого проекта.
        </p>

        <h3 className={H3}>Страница проекта</h3>
        <p className={P}>
          Страница разделена на четыре вкладки:
        </p>
        <ul className={UL}>
          <li><strong>«Обзор»</strong> — плитки, карточка «Не проходят в „Блокировках“», задачи по расписанию (только если хотя бы одна задача проекта стоит на расписании), отслеживаемые запросы, «AMP-домены сегодня» (только у проектов с эндпоинтом AMP Rotator) и GEO проекта;</li>
          <li><strong>«Позиции»</strong> — таблицы позиций и выгрузка CSV;</li>
          <li><strong>«Блокировки»</strong> — статус доменов по каждому прокси, проверка выбранных доменов по расписанию без выдачи и карточка Proxy Checker (когда и что отправлять);</li>
          <li><strong>«Загрузки CSV»</strong> — журнал загруженных файлов (см. ниже).</li>
        </ul>
        <p className={P}>
          <strong>Отслеживаемые запросы</strong> на «Обзоре» — список запросов проекта. Его можно
          поправить: поле «Найти или добавить запрос» ищет по списку, Enter добавляет новый;
          крестик убирает запрос, «Очистить все» — все сразу; изменения применяются кнопкой
          «Сохранить». Убранный запрос уходит из всех задач проекта (задачи по расписанию перестают
          его проверять); добавленный попадает в собственный список проекта и на то, что проверяют
          задачи, не влияет. Уже снятые позиции по убранным запросам остаются: если в проект
          загрузили не тот файл, удалите эту загрузку на вкладке «Загрузки CSV» — уйдут её
          позиции, — и уберите её запросы здесь.
        </p>
        <p className={P}>
          Открытая вкладка запоминается в адресе (<code className={CODE}>#positions</code>,{" "}
          <code className={CODE}>#blocks</code>, <code className={CODE}>#uploads</code>), поэтому ссылкой можно поделиться.
        </p>
        <p className={P}>
          На «Обзоре» сверху — плитки: домены, отслеживаемые запросы, задачи, локации, поисковики.
          Сами домены не перечисляются намеренно: проект, собранный из перестановок
          бренда, доходит до сотен почти одинаковых хостов, и их список хоронил под собой
          то, ради чего страницу открывают. Полный список — в форме редактирования
          проекта.
        </p>
        <p className={P}>
          На вкладке «Позиции» период выбирается чипами:{" "}
          <strong>Сегодня / Вчера / Эта неделя / Этот месяц / Этот год / Свой период</strong>.
          Интервал полуоткрытый: <code className={CODE}>[начало, конец)</code>, границы
          считаются по локальному времени и переводятся в UTC.
        </p>

        <h3 className={H3}>Загрузка выдачи из CSV</h3>
        <p className={P}>
          Выдачу, проверенную внутренним инструментом, можно загрузить в проект файлом: кнопка{" "}
          <strong>«Загрузить CSV»</strong> в шапке страницы проекта. Загрузка сохраняется как{" "}
          <strong>прогон проекта</strong> — позиции, вкладка «Блокировки» и отправка в Proxy Checker
          работают с ней как с любым другим прогоном.
        </p>
        <ul className={UL}>
          <li><strong>Что читается:</strong> четыре столбца — <code className={CODE}>Keywords</code>, <code className={CODE}>GEO</code>, <code className={CODE}>Domain / URL</code>, <code className={CODE}>Position</code>. Все остальные столбцы (Project, Tags, SEO, Partner, Neutral, Position score, Quality Status, Result type и любые другие) игнорируются. Порядок столбцов и разделитель (запятая или «;») не важны.</li>
          <li><strong>GEO</strong> — страна: английское название («Azerbaijan») или код («AZ»). Строки с нераспознанной страной пропускаются и перечисляются в отчёте о загрузке — SERP Monitor не угадывает.</li>
          <li><strong>Позиции без результата</strong> («–» в столбце Domain / URL) пропускаются.</li>
          <li><strong>GEO проекта:</strong> страны из файла, которых ещё нет в сохранённом списке GEO проекта, добавляются в него — так же, как запросы из файла добавляются к запросам проекта. Какие GEO отправлять в Proxy Checker, загрузка не меняет: если включены все, новый GEO тоже отправляется; если выбраны отдельные, новый добавляется выключенным.</li>
          <li><strong>Чего нет в файле:</strong> поисковик и устройство выбираются в форме (по умолчанию Google, мобильный), день проверки берётся из имени файла (например, <code className={CODE}>…_07-10-2026…</code>) и его можно поправить.</li>
          <li><strong>После загрузки</strong> форма закрывается, а вверху страницы остаётся одна строка с итогом: сколько позиций и запросов загружено, по каким странам, за какой день, сколько позиций без результата, и кнопки «Показать позиции» и «Прогон №…». Если какие-то строки не загрузились (нераспознанная страна, нечитаемая строка), строка жёлтая, а «не загружено строк: N» раскрывает подробности. Крестик убирает строку.</li>
          <li><strong>Глубина файла</strong> может быть любой — топ-10, топ-30, топ-100. В «Наших позициях» видны все позиции проекта, на любой глубине; в монополизацию входят только позиции, у которых есть вес (по умолчанию первые 10, см. «Видимость и монополизация»), но в счёте «N из M позиций» учитываются все. Для вкладки «Блокировки» и отправки в Proxy Checker домен «в выдаче» на любой позиции — чем глубже файл, тем больше доменов уходит в одном запросе.</li>
          <li><strong>Где это видно:</strong> загрузки проекта собираются в одну задачу «CSV — название проекта»; у каждой загрузки свой прогон. Запустить такую задачу нельзя — она только принимает файлы. Список загрузок — на вкладке «Загрузки CSV».</li>
        </ul>

        <h3 className={H3}>Вкладка «Загрузки CSV»</h3>
        <p className={P}>
          Журнал всех файлов, загруженных в проект, новые сверху: когда загружен, имя файла, за
          какой день проверка, поисковик и устройство, сколько позиций и запросов, по каким
          странам (и какие страны добавились в GEO проекта), что пропущено и что ушло в Proxy
          Checker после загрузки («принято N из M», «не отправлялось»). Число загрузок видно
          на самой вкладке.
        </p>
        <ul className={UL}>
          <li><strong>«Удалить»</strong> убирает загрузку целиком — её прогон и все её позиции, они пропадают с вкладок «Позиции» и «Блокировки». Пригодится, если загружен не тот файл или не тот день. Запросы и GEO, которые файл добавил в проект, остаются (их мог добавить и другой файл); ответы Proxy Checker тоже остаются — они про домены, а не про файл.</li>
          <li>У загрузок, сделанных до 14.10.2026, имя файла и пропущенные строки не записывались — там стоит «—»; остальное восстановлено по сохранённым позициям.</li>
        </ul>

        <h3 className={H3}>Отдельная таблица на каждую выдачу</h3>
        <p className={P}>
          Выдача — это вся шестёрка: <strong>поисковик, устройство, страна, язык,
          локация, домен Google</strong>. Любое из этих полей меняет страницу, которую
          возвращает поисковик, поэтому две выдачи никогда не делят одну таблицу: иначе
          в одной строке усреднились бы позиции, которых не было ни на одной реальной
          странице. Таблицы сгруппированы по поисковику — Google и Яндекс это разные
          продукты с разными результатами.
        </p>

        <h3 className={H3}>Два вида одного периода</h3>
        <table className={TABLE}>
          <thead>
            <tr>
              <th className={TH}>Вид</th>
              <th className={TH}>Что показывает</th>
              <th className={TH}>Главная колонка</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={TD}><strong>Последние</strong></td>
              <td className={TD}>Где запрос стоит сейчас: последний прогон каждого запроса внутри периода. Более новое измерение всегда вытесняет старое — «лучшее за период» скрыло бы падение.</td>
              <td className={TD}>Монополизация</td>
            </tr>
            <tr>
              <td className={TD}><strong>Средние</strong></td>
              <td className={TD}>Как держались за период: строка на пару «запрос — домен» по всем прогонам этой выдачи.</td>
              <td className={TD}>Видимость</td>
            </tr>
          </tbody>
        </table>
        <p className={P}>
          <strong>Средняя позиция считается только по тем прогонам, где домен
          присутствовал.</strong> У отсутствия нет позиции, которую можно усреднить:
          глубина снятия — свойство прогона, а не домена, и подставлять «глубина + 1»
          значило бы придумать число, которое меняется от того, как глубоко мы в тот день
          снимали. Поэтому присутствие показано отдельной парой колонок —
          «Присутствие» и «Отсутствие» в процентах от числа прогонов.
        </p>

        <h3 className={H3}>Пометки в ячейках</h3>
        <ul className={UL}>
          <li><strong>⇄</strong> — результат засчитан <em>показанному</em> хосту, а не тому, куда ведёт ссылка (см. следующий раздел);</li>
          <li><strong>≈</strong> — среднее смешивает прогоны разных провайдеров, а они по-разному нумеруют выдачу;</li>
          <li><strong>?</strong> — у части прогонов провайдер не записан (они сделаны до того, как это стало сохраняться), либо поисковик не сообщил показанный хост, хотя задача просила его использовать.</li>
        </ul>
        <div className={CALLOUT_NOTE}>
          Ни одна из пометок не прячет число — они говорят, <em>насколько ему можно
          верить</em>. Молчаливая подстановка хуже видимого пробела.
        </div>

        <h3 className={H3}>Выгрузка в CSV</h3>
        <p className={P}>
          В виде «Последние» справа над таблицами — кнопка <strong>«Экспорт CSV»</strong>; под ней
          раскрываются варианты выгрузки тех же строк: последний прогон каждого запроса за
          выбранный период. Переключатель <strong>«Сайты в файле»</strong>:
          «Вся страница» — все сайты на каждой позиции, наши отмечены <strong>★</strong> (видно,
          кто занимает остальные места); «Только наши» — только домены проекта, как в таблицах.
        </p>
        <ul className={UL}>
          <li><strong>CSV · таблица</strong> — строка на запрос, в колонках 1, 2, 3… — сайт на этой позиции. Удобнее всего читать глазами.</li>
          <li><strong>CSV · список</strong> — строка на позицию: запрос, позиция, сайт, наш или нет, URL, заголовок. Для фильтров и сводных таблиц.</li>
        </ul>
        <p className={P}>
          В обоих есть поисковик, устройство, страна, город, монополизация и время проверки (по
          часам вашего компьютера). «Домен поисковика» — где шёл поиск: для Google это домен
          из задачи, для Яндекса — домен, на котором открылась выдача (у собственного браузера
          его сообщает сама страница: ya.ru для России и Киргизии, yandex.kz, yandex.uz; у
          API-провайдеров — домен, который SERP Monitor запрашивает для этой страны). Файл на русском — с разделителем «;» и десятичной запятой:
          так его без настройки открывает Excel с русскими региональными настройками; Google
          Таблицы читают его тоже. На английском — «,» и точка.
        </p>

        <h3 className={H3}>AMP Rotator</h3>
        <p className={P}>
          AMP Rotator сообщает <strong>сегодняшний AMP-домен каждого домена проекта</strong>.
          Ротаторы переключают AMP-домены раз в сутки, поэтому SERP Monitor спрашивает их
          раз в сутки и по кнопке.
        </p>
        <ul className={UL}>
          <li><strong>Логин и пароль</strong> (HTTP Basic) — <strong>одни для всех ротаторов</strong>: сохраняются один раз вверху карточки AMP Rotator в «Настройки → Подключение инструментов». Пароль сохраняется и обратно не показывается; пока пара не сохранена, запросов нет.</li>
          <li><strong>Эндпоинты</strong> задаются там же: в форме выбирается <strong>проект</strong>, затем указываются адрес ротатора (<code className={CODE}>https://&lt;хост-ротатора&gt;/api/</code>) и время ежедневного запроса — оно у каждого эндпоинта своё. У проекта может быть несколько ротаторов: каждый обслуживает только свои сайты.</li>
          <li><strong>Что отправляется:</strong> все домены проекта одним запросом — <code className={CODE}>{`["domain.com", "domain2.com"]`}</code>. Ротатор отвечает <code className={CODE}>{`{"domain.com": "<AMP-домен>", "domain2.com": ""}`}</code>; пустая строка значит, что этот сайт ротатору не известен, и такой домен пропускается. Запрос только читает состояние и ничего не переключает.</li>
          <li><strong>Когда:</strong> раз в сутки во время, заданное у эндпоинта (в форме оно указывается по вашим часам; по умолчанию 02:00 UTC — после переключения ротаторов), и по кнопке <strong>«Получить сейчас»</strong> у эндпоинта. Если SERP Monitor в это время не работал, он запросит при запуске.</li>
          <li><strong>Где смотреть:</strong> на странице проекта, вкладка «Обзор», карточка <strong>«AMP-домены сегодня»</strong>: домен, его AMP-домен и с какого момента он активен. Карточка есть только у проектов с эндпоинтом. В настройках у каждого эндпоинта видно, чем закончился последний запрос.</li>
          <li><strong>Если запрос не удался</strong> (неверный пароль, ротатор недоступен), прежние AMP-домены остаются на месте с датой получения, а в строке эндпоинта и в карточке проекта показана причина.</li>
          <li><strong>«AMP-конфиг»</strong> — кнопка у каждого эндпоинта в «Настройки → Подключение инструментов»: загрузка файла конфигурации ротатора (JSON — список сайтов: <code className={CODE}>site</code>, <code className={CODE}>amps</code> и другие поля, которые не используются). Так SERP Monitor узнаёт <strong>прежние AMP-домены</strong>, которых он не застал. Для каждого сайта: находится домен проекта, совпадающий с <code className={CODE}>site</code>; берётся AMP-домен, который ежедневная проверка ротатора видела последним; все AMP-домены, стоящие в <code className={CODE}>amps</code> <em>перед</em> ним, добавляются как прежние. Стоящие после — будущие, ещё не использованные, — не берутся. Сайт пропускается (и это показано в итоге загрузки), если его нет среди доменов проекта, если ежедневная проверка ещё не видела его AMP-домена или если текущего AMP-домена нет в списке. Прежние AMP-домены считаются доменами проекта на вкладке «Позиции», видны на «Блокировках» и уходят в Proxy Checker, если попадутся в выдаче. Их даты неизвестны, поэтому рядом с ними стоит «до 13.10» — до дня, когда SERP Monitor впервые увидел следующий за ними AMP-домен. Повторная загрузка добавляет только новое; итог последней загрузки виден в строке эндпоинта.</li>
          <li><strong>AMP-домены в позициях:</strong> результат на AMP-домене считается результатом проекта, хотя в список доменов проекта AMP-домены не добавляются. На вкладке «Позиции» такой результат показан под своим хостом с пометкой <strong>AMP</strong> (в подсказке — чей это AMP-домен) и входит в монополизацию. Учитываются все AMP-домены, которые ротатор называл с момента подключения эндпоинта, а не только сегодняшний: выдача, снятая вчера, показывает вчерашний AMP-домен. В виде «Средние» AMP-домены одного сайта — одна строка. В CSV-выгрузке позиций у такого результата указан сайт, чей это AMP-домен. AMP-домены, которые были до подключения эндпоинта, SERP Monitor не знает и своими не считает.</li>
          <li><strong>Даты AMP-домена:</strong> в таблицах «Позиции», «Блокировки» и «Не проходят в „Блокировках“» на «Обзоре» рядом с AMP-доменом указано, когда он был AMP-доменом своего сайта: <strong>«с 13.10»</strong> — ротатор называет его и сейчас; <strong>«12.10–13.10»</strong> — называл в эти дни. Это дни ответов ротатора, полученных SERP Monitor. Ротатор сообщает, какой AMP-домен текущий, но не с какого времени, поэтому раньше первого из этих дней домен тоже мог быть AMP-доменом.</li>
        </ul>

        <h3 className={H3}>Proxy Checker</h3>
        <p className={P}>
          SERP Monitor может передавать в Proxy Checker <strong>домены проекта, найденные в
          выдаче при проверках</strong>: по одному запросу на страну, и только те домены,
          которые в этой стране действительно нашлись (по тому же правилу, что и «Наши
          позиции»). Страна берётся из локации задачи, у загруженного CSV — из столбца GEO.
          Страны отправляются по очереди, каждая — отдельным запросом со всеми её доменами. Запрос:
        </p>
        <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-900">{`POST <адрес API>          Authorization: Bearer <токен>
{"DailyCheck": {"geo": "KG", "domains": ["example1.com", "example2.com"]}}`}</pre>
        <ul className={UL}>
          <li><strong>AMP-домены.</strong> Если у проекта подключён AMP Rotator, в Proxy Checker отправляются и AMP-домены — в двух случаях. Первый: AMP-домен <strong>сам найден в выдаче</strong> страны — тогда он отправляется для этой страны, даже если основного домена на странице нет. Это может быть и вчерашний AMP-домен, который выдача ещё показывает. Второй: вместе с каждым найденным в выдаче доменом отправляется его <strong>сегодняшний AMP-домен</strong> — для тех же стран: именно на него попадает посетитель из выдачи. Включать ничего не нужно; в списке «что будет отправлено» такие домены помечены «AMP». На вкладке «Блокировки» под таблицей каждой страны — вторая таблица, для AMP-доменов, с теми же столбцами прокси. У AMP-домена, который сам есть в выдаче, стоит пометка «сам в выдаче» и показаны его собственные позиции; у остальных показана позиция основного домена, и это тоже подписано.</li>
          <li><strong>«Не проходят в „Блокировках“»</strong> — карточка на вкладке «Обзор», сразу под плитками и перед задачами по расписанию: только домены из выдачи, у которых хотя бы один прокси ответил не PASS, двумя таблицами — основные домены и AMP-домены. Для каждого показано, какие прокси не прошли и с каким статусом. Период выбирается теми же чипами, что и для позиций (<strong>Сегодня / Вчера / Эта неделя / Этот месяц / Этот год / Свой период</strong>); домен оценивается по его последней проверке внутри периода, поэтому ответы Proxy Checker хранятся с датой. Демо-данных здесь нет: если за период ничего не проверено, карточка так и говорит.</li>
          <li><strong>Таблица «Домены в выдаче: статус по прокси»</strong> (вкладка «Блокировки» проекта). Proxy Checker отвечает по каждому домену статусом от каждого прокси страны, например <code className={CODE}>{`{"example1.com": {"KG - Provider A": "PASS", "KG - Provider B": "PASS"}}`}</code>. Поэтому по каждой стране своя таблица: строка — домен проекта, который сейчас есть в выдаче этой страны, столбец — прокси, в ячейке статус <strong>так, как его прислал Proxy Checker</strong> (PASS — зелёным, любой другой — красным). SERP Monitor не сводит это к «заблокирован / не заблокирован». Рядом — по скольким запросам домен стоит, лучшая позиция и когда он был в выдаче. Сверху — домены, у которых хотя бы один прокси ответил не PASS. Период выбирается теми же чипами, что и для позиций (<strong>Сегодня / Вчера / Эта неделя / Этот месяц / Этот год / Свой период</strong>), и означает, когда ответили прокси: у каждого домена показан их последний ответ внутри периода. Какие домены «в выдаче», читается так же, как на вкладке «Позиции» (последняя проверка каждого запроса), за выбранный период и неделю до него — домен мог попасть в выдачу накануне проверки. Если по домену не ответил ни один прокси, под ним написано почему: GEO выключен для отправки, домен ещё не отправлялся, отправка отклонена или в ответе о домене ничего нет. Таблица всегда открывается на настоящих данных. Пока за выбранный срок ничего не проверено, вместо таблиц показано одно сообщение об этом; при желании можно нажать <strong>«Показать пример на демо-данных»</strong>: прокси и статусы в примере выдуманы и помечены жёлтой плашкой, домены и позиции настоящие; пример убирается кнопкой и сам никогда не включается.</li>
          <li><strong>Подключение</strong> (адрес API и токен) — одно на всё приложение: «Настройки → Подключение инструментов». Встроенного адреса нет: пока не введены и адрес, и токен, ничего не отправляется. Токен сохраняется и обратно не показывается. Там же — <strong>«Ждать ответа»</strong>: сколько минут ждать ответа Proxy Checker на один запрос, то есть на одну страну (по умолчанию 5, от 1 до 60). Он проверяет домены через прокси, прежде чем ответить, поэтому запрос с большим числом доменов идёт дольше; если ответа за это время нет, отправка записывается как «нет ответа» и статусов по ней не будет.</li>
          <li><strong>Когда отправлять</strong> — настройка проекта, карточка Proxy Checker на вкладке «Блокировки» страницы проекта: <strong>«Как в настройках»</strong>, «Выключено» или «Раз в день» в указанное время (всё найденное за последние 24 ч). «Как в настройках» следует общему переключателю <strong>«Автоматически отправлять после каждой проверки выдачи и загрузки CSV»</strong> в «Настройки → Подключение инструментов»: пока он включён (так по умолчанию), проект отправляет после каждого прогона и загрузки CSV; когда выключен — сам ничего не отправляет. Отправка «сразу после проверки или загрузки файла — домены, найденные в ней» — это и есть «Как в настройках» при включённом переключателе; отдельной кнопки для неё на странице проекта нет. Новые проекты создаются с «Как в настройках»; «Выключено» и «Раз в день» перекрывают общую настройку. У проектов, созданных до появления переключателя, осталось «Выключено». Проект, у которого раньше было выбрано «После каждого прогона/загрузки CSV», так и отправляет — независимо от переключателя; у него эта кнопка видна, пока не выбран другой вариант.</li>
          <li><strong>Проверка без выдачи</strong> — карточка на вкладке «Блокировки» страницы проекта, между таблицей статусов и карточкой Proxy Checker. Выбранные домены проекта можно проверить один раз или по расписанию. Когда переключатель «Проверять по расписанию» включён, они уходят в Proxy Checker с выбранной частотой — от «каждый час» до «раз в неделю», — даже если выдачу не проверяли и домена в ней нет. По умолчанию выбраны <strong>все домены</strong>, в том числе добавленные в проект позже; если снять «Все домены», сначала не выбран ни один, и нужные включаются нажатием. GEO выбираются так же: по умолчанию <strong>все GEO проекта</strong> из карточки «GEO проекта» (пока она не сохранена — страны из задач проекта), в том числе добавленные позже; если снять «Все GEO проекта», сначала не выбран ни один. Выбор «GEO для отправки» в карточке Proxy Checker сюда не относится. Вместе с доменом уходит его сегодняшний AMP-домен (у такого домена в списке пометка «+AMP»). Отсчёт идёт от момента сохранения: «каждые 6 часов», сохранённые в 10:00, — это 16:00, 22:00, 04:00 и так далее, и перезапуск приложения их не сдвигает. Кнопка <strong>«Проверить сейчас»</strong> — разовая проверка: отправляет выбранные в карточке домены по выбранным GEO один раз и сразу, даже если расписание выключено и выбор не сохранён. Ответы попадают в таблицу статусов как обычно; у домена, проверенного так, под ним написано «без выдачи», а если в выдаче его нет, позиция пустая. В журнале отправок такие запросы подписаны «по расписанию, без выдачи» или «вручную, без выдачи». Эта проверка не зависит от «Когда отправлять»: если включено и то и другое, домен из выдачи может проверяться дважды.</li>
          <li><strong>GEO проекта</strong> — карточка на вкладке «Обзор» страницы проекта: список всех стран, в которых работает проект (пока он не сохранён, подставляются страны из задач проекта). Из него в карточке Proxy Checker выбирается <strong>«GEO для отправки»</strong>: нажатие на страну выключает или включает её, отправляются находки только по включённым. Пока включены все, GEO, добавленный в проект позже, тоже отправляется.</li>
          <li><strong>«Отправить сейчас»</strong> там же отправляет найденное за последние 24 ч в любой момент, при любом режиме. Ниже — что именно уйдёт («Будет отправлено сейчас») и журнал «Последние отправки» с ответом сервера; журнал свёрнут, пока его не откроют. Кнопка ждёт ответа по каждой стране, поэтому при нескольких странах это может занять несколько «Ждать ответа» подряд.</li>
          <li><strong>Запрос и ответ.</strong> После «Отправить сейчас» под кнопкой появляется свёрнутая строка «Только что отправлено» с итогом; она раскрывается по клику и показывает каждый отправленный запрос в виде команды <code>curl</code> и ответ Proxy Checker без обработки: строка состояния, заголовки и тело. То же открывается в журнале кнопкой «curl и ответ» у любой отправки, в том числе автоматической. Токен в журнал не записывается — в команде на его месте стоит <code>&lt;token&gt;</code>; команда работает как есть в bash и в командной строке Windows (cmd).</li>
          <li><strong>Не больше 3 доменов в одном запросе.</strong> Proxy Checker проверяет каждый домен через все прокси страны, прежде чем ответить, а стоящий перед ним Cloudflare через 120 секунд обрывает запрос с ошибкой <strong>HTTP 524</strong> — сколько бы ни было выставлено в «Ждать ответа». Поэтому домены каждого GEO уходят запросами по 3, один за другим: 8 доменов — это 3 запроса (3 + 3 + 2). В журнале у каждого запроса указано, сколько он шёл, — так видно, насколько далеко до 120 секунд.</li>
          <li><strong>Отправка идёт на сервере до конца</strong>, даже если закрыть или обновить страницу после «Отправить сейчас» или «Проверить сейчас». Пока она идёт, в карточках Proxy Checker и «Проверка без выдачи» видна строка «Идёт отправка в Proxy Checker»: по каким GEO, сколько запросов уже готово и когда она начата, — и обе кнопки неактивны, чтобы не отправить то же самое второй раз (то же касается отправок по расписанию и после прогона). Ответ на каждый запрос сохраняется сразу, как пришёл, поэтому журнал и таблица на вкладке «Блокировки» заполняются по мере отправки. Перезапуск приложения прерывает отправку; уже полученные ответы при этом остаются.</li>
          <li><strong>Если в журнале «отклонено · HTTP 403»</strong> при верном токене — проверьте, открыт ли сервер Proxy Checker для IP-адреса, с которого работает SERP Monitor: сервер может принимать запросы только с разрешённых адресов.</li>
        </ul>
      </section>

      {/* ───────────────────────── Видимость ───────────────────────── */}
      <section id="visibility">
        <h2 className={H2}>{NUM["visibility"]}. Видимость и монополизация</h2>
        <p className={P}>
          Позиция — это ранг, а не количество. То, что #1 и #2 отличаются на единицу,
          ничего не говорит о том, во сколько раз первая ценнее второй. Чтобы из ранга
          получилось количество, каждой позиции назначается <strong>вес</strong>, и тогда
          несколько позиций можно складывать.
        </p>

        <h3 className={H3}>Две величины</h3>
        <ul className={UL}>
          <li>
            <strong>Монополизация</strong> (вид «Последние») — какую часть этой страницы
            занимают домены проекта вместе. Считаются <em>все</em> занятые ими позиции,
            каждая по своему весу. Рядом стоит счёт «N из M позиций»: процент без него
            нечем проверить.
          </li>
          <li>
            <strong>Видимость</strong> (вид «Средние») — та же доля страницы, усреднённая
            по всем прогонам периода, <em>включая те, где домена не было</em>: они
            считаются нулём. Это позиция и присутствие в одном числе.
          </li>
        </ul>

        <h3 className={H3}>Настройка весов</h3>
        <p className={P}>
          <strong>Настройки → Мониторинг выдачи → Веса видимости.</strong> По умолчанию кривая резкая —
          50 / 20 / 10 / 7 / 5 / 3 / 2 / 1 / 1 / 1 — потому что инструмент следит за
          брендовыми запросами, где первый результат забирает долю, немыслимую для
          информационного запроса. В редакторе рядом с каждым весом показаны его доля и
          накопленный итог («топ-N держит столько-то»).
        </p>
        <ul className={UL}>
          <li><strong>Важны только соотношения.</strong> 5 / 2 / 1 означает то же, что 50 / 20 / 10: каждая оценка делится на вес, задействованный на измеряемой странице. Сумма не обязана быть сотней.</li>
          <li><strong>Длина списка — это тоже настройка.</strong> Позиция ниже последней строки не стоит ничего, то есть кривая задаёт, до какой глубины выдача вообще считается видимой.</li>
        </ul>

        <h3 className={H3}>Короткая выдача и пропуски</h3>
        <p className={P}>
          Если прогон снял меньше результатов, чем позиций в кривой, те же 100% делятся
          между теми позициями, что есть: на странице из семи результатов семь слотов
          держат её целиком. Такие строки помечены <strong>⚠</strong> — и вот почему это
          важно: <em>так выглядит и по-настоящему короткая выдача, и неполное снятие</em>.
          Различить их позволяет только счёт позиций рядом с процентом.
        </p>
        <p className={P}>
          <strong>Пропуски не перераспределяются.</strong> DataForSEO отдаёт{" "}
          <code className={CODE}>rank_absolute</code>, поэтому органический результат
          может стоять на #4, а #3 занимать реклама, которую мы не сохраняем. Это
          внимание ушло рекламе, и раздавать его остальным было бы неправдой: знаменатель
          считается до самой глубокой снятой позиции, а не по тем, что есть.
        </p>
        <div className={CALLOUT_WARN}>
          Изменение кривой пересчитывает все представления сразу, <strong>включая прошлые
          прогоны</strong>. Это способ читать измерения, а не часть самих измерений —
          в отличие от формулы перспективы, которую прогон может зафиксировать за собой.
        </div>
      </section>

      {/* ───────────────────────── Показанный хост ───────────────────────── */}
      <section id="shown-host">
        <h2 className={H2}>{NUM["shown-host"]}. AMP, CDN и подменённые хосты</h2>
        <p className={P}>
          Поисковик печатает над ссылкой один хост, а ссылка может вести на другой.
          Честный случай — AMP и CDN: над ссылкой на <code className={CODE}>cloudfront.net</code>{" "}
          напечатано <code className={CODE}>by.tribuna.com</code>, и с точки зрения
          читателя ранжируется именно издатель. Нечестный — дорвей, печатающий чужой
          бренд.
        </p>

        <h3 className={H3}>Откуда берётся показанный хост</h3>
        <table className={TABLE}>
          <thead>
            <tr>
              <th className={TH}>Провайдер</th>
              <th className={TH}>Поле</th>
            </tr>
          </thead>
          <tbody>
            <tr><td className={TD}>DataForSEO</td><td className={TD}><code className={CODE}>breadcrumb</code>, <code className={CODE}>website_name</code></td></tr>
            <tr><td className={TD}>SerpAPI</td><td className={TD}><code className={CODE}>displayed_link</code></td></tr>
            <tr><td className={TD}>Oxylabs</td><td className={TD}><code className={CODE}>url_shown</code></td></tr>
            <tr><td className={TD}>Bright Data</td><td className={TD}><code className={CODE}>display_link</code></td></tr>
            <tr><td className={TD}>Яндекс (свой парсер)</td><td className={TD}>разметка пути в HTML</td></tr>
          </tbody>
        </table>
        <p className={P}>
          Значение сохраняется всегда и <strong>отдельно</strong> от хоста ссылки.
          <code className={CODE}>NULL</code> означает «провайдер ничего не сообщил» и
          никогда — «то же, что ссылка»: различать эти два случая и есть весь смысл.
          Название сайта, которое не является адресом («Отзовик»), хостом не считается.
        </p>

        <h3 className={H3}>Опция задачи</h3>
        <p className={P}>
          <strong>«Приводить AMP и CDN к показанному сайту»</strong> — с ней результат
          засчитывается показанному сайту. Подменённые результаты помечены <strong>⇄</strong>,
          а исходный хост доступен в один клик: галочка над таблицей позиций показывает,
          куда на самом деле ведёт каждая такая ссылка.
        </p>
        <p className={P}>
          Где опция действует: в <strong>позициях проекта</strong> (и в их CSV-выгрузке), в{" "}
          <strong>отправке доменов в Proxy Checker</strong> и на вкладке «Блокировки» — домен
          считается найденным в выдаче по тому же правилу, — и в{" "}
          <strong>сравнении провайдеров</strong> (режим 3 — таблица доменов и выдача по
          ключам; см. <a href="#compare" className="text-sky-700 hover:underline dark:text-sky-300">раздел {NUM["compare"]}</a>).
          Обзор распределения доменов на странице обычного прогона её пока не учитывает
          и показывает исходные хосты.
        </p>
        <div className={CALLOUT_WARN}>
          <strong>Это то же поле, которое подделывает дорвей.</strong> Результат,
          печатающий чужой бренд, будет засчитан этому бренду. Включайте опцию, когда
          следите за издателями, и помните про неё, когда следите за дорвеями.
        </div>

        <h3 className={H3}>Дорвеи не редиректят</h3>
        <p className={P}>
          Проверено на живом примере: странный URL из выдачи отдаёт{" "}
          <code className={CODE}>200</code> без единого редиректа — ни HTTP, ни{" "}
          <code className={CODE}>meta refresh</code>, ни JS. Это полный клон контента,
          у которого <code className={CODE}>title</code> и{" "}
          <code className={CODE}>description</code> совпадают с оригиналом, а показанный
          хост подменён. Поэтому «пройти по редиректам и подставить настоящий адрес» не
          сработало бы: редиректа нет, подделан именно показанный хост.
        </p>
      </section>

      {/* ───────────────────────── Verify scraped queries ───────────────────────── */}
      <section id="verify">
        <h2 className={H2}>{NUM["verify"]}. Проверка корректности (раздел «Проверить выполненные запросы»)</h2>

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
          вырезаны.
        </p>
        <div className={CALLOUT_NOTE}>
          Ссылки собираются в браузере из сохранённых параметров варианта (поисковик, страна,
          язык, локация, домен), а не берутся из фактического запроса к провайдеру. Поэтому{" "}
          <code className={CODE}>uule</code> в ссылке показан для любого провайдера, хотя
          отправляет его только Bright Data, а сам Bright Data получает uule от{" "}
          <em>актуального</em> названия места в списке Google — оно может отличаться от{" "}
          <code className={CODE}>canonical_name</code> (например, «Almaty Region» вместо «Almaty
          Province»). Ссылка показывает, что должно было уйти, и годится для ручной сверки
          выдачи.
        </div>

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
          вы видите в URL. Если в списке Google место называется иначе, Bright Data на деле
          получил uule от другого названия (см. примечание выше).
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
        <h2 className={H2}>{NUM["troubleshooting"]}. Частые проблемы</h2>

        <h3 className={H3}>Яндекс возвращает пустой результат</h3>
        <ul className={UL}>
          <li>Капча Яндекса пустым результатом уже не выглядит: такой запрос повторяется до трёх раз и затем падает с явной ошибкой «captcha/anti-bot page». Пустой результат без ошибки — скорее мягкая блокировка или изменившаяся вёрстка страницы; попробуйте повторить через 10–15 минут.</li>
          <li>Bright Data: проверьте, что зона <code className={CODE}>zone_raw</code> (Raw HTML) активна и в плане есть лимит на Yandex.</li>
          <li>Oxylabs: проверьте, что в учётных данных правильный <em>SERP-суб-аккаунт</em>, а не основной аккаунт.</li>
          <li>Логи: <code className={CODE}>docker compose logs api --since=10m | findstr /i yandex</code> (Windows) или <code className={CODE}>| grep -i yandex</code> (Linux/Mac).</li>
        </ul>

        <h3 className={H3}>Позиции «прыгают», хотя выдача не менялась</h3>
        <p className={P}>
          Почти всегда это смена провайдера, а не движение в выдаче.{" "}
          <strong>DataForSEO пишет <code className={CODE}>rank_absolute</code></strong> —
          номер с учётом рекламы и AI-блоков, поэтому органические результаты идут с
          дырами (#1 #2 _ #4 #5). <strong>SerpAPI пишет органический номер</strong> —
          он всегда подряд. Один и тот же слот на одной и той же странице приходит как
          #9 и как #7.
        </p>
        <ul className={UL}>
          <li>Сравнивайте прогоны <em>одного</em> провайдера. Провайдер записан у каждого прогона отдельно, потому что смена провайдера у задачи иначе переписала бы всю её историю.</li>
          <li>В виде «Средние» такие ячейки помечены <strong>≈</strong>, а прогоны, сделанные до того, как провайдер стал сохраняться, — <strong>?</strong>.</li>
        </ul>

        <h3 className={H3}>Прогон завершился успешно, но результатов почти нет</h3>
        <p className={P}>
          Прогон может отчитаться «выполнено, 0 ошибок» и при этом сохранить единицы
          строк на запрос. Проверьте число результатов у соседних прогонов той же задачи
          на других провайдерах: если у одного их 27, а у другого 2, дело не в выдаче.
        </p>
        <div className={CALLOUT_WARN}>
          Такой прогон <strong>искажает доли</strong>: монополизация и видимость делятся
          на вес позиций, реально снятых на странице, поэтому на странице из двух
          результатов одна позиция #1 прочитается как 70%+ страницы. Строки, посчитанные
          от короткой страницы, помечены <strong>⚠</strong> — смотрите на счёт «N из M
          позиций» рядом с процентом.
        </div>

        <h3 className={H3}>Расписание не запускается</h3>
        <ul className={UL}>
          <li>Убедитесь, что чекбокс «Включено» поставлен и задача сохранена.</li>
          <li>На странице задачи в блоке «Расписание» должно быть «включено» + «Следующий запуск: &lt;дата&gt;».</li>
          <li>Если видно «⚠ не зарегистрировано в планировщике» — переключите чекбокс выкл/вкл и сохраните ещё раз.</li>
          <li>Проверьте, что часовой пояс — UTC (если в <code className={CODE}>scheduler.py</code> ничего не меняли). Запуск, который ожидался «в 09:00 локального времени», в UTC-настройках мог уже произойти или ещё впереди.</li>
          <li>Задача с номерами дней недели (например, <code className={CODE}>1-5</code>) до 14.10.2026 срабатывала на день позже — со вторника по субботу. Это исправлено; если расписание «не запускалось в понедельник», дело было в этом.</li>
        </ul>

        <h3 className={H3}>CSV открывается в Excel «кашей» или в одну колонку</h3>
        <p className={P}>
          Выгрузки SERP Monitor (прогон, позиции проекта, таблица анализатора) — в UTF-8 с
          отметкой кодировки, поэтому кириллица в Excel читается сразу. Выгрузки прогона и
          позиций в русском интерфейсе разделяют поля «;», как ждёт Excel с русскими
          региональными настройками. Если всё же видите «кашу» (файл, скачанный до
          14.10.2026) или все данные в колонке A (файл с «,» — например, скачанный в
          английском интерфейсе — в Excel с русскими настройками), варианты:
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
          все будущие deploy. Строки сид добавляет только при первом запуске на пустой БД;
          но пустые (<code className={CODE}>NULL</code>) значения <code className={CODE}>yandex_lr</code>{" "}
          у мест из сида он дозаполняет при каждом запуске. Поэтому очищенный у такого места
          lr после перезапуска вернётся — чтобы отменить таргетинг по городу, впишите другое
          значение или удалите место.
        </div>

        <h3 className={H3}>Ошибка ProviderConfigError при запуске</h3>
        <p className={P}>Это означает, что выбранный провайдер не может выполнить задачу с текущими настройками. Самые частые случаи:</p>
        <ul className={UL}>
          <li><strong>Bright Data + Yandex</strong>, но не задана <code className={CODE}>zone_raw</code> → откройте Настройки → Bright Data, заполните зону Raw HTML.</li>
          <li><strong>SerpAPI</strong>, но ключ не введён или SerpAPI его отклонил → проверьте баланс на serpapi.com и обновите ключ.</li>
          <li><strong>Oxylabs</strong>, но в «Имени пользователя» / «Пароле» ошибка → используйте именно SERP Scraper-сабаккаунт.</li>
          <li><strong>DataForSEO</strong>: не заданы или отклонены логин и API-пароль; в задаче нет языка (у DataForSEO нет языка по умолчанию); нет локации или её нет в базе DataForSEO (России и Беларуси там нет вовсе); в задаче выбран Яндекс (DataForSEO его не поддерживает).</li>
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

      <footer className="mt-16 border-t border-slate-200 pt-6 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-400">
        <p>
          Не нашли ответа на свой вопрос? Откройте логи API через{" "}
          <code className={CODE}>docker compose logs api --since=15m</code> — большинство проблем
          оставляют там понятный след.
        </p>
      </footer>
    </article>
  );
}
