import os
import zlib
import struct
import math

def make_png(width, height, get_pixel_func):
    raw_data = bytearray()
    for y in range(height):
        raw_data.append(0)  # Filter type 0 (None)
        for x in range(width):
            r, g, b, a = get_pixel_func(x, y, width, height)
            raw_data.extend([r, g, b, a])
    
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    header = b'\x89PNG\r\n\x1a\n'
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    ihdr = chunk(b'IHDR', ihdr_data)
    idat = chunk(b'IDAT', zlib.compress(bytes(raw_data), 9))
    iend = chunk(b'IEND', b'')
    return header + ihdr + idat + iend

def draw_clock_icon(x, y, w, h):
    cx, cy = w / 2.0, h / 2.0
    radius = (min(w, h) / 2.0) - 1.0
    dx = x - cx
    dy = y - cy
    dist = math.sqrt(dx * dx + dy * dy)

    if dist > radius:
        return (0, 0, 0, 0) # Transparent

    # Outer circle border / background: Royal Blue #2563EB
    if dist > radius - 2.0:
        return (29, 78, 216, 255) # Border
    
    # Clock face: vibrant blue
    bg_r, bg_g, bg_b = 37, 99, 235

    # Center dot
    if dist < radius * 0.15:
        return (255, 255, 255, 255)

    # Clock Hands (White)
    # Hour hand pointing to 3 o'clock (positive x, small y)
    if 0 <= dx <= radius * 0.55 and abs(dy) <= max(1.0, radius * 0.12):
        return (255, 255, 255, 255)

    # Minute hand pointing to 12 o'clock (small x, negative y)
    if -radius * 0.75 <= dy <= 0 and abs(dx) <= max(1.0, radius * 0.12):
        return (255, 255, 255, 255)

    # Rim circle highlight
    if radius * 0.75 < dist < radius * 0.88:
        return (96, 165, 250, 255)

    return (bg_r, bg_g, bg_b, 255)

os.makedirs('icons', exist_ok=True)
for size in [16, 48, 128]:
    png_bytes = make_png(size, size, draw_clock_icon)
    path = os.path.join('icons', f'icon{size}.png')
    with open(path, 'wb') as f:
        f.write(png_bytes)
    print(f'Generated {path} ({size}x{size})')
