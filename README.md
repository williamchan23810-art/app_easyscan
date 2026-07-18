# EasyScan 📸

> **EasyScan** is a premium, high-fidelity 5-stage mobile photo scanning and real-time restoration pipeline designed specifically for smartphone web browsers. 

Designed like a sleek car dashboard, EasyScan combines smart computer vision analytics with a tactile mobile camera interface. It guides users to align, capture, and restore print photos without steep tilting, glare reflection, or manual cropping headaches.

---

## 🚀 Live Demo & Deployment
EasyScan is built on a pure web stack and is completely static, making it fully ready for one-click deployment on **Netlify** or **GitHub Pages**.

* **Target URL:** `https://app-easyscan.netlify.app/`
* **Local Server:** Run `node server.js` to run locally at `http://localhost:8000/`.

---

## 🛠️ The 5-Stage Architecture

### 1. Stage 1: Immersive Mobile Viewfinder
* **Phone Mock Frame:** Immersive full-screen mobile viewport container.
* **Header Auto-Hide:** Hides navigation bars during scanning for distraction-free alignment.
* **Developer Dashboard:** A floating gear icon (**`⚙️`**) opens developer metrics, frame logs, and processing queue details in split-screen.

### 2. Stage 2: Canvas Mirroring & Stream Control
* **Webcam Discovery:** Automatic camera hardware search on startup.
* **Fallback Simulation:** Automatically boots into a fallback canvas loop displaying the **William H. Chan Studio** brand logo if no hardware camera is available.

### 3. Stage 3: Computer Vision Analytics & Coaching
* **Perspective Skew Guard (Tilt Check):** Mathematical analysis of parallel border lengths blocks scanning if the slanted angle exceeds 18%, warning the user to hold the phone flat.
* **Glare Reflection Warning:** Analyzes bright highlight clusters and warns the user if glare is detected inside the target crop zone.
* **Center Coaching Overlay:** Pulsing instructional overlays guide the user step-by-step.

### 4. Stage 4: Tactical Shutter Dashboard
* **Sliding Mode Switcher:** Toggle between **Auto-Capture** (detects stable alignment and triggers in 0.75 seconds) and **Manual Capture** (toggles the shutter button).
* **Shrunk Shutter (75%):** Ultra-sleek, compact shutter button with custom red polka dots.
* **SVG Countdown Ring:** Glowing progress ring that fills up clockwise over 0.75 seconds of stable alignment.
* **3D Hinging Photo Album:** Crimson red leather album book that physically **hinges open in 3D perspective** to catch flying photos and swings closed on absorption.
* **Active Count Badge:** Blue counter tag on the album shoulder that updates instantly.
* **Square Brand Logo:** Rounded square brand button matching smartphone icon standards.

### 5. Stage 5: Serialized Folder Gallery
* **Frictionless Save:** Captured photos fly from the viewfinder directly into the photo album button.
* **Split Compare Modal:** Review scans with a tactile sliding bar comparing the **Before** (skewed, faded paper) and **After** (perspectively straight, restored colors) versions.
* **JPEG Export:** Download high-resolution restored scans ($1080 \times 1920$ px portrait aspect ratio) with virtual EXIF metadata stamps.

---

## 📦 Project Structure
```bash
EasyScan/
├── index.html        # Main app entry, head tags & SEO metadata
├── style.css         # Custom typography, 3D rotations, and dashboard layout
├── app.js            # Capture pipeline, timing events, and animations
├── cv-engine.js      # Perspective warping, tilt analysis, and glare thresholds
├── server.js         # Lightweight local dev server
└── assets/           # Local mock targets, OG image, and logo graphics
```

---

## 🔧 Installation & Pushing to GitHub

To push this codebase to your GitHub repository (**`app-easyscan`**):

1. **Log in to GitHub CLI:**
   ```bash
   gh auth login
   ```
2. **Push the repository:**
   ```bash
   git add .
   git commit -m "Add GitHub Readme and SEO descriptions"
   git push -u origin main
   ```
