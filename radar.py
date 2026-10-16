import os
import re
import json
import time
import random
import requests
from urllib.parse import unquote

# =========================================================================
# ⚙️ НАЛАШТУВАННЯ ТА API КЛЮЧІ GEMINI
# =========================================================================
RAW_GEMINI_KEYS = os.environ.get("GEMINI_KEY", "").strip() or os.environ.get("GEMINI_KEYS", "").strip()
GEMINI_KEYS = [k.strip() for k in re.split(r'[,;\s]+', RAW_GEMINI_KEYS) if len(k.strip()) > 15]

current_key_index = 0
# Пріоритетна зв'язка моделей: надшвидкий Lite -> потужний 3.8 Flash -> резервний 3.5 Flash
SUPPORTED_MODELS = ["gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3.5-flash"]

# Базовий URL Firebase Realtime Database
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

LIFETIME_MS = 40 * 60 * 1000  # 40 хвилин для актуальних міток
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
# 🚫 ФІЛЬТРАЦІЯ СПАМУ ТА РЕКЛАМИ
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
# 📍 БАЗА ТОПОНІМІВ ДНІПРА
# =========================================================================
LOCAL_STREETS_DB = [
    {"keys": ["славянк", "словянк"], "addr": "ТЦ Слов'янський (Слов'янка)", "lat": 48.4715, "lng": 35.0135},
    {"keys": ["озерк"], "addr": "Ринок Озерка", "lat": 48.4715, "lng": 35.0215},
    {"keys": ["курчатовск.*рынок", "курчатовськ.*ринок", "курчатовск", "курчатовськ", "128.*бригад"], "addr": "вул. 128-ї Бригади (Курчатовський)", "lat": 48.4740, "lng": 35.0140},
    {"keys": ["жд.*вокзал", "залізничн.*вокзал", "вокзал", "вокзалы", "вокзали"], "addr": "пл. Вокзальна (Центральний Вокзал)", "lat": 48.4760, "lng": 35.0160},
    {"keys": ["автовокзал"], "addr": "Центральний Автовокзал (вул. Курчатова)", "lat": 48.4735, "lng": 35.0100},
    {"keys": ["південн.*вокзал", "южн.*вокзал"], "addr": "Південний вокзал (вул. Лоцманська)", "lat": 48.4390, "lng": 35.0800},
    {"keys": ["старомостов", "островськ", "островск"], "addr": "пл. Старомостова (Островського)", "lat": 48.4770, "lng": 35.0220},

    {"keys": ["парус.*стрилиц", "парус.*стрелиц", "стрилиц", "стрелиц"], "addr": "ж/м Парус (Стрелиця / коса)", "lat": 48.4870, "lng": 34.9120},
    {"keys": ["трофимов", "трофімов"], "addr": "вул. Велика Діївська (Братів Трофімових)", "lat": 48.4840, "lng": 34.9180},
    {"keys": ["диевк", "діївк", "диевка 1", "диевка 2", "діївська"], "addr": "ж/м Діївка", "lat": 48.4810, "lng": 34.8980},
    {"keys": ["парус"], "addr": "ж/м Парус", "lat": 48.4840, "lng": 34.9180},
    {"keys": ["комунарівськ", "коммунаровск", "кондратюк"], "addr": "вул. Юрія Кондратюка (Комунарівська)", "lat": 48.4820, "lng": 34.9350},
    {"keys": ["покровськ", "покровск", "комунар", "коммунар"], "addr": "ж/м Покровський (Комунар)", "lat": 48.4820, "lng": 34.9380},
    {"keys": ["червон.*кам", "красный камень"], "addr": "ж/м Червоний Камінь", "lat": 48.4830, "lng": 34.9520},
    {"keys": ["західн", "западн"], "addr": "ж/м Західний", "lat": 48.4650, "lng": 34.9350},

    {"keys": ["космичк", "космічк", "космическ", "космічн"], "addr": "вул. Космічна", "lat": 48.4180, "lng": 35.0450},
    {"keys": ["низ космическ", "низ космічн", "низ космичк"], "addr": "вул. Космічна (Низ, Набережна)", "lat": 48.4240, "lng": 35.0740},
    {"keys": ["верх космическ", "верх космічн", "верх космичк"], "addr": "вул. Космічна (Верх, Запорізьке шосе)", "lat": 48.4060, "lng": 35.0410},
    {"keys": ["тещин.*язик", "тещин.*язык"], "addr": "Тьощин язик (вул. Космічна)", "lat": 48.4140, "lng": 35.0510},
    {"keys": ["высоковольтн.*ям", "високовольтн.*ям", "высоковольтн", "високовольтн"], "addr": "вул. Високовольтна (р-н Ями / Гагаріна)", "lat": 48.4270, "lng": 35.0450},

    {"keys": ["шинн", "шинная"], "addr": "вул. Шинна", "lat": 48.4180, "lng": 35.0150},
    {"keys": ["мирный", "мирний", "пос.*мирн"], "addr": "пос. Мирний (Сурсько-Литовське шосе)", "lat": 48.3980, "lng": 34.9850},
    {"keys": ["переезд.*мирн", "переїзд.*мирн"], "addr": "Переїзд Мирний (Краснопілля)", "lat": 48.3980, "lng": 34.9850},
    {"keys": ["12.*квартал", "12 квартал", "квартал"], "addr": "12 Квартал (просп. Б. Хмельницького)", "lat": 48.4120, "lng": 35.0150},
    {"keys": ["кротов", "гальченк"], "addr": "вул. Бориса Кротова / Гальченка", "lat": 48.4030, "lng": 35.0060},

    {"keys": ["остров.*слобожан", "острова.*правд", "остров", "острови"], "addr": "ж/м Смарагдовий (Острови, Слобожанське)", "lat": 48.5320, "lng": 35.0850},
    {"keys": ["слобожанск", "слобожанськ", "правд"], "addr": "просп. Слобожанський (Правди)", "lat": 48.5000, "lng": 35.0680},
    {"keys": ["бык", "бик"], "addr": "Пост «Бик» (Підгородне)", "lat": 48.5350, "lng": 35.1020},
    {"keys": ["золоті ключі", "золотые ключи"], "addr": "Золоті Ключі (Слобожанське)", "lat": 48.5280, "lng": 35.0920},
    {"keys": ["калинов"], "addr": "вул. Калинова", "lat": 48.5080, "lng": 35.0550},
    {"keys": ["донецк.*шоссе", "донецьк.*шосе", "дш", "караван"], "addr": "Донецьке шосе (Караван)", "lat": 48.5350, "lng": 34.9900},
    {"keys": ["левобереж", "лівобереж"], "addr": "ж/м Лівобережний", "lat": 48.5300, "lng": 35.0100},
    {"keys": ["фрунзенск", "фрунзенськ", "ломовск", "ломівськ"], "addr": "ж/м Ломівський (Фрунзенський)", "lat": 48.5050, "lng": 34.9750},
    {"keys": ["берегов"], "addr": "вул. Берегова (АНД)", "lat": 48.4980, "lng": 35.0250},
    {"keys": ["отечествен", "вітчизнян"], "addr": "вул. Вітчизняна (АНД)", "lat": 48.5050, "lng": 35.0350},
    {"keys": ["гринченк"], "addr": "вул. Миколи Грінченка", "lat": 48.5020, "lng": 35.0420},

    {"keys": ["низ киров", "низ кіров", "низ поля"], "addr": "просп. Олександра Поля (Низ, сквер Героїв)", "lat": 48.4610, "lng": 35.0310},
    {"keys": ["середина киров", "середина кіров", "середина поля"], "addr": "просп. Олександра Поля (Середина, Славутич)", "lat": 48.4480, "lng": 35.0240},
    {"keys": ["верх киров", "верх кіров", "верх поля"], "addr": "просп. Олександра Поля (Верх, Титова)", "lat": 48.4340, "lng": 35.0160},
    {"keys": ["поля", "кіров", "киров"], "addr": "просп. Олександра Поля (Кірова)", "lat": 48.4480, "lng": 35.0240},
    {"keys": ["низ рабоч", "низ робоч"], "addr": "вул. Робоча (Низ, р-н Нігояна)", "lat": 48.4680, "lng": 35.0110},
    {"keys": ["середина рабоч", "середина робоч"], "addr": "вул. Робоча (Середина, Театральна)", "lat": 48.4520, "lng": 35.0090},
    {"keys": ["верх рабоч", "верх робоч"], "addr": "вул. Робоча (Верх, Метеор / ЮМЗ)", "lat": 48.4385, "lng": 35.0065},
    {"keys": ["робоч", "рабоч"], "addr": "вул. Робоча", "lat": 48.4480, "lng": 35.0080},
    {"keys": ["низ науки", "низ гагарин", "низ гагарін"], "addr": "просп. Науки (Низ, Нагірка)", "lat": 48.4510, "lng": 35.0590},
    {"keys": ["середина науки", "середина гагарин", "середина гагарін"], "addr": "просп. Науки (Середина, ДІІТ / Казакова)", "lat": 48.4350, "lng": 35.0420},
    {"keys": ["верх науки", "верх гагарин", "верх гагарін"], "addr": "просп. Науки (Верх, Підстанція / Дафі)", "lat": 48.4230, "lng": 35.0320},
    {"keys": ["гагарин", "гагарін", "науки"], "addr": "просp. Науки (Гагаріна)", "lat": 48.4350, "lng": 35.0420},
    {"keys": ["підстанці", "подстанци", "дафі", "дафи"], "addr": "Підстанція (ТРЦ Дафі)", "lat": 48.4250, "lng": 35.0220},
    {"keys": ["титов", "независимост", "незалежност"], "addr": "вул. Незалежності (Титова)", "lat": 48.4340, "lng": 35.0150},
    {"keys": ["карла маркс", "яворниц", "яворницьк"], "addr": "просп. Дмитра Яворницького (К. Маркса)", "lat": 48.4650, "lng": 35.0350},
    {"keys": ["артем", "січов", "сечевых"], "addr": "вул. Січових Стрільців (Артема)", "lat": 48.4550, "lng": 35.0420},
    {"keys": ["савченк", "черновол", "чорновол"], "addr": "вул. В'ячеслава Чорновола (Савченка)", "lat": 48.4550, "lng": 35.0180},
    {"keys": ["павлов"], "addr": "вул. Академіка Павлова", "lat": 48.4818, "lng": 35.0012},
    {"keys": ["речпорт", "річпорт"], "addr": "Річпорт (Набережна Заводська)", "lat": 48.4805, "lng": 35.0210},
    {"keys": ["водокачк"], "addr": "Водокачка (Набережна Заводська)", "lat": 48.4910, "lng": 34.9480},
    {"keys": ["кайдак", "з'їзд.*кайдак"], "addr": "Кайдацький міст / з'їзд", "lat": 48.4925, "lng": 34.9625},
    {"keys": ["качка"], "addr": "вул. Каруни (Качка / з'їзд)", "lat": 48.4960, "lng": 35.0480},
    {"keys": ["боровск", "молодогвард"], "addr": "вул. Молодогвардійська (під мостами)", "lat": 48.4680, "lng": 35.1220}
]

