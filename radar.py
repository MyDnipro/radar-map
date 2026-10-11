import os
import re
import json
import time
import random
from datetime import datetime
import requests

RAW_GEMINI_KEYS = os.environ.get("GEMINI_KEY", "").strip() or os.environ.get("GEMINI_KEYS", "").strip()
GEMINI_KEYS = [k.strip() for k in re.split(r'[,;\s]+', RAW_GEMINI_KEYS) if len(k.strip()) > 15]

current_key_index = 0

FIREBASE_URL = os.environ.get("FIREBASE_URL", "").strip()
LIFETIME_MS = 40 * 60 * 1000  # 40 минут для меток на карте
ARCHIVE_RETENTION_MS = 400 * 24 * 60 * 60 * 1000  # 400 дней для архива аналитики

CHANNEL_BASE_URL = "https://t.me/s/dnepr_bez_tck"

if FIREBASE_URL and not FIREBASE_URL.endswith(".json"):
    FIREBASE_URL = FIREBASE_URL.rstrip("/") + "/points.json"

KNOWLEDGE_BASE_URL = FIREBASE_URL.replace("/points.json", "/knowledge_base.json") if FIREBASE_URL else ""
STATS_ARCHIVE_URL = FIREBASE_URL.replace("/points.json", "/stats_archive.json") if FIREBASE_URL else ""

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

PROCESSED_POST_IDS = set()

# ФИЛЬТР СПАМА, БОТОВ И СБОРОВ
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
    return bool(AD_FILTER_REGEX.search(text))

