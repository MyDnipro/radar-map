import os
import re
import json
import time
import random
import requests
from urllib.parse import unquote

# =========================================================================
# ⚙️ НАСТРОЙКИ И API КЛЮЧИ GEMINI
# =========================================================================
RAW_GEMINI_KEYS = os.environ.get("GEMINI_KEY", "").strip() or os.environ.get("GEMINI_KEYS", "").strip()
GEMINI_KEYS = [k.strip() for k in re.split(r'[,;\s]+', RAW_GEMINI_KEYS) if len(k.strip()) > 15]

current_key_index = 0
SUPPORTED_MODELS = ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.8-flash"]

# Базовый URL Firebase Realtime Database
FIREBASE_URL = os.environ.get("FIREBASE_URL", "").strip()
if FIREBASE_URL and not FIREBASE_URL.endswith(".json"):
    BASE_FB_URL = FIREBASE_URL.rstrip("/")
else:
    BASE_FB_URL = FIREBASE_URL.replace("/points.json", "").rstrip("/") if FIREBASE_URL else ""

POINTS_URL = f"{BASE_FB_URL}/points.json" if BASE_FB_URL else ""
KNOWLEDGE_BASE_URL = f"{BASE_FB_URL}/knowledge_base.json" if BASE_FB_URL else ""
STATS_ARCHIVE_URL = f"{BASE_FB_URL}/stats_archive.json" if BASE_FB_URL else ""
CUSTOM_STREETS_URL = f"{BASE_FB_URL}/custom_streets.json" if BASE_FB_URL else ""
SPAM_FILTERS_URL = f"{BASE_FB_URL}/spam_filters.json" if BASE_FB_URL else ""

LIFETIME_MS = 40 * 60 * 1000  # 40 минут для актуальных меток
CHANNEL_BASE_URL = "https://t.me/s/dnepr_bez_tck"

PROCESSED_POST_IDS = set()
CUSTOM_STREETS_CACHE = {}
DYNAMIC_SPAM_WORDS = set()
LAST_CLOUD_SYNC = 0

def log(msg):
    print(msg, flush=True)

def get_active_gemini_key():
    global current_key_index
    if not GEMINI_KEYS:
        return ""
    return GEMINI_KEYS[current_key_index % len(GEMINI_KEYS)]

def rotate_to_next_key():
    global current_key_index
    if not GEMINI_KEYS:
        return ""
    current_key_index = (current_key_index + 1) % len(GEMINI_KEYS)
    log(f"🔄 Перемикання на Gemini API Key #{current_key_index + 1} з {len(GEMINI_KEYS)}")
    return get_active_gemini_key()

# =========================================================================
# 🚫 ФИЛЬТРАЦИЯ СПАМА И РЕКЛАМЫ (СТАТИЧЕСКАЯ + ОБЛАЧНАЯ ИЗ КАРТЫ)
# =========================================================================
AD_FILTER_REGEX = re.compile(
    r'(?:'
    r'напоминаем.*?бот|'
    r'бот\s+с\s+картой|'
    r'бот\s+з\s+картою|'
    r'покупка\s+бота|'
    r'купить\s+бота|'
    r'підтримайте\s+(?:канал|її|його)|'
    r'поддержите\s+(?:канал|её|его)|'
    r'группа\s+вам\s+полезна|'
    r'канал\s+вам\s+полезен|'
    r'сделайте\s+репост|'
    r'зробіть\s+репост|'
    r'пригласите\s+друзей|'
    r'запросіть\s+друзів|'
    r'поделитесь\s+ссылкой|'
    r'поділіться\s+посиланням|'
    r'ссылка\s+на\s+бота|'
    r'посилання\s+на\s+бота|'
    r'описании\s+группы|'
    r'описании\s+канала|'
    r'продолжать\s+работу|'
    r'продовжувати\s+роботу|'
    r'улучшать\s+функционал|'
    r'развивать\s+проект|'
    r'пробный\s+доступ|'
    r'события\s+живут|'
    r'метки\s+появляются|'
    r'без\s+отдельных\s+приложений|'
    r'збір\s+на|'
    r'сбор\s+на|'
    r'підпишіться|'
    r'подпишитесь|'
    r't\.me/|'
    r'https?://|'
    r'реклам[аеу]'
    r')',
    re.IGNORECASE
)

def is_ad_or_spam(text):
    if not text:
        return False
    if AD_FILTER_REGEX.search(text):
        return True
    t_lower = text.lower()
    for spam_word in DYNAMIC_SPAM_WORDS:
        if spam_word and spam_word in t_lower:
            return True
    return False

