# HydLab Flow Sandbox

[Live demo: https://jinkashiwada.github.io/esePH/](https://jinkashiwada.github.io/esePH/)

The live demo runs interactively in a browser, so visitors can try the particle flow, dam break, bed editing, and wavemaker controls directly on their own device.

HydLab Flow Sandbox is a browser-based interactive flow demo for exploring water-like particle motion in a tank.

This is an extremely simplified pseudo-SPH model. It uses an SPH-like particle representation with density relaxation, artificial viscosity, fixed wall particles, dam-break initialization, editable bed geometry, and a simple wavemaker.

The primary goal is to spark interest in fluid simulation and hydraulic motion through an interactive visual experience. Physical and hydraulic accuracy have not been validated at all, and this demo should not be used for engineering design, quantitative analysis, or scientific interpretation.

## Features

- Real-time water-like particle motion in a closed tank
- Fixed boundary particles for side walls, bed, and wavemaker
- Dam-break preset with countdown
- Editable bed geometry
- Wavemaker with adjustable amplitude and period
- Adjustable viscosity multiplier
- White particles or velocity-colored particles
- Optional velocity vectors

## Run

Open `index.html` directly in a browser, or serve the directory with a static server:

```sh
python3 -m http.server 8001 --bind 0.0.0.0
```

Then open `http://127.0.0.1:8001/`.
