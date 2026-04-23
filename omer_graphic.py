#!/usr/bin/env python3
"""
omer_graphic.py — מייצר גרפיקת ספירת העומר ל-PNG עבור תאריך/שעה נתונים

שימוש:
    python3 omer_graphic.py                        # עכשיו (מתחשב בשקיעה)
    python3 omer_graphic.py 2026-04-22             # תאריך ספציפי (בוקר)
    python3 omer_graphic.py "2026-04-22 20:30"     # תאריך + שעה מקומית
    python3 omer_graphic.py 2026-05-06 output.png  # שם קובץ מותאם

הספירה מתחדשת 45 דקות אחרי השקיעה בירושלים.
"""

import sys
from datetime import date, datetime, timedelta, timezone
from PIL import Image, ImageDraw, ImageFont
import ephem

# ============================================================
# הגדרות
# ============================================================

FONT_BOLD     = "/usr/share/fonts/truetype/freefont/FreeSerifBold.ttf"
FONT_REG      = "/usr/share/fonts/truetype/freefont/FreeSerif.ttf"
FONT_LATIN    = "/usr/share/fonts/truetype/freefont/FreeSerif.ttf"

COPYRIGHT = "© Ploni Almoni"

# ============================================================
# נתוני לוח עברי — תחילת ספירת העומר לפי שנה גרגוריאנית
# (ערב 16 ניסן — הלילה השני של פסח)
# ============================================================

OMER_START = {
    2024: date(2024, 4,  23),
    2025: date(2025, 4,  13),
    2026: date(2026, 4,   2),
    2027: date(2027, 4,  22),
    2028: date(2028, 4,  11),
    2029: date(2029, 4,   1),
    2030: date(2030, 4,  18),
}

# ============================================================
# טקסטים עבריים
# ============================================================

ONES = ["", "אֶחָד", "שְׁנַיִם", "שְׁלֹשָׁה", "אַרְבָּעָה", "חֲמִשָּׁה",
        "שִׁשָּׁה", "שִׁבְעָה", "שְׁמוֹנָה", "תִּשְׁעָה", "עֲשָׂרָה",
        "אַחַד עָשָׂר", "שְׁנֵים עָשָׂר", "שְׁלֹשָׁה עָשָׂר",
        "אַרְבָּעָה עָשָׂר", "חֲמִשָּׁה עָשָׂר", "שִׁשָּׁה עָשָׂר",
        "שִׁבְעָה עָשָׂר", "שְׁמוֹנָה עָשָׂר", "תִּשְׁעָה עָשָׂר"]

TENS = ["", "", "עֶשְׂרִים", "שְׁלֹשִׁים", "אַרְבָּעִים"]

WEEKS_F = ["", "שָׁבוּעַ אֶחָד", "שְׁנֵי שָׁבוּעוֹת", "שְׁלֹשָׁה שָׁבוּעוֹת",
           "אַרְבָּעָה שָׁבוּעוֹת", "חֲמִשָּׁה שָׁבוּעוֹת",
           "שִׁשָּׁה שָׁבוּעוֹת", "שִׁבְעָה שָׁבוּעוֹת"]

DAYS_F = ["", "יוֹם אֶחָד", "שְׁנֵי יָמִים", "שְׁלֹשָׁה יָמִים",
          "אַרְבָּעָה יָמִים", "חֲמִשָּׁה יָמִים", "שִׁשָּׁה יָמִים"]


def day_to_hebrew(n):
    """ממיר מספר יום (1–49) לטקסט עברי, למשל 21 → 'אֶחָד וְעֶשְׂרִים יוֹם'"""
    suffix = "יוֹם" if n == 1 else "יָמִים"
    if n <= 19:
        return f"{ONES[n]} {suffix}"
    ones = n % 10
    tens = n // 10
    if ones == 0:
        return f"{TENS[tens]} {suffix}"
    return f"{ONES[ones]} וְ{TENS[tens]} {suffix}"