# =========================================================================
# 📍 ГЕНЕРАЛЬНАЯ БАЗА ТОПОНИМОВ И УЧАСТКОВ ДНЕПРА
# =========================================================================
LOCAL_STREETS_DB = [
    # --- ДИЛЯНКИ: ПОЛЯ / КИРОВА ---
    {"keys": ["низ киров", "низ кіров", "низ поля"], "addr": "просп. Олександра Поля (Низ, сквер Героїв)", "lat": 48.4610, "lng": 35.0310},
    {"keys": ["середина киров", "середина кіров", "середина поля"], "addr": "просп. Олександра Поля (Середина, Славутич)", "lat": 48.4480, "lng": 35.0240},
    {"keys": ["верх киров", "верх кіров", "верх поля"], "addr": "просп. Олександра Поля (Верх, Титова)", "lat": 48.4340, "lng": 35.0160},

    # --- ДИЛЯНКИ: РАБОЧАЯ ---
    {"keys": ["низ рабоч", "низ робоч"], "addr": "вул. Робоча (Низ, р-н Нігояна)", "lat": 48.4680, "lng": 35.0110},
    {"keys": ["середина рабоч", "середина робоч"], "addr": "вул. Робоча (Середина, Театральна)", "lat": 48.4520, "lng": 35.0090},
    {"keys": ["верх рабоч", "верх робоч"], "addr": "вул. Робоча (Верх, Метеор / ЮМЗ)", "lat": 48.4385, "lng": 35.0065},

    # --- ДИЛЯНКИ: СИЧОВЫХ СТРЕЛЬЦОВ / АРТЕМА ---
    {"keys": ["низ артем", "низ січов", "низ сечевых"], "addr": "вул. Січових Стрільців (Низ, Яворницького)", "lat": 48.4635, "lng": 35.0445},
    {"keys": ["середина артем", "середина січов", "середина сечевых"], "addr": "вул. Січових Стрільців (Середина, Чкалова)", "lat": 48.4560, "lng": 35.0420},
    {"keys": ["верх артем", "верх січов", "верх сечевых"], "addr": "вул. Січових Стрільців (Верх, тупик 4 трамвая)", "lat": 48.4480, "lng": 35.0390},

    # --- ДИЛЯНКИ: НАУКИ / ГАГАРИНА ---
    {"keys": ["низ гагарин", "низ гагарін", "низ науки"], "addr": "просп. Науки (Низ, Нагірка)", "lat": 48.4510, "lng": 35.0590},
    {"keys": ["середина гагарин", "середина гагарін", "середина науки"], "addr": "просп. Науки (Середина, ДІІТ / Казакова)", "lat": 48.4350, "lng": 35.0420},
    {"keys": ["верх гагарин", "верх гагарін", "верх науки"], "addr": "просп. Науки (Верх, Підстанція / Дафі)", "lat": 48.4230, "lng": 35.0320},

    # --- ДИЛЯНКИ: ХМЕЛЬНИЦКОГО / СТАЛИНГРАДА ---
    {"keys": ["низ сталинград", "низ хмельниц"], "addr": "просп. Б. Хмельницького (Низ, Титова)", "lat": 48.4310, "lng": 35.0170},
    {"keys": ["середина сталинград", "середина хмельниц"], "addr": "просп. Б. Хмельницького (Середина, Шинна)", "lat": 48.4200, "lng": 35.0180},
    {"keys": ["верх сталинград", "верх хмельниц"], "addr": "просп. Б. Хмельницького (Верх, 12 Квартал)", "lat": 48.4050, "lng": 35.0210},

    # --- ДИЛЯНКИ: МАЗЕПЫ / ПЕТРОВСКОГО ---
    {"keys": ["низ петровск", "низ мазеп"], "addr": "просп. Івана Мазепи (Низ, Органний зал)", "lat": 48.4735, "lng": 34.9860},
    {"keys": ["середина петровск", "середина мазеп"], "addr": "просп. Івана Мазепи (Середина, Авіаційна)", "lat": 48.4680, "lng": 34.9650},
    {"keys": ["верх петровск", "верх мазеп"], "addr": "просп. Івана Мазепи (Верх, Київська)", "lat": 48.4610, "lng": 34.9480},

    # --- ДИЛЯНКИ: СЛОБОЖАНСКИЙ / ПРАВДА ---
    {"keys": ["начало правд", "низ правд", "початок слобожанськ"], "addr": "просп. Слобожанський (Початок, Новий міст)", "lat": 48.4860, "lng": 35.0560},
    {"keys": ["середина правд", "середина слобожанськ"], "addr": "просп. Слобожанський (Середина, Калинова)", "lat": 48.5020, "lng": 35.0690},
    {"keys": ["конец правд", "верх правд", "кінець слобожанськ"], "addr": "просп. Слобожанський (Кінець, Золоті Ключі)", "lat": 48.5250, "lng": 35.0880},

    # --- ДИЛЯНКИ: ДОНЕЦКОЕ ШОССЕ (ДШ) ---
    {"keys": ["начало дш", "початок дш"], "addr": "Донецьке шосе (Початок, Ломівський)", "lat": 48.5030, "lng": 34.9780},
    {"keys": ["середина дш"], "addr": "Донецьке шосе (Середина, Березинський)", "lat": 48.5170, "lng": 35.0020},
    {"keys": ["конец дш", "кінець дш"], "addr": "Донецьке шосе (Кінець, Караван)", "lat": 48.5300, "lng": 35.0250},

    # --- ДИЛЯНКИ: ЯВОРНИЦКОГО / КАРЛА МАРКСА ---
    {"keys": ["низ карла маркс", "низ яворниц"], "addr": "просп. Дмитра Яворницького (Вокзал / Островського)", "lat": 48.4760, "lng": 35.0190},
    {"keys": ["центр карла маркс", "центр яворниц"], "addr": "просп. Дмитра Яворницького (Центр, ЦУМ / Пасаж)", "lat": 48.4650, "lng": 35.0450},
    {"keys": ["верх карла маркс", "верх яворниц"], "addr": "просп. Дмитра Яворницького (Верх, Соборна площа)", "lat": 48.4570, "lng": 35.0640},

    # --- ДИЛЯНКИ: КОСМИЧЕСКАЯ ---
    {"keys": ["низ космическ", "низ космічн"], "addr": "вул. Космічна (Низ, Набережна)", "lat": 48.4240, "lng": 35.0740},
    {"keys": ["верх космическ", "верх космічн"], "addr": "вул. Космічна (Верх, Запорізьке шосе)", "lat": 48.4060, "lng": 35.0410},
    {"keys": ["тещин.*язик", "тещин.*язык", "тёщин.*язык"], "addr": "Тьощин язик (вул. Космічна)", "lat": 48.4140, "lng": 35.0510},

    # --- ТОЧНЫЕ УЛИЦЫ И ПЕРЕИМЕНОВАНИЯ ---
    {"keys": ["бородинск", "бородинськ", "магалевськ"], "addr": "вул. Юрія Магалевського (Бородинська)", "lat": 48.4555, "lng": 35.0410},
    {"keys": ["нагорк", "нагірк", "нагорный рынок", "нагірний ринок"], "addr": "Нагірний ринок (Нагорка)", "lat": 48.4520, "lng": 35.0610},
    {"keys": ["энергетич", "енергетич"], "addr": "вул. Енергетична", "lat": 48.4225, "lng": 35.0085},
    {"keys": ["карун"], "addr": "вул. Василя Каруни (Амур / з'їзд на Слобожанський)", "lat": 48.4910, "lng": 35.0560},
    {"keys": ["савченк", "черновол", "чорновол"], "addr": "вул. В'ячеслава Чорновола (Савченка)", "lat": 48.4550, "lng": 35.0180},
    {"keys": ["гавриленк", "ребинин", "ребінін"], "addr": "вул. Лікаря Ребініна (Гавриленка)", "lat": 48.4380, "lng": 35.0210},
    {"keys": ["вакуленчук", "стромцов"], "addr": "вул. Леоніда Стромцова (Вакуленчука)", "lat": 48.4410, "lng": 35.0250},
    {"keys": ["барвинковск", "барвінківськ"], "addr": "вул. Барвінківська", "lat": 48.4493, "lng": 35.0286},
    {"keys": ["камчатск", "камчатськ", "калдирськ"], "addr": "вул. Калдирська (Камчатська)", "lat": 48.4650, "lng": 34.9800},
    {"keys": ["ленинград", "ленінград", "мудрог", "ярослав.*мудр"], "addr": "вул. Князя Ярослава Мудрого (Ленінградська)", "lat": 48.4758, "lng": 35.0307},
    {"keys": ["курчатов", "128.*бригад"], "addr": "вул. 128-ї Бригади (Курчатова)", "lat": 48.4740, "lng": 35.0140},
    {"keys": ["шмидт", "шмідт", "бандер"], "addr": "вул. Степана Бандери (Шмідта)", "lat": 48.4680, "lng": 35.0240},
    {"keys": ["чкалов", "хоробр", "храбр"], "addr": "вул. Святослава Хороброго (Чкалова)", "lat": 48.4560, "lng": 35.0340},
    {"keys": ["дзержинск", "дзержинськ", "вернадск", "вернадськ"], "addr": "вул. Володимира Вернадського (Дзержинського)", "lat": 48.4630, "lng": 35.0580},
    {"keys": ["комсомольск", "комсомольськ", "старокозац", "старокозацьк"], "addr": "вул. Старокозацька (Комсомольська)", "lat": 48.4610, "lng": 35.0380},
    {"keys": ["плеханов"], "addr": "вул. Князя Володимира Великого (Плеханова)", "lat": 48.4680, "lng": 35.0450},
    {"keys": ["ленин", "ленін", "воскресенск", "воскресенськ"], "addr": "вул. Воскресенська (Леніна)", "lat": 48.4640, "lng": 35.0410},
    {"keys": ["молодогвард"], "addr": "вул. Молодогвардійська (під мостами)", "lat": 48.4680, "lng": 35.1220},
    {"keys": ["луговськ", "луговск"], "addr": "вул. Луговська (АНД)", "lat": 48.4890, "lng": 35.0480},
    {"keys": ["солончаков"], "addr": "вул. Солончакова (АНД)", "lat": 48.5010, "lng": 35.0350},
    {"keys": ["ингульск", "інгульськ"], "addr": "вул. Інгульська (АНД)", "lat": 48.5120, "lng": 35.0420},
    {"keys": ["моторн", "семен"], "addr": "вул. Моторна (Березанівка)", "lat": 48.5350, "lng": 34.9600},
    {"keys": ["петрозаводськ", "петрозаводск", "ковпак"], "addr": "вул. Петрозаводська (Ковпака)", "lat": 48.5300, "lng": 34.9850},
    {"keys": ["аеропорт", "аэропорт"], "addr": "Аеропорт Дніпро", "lat": 48.3570, "lng": 35.1000},
    {"keys": ["старих кодак", "старых кодак", "кодаки"], "addr": "дорога на Старі Кодаки", "lat": 48.3650, "lng": 35.1050},
    {"keys": ["братськ", "братское"], "addr": "с. Братське (Запорізька траса)", "lat": 48.3280, "lng": 35.0250},
    {"keys": ["новоолександрівк", "новоалександровк"], "addr": "с. Новоолександрівка", "lat": 48.3520, "lng": 35.0050},
    {"keys": ["краснопіл", "краснополь"], "addr": "Краснопілля", "lat": 48.4100, "lng": 34.9550},
    {"keys": ["переезд.*мирн", "переїзд.*мирн"], "addr": "Переїзд Мирний (Краснопілля)", "lat": 48.3980, "lng": 34.9850},
    {"keys": ["розвилк", "развилк"], "addr": "Розвилка (Б. Хмельницького / ЗШ)", "lat": 48.4250, "lng": 35.0220},

    # --- ЗАХОД, ПАРУС, ДИЕВКА ---
    {"keys": ["трофимов", "трофімов", "диевск", "діївськ"], "addr": "вул. Велика Діївська (Братів Трофімових)", "lat": 48.4840, "lng": 34.9180},
    {"keys": ["комунарівськ", "коммунаровск", "кондратюк"], "addr": "вул. Юрія Кондратюка (Комунарівська)", "lat": 48.4820, "lng": 34.9350},
    {"keys": ["парус"], "addr": "ж/м Парус", "lat": 48.4840, "lng": 34.9180},
    {"keys": ["покровськ", "покровск", "комунар", "коммунар"], "addr": "ж/м Покровський (Комунар)", "lat": 48.4820, "lng": 34.9380},
    {"keys": ["червон.*кам", "красный камень"], "addr": "ж/м Червоний Камінь", "lat": 48.4830, "lng": 34.9520},
    {"keys": ["західн", "западн"], "addr": "ж/м Західний", "lat": 48.4650, "lng": 34.9350},
    {"keys": ["лак"], "addr": "Лакофарбовий завод (з/м Західний)", "lat": 48.4680, "lng": 34.9520},
    {"keys": ["каштанов"], "addr": "вул. Каштанова (Таромське)", "lat": 48.4710, "lng": 34.8250},
    {"keys": ["діївк", "диевк"], "addr": "ж/м Діївка", "lat": 48.4810, "lng": 34.8980},

    # --- НАБЕРЕЖНАЯ, ВОКЗАЛ, ЦЕНТР ---
    {"keys": ["свобод"], "addr": "просп. Свободи", "lat": 48.4810, "lng": 34.9750},
    {"keys": ["водолікарн", "водолечеб"], "addr": "Водолікарня (пр. Свободи)", "lat": 48.4848, "lng": 34.9735},
    {"keys": ["павлов"], "addr": "вул. Академіка Павлова", "lat": 48.4818, "lng": 35.0012},
    {"keys": ["белелюб", "краснозавод", "дтрз", "комбайн", "ударник"], "addr": "вул. Белелюбського (Краснозаводська)", "lat": 48.4800, "lng": 34.9880},
    {"keys": ["набережн"], "addr": "Січеславська Набережна / Заводська", "lat": 48.4800, "lng": 35.0150},
    {"keys": ["речпорт", "річпорт"], "addr": "Річпорт (Набережна Заводська)", "lat": 48.4805, "lng": 35.0210},
    {"keys": ["стан 550", "стан550"], "addr": "Стан 550 (Набережна Заводська)", "lat": 48.4865, "lng": 34.9850},
    {"keys": ["водокачк"], "addr": "Водокачка (Набережна Заводська)", "lat": 48.4910, "lng": 34.9480},
    {"keys": ["кайдак", "з'їзд.*кайдак", "съезд.*кайдак"], "addr": "Кайдацький міст / з'їзд", "lat": 48.4925, "lng": 34.9625},
    {"keys": ["вокзал"], "addr": "пл. Вокзальна (Ж/Д Вокзал)", "lat": 48.4760, "lng": 35.0160},
    {"keys": ["старомостов", "островськ", "островск"], "addr": "пл. Старомостова (Островського)", "lat": 48.4770, "lng": 35.0220},
    {"keys": ["озерк"], "addr": "Ринок Озерка", "lat": 48.4715, "lng": 35.0215},
    {"keys": ["карла маркс", "яворниц", "яворницьк"], "addr": "просп. Дмитра Яворницького (К. Маркса)", "lat": 48.4650, "lng": 35.0350},
    {"keys": ["робоч", "рабоч"], "addr": "вул. Робоча", "lat": 48.4480, "lng": 35.0080},
    {"keys": ["канатн"], "addr": "вул. Канатна", "lat": 48.4600, "lng": 35.0100},
    {"keys": ["криворізьк", "криворож"], "addr": "вул. Криворізька", "lat": 48.4385, "lng": 34.9920},
    {"keys": ["поля", "кіров", "киров"], "addr": "просп. Олександра Поля (Кірова)", "lat": 48.4480, "lng": 35.0240},
    {"keys": ["титов", "независимост", "незалежност"], "addr": "вул. Незалежності (Титова)", "lat": 48.4340, "lng": 35.0150},
    {"keys": ["гагарин", "гагарін", "науки"], "addr": "просп. Науки (Гагаріна)", "lat": 48.4350, "lng": 35.0420},
    {"keys": ["артем", "січов", "сечевых"], "addr": "вул. Січових Стрільців (Артема)", "lat": 48.4550, "lng": 35.0420},
    {"keys": ["підстанці", "подстанци", "дафі", "дафи"], "addr": "Підстанція (ТРЦ Дафі)", "lat": 48.4250, "lng": 35.0220},
    {"keys": ["12.*квартал", "12 квартал"], "addr": "12 Квартал", "lat": 48.4120, "lng": 35.0150},
    {"keys": ["хмельниц", "хмельницьк", "сталинград", "сталінград"], "addr": "просп. Богдана Хмельницького", "lat": 48.4200, "lng": 35.0180},
    {"keys": ["топол"], "addr": "ж/м Тополя", "lat": 48.3950, "lng": 35.0350},
    {"keys": ["сокол", "сокіл"], "addr": "ж/м Сокіл", "lat": 48.4150, "lng": 35.0600},
    {"keys": ["космічн", "космическ"], "addr": "вул. Космічна", "lat": 48.4180, "lng": 35.0450},
    {"keys": ["перемог", "побед"], "addr": "ж/м Перемога", "lat": 48.4250, "lng": 35.0850},
    {"keys": ["мазеп", "петровск", "петровськ"], "addr": "просп. Івана Мазепи (Петровського)", "lat": 48.4680, "lng": 34.9650},
    {"keys": ["нігоян", "нигоян", "калінін", "калинин"], "addr": "просп. Сергія Нігояна (Калініна)", "lat": 48.4730, "lng": 34.9850},

    # --- ЛЕВЫЙ БЕРЕГ ---
    {"keys": ["бык", "бик"], "addr": "Пост «Бик» (Підгородне)", "lat": 48.5350, "lng": 35.1020},
    {"keys": ["золоті ключі", "золотые ключи"], "addr": "Золоті Ключі (Слобожанське)", "lat": 48.5280, "lng": 35.0920},
    {"keys": ["слобожанск", "слобожанськ", "правд"], "addr": "просп. Слобожанський (Правди)", "lat": 48.5000, "lng": 35.0680},
    {"keys": ["мануйловск", "мануйлівськ", "воронцов"], "addr": "просп. Мануйлівський (Воронцова)", "lat": 48.4850, "lng": 35.0500},
    {"keys": ["сонячн", "солнечн", "малиновск", "малиновськ"], "addr": "ж/м Сонячний (Набережна Сонячна)", "lat": 48.4750, "lng": 35.0650},
    {"keys": ["косиор", "косіор", "калнишевск", "калнишевськ"], "addr": "просп. Петра Калнишевського (Косіора)", "lat": 48.5080, "lng": 35.0750},
    {"keys": ["калинов"], "addr": "вул. Калинова", "lat": 48.5080, "lng": 35.0550},
    {"keys": ["донецк.*шоссе", "донецьк.*шосе", "дш", "караван"], "addr": "Донецьке шосе (Караван)", "lat": 48.5350, "lng": 34.9900},
    {"keys": ["левобереж", "лівобереж"], "addr": "ж/м Лівобережний", "lat": 48.5300, "lng": 35.0100},
    {"keys": ["фрунзенск", "фрунзенськ", "ломовск", "ломівськ"], "addr": "ж/м Ломівський (Фрунзенський)", "lat": 48.5050, "lng": 34.9750},
    {"keys": ["придніпр", "придник"], "addr": "ж/м Придніпровськ", "lat": 48.3980, "lng": 35.1320}
]

