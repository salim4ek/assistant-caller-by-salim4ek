# Генерация app.ico — фирменный NN+ (изумруд на тёмно-бирюзовом, скруглённый квадрат).
import os
from PIL import Image, ImageDraw, ImageFont

BG_TOP = (6, 38, 31)      # тёмно-бирюзовый верх
BG_BOT = (3, 22, 18)      # ещё темнее низ
EMER   = (52, 211, 153)   # изумруд (бренд)
EMER_D = (16, 185, 129)

def font(sz):
    for path in (r"C:\Windows\Fonts\segoeuib.ttf", r"C:\Windows\Fonts\arialbd.ttf", r"C:\Windows\Fonts\arial.ttf"):
        try:
            return ImageFont.truetype(path, sz)
        except Exception:
            continue
    return ImageFont.load_default()

def draw(size):
    SS = 4  # суперсэмплинг для гладкости
    S = size * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # вертикальный градиент фона
    grad = Image.new("RGB", (1, S))
    for y in range(S):
        t = y / max(1, S - 1)
        grad.putpixel((0, y), tuple(int(BG_TOP[i] + (BG_BOT[i] - BG_TOP[i]) * t) for i in range(3)))
    grad = grad.resize((S, S))
    # маска — скруглённый квадрат
    mask = Image.new("L", (S, S), 0)
    md = ImageDraw.Draw(mask)
    rad = int(S * 0.235)
    md.rounded_rectangle([0, 0, S - 1, S - 1], radius=rad, fill=255)
    img.paste(grad, (0, 0), mask)
    # тонкая изумрудная рамка
    d.rounded_rectangle([int(S*0.02), int(S*0.02), S - 1 - int(S*0.02), S - 1 - int(S*0.02)],
                        radius=int(rad*0.95), outline=EMER_D, width=max(2, int(S*0.012)))
    # текст NN+
    txt = "NN+"
    fs = int(S * 0.40)
    f = font(fs)
    # подгон по ширине ~0.80*S
    bbox = d.textbbox((0, 0), txt, font=f)
    tw = bbox[2] - bbox[0]
    if tw > 0:
        fs = int(fs * (S * 0.80) / tw)
        f = font(fs)
        bbox = d.textbbox((0, 0), txt, font=f)
    tw = bbox[2] - bbox[0]; th = bbox[3] - bbox[1]
    x = (S - tw) / 2 - bbox[0]
    y = (S - th) / 2 - bbox[1] - int(S * 0.02)
    # лёгкая тень + текст
    d.text((x, y + int(S*0.012)), txt, font=f, fill=(0, 0, 0, 120))
    d.text((x, y), txt, font=f, fill=EMER)
    return img.resize((size, size), Image.LANCZOS)

sizes = [16, 24, 32, 48, 64, 128, 256]
imgs = [draw(s) for s in sizes]
_out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "app.ico")
imgs[-1].save(_out, format="ICO",
              sizes=[(s, s) for s in sizes], append_images=imgs[:-1])
print("app.ico written:", sizes)