# Правила фільтрації по емодзі та статусах
QUESTION_EMOJIS = ['?', '❓', '❔', '⁉️', '🤔', '🧐', '🙏']
CLOUD_PRECIP_EMOJIS = ['🌤️', '⛅', '🌥️', '🌦️', '☁️', '🌧️', '⛈️', '🌩️', '🌨️', '🌪️', '🌫️', '☔', '💧', '💦']
SUN_ONLY_EMOJIS = ['☀️', '🌞', '🌈']

CLEAN_KEYWORDS = [
    "чисто", "чистенько", "пусто", "вільно", "спокійно", "спокойно", "проїзд",
    "без бп", "ясно", "сухо", "знялися", "пролітайте", "все чисто", "зелено",
    "норм", "нормально", "нормик", "все норм", "всё норм"
]

CLEAN_REGEX = re.compile(
    r'(?:\b(?:чисто|чистенько|пусто|вільно|спокійно|спокойно|проїзд|ясно|сухо|знялися|пролітайте|зелено|норм|нормально|нормик)\b|без\s*бп|все\s*чисто|все\s*норм|всё\s*норм)',
    re.IGNORECASE
)

CLEAN_NEGATION_REGEX = re.compile(
    r'(?:не\s*норм|не\s*чисто|не\s*пусто|не\s*спок|не\s*тихо)',
    re.IGNORECASE
)