# ГЕНЕРАЛЬНАЯ БАЗА ТОПОНИМОВ И НАРОДНЫХ ОРИЕНТИРОВ ДНЕПРА
LOCAL_STREETS_DB = [
    # Народный сленг и специфические места
    {"keys": ["тещин.*язик", "тещин.*язык", "тёщин.*язык"], "addr": "Тьощин язик (вул. Космічна)", "lat": 48.4140, "lng": 35.0510},
    {"keys": ["молодогвард"], "addr": "вул. Молодогвардійська (під мостами)", "lat": 48.4680, "lng": 35.1220},
    {"keys": ["луговськ", "луговск"], "addr": "вул. Луговська (АНД)", "lat": 48.4890, "lng": 35.0480},
    {"keys": ["солончаков"], "addr": "вул. Солончакова (АНД)", "lat": 48.5010, "lng": 35.0350},
    {"keys": ["моторн", "семен"], "addr": "вул. Моторна (Березанівка)", "lat": 48.5350, "lng": 34.9600},
    {"keys": ["петрозаводськ", "петрозаводск", "ковпак"], "addr": "вул. Петрозаводська (Ковпака)", "lat": 48.5300, "lng": 34.9850},

    # Аэропорт и южные выезды
    {"keys": ["аеропорт", "аэропорт"], "addr": "Аеропорт Дніпро", "lat": 48.3570, "lng": 35.1000},
    {"keys": ["старих кодак", "старых кодак", "старі кодаки", "старые кодаки", "кодаки"], "addr": "дорога на Старі Кодаки", "lat": 48.3650, "lng": 35.1050},
    {"keys": ["братськ", "братское"], "addr": "с. Братське (Запорізька траса)", "lat": 48.3280, "lng": 35.0250},
    {"keys": ["новоолександрівк", "новоалександровк"], "addr": "с. Новоолександрівка", "lat": 48.3520, "lng": 35.0050},
    {"keys": ["сурськ", "сурск"], "addr": "с. Сурсько-Литовське", "lat": 48.3400, "lng": 34.9350},
    {"keys": ["краснопіл", "краснополь"], "addr": "Краснопілля", "lat": 48.4100, "lng": 34.9550},
    {"keys": ["розвилк", "развилк"], "addr": "Розвилка (Б. Хмельницького / ЗШ)", "lat": 48.4250, "lng": 35.0220},

    # Парус, Диёвка, Новокодакский р-н
    {"keys": ["трофимов", "трофімов", "велик.*діїр", "велик.*діїв"], "addr": "вул. Велика Діївська (Братів Трофімових)", "lat": 48.4840, "lng": 34.9180},
    {"keys": ["комунарівськ", "коммунаровск", "кондратюк"], "addr": "вул. Юрія Кондратюка (Комунарівська)", "lat": 48.4820, "lng": 34.9350},
    {"keys": ["парус"], "addr": "ж/м Парус", "lat": 48.4840, "lng": 34.9180},
    {"keys": ["покровськ", "комунар", "коммунар"], "addr": "ж/м Покровський (Комунар)", "lat": 48.4820, "lng": 34.9380},
    {"keys": ["червон.*кам", "красн.*кам", "камни", "каменях"], "addr": "ж/м Червоний Камінь", "lat": 48.4830, "lng": 34.9520},
    {"keys": ["західн", "западн", "западний", "западном"], "addr": "ж/м Західний", "lat": 48.4650, "lng": 34.9350},
    {"keys": ["діївк", "диевк"], "addr": "ж/м Діївка", "lat": 48.4810, "lng": 34.8980},
    {"keys": ["сухачівк", "сухачевк"], "addr": "Сухачівка", "lat": 48.4880, "lng": 34.8420},
    {"keys": ["таромськ", "таромск"], "addr": "Таромське", "lat": 48.4750, "lng": 34.7850},
    {"keys": ["моніторн", "мониторн", "гідропарк"], "addr": "вул. Моніторна (Парус)", "lat": 48.4850, "lng": 34.9120},
    {"keys": ["метробудівник", "метростроев"], "addr": "вул. Метробудівська (Парус)", "lat": 48.4810, "lng": 34.9250},
    {"keys": ["мазеп", "петровськ", "петровск"], "addr": "просп. Івана Мазепи (Петровського)", "lat": 48.4680, "lng": 34.9650},
    {"keys": ["нігоян", "нигоян", "калінін", "калинин"], "addr": "просп. Сергія Нігояна (Калініна)", "lat": 48.4730, "lng": 34.9850},

    # Набережная, Вокзал, Рабочая, Центр
    {"keys": ["свобод"], "addr": "просп. Свободи", "lat": 48.4810, "lng": 34.9750},
    {"keys": ["водолікарн", "водолечеб"], "addr": "Водолікарня (пр. Свободи)", "lat": 48.4848, "lng": 34.9735},
    {"keys": ["павлов"], "addr": "вул. Академіка Павлова", "lat": 48.4818, "lng": 35.0012},
    {"keys": ["белелюб", "краснозавод", "дтрз", "комбайн", "ударник"], "addr": "вул. Белелюбського (Краснозаводська)", "lat": 48.4800, "lng": 34.9880},
    {"keys": ["набережн.*завод", "заводск.*набережн"], "addr": "Набережна Заводська", "lat": 48.4850, "lng": 34.9800},
    {"keys": ["речпорт", "річпорт", "репорт"], "addr": "Річпорт (Набережна Заводська)", "lat": 48.4805, "lng": 35.0210},
    {"keys": ["стан 550", "стан550"], "addr": "Стан 550 (Набережна Заводська)", "lat": 48.4865, "lng": 34.9850},
    {"keys": ["водокачк"], "addr": "Водокачка (Набережна Заводська)", "lat": 48.4910, "lng": 34.9480},
    {"keys": ["кайдак", "ровд"], "addr": "Кайдацький міст / з'їзд (РОВД)", "lat": 48.4925, "lng": 34.9625},
    {"keys": ["вокзал", "привокзальн"], "addr": "пл. Вокзальна (Ж/Д Вокзал)", "lat": 48.4760, "lng": 35.0160},
    {"keys": ["старомостов", "островськ", "островск"], "addr": "пл. Старомостова (Островського)", "lat": 48.4770, "lng": 35.0220},
    {"keys": ["курчатов", "128.*бригад"], "addr": "вул. 128-ї Бригади (Курчатова)", "lat": 48.4740, "lng": 35.0140},
    {"keys": ["шмідт", "шмидт", "бандер"], "addr": "вул. Степана Бандери (Шмідта)", "lat": 48.4680, "lng": 35.0240},
    {"keys": ["озерк"], "addr": "Ринок Озерка", "lat": 48.4715, "lng": 35.0215},
    {"keys": ["карла маркс", "карла маркса", "яворницьк", "км "], "addr": "просп. Дмитра Яворницького (К. Маркса)", "lat": 48.4650, "lng": 35.0350},
    {"keys": ["чечел"], "addr": "Чечелівка (Чечеловка)", "lat": 48.4620, "lng": 34.9950},
    {"keys": ["робоч", "рабоч"], "addr": "вул. Робоча", "lat": 48.4480, "lng": 35.0080},
    {"keys": ["канатн"], "addr": "вул. Канатна", "lat": 48.4600, "lng": 35.0100},
    {"keys": ["криворізьк", "криворож"], "addr": "вул. Криворізька", "lat": 48.4385, "lng": 34.9920},
    {"keys": ["криворізьке шосе", "криворожское шоссе"], "addr": "Криворізьке шосе", "lat": 48.4280, "lng": 34.9350},
    {"keys": ["антонович", "свердлов"], "addr": "вул. Володимира Антоновича (Свердлова)", "lat": 48.4610, "lng": 35.0180},
    {"keys": ["поля", "кіров", "киров"], "addr": "просп. Олександра Поля (Кірова)", "lat": 48.4480, "lng": 35.0240},
    {"keys": ["титов", "рудницьк"], "addr": "вул. Титова (Степана Рудницького)", "lat": 48.4340, "lng": 35.0150},
    {"keys": ["гагарін", "науки", "дііт", "диит", "дну"], "addr": "просп. Науки (Гагаріна)", "lat": 48.4350, "lng": 35.0420},
    {"keys": ["підстанці", "подстанци", "дафі", "дафи"], "addr": "Підстанція (ТРЦ Дафі)", "lat": 48.4250, "lng": 35.0220},
    {"keys": ["12.*квартал", "квартал"], "addr": "12 Квартал", "lat": 48.4120, "lng": 35.0150},
    {"keys": ["хмельницьк", "героїв сталінград", "героев сталинграда", "гс "], "addr": "просп. Богдана Хмельницького (Г. Сталінграда)", "lat": 48.4200, "lng": 35.0180},
    {"keys": ["топол"], "addr": "ж/м Тополя", "lat": 48.3950, "lng": 35.0350},
    {"keys": ["панікахи", "паникахи"], "addr": "вул. Панікахи", "lat": 48.3950, "lng": 35.0450},
    {"keys": ["космічн", "космическ"], "addr": "вул. Космічна", "lat": 48.4180, "lng": 35.0450},
    {"keys": ["перемог", "побед"], "addr": "ж/м Перемога (1-6)", "lat": 48.4250, "lng": 35.0850},

    # Левый берег
    {"keys": ["бик", "бык", "пост бык"], "addr": "Пост «Бик» (Підгородне)", "lat": 48.5350, "lng": 35.1020},
    {"keys": ["золоті ключі", "золотые ключи"], "addr": "Золоті Ключі (Слобожанське)", "lat": 48.5280, "lng": 35.0920},
    {"keys": ["обухівк", "обуховк", "кіровськ", "кировск", "полтавськ.*шосе"], "addr": "Полтавське шосе / Обухівка", "lat": 48.5450, "lng": 34.9350},
    {"keys": ["слобожанськ", "правд"], "addr": "просп. Слобожанський (Правди)", "lat": 48.5000, "lng": 35.0680},
    {"keys": ["мануйлівськ", "воронцов"], "addr": "просп. Мануйлівський (Воронцова)", "lat": 48.4850, "lng": 35.0500},
    {"keys": ["сонячн", "солнечн", "малиновськ", "вавілон", "вавилон"], "addr": "ж/м Сонячний (Набережна Сонячна / Малиновського)", "lat": 48.4750, "lng": 35.0650},
    {"keys": ["калнишевськ", "косіор", "косиор"], "addr": "просп. Петра Калнишевського (Косіора)", "lat": 48.5080, "lng": 35.0750},
    {"keys": ["калинов"], "addr": "вул. Калинова", "lat": 48.5080, "lng": 35.0550},
    {"keys": ["янтарн"], "addr": "вул. Янтарна", "lat": 48.5200, "lng": 35.0480},
    {"keys": ["клочко"], "addr": "ж/м Клочко-6", "lat": 48.5280, "lng": 35.0620},
    {"keys": ["донецьк.*шосе", "донецк.*шоссе", "караван"], "addr": "Донецьке шосе (Караван)", "lat": 48.5350, "lng": 34.9900},
    {"keys": ["березинк"], "addr": "Березинка / вул. Марії Лисиченко", "lat": 48.5250, "lng": 35.0250},
    {"keys": ["лівобереж", "левобереж"], "addr": "ж/м Лівобережний (1-3)", "lat": 48.5300, "lng": 35.0100},
    {"keys": ["фрунзенськ", "фрунзик", "ломівськ", "ломовск", "кам'янськ", "каменск"], "addr": "ж/м Ломівський / Кам'янський (Фрунзенський)", "lat": 48.5050, "lng": 34.9750},
    {"keys": ["придніпр", "придник"], "addr": "ж/м Придніпровськ", "lat": 48.3980, "lng": 35.1320},
    {"keys": ["ігрень", "игрень"], "addr": "Ігрень", "lat": 48.4550, "lng": 35.1550},
    {"keys": ["чаплі", "чапли"], "addr": "ж/м Чаплі", "lat": 48.4050, "lng": 35.1750},
    {"keys": ["підгородн", "подгородн"], "addr": "м. Підгородне", "lat": 48.5750, "lng": 35.1050}
]

