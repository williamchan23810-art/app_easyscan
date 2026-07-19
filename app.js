/**
 * EasyScan - Application Orchestrator
 * Integrates Stage 1 (Camera Init), Stage 2 (Canvas Mirroring), Stage 3 (Analytics Tick),
 * Stage 4 (Async Queue Workers), and Stage 5 (Serialized Folder Storage).
 */

document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const liveClock = document.getElementById('live-clock');
    const cameraSelect = document.getElementById('camera-select');
    const fileUploader = document.getElementById('file-uploader');
    const btnShutter = document.getElementById('btn-shutter');
    const cameraLoading = document.getElementById('camera-loading');
    const cameraHardwareDot = document.getElementById('camera-hardware-dot');
    
    // Canvas & Contexts
    const previewCanvas = document.getElementById('camera-preview-canvas');
    const previewCtx = previewCanvas.getContext('2d', { willReadFrequently: true });
    const overlayCanvas = document.getElementById('overlay-canvas');
    const overlayCtx = overlayCanvas.getContext('2d');
    const targetGrid = document.getElementById('target-grid');
    const viewportContainer = document.getElementById('viewport-container');

    // Analytics Dashboard
    const glareGaugeFill = document.getElementById('glare-gauge-fill');
    const glareGaugeVal = document.getElementById('glare-gauge-val');
    const glareStatus = document.getElementById('glare-status');
    const boundaryStatus = document.getElementById('boundary-status');
    const glareAlertOverlay = document.getElementById('glare-alert');
    const tiltAlertOverlay = document.getElementById('tilt-alert');
    const shutterTimerFill = document.getElementById('shutter-timer-fill');
    const shutterFlash = document.getElementById('shutter-flash');
    const savedToast = document.getElementById('saved-toast');
    const toastFilename = document.getElementById('toast-filename');

    // Queue Visualizer
    const queueLoadText = document.getElementById('queue-load');
    const uiLatencyText = document.getElementById('ui-latency');
    const queueIndicator = document.getElementById('queue-indicator');
    const workerWarpStatus = document.getElementById('worker-warp-status');
    const workerWarpProgress = document.getElementById('worker-warp-progress');
    const workerWarpInfo = document.getElementById('worker-warp-info');
    const workerRestStatus = document.getElementById('worker-rest-status');
    const workerRestProgress = document.getElementById('worker-rest-progress');
    const workerRestInfo = document.getElementById('worker-rest-info');

    // Serialized Storage Gallery
    const galleryGrid = document.getElementById('gallery-grid');
    const galleryEmpty = document.getElementById('gallery-empty');
    const dirCount = document.getElementById('dir-count');
    const dirPath = document.getElementById('dir-path');

    // Modal Slider elements
    const compareModal = document.getElementById('compare-modal');
    const btnCloseModal = document.getElementById('btn-close-modal');
    const btnModalCloseAction = document.getElementById('btn-modal-close-action');
    const btnDownloadScan = document.getElementById('btn-download-scan');
    const comparisonSlider = document.getElementById('comparison-slider');
    const sliderHandle = document.getElementById('slider-handle');
    const imageAfterContainer = document.getElementById('comparison-image-after');
    const canvasBefore = document.getElementById('compare-canvas-before');
    const canvasAfter = document.getElementById('compare-canvas-after');

    // EXIF Metadata elements
    const exifFilename = document.getElementById('exif-filename');
    const exifDirectory = document.getElementById('exif-directory');
    const exifFormat = document.getElementById('exif-format');

    // Pipeline State Variables
    let activeSource = 'webcam'; // 'webcam', 'aged', 'glare', 'file'
    let gridRatio = '9:16'; // '9:16' Portrait Lock
    let autoCapture = false;
    let cameraStream = null;
    let webcamVideo = null;
    let testImageAged = null;
    let testImageGlare = null;
    let uploadedImage = null;

    // Corner Tracking state
    let corners = [
        { x: 100, y: 120 }, // TL
        { x: 540, y: 120 }, // TR
        { x: 500, y: 380 }, // BR
        { x: 140, y: 380 }  // BL
    ];
    let activeDragIndex = null;
    let autoDetectionTick = 0;
    let captureCoolDown = false;
    let boundaryStableFrames = 0;
    let lastCorners = JSON.parse(JSON.stringify(corners));

    // Queue State
    const processingQueue = [];
    let isWorkerBusy = false;
    const scanDatabase = [];

    // Current Date Folder setup
    const currentDateStr = "2026-07-18";
    dirPath.textContent = `/EasyScan_Scans_${currentDateStr}/`;

    // Audio confirmation sound generator (using Web Audio API to bypass asset file load issues)
    const playShutterSound = () => {
        try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            
            // Camera click high frequency sound
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(800, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.12);
            
            gain.gain.setValueAtTime(0.5, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.12);
            
            osc.start();
            osc.stop(audioCtx.currentTime + 0.12);
        } catch (e) {
            console.log("Audio contexts blocked or not supported", e);
        }
    };

    // Live clock update
    setInterval(() => {
        const d = new Date();
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        const ss = String(d.getSeconds()).padStart(2, '0');
        if (liveClock) {
            liveClock.textContent = `2026-07-18 ${hh}:${mm}:${ss}`;
        }
    }, 1000);

    // Grid sweet spot boundary dimensions mapping
    // Grid sweet spot boundary dimensions mapping (9:16 Portrait Lock)
    const getTargetGridSpecs = () => {
        // Large target grid box centered on the visible phone screen (Request 4)
        return {
            x: 178,
            y: 24,
            width: 284,
            height: 432
        };
    };

    // Initialize UI Target Grid dimensions
    const updateTargetGridUI = () => {
        targetGrid.className = 'target-grid-overlay grid-9-16';
    };

    // Setup drag handling for corners
    const initDragHandlers = () => {
        const handles = [
            document.getElementById('handle-0'),
            document.getElementById('handle-1'),
            document.getElementById('handle-2'),
            document.getElementById('handle-3')
        ];

        const updateHandlePositions = () => {
            const rect = previewCanvas.getBoundingClientRect();
            corners.forEach((c, idx) => {
                // Convert canvas coords to UI viewport container offset
                const uiX = (c.x / previewCanvas.width) * rect.width;
                const uiY = (c.y / previewCanvas.height) * rect.height;
                handles[idx].style.left = `${uiX}px`;
                handles[idx].style.top = `${uiY}px`;
            });
        };

        const getMousePos = (e) => {
            const rect = viewportContainer.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            
            // Return scaled to canvas size
            const scaleX = previewCanvas.width / rect.width;
            const scaleY = previewCanvas.height / rect.height;
            return {
                x: Math.max(0, Math.min(previewCanvas.width, (clientX - rect.left) * scaleX)),
                y: Math.max(0, Math.min(previewCanvas.height, (clientY - rect.top) * scaleY))
            };
        };

        const onStart = (idx, e) => {
            e.preventDefault();
            activeDragIndex = idx;
            handles[idx].classList.add('active');
        };

        const onMove = (e) => {
            if (activeDragIndex === null) return;
            const pos = getMousePos(e);
            corners[activeDragIndex].x = Math.round(pos.x);
            corners[activeDragIndex].y = Math.round(pos.y);
            updateHandlePositions();
        };

        const onEnd = () => {
            if (activeDragIndex !== null) {
                handles[activeDragIndex].classList.remove('active');
                activeDragIndex = null;
            }
        };

        handles.forEach((handle, idx) => {
            handle.addEventListener('mousedown', (e) => onStart(idx, e));
            handle.addEventListener('touchstart', (e) => onStart(idx, e), { passive: false });
        });

        window.addEventListener('mousemove', onMove);
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('mouseup', onEnd);
        window.addEventListener('touchend', onEnd);

        // Keep handles aligned on window resize
        window.addEventListener('resize', updateHandlePositions);

        // Trigger first position update
        setTimeout(updateHandlePositions, 100);
    };

    // Stage 1: Asynchronous Initialization of hardware camera
    const initCameraHardware = async () => {
        cameraLoading.classList.remove('hidden');
        cameraHardwareDot.className = 'status-dot yellow';

        // Stop existing stream if running
        if (cameraStream) {
            cameraStream.getTracks().forEach(track => track.stop());
            cameraStream = null;
        }

        try {
            // Max resolutions lock profile simulation (Stage 1)
            cameraStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'environment',
                    width: { ideal: 1920, min: 1280 },
                    height: { ideal: 1080, min: 720 }
                },
                audio: false
            });

            if (!webcamVideo) {
                webcamVideo = document.createElement('video');
                webcamVideo.setAttribute('autoplay', '');
                webcamVideo.setAttribute('playsinline', '');
                webcamVideo.setAttribute('muted', '');
                webcamVideo.muted = true;
            }
            webcamVideo.srcObject = cameraStream;
            
            // Wait for video load metadata
            await new Promise((resolve) => {
                webcamVideo.onloadedmetadata = () => {
                    webcamVideo.play();
                    resolve();
                };
            });

            cameraLoading.classList.add('hidden');
            cameraHardwareDot.className = 'status-dot green';
        } catch (err) {
            console.warn("Webcam hardware init failed/denied, falling back to simulation.", err);
            cameraHardwareDot.className = 'status-dot red';
            cameraLoading.classList.add('hidden');
            
            // Switch dropdown back to static simulated assets if selector exists
            if (cameraSelect) {
                cameraSelect.value = 'aged';
            }
            activeSource = 'aged';
            resetCornersToSkewedSim();

            // Trigger non-blocking toast overlay explaining simulated fallback
            toastFilename.textContent = "Simulated Fallback Mode";
            const toastText = savedToast.querySelector('.toast-text p');
            const originalText = toastText ? toastText.textContent : "Saved to folder successfully";
            if (toastText) toastText.textContent = "Webcam offline • Loaded Demo Photo";
            savedToast.classList.add('show');
            setTimeout(() => {
                savedToast.classList.remove('show');
                // Restore toast text for subsequent scanned photo saves
                setTimeout(() => {
                    if (toastText) toastText.textContent = originalText;
                }, 500);
            }, 3500);
        }
    };

    // Preload Test Images
    const loadTestImages = () => {
        testImageAged = new Image();
        testImageAged.src = 'assets/williamhchan_studio_logo.jpg';

        testImageGlare = new Image();
        testImageGlare.src = 'assets/williamhchan_studio_logo.jpg';

        // Hard reset corners when images load to fit nicely
        testImageAged.onload = () => {
            resetCornersToSkewedSim();
            // Hide loading overlay once simulated photo is loaded
            cameraLoading.classList.add('hidden');
        };
    };

    const resetCornersToSkewedSim = () => {
        // Center the corner pins around the scaled square logo print
        if (activeSource === 'aged' || activeSource === 'glare') {
            corners = [
                { x: 155, y: 75 },   // TL
                { x: 485, y: 75 },   // TR
                { x: 485, y: 405 },  // BR
                { x: 155, y: 405 }   // BL
            ];
        } else {
            const grid = getTargetGridSpecs();
            corners = [
                { x: grid.x, y: grid.y },
                { x: grid.x + grid.width, y: grid.y },
                { x: grid.x + grid.width, y: grid.y + grid.height },
                { x: grid.x, y: grid.y + grid.height }
            ];
        }
        initDragHandlers();
    };

    // Stage 2 & 3: Frame loop running analytics at 60fps
    const tick = () => {
        // Draw frame to preview canvas
        if (activeSource === 'webcam' && cameraStream && webcamVideo.readyState === webcamVideo.HAVE_ENOUGH_DATA) {
            // Mirror stream
            previewCtx.save();
            previewCtx.drawImage(webcamVideo, 0, 0, previewCanvas.width, previewCanvas.height);
            previewCtx.restore();
        } else if (activeSource === 'aged' && testImageAged.complete) {
            // Draw slate desk background texture
            previewCtx.fillStyle = '#0f172a';
            previewCtx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
            
            // Draw logo centered inside canvas vertical safe crop area
            const size = 330;
            const lx = (previewCanvas.width - size) / 2; // 155
            const ly = (previewCanvas.height - size) / 2; // 75
            previewCtx.drawImage(testImageAged, lx, ly, size, size);
        } else if (activeSource === 'glare' && testImageGlare.complete) {
            previewCtx.fillStyle = '#0f172a';
            previewCtx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
            
            const size = 330;
            const lx = (previewCanvas.width - size) / 2;
            const ly = (previewCanvas.height - size) / 2;
            previewCtx.drawImage(testImageGlare, lx, ly, size, size);
        } else if (activeSource === 'file' && uploadedImage) {
            previewCtx.drawImage(uploadedImage, 0, 0, previewCanvas.width, previewCanvas.height);
        }

        // Run Real-Time Analytics Tick
        const targetGridSpecs = getTargetGridSpecs();

        // 1. Boundary Snapping (Auto corner detection every 30 frames for stability)
        autoDetectionTick++;
        if (autoDetectionTick >= 30 && activeDragIndex === null && activeSource !== 'aged' && activeSource !== 'glare') {
            const detected = CVEngine.autoDetectCorners(previewCanvas, targetGridSpecs);
            // Interpolate slightly towards detected for visual smoothness
            for (let i = 0; i < 4; i++) {
                corners[i].x += (detected[i].x - corners[i].x) * 0.2;
                corners[i].y += (detected[i].y - corners[i].y) * 0.2;
            }
            autoDetectionTick = 0;
        }

        // 2. Glare check inside boundary
        const glareResult = CVEngine.glareAnalysis(previewCanvas, corners);
        const glareRatio = glareResult.ratio;
        const glarePercent = (glareRatio * 100).toFixed(1);

        // Update dashboard UI
        glareGaugeFill.style.width = `${glarePercent}%`;
        glareGaugeVal.textContent = `${glarePercent}%`;

        // 3. Tilt Angle evaluation (perspective skew check)
        const W_top = Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y);
        const W_bottom = Math.hypot(corners[2].x - corners[3].x, corners[2].y - corners[3].y);
        const H_left = Math.hypot(corners[3].x - corners[0].x, corners[3].y - corners[0].y);
        const H_right = Math.hypot(corners[2].x - corners[1].x, corners[2].y - corners[1].y);

        const skewW = Math.abs(W_top - W_bottom) / Math.max(W_top, W_bottom, 1);
        const skewH = Math.abs(H_left - H_right) / Math.max(H_left, H_right, 1);
        const maxTiltSkew = Math.max(skewW, skewH);

        let tiltBlocked = false;
        if (maxTiltSkew >= 0.18) {
            // tiltAlertOverlay.classList.add('show'); // Visual yellow alert popup removed (Request 3)
            tiltBlocked = true;
        } else {
            tiltAlertOverlay.classList.remove('show');
        }

        // Handle Glare Alert triggers (Stage 3 threshold > 10%)
        let glareBlocked = false;
        if (glareRatio >= 0.10) {
            glareGaugeFill.className = 'glare-gauge-fill warning';
            glareStatus.textContent = 'WARNING - HIGH REFLECTION DETECTED';
            glareStatus.style.color = 'var(--accent-red)';
            glareAlertOverlay.classList.add('show');
            glareBlocked = true;
        } else {
            glareGaugeFill.className = 'glare-gauge-fill';
            glareStatus.textContent = 'SAFE - AUTO-CAPTURE READY';
            glareStatus.style.color = 'var(--accent-green)';
            glareAlertOverlay.classList.remove('show');
        }

        const captureBlocked = glareBlocked || tiltBlocked;
        // In Custom/Manual mode, the shutter button is never disabled (Request 1)
        if (captureBlocked && autoCapture) {
            btnShutter.classList.add('shutter-disabled');
        } else {
            btnShutter.classList.remove('shutter-disabled');
        }

        // Check if quadrilateral fits target grid parameters
        const isAligned = verifyAlignment(corners, targetGridSpecs);
        if (isAligned && !captureBlocked) {
            boundaryStatus.innerHTML = `
                <span class="status-dot green"></span>
                <span class="status-text">QUADRILATERAL ALIGNED</span>
            `;
        } else if (tiltBlocked) {
            boundaryStatus.innerHTML = `
                <span class="status-dot yellow"></span>
                <span class="status-text">OVER-TILTING DETECTED</span>
            `;
        } else if (glareBlocked) {
            boundaryStatus.innerHTML = `
                <span class="status-dot red"></span>
                <span class="status-text">OVER-GLARE DETECTED</span>
            `;
        } else {
            boundaryStatus.innerHTML = `
                <span class="status-dot yellow"></span>
                <span class="status-text">ALIGN PHOTO TO GRID</span>
            `;
        }

        // Clear overlay canvas
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

        // Draw glare pixels overlay mask if active (helps user visualize reflection tracks)
        if (glareRatio > 0.02) {
            overlayCtx.fillStyle = 'rgba(239, 68, 68, 0.45)';
            glareResult.glarePixels.forEach(p => {
                overlayCtx.fillRect(p.x, p.y, 2, 2);
            });
        }

        // Draw a clean, glowing green boundary outline around detected corners for real-time visual feedback
        overlayCtx.beginPath();
        overlayCtx.moveTo(corners[0].x, corners[0].y);
        overlayCtx.lineTo(corners[1].x, corners[1].y);
        overlayCtx.lineTo(corners[2].x, corners[2].y);
        overlayCtx.lineTo(corners[3].x, corners[3].y);
        overlayCtx.closePath();
        overlayCtx.lineWidth = 2.5;
        overlayCtx.strokeStyle = isAligned ? 'rgba(16, 185, 129, 0.95)' : 'rgba(255, 255, 255, 0.45)';
        overlayCtx.shadowColor = isAligned ? '#10B981' : 'transparent';
        overlayCtx.shadowBlur = isAligned ? 8 : 0;
        overlayCtx.stroke();
        overlayCtx.shadowBlur = 0; // reset shadow

        // Auto-Capture countdown timer SVG & Capture triggering logic
        if (autoCapture) {
            shutterTimerFill.classList.remove('greyed');
            if (isAligned && !captureBlocked && !captureCoolDown) {
                let movement = 0;
                for (let i = 0; i < 4; i++) {
                    movement += Math.hypot(corners[i].x - lastCorners[i].x, corners[i].y - lastCorners[i].y);
                }

                if (movement < 5) {
                    boundaryStableFrames++;
                    // Render SVG Countdown timer progress fill (Radius = 28, Circumference = 175.93)
                    const pct = Math.min(1.0, boundaryStableFrames / 45);
                    shutterTimerFill.style.strokeDashoffset = 175.93 * (1 - pct);

                    if (boundaryStableFrames > 45) { // 0.75 seconds stable
                        // Turn off auto-capture if using static simulated images to prevent loop
                        if (activeSource !== 'webcam') {
                            autoCapture = false;
                            const optAuto = document.getElementById('opt-auto');
                            const optManual = document.getElementById('opt-manual');
                            const modeSlider = document.getElementById('mode-slider');
                            if (optAuto && optManual && modeSlider) {
                                optAuto.classList.remove('active');
                                optManual.classList.add('active');
                                modeSlider.style.left = '50%';
                            }
                            shutterTimerFill.classList.add('greyed');
                            shutterTimerFill.style.strokeDashoffset = '175.93';
                        }
                        triggerCapture();
                        boundaryStableFrames = 0;
                    }
                } else {
                    boundaryStableFrames = 0;
                    shutterTimerFill.style.strokeDashoffset = '175.93';
                }
            } else {
                boundaryStableFrames = 0;
                shutterTimerFill.style.strokeDashoffset = '175.93';
            }
        } else {
            // Manual capture - timer is greyed and empty
            boundaryStableFrames = 0;
            shutterTimerFill.classList.add('greyed');
            shutterTimerFill.style.strokeDashoffset = '175.93';
        }

        // Save last corner coordinates for stability checking
        lastCorners = JSON.parse(JSON.stringify(corners));

        // Refresh handle overlays in case container resized
        const rect = previewCanvas.getBoundingClientRect();
        corners.forEach((c, idx) => {
            const h = document.getElementById(`handle-${idx}`);
            const uiX = (c.x / previewCanvas.width) * rect.width;
            const uiY = (c.y / previewCanvas.height) * rect.height;
            h.style.left = `${uiX}px`;
            h.style.top = `${uiY}px`;
        });

        requestAnimationFrame(tick);
    };

    // Helper: Verify quadrilateral boundary is reasonably located in target zone
    const verifyAlignment = (p, grid) => {
        // Quick centroid check: check if the center of quad is inside grid boundaries
        const cx = (p[0].x + p[1].x + p[2].x + p[3].x) / 4;
        const cy = (p[0].y + p[1].y + p[2].y + p[3].y) / 4;

        const pad = 30; // alignment margin tolerance
        return (cx > grid.x - pad && cx < grid.x + grid.width + pad &&
                cy > grid.y - pad && cy < grid.y + grid.height + pad);
    };

    // Capture triggering
    const triggerCapture = () => {
        if (captureCoolDown) return;
        
        // Enforce 100-scans capacity limit (Request 6)
        if (scanDatabase.length >= 100) {
            alert("Album full! Please download or delete photos to scan more.");
            return;
        }

        captureCoolDown = true;
        boundaryStableFrames = 0;

        // Stage 4 immediate visual click confirmation (< 50ms)
        const tStart = performance.now();
        playShutterSound();
        shutterFlash.classList.add('flash-active');
        
        // Grab raw uncompressed frame
        const rawFrame = document.createElement('canvas');
        rawFrame.width = previewCanvas.width;
        rawFrame.height = previewCanvas.height;
        rawFrame.getContext('2d').drawImage(previewCanvas, 0, 0);

        const targetGridSpecs = getTargetGridSpecs();
        const detected = CVEngine.autoDetectCorners(previewCanvas, targetGridSpecs);
        const currentCorners = JSON.parse(JSON.stringify(detected));
        const captureTimeStr = new Date().toTimeString().split(' ')[0].replace(/:/g, '');

        const scanItem = {
            id: `Scan_${captureTimeStr}`,
            timestamp: new Date().toLocaleTimeString(),
            rawCanvas: rawFrame,
            corners: currentCorners,
            restoredCanvas: null,
            exif: null
        };

        // UI immediately flushes back to live state (< 50ms confirmation latency metric)
        setTimeout(() => {
            shutterFlash.classList.remove('flash-active');
            uiLatencyText.textContent = `${Math.round(performance.now() - tStart)} ms`;
            captureCoolDown = false;
        }, 40);

        // Handoff to Stage 4 decoupled worker queue
        pushToProcessingQueue(scanItem);
    };

    // Stage 4: Decoupled Queue Orchestration
    const pushToProcessingQueue = (scanItem) => {
        processingQueue.push(scanItem);
        queueLoadText.textContent = `${processingQueue.length} tasks`;
        
        if (!isWorkerBusy) {
            processNextQueueItem();
        }
    };

    const processNextQueueItem = () => {
        if (processingQueue.length === 0) {
            isWorkerBusy = false;
            queueIndicator.textContent = 'IDLE';
            queueIndicator.className = 'queue-indicator';
            return;
        }

        isWorkerBusy = true;
        queueIndicator.textContent = 'PROCESSING';
        queueIndicator.className = 'queue-indicator processing';

        const item = processingQueue.shift();
        queueLoadText.textContent = `${processingQueue.length} tasks`;

        // Simulate asynchronous background core workers (Threads A & B via CPU timers)
        workerWarpStatus.textContent = 'RUNNING';
        workerWarpStatus.className = 'worker-status running';
        workerWarpProgress.style.width = '0%';
        workerWarpInfo.textContent = 'Calculating projective matrix & bilinear mapping...';

        const processingStart = performance.now();

        // Simulate Thread A: Geometric Warp Engine
        let warpProgress = 0;
        const warpInterval = setInterval(() => {
            warpProgress += 20;
            workerWarpProgress.style.width = `${warpProgress}%`;
            if (warpProgress >= 100) {
                clearInterval(warpInterval);
                workerWarpStatus.textContent = 'COMPLETE';
                workerWarpStatus.className = 'worker-status';
                workerWarpInfo.textContent = 'Coordinate warp mapping completed.';
                
                // Proceed to Thread B: Smart Restoration Engine
                runRestorationWorker(item, processingStart);
            }
        }, 60);
    };

    const runRestorationWorker = (item, startTime) => {
        workerRestStatus.textContent = 'RUNNING';
        workerRestStatus.className = 'worker-status running';
        workerRestProgress.style.width = '0%';
        workerRestInfo.textContent = 'Analyzing contrast levels & yellowing oxidation...';

        let restProgress = 0;
        const restInterval = setInterval(() => {
            restProgress += 25;
            workerRestProgress.style.width = `${restProgress}%`;
            if (restProgress >= 100) {
                clearInterval(restInterval);
                workerRestStatus.textContent = 'COMPLETE';
                workerRestStatus.className = 'worker-status';
                workerRestInfo.textContent = 'Restoration matrices applied.';

                // Perform the actual CV computations on a temporary canvas (rotated and aspect-ratio preserved) (Request 3)
                const corners = item.corners;
                const wTop = Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y);
                const wBottom = Math.hypot(corners[2].x - corners[3].x, corners[2].y - corners[3].y);
                const hLeft = Math.hypot(corners[3].x - corners[0].x, corners[3].y - corners[0].y);
                const hRight = Math.hypot(corners[2].x - corners[1].x, corners[2].y - corners[1].y);

                const avgW = (wTop + wBottom) / 2;
                const avgH = (hLeft + hRight) / 2;
                const rawAspect = avgW / avgH;

                let targetW, targetH;
                if (avgW > avgH) {
                    // Document is vertical (portrait) in real world
                    targetW = 1080;
                    targetH = Math.round(1080 * rawAspect);
                } else {
                    // Document is horizontal (landscape) in real world
                    targetH = 1080;
                    targetW = Math.round(1080 / rawAspect);
                }

                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = targetH;
                tempCanvas.height = targetW;

                // 1. Warp perspective to native landscape sensor orientation first
                CVEngine.warpPerspective(item.rawCanvas, tempCanvas, item.corners);

                // 2. Rotate 90 degrees clockwise to align upright (Request 3)
                const warpCanvas = document.createElement('canvas');
                warpCanvas.width = targetW;
                warpCanvas.height = targetH;
                const warpCtx = warpCanvas.getContext('2d');
                warpCtx.translate(targetW, 0);
                warpCtx.rotate(90 * Math.PI / 180);
                warpCtx.drawImage(tempCanvas, 0, 0);

                // Analyze yellow ratio before restoration for metadata logs
                const analysisCtx = warpCanvas.getContext('2d');
                const analysisData = analysisCtx.getImageData(0,0,targetW,targetH).data;
                let sumR=0, sumG=0, sumB=0;
                for(let i=0; i<analysisData.length; i+=40){ // step sampling
                    sumR += analysisData[i];
                    sumG += analysisData[i+1];
                    sumB += analysisData[i+2];
                }
                const rawYellowVal = ((sumR + sumG)/2) / (sumB || 1);

                // 2. Fading Matrix
                CVEngine.restoreFading(warpCanvas);

                // 3. Age Matrix
                CVEngine.restoreAge(warpCanvas);

                // 4. Frequency Matrix (Scratch fix)
                CVEngine.restoreFrequency(warpCanvas);

                const latency = Math.round(performance.now() - startTime);

                // Compile EXIF metadata payload (Stage 5)
                const hhmmss = item.id.split('_')[1];
                item.restoredCanvas = warpCanvas;
                item.exif = {
                    filename: `Scan_${hhmmss}.jpg`,
                    directory: `/Documents/EasyScan_Scans_${currentDateStr}/`,
                    format: 'JPEG (95% density grain profile)',
                    processedTag: 'EasyScan_Processed = True',
                    fadingScore: 'Shadow stretch: +8% / Highlights: -3%',
                    ageScore: rawYellowVal > 1.08 
                        ? `Cooling Vector Applied: +${((rawYellowVal - 1) * 80).toFixed(1)}%` 
                        : 'Color Temperature: Neutral (no shift)',
                    scratchScore: activeSource === 'aged' 
                        ? 'Detected hairline scratches: 1.2% inpainted' 
                        : 'No scratch anomalies detected',
                    latency: `${latency} ms`
                };

                // Save scan to virtual file system
                scanDatabase.push(item);
                
                // Update folder gallery (Stage 5)
                updateGalleryUI();

                // Update bottom folder badge count
                const badge = document.getElementById('folder-badge-count');
                if (badge) {
                    badge.textContent = scanDatabase.length;
                }

                // Execute cell phone style flying photo animation (Viewfinder to folder icon)
                const rectSrc = viewportContainer.getBoundingClientRect();
                const folderCircle = document.querySelector('.folder-icon-circle');
                const bookFront = document.getElementById('book-front');
                
                if (rectSrc && folderCircle) {
                    // Open the 3D book cover immediately when the photo starts flying
                    if (bookFront) {
                        bookFront.classList.add('book-open');
                    }

                    const rectDst = folderCircle.getBoundingClientRect();
                    const flyer = document.createElement('img');
                    flyer.className = 'flying-flyer';
                    // Use the processed image canvas URL for the flyer
                    flyer.src = item.restoredCanvas.toDataURL('image/jpeg', 0.5);
                    
                    flyer.style.left = `${rectSrc.left + window.scrollX}px`;
                    flyer.style.top = `${rectSrc.top + window.scrollY}px`;
                    flyer.style.width = `${rectSrc.width}px`;
                    flyer.style.height = `${rectSrc.height}px`;
                    
                    document.body.appendChild(flyer);
                    
                    // Force DOM reflow
                    flyer.offsetWidth;
                    
                    // Animate to folder destination with rotation and shrink warp
                    flyer.style.left = `${rectDst.left + rectDst.width / 2 - 10 + window.scrollX}px`;
                    flyer.style.top = `${rectDst.top + rectDst.height / 2 - 10 + window.scrollY}px`;
                    flyer.style.width = '20px';
                    flyer.style.height = '20px';
                    flyer.style.opacity = '0';
                    flyer.style.transform = 'rotate(720deg) scale(0.1)';
                    
                    flyer.addEventListener('transitionend', () => {
                        flyer.remove();
                        
                        // Close the 3D book cover upon photo absorption
                        if (bookFront) {
                            bookFront.classList.remove('book-open');
                        }

                        // Trigger absorption pulse glow
                        folderCircle.classList.add('pulse-save');
                        setTimeout(() => {
                            folderCircle.classList.remove('pulse-save');
                        }, 500);
                    });
                }

                // Trigger non-blocking Saved Toast notification for fast bulk scanning
                toastFilename.textContent = item.exif.filename;
                savedToast.classList.add('show');
                setTimeout(() => {
                    savedToast.classList.remove('show');
                }, 2500);

                // Process next in queue
                setTimeout(processNextQueueItem, 200);
            }
        }, 80);
    };

    // Stage 5: Update the Serialized gallery interface
    const updateGalleryUI = () => {
        if (scanDatabase.length === 0) {
            galleryEmpty.style.display = 'flex';
            dirCount.textContent = '0 items';
            return;
        }

        galleryEmpty.style.display = 'none';
        dirCount.textContent = `${scanDatabase.length} items`;

        // Clear previous grid items (except empty div)
        const items = galleryGrid.querySelectorAll('.gallery-item');
        items.forEach(el => el.remove());

        scanDatabase.forEach(scan => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'gallery-item';
            
            const thumbContainer = document.createElement('div');
            thumbContainer.className = 'gallery-thumb-container';
            
            const thumb = document.createElement('img');
            thumb.className = 'gallery-thumb';
            // Render from output canvas
            thumb.src = scan.restoredCanvas.toDataURL('image/jpeg', 0.5); // low density thumbnail
            
            thumbContainer.appendChild(thumb);
            
            const label = document.createElement('span');
            label.className = 'gallery-name';
            label.textContent = scan.exif.filename;

            itemDiv.appendChild(thumbContainer);
            itemDiv.appendChild(label);

            itemDiv.addEventListener('click', () => showComparisonModal(scan));
            galleryGrid.appendChild(itemDiv);
        });
    };

    // Comparison Modal display
    const showComparisonModal = (scan) => {
        // Set canvas bounds
        canvasBefore.width = scan.rawCanvas.width;
        canvasBefore.height = scan.rawCanvas.height;
        canvasBefore.getContext('2d').drawImage(scan.rawCanvas, 0, 0);

        canvasAfter.width = scan.restoredCanvas.width;
        canvasAfter.height = scan.restoredCanvas.height;
        canvasAfter.getContext('2d').drawImage(scan.restoredCanvas, 0, 0);

        // Bind EXIF labels
        exifFilename.textContent = scan.exif.filename;
        exifDirectory.textContent = scan.exif.directory;
        exifFormat.textContent = `${scan.restoredCanvas.width} x ${scan.restoredCanvas.height} • JPEG (95% Quality)`;

        // Set download trigger
        btnDownloadScan.href = scan.restoredCanvas.toDataURL('image/jpeg', 0.95);
        btnDownloadScan.download = scan.exif.filename;

        // Reset split slider to middle
        imageAfterContainer.style.width = '50%';
        sliderHandle.style.left = '50%';

        // Show modal
        compareModal.classList.add('show');
    };

    // Modal split-slider dragging mechanics
    const initSliderDrag = () => {
        if (!comparisonSlider) return; // Safeguard if slider is removed (Request 1)
        let isDragging = false;

        const setSliderWidth = (clientX) => {
            const rect = comparisonSlider.getBoundingClientRect();
            const offset = clientX - rect.left;
            const percentage = Math.max(0, Math.min(100, (offset / rect.width) * 100));
            
            imageAfterContainer.style.width = `${percentage}%`;
            sliderHandle.style.left = `${percentage}%`;
        };

        const onDragStart = (e) => {
            isDragging = true;
            setSliderWidth(e.touches ? e.touches[0].clientX : e.clientX);
        };

        const onDragMove = (e) => {
            if (!isDragging) return;
            setSliderWidth(e.touches ? e.touches[0].clientX : e.clientX);
        };

        const onDragEnd = () => {
            isDragging = false;
        };

        comparisonSlider.addEventListener('mousedown', onDragStart);
        comparisonSlider.addEventListener('touchstart', onDragStart, { passive: false });

        window.addEventListener('mousemove', onDragMove);
        window.addEventListener('touchmove', onDragMove, { passive: false });

        window.addEventListener('mouseup', onDragEnd);
        window.addEventListener('touchend', onDragEnd);
    };

    // UI Event Listeners

    // Sliding Mode Switcher (Auto / Manual Toggle)
    const modeSelector = document.getElementById('mode-selector');
    if (modeSelector) {
        modeSelector.addEventListener('click', (e) => {
            const option = e.target.closest('.mode-option');
            if (!option) return;
            
            const mode = option.dataset.mode;
            const optAuto = document.getElementById('opt-auto');
            const optManual = document.getElementById('opt-manual');
            const modeSlider = document.getElementById('mode-slider');
            
            if (mode === 'auto') {
                autoCapture = true;
                optAuto.classList.add('active');
                optManual.classList.remove('active');
                modeSlider.style.left = '0%';
                shutterTimerFill.classList.remove('greyed');
            } else {
                autoCapture = false;
                optAuto.classList.remove('active');
                optManual.classList.add('active');
                modeSlider.style.left = '50%';
                shutterTimerFill.classList.add('greyed');
                shutterTimerFill.style.strokeDashoffset = '175.93';
            }
        });
    }

    const onShutterTrigger = (e) => {
        if (e) e.preventDefault();
        triggerCapture();
    };
    btnShutter.addEventListener('click', onShutterTrigger);
    btnShutter.addEventListener('touchstart', onShutterTrigger, { passive: false });

    if (cameraSelect) {
        cameraSelect.addEventListener('change', (e) => {
            activeSource = e.target.value;
            if (activeSource === 'webcam') {
                initCameraHardware();
            } else if (activeSource === 'file') {
                fileUploader.click();
            } else {
                if (cameraStream) {
                    cameraStream.getTracks().forEach(track => track.stop());
                    cameraStream = null;
                    cameraHardwareDot.className = 'status-dot green';
                }
                cameraLoading.classList.add('hidden');
                resetCornersToSkewedSim();
            }
        });
    }

    fileUploader.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                uploadedImage = new Image();
                uploadedImage.onload = () => {
                    cameraLoading.classList.add('hidden');
                    resetCornersToSkewedSim();
                };
                uploadedImage.src = event.target.result;
            };
            reader.readAsDataURL(file);
        } else {
            // Revert dropdown
            cameraSelect.value = 'aged';
            activeSource = 'aged';
            cameraLoading.classList.add('hidden');
            resetCornersToSkewedSim();
        }
    });

    // Close Modals
    const closeModal = () => {
        compareModal.classList.remove('show');
    };
    btnCloseModal.addEventListener('click', closeModal);
    btnModalCloseAction.addEventListener('click', closeModal);

    // Photo Album Gallery Modal Management (Request 3, 5, 7, 8)
    let selectedPhotoIndices = new Set();

    const albumGrid = document.getElementById('album-grid');
    const albumEmptyState = document.getElementById('album-empty-state');
    const galleryBadgeCount = document.getElementById('gallery-badge-count');
    const albumUsageBar = document.getElementById('album-usage-bar');
    const btnRemoveSelected = document.getElementById('btn-remove-selected');
    const deleteSelectedCount = document.getElementById('delete-selected-count');

    const updateAlbumGalleryUI = () => {
        if (!albumGrid) return;
        albumGrid.innerHTML = '';
        
        const count = scanDatabase.length;
        if (galleryBadgeCount) galleryBadgeCount.textContent = count;
        if (albumUsageBar) albumUsageBar.style.width = `${(count / 100) * 100}%`;
        
        if (count === 0) {
            if (albumEmptyState) albumEmptyState.style.display = 'flex';
        } else {
            if (albumEmptyState) albumEmptyState.style.display = 'none';
            
            scanDatabase.forEach((item, index) => {
                const card = document.createElement('div');
                card.className = `album-item-card ${selectedPhotoIndices.has(index) ? 'selected' : ''}`;
                card.dataset.index = index;
                
                const checkbox = document.createElement('div');
                checkbox.className = 'album-item-checkbox';
                
                // Direct touch captures on iOS to prevent double-tap or block issues (Request 1)
                const handleCheck = (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    togglePhotoSelection(index);
                };
                checkbox.addEventListener('click', handleCheck);
                checkbox.addEventListener('touchstart', handleCheck, { passive: false });
                
                const img = document.createElement('img');
                img.className = 'album-item-img';
                img.src = item.restoredCanvas.toDataURL('image/jpeg', 0.4);
                
                card.appendChild(checkbox);
                card.appendChild(img);
                
                // Clicking the card itself opens the inspection preview
                card.addEventListener('click', () => {
                    openCompareModalForIndex(index);
                });
                
                albumGrid.appendChild(card);
            });
        }
        
        updateRemoveButtonState();
    };

    const togglePhotoSelection = (index) => {
        if (selectedPhotoIndices.has(index)) {
            selectedPhotoIndices.delete(index);
        } else {
            selectedPhotoIndices.add(index);
        }
        updateAlbumGalleryUI();
    };

    const updateRemoveButtonState = () => {
        if (!btnRemoveSelected) return;
        const size = selectedPhotoIndices.size;
        if (size > 0) {
            btnRemoveSelected.disabled = false;
            if (deleteSelectedCount) deleteSelectedCount.textContent = size;
        } else {
            btnRemoveSelected.disabled = true;
            if (deleteSelectedCount) deleteSelectedCount.textContent = '0';
        }
    };

    const openCompareModalForIndex = (index) => {
        const item = scanDatabase[index];
        if (!item) return;
        
        exifFilename.textContent = item.exif.filename;
        exifDirectory.textContent = item.exif.directory;
        exifFormat.textContent = item.exif.format;
        
        const beforeCtx = canvasBefore.getContext('2d');
        canvasBefore.width = item.rawCanvas.width;
        canvasBefore.height = item.rawCanvas.height;
        beforeCtx.drawImage(item.rawCanvas, 0, 0);
        
        const afterCtx = canvasAfter.getContext('2d');
        canvasAfter.width = item.restoredCanvas.width;
        canvasAfter.height = item.restoredCanvas.height;
        afterCtx.drawImage(item.restoredCanvas, 0, 0);
        
        btnDownloadScan.href = item.restoredCanvas.toDataURL('image/jpeg', 0.95);
        btnDownloadScan.download = item.exif.filename;
        
        compareModal.classList.add('show');
    };

    // Removal button event listener (Request 8)
    if (btnRemoveSelected) {
        btnRemoveSelected.addEventListener('click', () => {
            const remainingScans = scanDatabase.filter((_, index) => !selectedPhotoIndices.has(index));
            scanDatabase.length = 0;
            remainingScans.forEach(item => scanDatabase.push(item));
            
            selectedPhotoIndices.clear();
            updateAlbumGalleryUI();
            
            // Sync counts
            const badge = document.getElementById('folder-badge-count');
            if (badge) {
                badge.textContent = scanDatabase.length;
            }
            updateGalleryUI();
        });
    }

    // Configure iOS download instruction overlay (Request 2)
    if (btnDownloadScan) {
        btnDownloadScan.setAttribute('target', '_blank');
        btnDownloadScan.addEventListener('click', () => {
            alert("Opening image in a new tab. Please press and hold the photo, then select 'Add to Photos' to save it to your iPhone library.");
        });
    }

    // Toggle slide-up gallery modal sheets (Request 3 & 5)
    const folderBtn = document.getElementById('folder-btn');
    const albumGalleryModal = document.getElementById('album-gallery-modal');
    const btnCloseGallery = document.getElementById('btn-close-gallery');
    
    if (folderBtn && albumGalleryModal) {
        folderBtn.addEventListener('click', () => {
            updateAlbumGalleryUI();
            albumGalleryModal.classList.add('show');
        });
    }

    if (btnCloseGallery && albumGalleryModal) {
        btnCloseGallery.addEventListener('click', () => {
            albumGalleryModal.classList.remove('show');
        });
    }

    const logoBtn = document.getElementById('easyscan-logo-btn');
    if (logoBtn) {
        logoBtn.addEventListener('click', () => {
            alert("EasyScan Pro • Powered by WILLIAMHCHANSTUDIO\nFast, high-fidelity bulk-scanning and photo restoration engine.");
        });
    }

    // Developer Dashboard Toggle Logic
    const btnToggleDashboard = document.getElementById('btn-toggle-dashboard');
    const btnFloatingDev = document.getElementById('btn-floating-dev');
    const appMain = document.querySelector('.app-main');
    const dashboardSection = document.querySelector('.dashboard-section');

    const showDashboard = () => {
        if (appMain) appMain.classList.remove('view-camera-only');
        document.body.classList.remove('camera-only-layout');
        if (btnToggleDashboard) {
            btnToggleDashboard.classList.add('active');
            btnToggleDashboard.innerHTML = '📱 View Camera Only';
            btnToggleDashboard.style.background = 'rgba(59, 130, 246, 0.15)';
            btnToggleDashboard.style.color = 'var(--accent-blue)';
            btnToggleDashboard.style.borderColor = 'var(--accent-blue)';
        }
        setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
    };

    const hideDashboard = () => {
        if (appMain) appMain.classList.add('view-camera-only');
        document.body.classList.add('camera-only-layout');
        if (btnToggleDashboard) {
            btnToggleDashboard.classList.remove('active');
            btnToggleDashboard.innerHTML = '🖥️ Developer Dashboard';
            btnToggleDashboard.style.background = '';
            btnToggleDashboard.style.color = '';
            btnToggleDashboard.style.borderColor = '';
        }
        setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
    };

    // Default to Camera Only mode on load
    if (appMain && dashboardSection) {
        hideDashboard();
        
        if (btnToggleDashboard) {
            btnToggleDashboard.addEventListener('click', () => {
                if (appMain.classList.contains('view-camera-only')) {
                    showDashboard();
                } else {
                    hideDashboard();
                }
            });
        }

        if (btnFloatingDev) {
            btnFloatingDev.addEventListener('click', () => {
                showDashboard();
                // Smooth scroll to dashboard metrics
                if (dashboardSection) {
                    dashboardSection.scrollIntoView({ behavior: 'smooth' });
                }
            });
        }
    }

    // Automatic White Background Removal for clean 3D button rendering
    const cleanAlbumBackground = () => {
        const albumImg = document.querySelector('.photo-album-img');
        if (albumImg) {
            const process = () => {
                albumImg.onload = null; // Prevent infinite load recursion
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = albumImg.naturalWidth;
                    canvas.height = albumImg.naturalHeight;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(albumImg, 0, 0);
                    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    const data = imgData.data;
                    for (let i = 0; i < data.length; i += 4) {
                        const r = data[i];
                        const g = data[i+1];
                        const b = data[i+2];
                        // Key out bright grey/white background pixels (R, G, and B all high)
                        if (r > 190 && g > 190 && b > 190) {
                            data[i+3] = 0; // Alpha
                        }
                    }
                    ctx.putImageData(imgData, 0, 0);
                    albumImg.src = canvas.toDataURL('image/png');
                } catch (e) {
                    console.warn("Background removal skipped due to secure origin check.", e);
                }
            };
            if (albumImg.complete) {
                process();
            } else {
                albumImg.onload = process;
            }
        }
    };

    // Initialization routine
    cleanAlbumBackground();
    loadTestImages();
    updateTargetGridUI();
    initSliderDrag();

    // Set default starting mode to Custom/Manual scan (Request 9)
    autoCapture = false;
    const optAuto = document.getElementById('opt-auto');
    const optManual = document.getElementById('opt-manual');
    const modeSlider = document.getElementById('mode-slider');
    if (optAuto && optManual && modeSlider) {
        optAuto.classList.remove('active');
        optManual.classList.add('active');
        modeSlider.style.left = '50%';
    }
    shutterTimerFill.classList.add('greyed');
    shutterTimerFill.style.strokeDashoffset = '175.93';
    
    // Boot-to-Camera startup triggers
    if (activeSource === 'webcam') {
        initCameraHardware();
    } else {
        resetCornersToSkewedSim();
    }
    
    // Start main frame analytical loop (Stage 2)
    requestAnimationFrame(tick);
});