NEGATION_WORDS = [
    "нет", "немає", "убрали", "прибрали", "сняли", "зняли",
    "поехали", "поїхали", "уехали", "пропали", "немає вже"
]

DANGER_KEYWORDS = [
    "мент", "полиц", "поліц", "бп", "блокпост", "патруль",
    "тормоз", "стоят", "облав", "тцк", "бусик", "мусор", "зупиня", "шмонал"
]

def is_ignored_question(text):
    """Ігнор-лист для питань і сумнівів."""
    return any(q in text for q in QUESTION_EMOJIS)

def is_message_clean(text):
    """
    - Зелена зона: сонце або слова чистоти/норми (якщо немає заперечень).
    - Червона зона: хмари, опади або небезпечні ключові слова.
    """
    t = text.lower()
    
    # 1. Знаки питань / сумніви — ігноруємо
    if is_ignored_question(text):
        return None

    # 2. Перевіряємо небезпечні фактори (хмари, опади, небезпечні слова)
    has_danger_words = any(w in t for w in DANGER_KEYWORDS)
    has_cloud_or_precip = any(ce in text for ce in CLOUD_PRECIP_EMOJIS)
    
    if has_danger_words or has_cloud_or_precip:
        has_negation = any(nw in t for nw in NEGATION_WORDS)
        if has_danger_words and has_negation:
            return True
        return False

    # 3. Перевіряємо зелену зону ("норм", "чисто", сонце)
    has_pure_sun = any(se in text for se in SUN_ONLY_EMOJIS)
    has_clean_word = bool(CLEAN_REGEX.search(t))

    if has_pure_sun or has_clean_word:
        if not CLEAN_NEGATION_REGEX.search(t):
            return True

    return False

