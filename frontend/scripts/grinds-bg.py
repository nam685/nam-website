#!/usr/bin/env python3
"""Generate grinds page background mosaic from leaf/vine sprites."""

import argparse
import random
import subprocess

SPRITES = [
    (
        "public/grinds-leaves.png",
        [
            (187, 305, 683, 150),
            (128, 410, 132, 502),
            (139, 373, 446, 344),
            (132, 290, 139, 138),
            (261, 263, 600, 649),
            (93, 129, 385, 783),
        ],
    ),
    ("public/grinds-vine.png", [(1024, 1024, 0, 0)]),
]

W, H = 1920, 1280
OUT = "public/images/bg/grinds.jpg"


def main():
    p = argparse.ArgumentParser(description="Generate grinds mosaic background")
    p.add_argument("-n", "--nb-placements", type=int, default=140, help="number of sprite placements (default: 140)")
    p.add_argument("--scale-min", type=float, default=0.25, help="min scale factor (default: 0.25)")
    p.add_argument("--scale-max", type=float, default=0.7, help="max scale factor (default: 0.7)")
    p.add_argument("--vine-scale-min", type=float, default=0.15, help="min vine scale (default: 0.15)")
    p.add_argument("--vine-scale-max", type=float, default=0.35, help="max vine scale (default: 0.35)")
    p.add_argument("--darkness", type=int, default=18, help="brightness %% via -modulate (default: 18, lower=darker)")
    p.add_argument(
        "--vine-ratio", type=float, default=0.15, help="probability of picking vine vs leaf, 0-1 (default: 0.15)"
    )
    p.add_argument("--seed", type=int, default=99, help="random seed (default: 99)")
    args = p.parse_args()

    random.seed(args.seed)

    # Extract sprites to temp files
    tmp = []
    for src, regions in SPRITES:
        for w, h, x, y in regions:
            path = f"/tmp/grinds_sprite_{len(tmp)}.png"
            subprocess.run(["convert", src, "-crop", f"{w}x{h}+{x}+{y}", "+repage", path], check=True)
            tmp.append((path, w, h, src == "public/grinds-vine.png"))

    leaves = [(p, w, h, False) for p, w, h, v in tmp if not v]
    vines = [(p, w, h, True) for p, w, h, v in tmp if v]

    cmd = ["convert", "-size", f"{W}x{H}", "xc:black"]
    for _ in range(args.nb_placements):
        if vines and random.random() < args.vine_ratio:
            path, sw, sh, is_vine = random.choice(vines)
        else:
            path, sw, sh, is_vine = random.choice(leaves)
        if is_vine:
            scale = random.uniform(args.vine_scale_min, args.vine_scale_max)
        else:
            scale = random.uniform(args.scale_min, args.scale_max)
        nw, nh = int(sw * scale), int(sh * scale)
        rot = random.randint(-180, 180)
        x = random.randint(-nw // 2, W - nw // 2)
        y = random.randint(-nh // 2, H - nh // 2)
        flip = random.choice(["", "-flop", "-flip", "-flip -flop"])

        cmd.append("(")
        cmd.append(path)
        cmd.extend(["-resize", f"{nw}x{nh}"])
        if flip:
            cmd.extend(flip.split())
        cmd.extend(["-background", "black", "-rotate", str(rot)])
        cmd.append(")")
        sx = "+" if x >= 0 else ""
        sy = "+" if y >= 0 else ""
        cmd.extend(["-geometry", f"{sx}{x}{sy}{y}", "-compose", "Lighten", "-composite"])

    cmd.extend(["-modulate", f"{args.darkness},100,100", "-gaussian-blur", "0x1", "-quality", "85", OUT])
    subprocess.run(cmd, check=True)
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