def omer_nusach(day_num):
    """
    מחזיר את הנוסח המסורתי לספירה:
    'הַיּוֹם X יָמִים שֶׁהֵם Y שָׁבוּעוֹת [וְZ יָמִים] לָעוֹמֶר'
    """
    weeks = (day_num - 1) // 7
    days  = (day_num - 1) % 7 + 1  # 1-based within week

    day_text = day_to_hebrew(day_num)

    if weeks == 0:
        # פחות משבוע — רק ימים
        week_part = None
    elif days == 7:
        # בדיוק שבועות שלמים
        weeks += 1
        week_part = WEEKS_F[weeks]
        days = 0
    else:
        week_part = WEEKS_F[weeks]

    if week_part is None:
        shehem = day_text
    elif days == 0:
        shehem = week_part
    else:
        shehem = f"{week_part} וְ{DAYS_F[days]}"

    return day_text, shehem


# ============================================================
# יצירת הגרפיקה
# ============================================================

def make_omer_image(target_date: date, output_path: str = None):
    year = target_date.year
    if year not in OMER_START:
        print(f"שגיאה: אין נתוני עומר עבור שנת {year}. הוסף לטבלת OMER_START.")
        sys.exit(1)

    start = OMER_START[year]
    day_num = (target_date - start).days + 1

    if day_num < 1 or day_num > 49:
        print(f"התאריך {target_date} אינו בתוך תקופת ספירת העומר (יום {day_num}).")
        sys.exit(1)

    day_text, shehem = omer_nusach(day_num)

    if output_path is None:
        output_path = f"omer_day{day_num:02d}_{target_date}.png"

    # ---- פונטים ----
    ft_title = ImageFont.truetype(FONT_REG,   28)
    ft_reg   = ImageFont.truetype(FONT_REG,   42)
    ft_bold  = ImageFont.truetype(FONT_BOLD,  54)
    ft_orn   = ImageFont.truetype(FONT_LATIN, 22)
    ft_copy  = ImageFont.truetype(FONT_LATIN, 18)

    # ---- צבעים ----
    BG     = (110, 80,  0)
    CARD_T = (145, 105, 0)
    CARD_B = (95,  68,  0)
    GOLD   = (245, 210, 100)
    CREAM  = (255, 248, 231)
    COPY_C = (220, 185, 100)

    # ---- שורות תוכן ----
    # כל פריט: (טקסט, פונט, צבע) או פקודה מיוחדת
    lines = [
        ("סְפִירַת הָעוֹמֶר", ft_title, GOLD),
        ("DIV",  None, None),
        ("הַיּוֹם",            ft_reg,  GOLD),
        (day_text,             ft_bold, CREAM),
        (f"שֶׁהֵם {shehem}",  ft_bold, CREAM),
        ("לָעוֹמֶר",           ft_reg,  GOLD),
        ("DIV",  None, None),
        ("✦  ✦  ✦",           ft_orn,  GOLD),
        ("SPACE30", None, None),
        (COPYRIGHT,            ft_copy, COPY_C),
    ]

    # ---- מדידה ----
    PAD_X  = 50
    PAD_Y  = 24
    GAP    = 12
    DIVGAP = 10
    MARGIN = 6

    tmp = Image.new("RGB", (1, 1))
    d   = ImageDraw.Draw(tmp)

    total_h = PAD_Y * 2
    max_w   = 0
    for text, font, _ in lines:
        if text == "DIV":
            total_h += 1 + DIVGAP * 2
        elif text.startswith("SPACE"):
            total_h += int(text[5:])
        else:
            bb = d.textbbox((0, 0), text, font=font)
            max_w   = max(max_w, bb[2] - bb[0])
            total_h += bb[3] - bb[1] + GAP

    card_w = max_w + PAD_X * 2
    card_h = total_h
    img_w  = card_w + MARGIN * 2
    img_h  = card_h + MARGIN * 2

    # ---- ציור ----
    img  = Image.new("RGB", (img_w, img_h), BG)
    draw = ImageDraw.Draw(img)

    # רקע מדורג
    for y in range(card_h):
        t = y / card_h
        r = int(CARD_T[0] + (CARD_B[0] - CARD_T[0]) * t)
        g = int(CARD_T[1] + (CARD_B[1] - CARD_T[1]) * t)
        b = int(CARD_T[2] + (CARD_B[2] - CARD_T[2]) * t)
        draw.line([(MARGIN, MARGIN + y), (MARGIN + card_w, MARGIN + y)], fill=(r, g, b))

    # מסגרת
    draw.rounded_rectangle([MARGIN, MARGIN, MARGIN + card_w, MARGIN + card_h],
                            radius=14, outline=GOLD, width=2)

    # עיטורי פינה
    draw.text((MARGIN + 10,          MARGIN + 8), "✦", font=ft_orn, fill=GOLD)
    draw.text((MARGIN + card_w - 30, MARGIN + 8), "✦", font=ft_orn, fill=GOLD)

    # תוכן
    cy = MARGIN + PAD_Y
    for text, font, color in lines:
        if text == "DIV":
            cy += DIVGAP
            x0, x1 = MARGIN + PAD_X, MARGIN + card_w - PAD_X
            for xi in range(x0, x1):
                t = (xi - x0) / (x1 - x0)
                a = min(min(t, 1 - t) * 4, 1.0)
                gc = tuple(int(BG[i] + (GOLD[i] - BG[i]) * a) for i in range(3))
                draw.point((xi, cy), fill=gc)
            cy += 1 + DIVGAP
        elif text.startswith("SPACE"):
            cy += int(text[5:])
        else:
            bb = draw.textbbox((0, 0), text, font=font)
            w  = bb[2] - bb[0]
            x  = MARGIN + (card_w - w) // 2 - bb[0]
            draw.text((x, cy - bb[1]), text, font=font, fill=color)
            cy += bb[3] - bb[1] + GAP

    img.save(output_path)
    print(f"✓ נשמר: {output_path}  ({img_w}×{img_h}px)  יום {day_num} לעומר")
    return output_path