# =========================================================================
# 🔄 РОЗУМНИЙ БАГАТОРАДКОВИЙ ПАРСИНГ
# =========================================================================
def split_multiline_reports(raw_post_text):
    if not raw_post_text:
        return []

    lines = [l.strip() for l in raw_post_text.split('\n') if l.strip()]
    if not lines:
        return []

    if len(lines) == 1:
        return [raw_post_text.strip()]

    parsed_reports = []
    first_clean = is_message_clean(lines[0])
    fallback_status = "чисто" if first_clean is True else None

    for line in lines:
        if is_ad_or_spam(line) or len(line) < 3:
            continue

        clean_line = re.sub(r'^\d{1,2}[:.]\d{2}\s*', '', line).strip()
        if not clean_line or len(clean_line) < 3:
            continue

        if is_ignored_question(clean_line):
            continue

        stripped_status = re.sub(r'(?:' + '|'.join(CLEAN_KEYWORDS) + r')\b', '', clean_line, flags=re.I).strip(' .,!?:;-')
        if len(stripped_status) < 3:
            continue

        has_local_clean = is_message_clean(clean_line)
        has_local_danger = any(w in clean_line.lower() for w in DANGER_KEYWORDS) or any(ce in clean_line for ce in CLOUD_PRECIP_EMOJIS)
        if has_local_clean is False and not has_local_danger and fallback_status:
            clean_line = f"{clean_line} {fallback_status}"

        parsed_reports.append(clean_line)

    return parsed_reports if parsed_reports else [raw_post_text.strip()]

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
    clean_t = text.lower().replace('ё', 'е')
    t = " " + clean_t + " "

    for raw_alias, data in CUSTOM_STREETS_CACHE.items():
        if isinstance(data, dict):
            alias = unquote(raw_alias).lower().replace('ё', 'е')
            if alias in t:
                return data.get("name", alias), data.get("lat"), data.get("lng")

    sorted_items = sorted(
        LOCAL_STREETS_DB,
        key=lambda item: max(len(k) for k in item["keys"]),
        reverse=True
    )

    for item in sorted_items:
        for k in item["keys"]:
            pattern = re.compile(k.replace('ё', 'е'), re.IGNORECASE)
            if pattern.search(t):
                return item["addr"], item["lat"], item["lng"]

    return None, None, None