def sync_cloud_knowledge_and_spam():
    global CUSTOM_STREETS_CACHE, DYNAMIC_SPAM_WORDS, LAST_CLOUD_SYNC
    if time.time() - LAST_CLOUD_SYNC < 45:
        return

    if not BASE_FB_URL:
        return

    try:
        if CUSTOM_STREETS_URL:
            r_streets = requests.get(f"{CUSTOM_STREETS_URL}?t={int(time.time()*1000)}", timeout=5)
            if r_streets.status_code == 200 and r_streets.json():
                CUSTOM_STREETS_CACHE = r_streets.json()

        if SPAM_FILTERS_URL:
            r_spam = requests.get(f"{SPAM_FILTERS_URL}?t={int(time.time()*1000)}", timeout=5)
            if r_spam.status_code == 200 and r_spam.json():
                words = set()
                for val in r_spam.json().values():
                    if isinstance(val, str) and len(val.strip()) >= 2:
                        words.add(val.strip().lower())
                DYNAMIC_SPAM_WORDS = words

        LAST_CLOUD_SYNC = time.time()
    except Exception as e:
        log(f"⚠️ Помилка синхронізації з хмарою знань: {e}")

def geocode_local(text):
    t = " " + text.lower() + " "

    for raw_alias, data in CUSTOM_STREETS_CACHE.items():
        if isinstance(data, dict):
            alias = unquote(raw_alias).lower()
            if alias in t:
                return data.get("name", alias), data.get("lat"), data.get("lng")

    sorted_items = sorted(
        LOCAL_STREETS_DB,
        key=lambda item: max(len(k) for k in item["keys"]),
        reverse=True
    )

    for item in sorted_items:
        for k in item["keys"]:
            pattern = re.compile(k, re.IGNORECASE)
            if pattern.search(t):
                return item["addr"], item["lat"], item["lng"]

    return None, None, None