# ============================================================
# חישוב שקיעה בירושלים
# ============================================================

# ירושלים: קו רוחב, אורך, גובה
_JLM_LAT  = '31.7683'
_JLM_LON  = '35.2137'
_JLM_ELEV = 754
_TZ_JLM   = timezone(timedelta(hours=3))   # UTC+3 (IST/IDT — ירושלים)


def jerusalem_sunset(d: date) -> datetime:
    """מחזיר את שעת השקיעה בירושלים לתאריך נתון (עם tzinfo=UTC+3)."""
    obs = ephem.Observer()
    obs.lat  = _JLM_LAT
    obs.lon  = _JLM_LON
    obs.elev = _JLM_ELEV
    obs.date = ephem.Date(f'{d.year}/{d.month}/{d.day} 12:00:00')
    sun = ephem.Sun()
    sunset_utc = obs.next_setting(sun).datetime().replace(tzinfo=timezone.utc)
    return sunset_utc.astimezone(_TZ_JLM)


def halachic_date(now: datetime) -> date:
    """
    מחזיר את התאריך ההלכתי: אם השעה הנוכחית היא לפני 45 דקות אחרי
    השקיעה בירושלים — עדיין "יום" הקודם הלכתית; אחרי כן — יום חדש.
    """
    local_date = now.date()
    sunset = jerusalem_sunset(local_date)
    cutoff = sunset + timedelta(minutes=45)

    # המר את now ל-timezone מודע אם צריך
    if now.tzinfo is None:
        now = now.replace(tzinfo=_TZ_JLM)

    if now >= cutoff:
        # אחרי 45 דק' משקיעה → ספירת אותו לילה (local_date)
        return local_date
    else:
        # לפני הספירה של הלילה → עדיין ספירת אתמול
        return local_date - timedelta(days=1)


# ============================================================
# הרצה
# ============================================================

if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.endswith('.png') and not a.endswith('.jpg')]
    out  = next((a for a in sys.argv[1:] if a.endswith('.png') or a.endswith('.jpg')), None)

    if args:
        raw = args[0]
        try:
            if 'T' in raw or ' ' in raw:
                # תאריך + שעה
                now = datetime.fromisoformat(raw).replace(tzinfo=_TZ_JLM)
                target = halachic_date(now)
            else:
                # תאריך בלבד — נניח בוקר (לפני שקיעה)
                target = date.fromisoformat(raw)
        except ValueError:
            print(f"פורמט שגוי: {raw}  (נדרש YYYY-MM-DD או 'YYYY-MM-DD HH:MM')")
            sys.exit(1)
    else:
        # ברירת מחדל: עכשיו
        now    = datetime.now(_TZ_JLM)
        target = halachic_date(now)
        sunset = jerusalem_sunset(now.date())
        cutoff = sunset + timedelta(minutes=45)
        print(f"שקיעה בירושלים: {sunset.strftime('%H:%M')}  |  ספירה חדשה מ: {cutoff.strftime('%H:%M')}")

    make_omer_image(target, out)
