"""Optional mockup overview/contact-sheet export. Requires Pillow."""
from pathlib import Path
import json
import math
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
SCREENS = json.loads((ROOT / "inventory.json").read_text())


def font(size, bold=False):
    name = "Arial Bold.ttf" if bold else "Arial.ttf"
    path = Path("/System/Library/Fonts/Supplemental") / name
    return ImageFont.truetype(str(path), size) if path.exists() else ImageFont.load_default(size=size)


def paste(canvas, name, xy, size=None):
    image = Image.open(ROOT / "screens" / f"{name}.png").convert("RGB")
    if size:
        image.thumbnail(size, Image.Resampling.LANCZOS)
    canvas.paste(image, xy)


def heading(canvas, title, subtitle):
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((40, 35, 71, 70), radius=6, fill="#efd06b")
    draw.text((85, 29), title, font=font(40, True), fill="#292c28")
    draw.text((40, 91), subtitle, font=font(18), fill="#777a70")
    return draw


overview = Image.new("RGB", (1700, 1080), "#eeede8")
draw = heading(overview, "peel", "Floating Mac notes, with iPhone and browser access")
draw.text((40, 140), "MAC DESKTOP", font=font(13, True), fill="#777a70")
draw.text((1220, 140), "IPHONE EDITOR", font=font(13, True), fill="#777a70")
paste(overview, "mac-desktop", (40, 166))
paste(overview, "iphone-editor", (1220, 166))
draw.text((40, 923), f"{len(SCREENS)} screen mockups", font=font(30, True), fill="#292c28")
draw.text((40, 974), "Free remote device sync + paid live Peel Cloud. Mockups only.", font=font(17), fill="#777a70")
overview.save(ROOT / "overview.png", optimize=True)

desktop = Image.new("RGB", (1700, 1050), "#eeede8")
draw = heading(desktop, "peel desktop", "Independent desktop windows. One green minus saves and puts a note away.")
draw.text((40, 140), "DRAG OUT OR RIGHT-CLICK TO PIN", font=font(13, True), fill="#777a70")
draw.text((1180, 140), "ARRANGE LEFT", font=font(13, True), fill="#777a70")
paste(desktop, "mac-library-desktop", (40, 166))
paste(desktop, "mac-arrange-left", (1180, 166), (480, 320))
draw.text((1180, 540), "ARRANGE TOP", font=font(13, True), fill="#777a70")
paste(desktop, "mac-arrange-top", (1180, 566), (480, 320))
draw.text((40, 932), "Control + Option + Command + Arrow", font=font(26, True), fill="#292c28")
draw.text((40, 980), "Arrange left, right, top or bottom. Command + Shift + L opens Notes Library.", font=font(18), fill="#777a70")
desktop.save(ROOT / "desktop-overview.png", optimize=True)

cols, cellw, cellh, margin, top = 5, 324, 260, 36, 100
sheet = Image.new("RGB", (cols * cellw + margin * 2, math.ceil(len(SCREENS) / cols) * cellh + top + margin), "#eeede8")
draw = ImageDraw.Draw(sheet)
draw.text((margin, 27), "Peel screen index", font=font(30, True), fill="#292c28")
draw.text((margin, 66), f"{len(SCREENS)} canonical screens · macOS, iPhone and browser · 26 October 2026", font=font(15), fill="#777a70")
for i, screen in enumerate(SCREENS):
    x, y = margin + (i % cols) * cellw, top + (i // cols) * cellh
    im = Image.open(ROOT / "screens" / f"{screen['id']}.png").convert("RGB")
    im.thumbnail((300, 205), Image.Resampling.LANCZOS)
    sheet.paste(im, (x + (300 - im.width) // 2, y))
    title = screen["title"]
    draw.text((x, y + 215), title if len(title) <= 39 else title[:36] + "...", font=font(12, True), fill="#292c28")
    draw.text((x, y + 235), screen["platform"].upper() + " · " + screen["requirements"], font=font(10), fill="#777a70")
sheet.save(ROOT / "all-screens.png", optimize=True)
print(f"Exported overview, desktop overview, and contact sheet for {len(SCREENS)} screens")