def geocode_osm_fallback(text):
    clean = re.sub(r'(?:чисто|пусто|вільно|спокійно|бп|блокпост|патруль|роздають|хмари|сині|дощ|сонце|сонечко|🌞|☀️)\b', '', text, flags=re.I).strip()
    words = [w for w in re.split(r'[,+\n/]', clean) if len(w.strip()) >= 4]
    if not words:
        words = [clean]

    for w in words[:2]:
        query = w.strip()
        if len(query) < 4:
            continue
        try:
            url = f"https://nominatim.openstreetmap.org/search?format=json&q={requests.utils.quote(query + ', Дніпро')}&countrycodes=ua&limit=1"
            headers = {"User-Agent": "DniproRadarMap/3.9"}
            r = requests.get(url, headers=headers, timeout=5)
            if r.status_code == 200:
                data = r.json()
                if data and len(data) > 0:
                    lat = float(data[0]["lat"])
                    lng = float(data[0]["lon"])
                    if 48.25 <= lat <= 48.70 and 34.70 <= lng <= 35.40:
                        name = data[0].get("display_name", query).split(",")[0]
                        return f"вул. {name}", round(lat, 5), round(lng, 5)
        except Exception:
            pass
    return None, None, None

CLEAN_KEYWORDS = [
    "чисто", "чистенько", "пусто", "вільно", "спокійно", "проїзд",
    "без бп", "сонечко", "солнечно", "солнце", "ясно", "сухо",
    "знялися", "пролітайте", "все чисто", "зелено", "🌞", "☀️", "🌤️"
]