def geocode_osm_fallback(text):
    clean = re.sub(r'(?:чисто|пусто|вільно|спокійно|спокойно|норм|нормально|бп|блокпост|патруль|роздають|хмари|сині|дощ|сонце|сонечко|🌞|☀️)\b', '', text, flags=re.I).strip()
    words = [w for w in re.split(r'[,+\n/]', clean) if len(w.strip()) >= 4]
    if not words:
        words = [clean]

    for w in words[:2]:
        query = w.strip()
        if len(query) < 4:
            continue
        try:
            url = f"https://nominatim.openstreetmap.org/search?format=json&q={requests.utils.quote(query + ', Дніпро')}&countrycodes=ua&limit=1"
            headers = {"User-Agent": "DniproRadarMap/4.0"}
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
    t = text.lower().replace('ё', 'е')
    for item in kb_list:
        phrase = item.get("phrase", "").strip().lower().replace('ё', 'е')
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

            if is_ad_or_spam(clean) or is_ignored_question(clean):
                continue

            sub_reports = split_multiline_reports(clean)
            for idx, report_line in enumerate(sub_reports):
                if not is_ad_or_spam(report_line) and not is_ignored_question(report_line):
                    sub_post_id = f"{post_id}_{idx}" if len(sub_reports) > 1 else post_id
                    results.append((sub_post_id, report_line))

        return results
    except Exception as e:
        log(f"⚠️ Помилка зчитування Telegram: {e}")
        return []