def geocode_local(text):
    t = " " + text.lower() + " "
    for item in LOCAL_STREETS_DB:
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
            headers = {"User-Agent": "DniproRadarMap/3.0"}
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

# МОДЕЛИ 3.5 С БОЛЬШИМИ ЛИМИТАМИ СТОЯТ ПЕРВЫМИ
SUPPORTED_MODELS = ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.8-flash"]

CLEAN_KEYWORDS = [
    "чисто", "чистенько", "пусто", "вільно", "спокійно", "проїзд",
    "без бп", "сонечко", "солнечно", "солнце", "ясно", "сухо",
    "знялися", "пролітайте", "все чисто", "зелено", "🌞", "☀️", "🌤️"
]

def is_message_clean(text):
    t = text.lower()
    if "не чисто" in t or "не пусто" in t or "не вільно" in t:
        return False
    for kw in CLEAN_KEYWORDS:
        if kw in t:
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

def cleanup_old_points():
    now_ms = int(time.time() * 1000)
    if not FIREBASE_URL:
        return
    base_url = FIREBASE_URL.replace("/points.json", "")

    try:
        r = requests.get(FIREBASE_URL, timeout=8)
        if r.status_code == 200 and r.json():
            data = r.json()
            to_delete = {}
            for k, v in data.items():
                if isinstance(v, dict):
                    full_txt = (v.get("text", "") + " " + v.get("raw_text", "")).lower()
                    if (now_ms - (v.get("time") or v.get("timestamp") or 0)) > LIFETIME_MS or is_ad_or_spam(full_txt):
                        to_delete[k] = None
            if to_delete:
                requests.patch(f"{base_url}/points.json", json=to_delete, timeout=8)
                log(f"🧹 Видалено міток (застарілих або спам): {len(to_delete)}")
    except Exception:
        pass

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