NEGATION_WORDS = [
    "нет", "немає", "убрали", "прибрали", "сняли", "зняли",
    "поехали", "поїхали", "уехали", "пропали", "чисто", "немає вже"
]

DANGER_KEYWORDS = [
    "мент", "полиц", "поліц", "бп", "блокпост", "патруль",
    "тормоз", "стоят", "облав", "тцк", "бусик", "мусор", "зупиня", "шмонал"
]

def is_message_clean(text):
    t = text.lower()
    has_danger = any(w in t for w in DANGER_KEYWORDS)
    has_negation = any(nw in t for nw in NEGATION_WORDS)

    if has_danger:
        if has_negation:
            return True
        return False

    for kw in CLEAN_KEYWORDS:
        if kw in t and "не чисто" not in t and "не пусто" not in t:
            return True
    return False

def get_knowledge_base():
    if not KNOWLEDGE_BASE_URL:
        return []
    try:
        r = requests.get(f"{KNOWLEDGE_BASE_URL}?t={int(time.time() * 1000)}", timeout=8)
        if r.status_code == 200 and r.json():
            data = r.json()
            if isinstance(data, dict):
                return [v for v in data.values() if isinstance(v, dict)]
            elif isinstance(data, list):
                return [x for x in data if isinstance(x, dict)]
    except Exception:
        pass
    return []