def parse_batch_with_gemini(items_to_parse):
    if not items_to_parse or not GEMINI_KEYS:
        return {}

    formatted_items = [{"id": it["id"], "text": it["text"]} for it in items_to_parse]

    prompt = f"""
Ти — точний гео-аналітик міста Дніпро (Україна).
Визнач координати та адресу в Дніпрі для повідомлень:
{json.dumps(formatted_items, ensure_ascii=False)}

Відповідай ВИКЛЮЧНО JSON-масивом:
[
  {{"id": 0, "found": true, "address": "вул. ...", "lat": 48.45, "lng": 35.01, "status": "чисто"|"опасно"}},
  {{"id": 1, "found": false}}
]
Координати строго в межах Дніпра (lat: 48.25-48.70, lng: 34.70-35.40).
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
                    timeout=10
                )

                if r.status_code == 200:
                    raw = r.json().get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                    raw = raw.replace("```json", "").replace("```", "").strip()
                    data_list = json.loads(raw)
                    if isinstance(data_list, list):
                        result_map = {res["id"]: res for res in data_list if isinstance(res, dict) and "id" in res}
                        log(f"📦 [GEMINI BATCH]: Успішно розпізнано пакет із {len(result_map)} точок за допомогою {model}!")
                        return result_map
                elif r.status_code in [429, 403]:
                    rotate_to_next_key()
                    break
            except requests.exceptions.Timeout:
                log(f"⏱️ Таймаут на ключі #{current_key_index + 1}, перемикання...")
                rotate_to_next_key()
                break
            except Exception:
                rotate_to_next_key()
                break

    return {}

def save_point_to_firebase(msg, parsed_result, is_clean, now_ms):
    status_clean = (parsed_result["status"] == "чисто" or is_clean is True)
    color = "green" if status_clean else "red"
    display_text = msg
    
    if status_clean and not re.search(r'\b(?:чисто|норм|нормально)\b', msg, re.I):
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
    unresolved_queue = []

    # 1. Локальний прохід
    for unique_key, msg in new_items:
        PROCESSED_POST_IDS.add(unique_key)

        if is_ad_or_spam(msg) or is_ignored_question(msg):
            log(f"🚫 [СПАМ / ПИТАННЯ ПРОПУЩЕНО]: '{msg[:45]}'")
            continue

        is_clean = is_message_clean(msg)
        if is_clean is None:
            continue  # Пропускаємо питання (ігнор-лист)

        parsed_result = None

        # Локальна база
        addr, lat, lng = geocode_local(msg)
        if addr and lat and lng:
            parsed_result = {
                "address": addr,
                "lat": round(float(lat), 5),
                "lng": round(float(lng), 5),
                "status": "чисто" if is_clean else "опасно",
                "needs_training": False
            }
            log(f"⚡ [ЛОКАЛЬНО / ДІЛЯНКА]: '{msg[:45]}' ➔ {addr} ({'ЗЕЛЕНА' if is_clean else 'ЧЕРВОНА'})")

        # База знань Firebase
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

        # OpenStreetMap
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

        # Зберігаємо знайдені точки
        if parsed_result:
            save_point_to_firebase(msg, parsed_result, is_clean, now_ms)
        else:
            unresolved_queue.append((msg, is_clean))

    # 2. Невідомі — пакетом до Gemini
    if unresolved_queue:
        gemini_items = [{"id": i, "text": item[0]} for i, item in enumerate(unresolved_queue)]
        log(f"🚀 Відправка пакету з {len(gemini_items)} невідомих точок до Gemini...")
        batch_results = parse_batch_with_gemini(gemini_items)

        for i, (msg, is_clean) in enumerate(unresolved_queue):
            ai_data = batch_results.get(i)
            parsed_result = None

            if ai_data and ai_data.get("found") and ai_data.get("lat") and ai_data.get("lng"):
                lat = float(ai_data["lat"])
                lng = float(ai_data["lng"])
                if 48.25 <= lat <= 48.70 and 34.70 <= lng <= 35.40:
                    addr = ai_data.get("address", "Дніпро")
                    parsed_result = {
                        "address": addr,
                        "lat": round(lat, 5),
                        "lng": round(lng, 5),
                        "status": "чисто" if is_clean else ai_data.get("status", "опасно"),
                        "needs_training": False
                    }
                    log(f"🤖 [GEMINI AI]: '{msg[:45]}' ➔ {addr}")
                    auto_save_to_knowledge_base(msg, addr, round(lat, 5), round(lng, 5))

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

            save_point_to_firebase(msg, parsed_result, is_clean, now_ms)

if __name__ == "__main__":
    log(f"🚀 Запуск оновленого радара 24/7 v4.0 (Завантажено {len(GEMINI_KEYS)} API ключів)...")
    start_time = time.time()
    MAX_RUNTIME_SEC = 5 * 3600 + 40 * 60

    while (time.time() - start_time) < MAX_RUNTIME_SEC:
        try:
            sync_cycle()
        except Exception as e:
            log(f"⚠️ Помилка в циклі: {e}")
        time.sleep(20)