def parse_with_gemini(text):
    if not GEMINI_KEYS:
        return None

    prompt = f"""
Ти — аналітик геолокації у місті Дніпро (Україна).
Повідомлення: "{text}"
Знайди назву вулиці, району або орієнтир у місті Дніпро (враховуй народні та сленгові назви).
Відповідай ТІЛЬКИ JSON:
{{"found": true, "address": "вул. ...", "lat": 48.45, "lng": 35.01, "status": "чисто"|"опасно"}}
Якщо локації немає: {{"found": false}}
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
                    timeout=8
                )
                if r.status_code == 200:
                    raw = r.json().get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                    raw = raw.replace("```json", "").replace("```", "").strip()
                    data = json.loads(raw)
                    if data.get("found") and data.get("lat") and data.get("lng"):
                        lat = float(data["lat"])
                        lng = float(data["lng"])
                        if 48.25 <= lat <= 48.70 and 34.70 <= lng <= 35.40:
                            return {
                                "address": data.get("address", "Дніпро"),
                                "lat": round(lat, 5),
                                "lng": round(lng, 5),
                                "status": data.get("status", "опасно")
                            }
                    return None
                elif r.status_code in [429, 403]:
                    # Пробуем следующую модель или ключ без падения
                    continue
            except Exception:
                continue

    return None

def sync_cycle():
    global PROCESSED_POST_IDS
    cleanup_old_points()

    kb_list = get_knowledge_base()
    items = fetch_channel_messages()

    if not items:
        return

    new_items = []
    for post_id, text in items:
        unique_key = f"{post_id}_{text.lower()}"
        if unique_key not in PROCESSED_POST_IDS:
            new_items.append((unique_key, text))

    log(f"📢 В каналі: {len(items)} | Нових: {len(new_items)} | В базі знань: {len(kb_list)} | Ключів в пулі: {len(GEMINI_KEYS)}")

    if not new_items:
        return

    now_ms = int(time.time() * 1000)

    for unique_key, msg in new_items:
        PROCESSED_POST_IDS.add(unique_key)

        if is_ad_or_spam(msg):
            log(f"🚫 [РЕКЛАМА/СПАМ ПРОПУЩЕНО]: '{msg[:45]}'")
            continue

        is_clean = is_message_clean(msg)
        parsed_result = None

        # 1. База знаний
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

        # 2. Локальный справочник (топонимы, переименования, сленг)
        if not parsed_result:
            addr, lat, lng = geocode_local(msg)
            if addr and lat and lng:
                parsed_result = {
                    "address": addr,
                    "lat": lat,
                    "lng": lng,
                    "status": "чисто" if is_clean else "опасно",
                    "needs_training": False
                }
                log(f"⚡ [ЛОКАЛЬНО / ТОПОНІМ]: '{msg[:45]}' ➔ {addr}")

        # 3. Резерв OpenStreetMap
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

        # 4. Gemini AI
        if not parsed_result:
            time.sleep(0.4)
            ai_res = parse_with_gemini(msg)
            if ai_res:
                parsed_result = {**ai_res, "needs_training": False}
                log(f"🤖 [GEMINI AI]: '{msg[:45]}' ➔ {parsed_result['address']}")

        # 5. ЕСЛИ ТОЧКА НЕ ОПОЗНАНА — БРОСАЕМ В РЕКУ В ЗАЛИВ ВОЗЛЕ КАЙДАКСКОГО МОСТА!
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
            log(f"🌊 [НАВЧАННЯ / НА ВОДУ]: Невідому точку розміщено в річці: '{msg[:45]}'")

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

        try:
            requests.post(FIREBASE_URL, json=point_data, timeout=8)
        except Exception as e:
            log(f"⚠️ Помилка Firebase: {e}")

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
    log(f"🚀 Запуск безперервної зміни радара 24/7 (Завантажено {len(GEMINI_KEYS)} API ключів)...")
    start_time = time.time()
    MAX_RUNTIME_SEC = 5 * 3600 + 40 * 60

    while (time.time() - start_time) < MAX_RUNTIME_SEC:
        try:
            sync_cycle()
        except Exception as e:
            log(f"⚠️ Помилка в циклі: {e}")
        time.sleep(20)