def match_knowledge_base(text, kb_list):
    t = text.lower()
    for item in kb_list:
        phrase = item.get("phrase", "").strip().lower()
        if phrase and len(phrase) >= 3 and phrase in t:
            lat = item.get("lat")
            lng = item.get("lng")
            if lat is not None and lng is not None:
                try:
                    float(lat)
                    float(lng)
                    return item
                except (ValueError, TypeError):
                    pass
    return None

def auto_save_to_knowledge_base(phrase, address, lat, lng):
    """Шаг 4: Автообучение — сохраняем распознанную фразу в Firebase"""
    if not KNOWLEDGE_BASE_URL or not phrase or not address or not lat or not lng:
        return
    try:
        clean_key = re.sub(r'[^a-zA-Z0-9а-яА-ЯіїєґІЇЄҐ_]', '_', phrase.strip().lower())[:40]
        data = {
            "phrase": phrase.strip().lower(),
            "address": address,
            "lat": lat,
            "lng": lng,
            "time": int(time.time() * 1000)
        }
        requests.put(f"{BASE_FB_URL}/knowledge_base/{clean_key}.json", json=data, timeout=5)
        log(f"💾 [АВТО-НАВЧАННЯ]: '{phrase}' ➔ {address} збережено в базу знань!")
    except Exception as e:
        log(f"⚠️ Помилка авто-навчання бази знань: {e}")

def cleanup_old_points():
    now_ms = int(time.time() * 1000)
    if not POINTS_URL:
        return

    try:
        r = requests.get(POINTS_URL, timeout=8)
        if r.status_code == 200 and r.json():
            data = r.json()
            to_delete = {}
            for k, v in data.items():
                if isinstance(v, dict):
                    full_txt = (v.get("text", "") + " " + v.get("raw_text", "")).lower()
                    point_time = v.get("time") or v.get("timestamp") or 0
                    if (now_ms - point_time) > LIFETIME_MS or is_ad_or_spam(full_txt):
                        to_delete[k] = None
            if to_delete:
                requests.patch(POINTS_URL, json=to_delete, timeout=8)
                log(f"🧹 Видалено міток (застарілих або спам): {len(to_delete)}")
    except Exception as e:
        log(f"⚠️ Помилка очищення Firebase: {e}")

