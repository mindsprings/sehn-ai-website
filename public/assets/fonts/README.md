# Fonts

Served from this site, so no visitor connects to a third party for them. Latin subsets, from Google Fonts. All under the
[SIL Open Font License 1.1](https://openfontlicense.org).

| File | Font | Copyright |
|---|---|---|
| `fraunces.woff2`, `fraunces-italic.woff2` | Fraunces, variable (optical size, weight 300–700) | Copyright 2020 The Fraunces Project Authors (github.com/undercasetype/Fraunces) |
| `plex-sans.woff2`, `plex-sans-italic.woff2` | IBM Plex Sans (variable weight; italic 400) | Copyright 2019 IBM Corp. |
| `old-standard.woff2`, `old-standard-italic.woff2`, `old-standard-bold.woff2` | Old Standard TT | Copyright 2011 The Old Standard Project Authors |

Fraunces is modified: its softness and wonkiness axes are pinned at 0 (no soft corners, no wonky letters) and its
weights limited to 300–700, with

    python -m fontTools.varLib.instancer Fraunces.woff2 SOFT=0 WONK=0 wght=300:700 --update-name-table -o fraunces.woff2