def fetch_channel_messages():
    timestamp_param = int(time.time())
    url = f"{CHANNEL_BASE_URL}?t={timestamp_param}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0"
    }

    try:
        r = requests.get(url, headers=headers, timeout=12)
        if r.status_code != 200:
            return []

        pattern = re.compile(
            r'data-post="[^/]+/(\d+)"[^>]*>.*?<div class="tgme_widget_message_text[^"]*"[^>]*>(.*?)</div>',
            re.DOTALL
        )
        matches = pattern.findall(r.text)

        results = []
        for post_id, raw_html in matches:
            clean = re.sub(r'<br\s*/?>', '\n', raw_html)
            clean = re.sub(r'<[^>]+>', '', clean)
            clean = clean.replace('&quot;', '"').replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>').strip()

            if is_ad_or_spam(clean):
                continue

            lines = [l.strip() for l in clean.split('\n') if len(l.strip()) >= 3]
            for line in lines:
                if not is_ad_or_spam(line):
                    results.append((post_id, line))

        return results
    except Exception as e:
        log(f"⚠️ Помилка зчитування Telegram: {e}")
        return []

# =========================================================================
# 🚀 ШАГ 1: ПАКЕТНЫЙ ЗАПРОС В GEMINI (ОДИН ЗАПРОС НА ВСЕ СООБЩЕНИЯ)
# =========================================================================
def parse_batch_with_gemini(items_to_parse):
    """
    Отправляет весь список нераспознанных сообщений одним пакетом (JSON)
    items_to_parse: [{'id': 0, 'text': '...'}, ...]
    """
    if not items_to_parse or not GEMINI_KEYS:
        return {}

    formatted_items = [{"id": it["id"], "text": it["text"]} for it in items_to_parse]

    prompt = f"""
Ти — точний гео-аналітик міста Дніпро (Україна).
Ось JSON-список коротких повідомлень водіїв про ситуацію на дорогах:
{json.dumps(formatted_items, ensure_ascii=False)}

Для КОЖНОГО елемента визнач локацію в Дніпрі (вулиця, проспект, район або орієнтир):
Поверни строго JSON-масив:
[
  {{"id": 0, "found": true, "address": "вул. ...", "lat": 48.45, "lng": 35.01, "status": "чисто"|"опасно"}},
  {{"id": 1, "found": false}}
]
Координати мають бути строго в межах Дніпра: lat (48.25 - 48.70), lng (34.70 - 35.40).
Не пиши нічого зайвого, тільки валідний чистий JSON.
"""

    total_keys = len(GEMINI_KEYS)
    for attempt in range(total_keys):
        active_key = get_active_gemini_key()
        for model in SUPPORTED_MODELS:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={active_key}"
            try:
                r = requests.post(
                    url,
                    json={
                        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                        "generationConfig": {"temperature": 0.1, "responseMimeType": "application/json"}
                    },
                    timeout=6  # Жесткий тайм-аут: не ждем минутами
                )

                if r.status_code == 200:
                    raw = r.json().get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                    raw = raw.replace("```json", "").replace("```", "").strip()
                    data_list = json.loads(raw)
                    if isinstance(data_list, list):
                        result_map = {}
                        for res in data_list:
                            if isinstance(res, dict) and "id" in res:
                                result_map[res["id"]] = res
                        log(f"📦 [GEMINI BATCH]: Успішно оброблено пакет із {len(result_map)} точок за 1 запит!")
                        return result_map
                    return {}
                elif r.status_code in [429, 403]:
                    rotate_to_next_key()
                    break
            except requests.exceptions.Timeout:
                log(f"⏱️ Таймаут на ключі #{current_key_index + 1}, миттєве перемикання...")
                rotate_to_next_key()
                break
            except Exception:
                rotate_to_next_key()
                break

    return {}

# =========================================================================
# 🔄 ОСНОВНОЙ ЦИКЛ СИНХРОНИЗАЦИИ
# =========================================================================
def sync_cycle():
    global PROCESSED_POST_IDS
    cleanup_old_points()
    sync_cloud_knowledge_and_spam()

    kb_list = get_knowledge_base()
    items = fetch_channel_messages()

    if not items:
        return

    new_items = []
    for post_id, text in items:
        unique_key = f"{post_id}_{text.lower()}"
        if unique_key not in PROCESSED_POST_IDS:
            new_items.append((unique_key, text))

    log(f"📢 В каналі: {len(items)} | Нових: {len(new_items)} | В базі знань: {len(kb_list)} | Хмарних правил: {len(CUSTOM_STREETS_CACHE)} | Спам-фільтрів: {len(DYNAMIC_SPAM_WORDS)}")

    if not new_items:
        return

    now_ms = int(time.time() * 1000)

    # 1. Быстрый локальный проход (Локальная база, База знаний, OSM)
    items_to_process = []
    gemini_queue = []

    for idx, (unique_key, msg) in enumerate(new_items):
        PROCESSED_POST_IDS.add(unique_key)

        if is_ad_or_spam(msg):
            log(f"🚫 [РЕКЛАМА/СПАМ ПРОПУЩЕНО]: '{msg[:45]}'")
            continue

        is_clean = is_message_clean(msg)
        parsed_result = None

        # Проверка локальных участков
        addr, lat, lng = geocode_local(msg)
        if addr and lat and lng:
            parsed_result = {
                "address": addr,
                "lat": round(float(lat), 5),
                "lng": round(float(lng), 5),
                "status": "чисто" if is_clean else "опасно",
                "needs_training": False
            }
            log(f"⚡ [ЛОКАЛЬНО / ДІЛЯНКА]: '{msg[:45]}' ➔ {addr}")

        # Проверка базы знаний
        if not parsed_result:
            matched_kb = match_knowledge_base(msg, kb_list)
            if matched_kb and matched_kb.get("lat") and matched_kb.get("lng"):
                parsed_result = {
                    "address": matched_kb.get("address") or matched_kb.get("phrase"),
                    "lat": float(matched_kb["lat"]),
                    "lng": float(matched_kb["lng"]),
                    "status": "чисто" if is_clean else "опасно",
                    "needs_training": False
                }
                log(f"🎯 [БАЗА ЗНАНЬ]: '{matched_kb.get('phrase')}' ➔ {parsed_result['address']}")

        # Резерв OpenStreetMap
        if not parsed_result:
            osm_addr, osm_lat, osm_lng = geocode_osm_fallback(msg)
            if osm_addr and osm_lat and osm_lng:
                parsed_result = {
                    "address": osm_addr,
                    "lat": osm_lat,
                    "lng": osm_lng,
                    "status": "чисто" if is_clean else "опасно",
                    "needs_training": False
                }
                log(f"🗺️ [OSM КАРТА]: '{msg[:45]}' ➔ {osm_addr}")

        item_ctx = {
            "id": idx,
            "msg": msg,
            "is_clean": is_clean,
            "parsed_result": parsed_result
        }
        items_to_process.append(item_ctx)

        # Если локально не определили — ставим в очередь на пакет Gemini
        if not parsed_result:
            gemini_queue.append({"id": idx, "text": msg})

    # 2. Если есть нераспознанные — выполняем РОВНО ОДИН пакетный запрос в Gemini
    if gemini_queue:
        log(f"🚀 Відправка пакету з {len(gemini_queue)} повідомлень до Gemini...")
        batch_results = parse_batch_with_gemini(gemini_queue)
        
        for item_ctx in items_to_process:
            if not item_ctx["parsed_result"] and item_ctx["id"] in batch_results:
                res = batch_results[item_ctx["id"]]
                if res.get("found") and res.get("lat") and res.get("lng"):
                    lat = float(res["lat"])
                    lng = float(res["lng"])
                    if 48.25 <= lat <= 48.70 and 34.70 <= lng <= 35.40:
                        addr = res.get("address", "Дніпро")
                        item_ctx["parsed_result"] = {
                            "address": addr,
                            "lat": round(lat, 5),
                            "lng": round(lng, 5),
                            "status": res.get("status", "опасно"),
                            "needs_training": False
                        }
                        log(f"🤖 [GEMINI AI]: '{item_ctx['msg'][:45]}' ➔ {addr}")
                        # Шаг 4: Сразу обучаем базу знаний
                        auto_save_to_knowledge_base(item_ctx["msg"], addr, round(lat, 5), round(lng, 5))

    # 3. Финальная сборка и отправка в Firebase
    for item_ctx in items_to_process:
        msg = item_ctx["msg"]
        is_clean = item_ctx["is_clean"]
        parsed_result = item_ctx["parsed_result"]

        if not parsed_result:
            water_lat = round(48.5020 + random.uniform(-0.0040, 0.0040), 5)
            water_lng = round(34.9280 + random.uniform(-0.0060, 0.0060), 5)
            parsed_result = {
                "address": "Потребує навчання (натисніть та перетягніть з річки)",
                "lat": water_lat,
                "lng": water_lng,
                "status": "чисто" if is_clean else "опасно",
                "needs_training": True
            }
            log(f"🌊 [НАВЧАННЯ / НА ВОДУ]: '{msg[:45]}'")

        status_clean = (parsed_result["status"] == "чисто" or is_clean)
        color = "green" if status_clean else "red"
        display_text = msg
        if status_clean and "чисто" not in msg.lower():
            display_text = f"{msg} (чисто)"

        point_data = {
            "text": display_text,
            "raw_text": msg,
            "address": parsed_result["address"],
            "lat": parsed_result["lat"],
            "lng": parsed_result["lng"],
            "color": color,
            "status": "чисто" if status_clean else "опасно",
            "is_clean": status_clean,
            "needs_training": parsed_result.get("needs_training", False),
            "time": now_ms,
            "timestamp": now_ms
        }

        if POINTS_URL:
            try:
                requests.post(POINTS_URL, json=point_data, timeout=8)
            except Exception as e:
                log(f"⚠️ Помилка запису в Firebase: {e}")

        if STATS_ARCHIVE_URL:
            try:
                archive_entry = {
                    "text": msg,
                    "address": parsed_result["address"],
                    "lat": parsed_result["lat"],
                    "lng": parsed_result["lng"],
                    "is_clean": status_clean,
                    "time": now_ms
                }
                requests.post(STATS_ARCHIVE_URL, json=archive_entry, timeout=8)
            except Exception:
                pass

if __name__ == "__main__":
    log(f"🚀 Запуск оновленого радара 24/7 v3.9 (Завантажено {len(GEMINI_KEYS)} API ключів)...")
    start_time = time.time()
    MAX_RUNTIME_SEC = 5 * 3600 + 40 * 60

    while (time.time() - start_time) < MAX_RUNTIME_SEC:
        try:
            sync_cycle()
        except Exception as e:
            log(f"⚠️ Помилка в циклі: {e}")
        time.sleep(20)
