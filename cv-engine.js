/**
 * EasyScan - Mathematical CV Engine
 * Implements Stage 3 (Real-Time Analytics & Glare) and Stage 4 (Warping & Restoration)
 */

const CVEngine = {
    // Stage 3: Auto-Detect Corners of a photo on a dark background
    // Scans diagonal tracks from corners inwards to find high contrast boundaries
    autoDetectCorners(canvas, targetGrid) {
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        const imgData = ctx.getImageData(0, 0, width, height);
        const data = imgData.data;

        // Default to target grid if detection fails
        const corners = [
            { x: targetGrid.x, y: targetGrid.y }, // Top-Left
            { x: targetGrid.x + targetGrid.width, y: targetGrid.y }, // Top-Right
            { x: targetGrid.x + targetGrid.width, y: targetGrid.y + targetGrid.height }, // Bottom-Right
            { x: targetGrid.x, y: targetGrid.y + targetGrid.height } // Bottom-Left
        ];

        const getLuma = (x, y) => {
            if (x < 0 || x >= width || y < 0 || y >= height) return 128;
            const idx = (Math.round(y) * width + Math.round(x)) * 4;
            return 0.299 * data[idx] + 0.587 * data[idx+1] + 0.114 * data[idx+2];
        };

        // Scan from the center of targetGrid outwards to the 4 corners of the canvas
        const cx = targetGrid.x + targetGrid.width / 2;
        const cy = targetGrid.y + targetGrid.height / 2;

        const endpoints = [
            { x: 0, y: 0 }, // TL
            { x: width - 1, y: 0 }, // TR
            { x: width - 1, y: height - 1 }, // BR
            { x: 0, y: height - 1 } // BL
        ];

        for (let i = 0; i < 4; i++) {
            const end = endpoints[i];
            
            // We scan outwards from center (t=0) to the endpoint (t=1).
            // We search for a sharp gradient spike. Since documents are rectangular,
            // the transition from document edge to background has a sharp luma change.
            let maxGrad = 0;
            let bestX = corners[i].x;
            let bestY = corners[i].y;

            let prevLuma = null;
            const steps = 150;
            
            // We scan the portion of the diagonal where the document boundary is expected
            // (from t=0.2 to t=0.95 of the path)
            for (let s = 30; s < steps; s++) {
                const t = s / steps;
                const px = cx + (end.x - cx) * t;
                const py = cy + (end.y - cy) * t;

                const luma = getLuma(px, py);
                if (prevLuma !== null) {
                    const grad = Math.abs(luma - prevLuma);
                    // We look for a local peak in gradient. If it's a strong edge, we record it.
                    if (grad > maxGrad && grad > 10) {
                        maxGrad = grad;
                        bestX = Math.round(px);
                        bestY = Math.round(py);
                    }
                }
                prevLuma = luma;
            }

            // If a valid edge was found, snap to it!
            if (maxGrad > 10) {
                corners[i].x = bestX;
                corners[i].y = bestY;
            }
        }

        return corners;
    },

    // Stage 3: Glare Analysis
    // Checks the bounded region for pixels with RGB >= 250 and calculates the percentage
    glareAnalysis(canvas, corners) {
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        const imgData = ctx.getImageData(0, 0, width, height);
        const data = imgData.data;

        // Bounding box of the quadrilateral
        const minX = Math.max(0, Math.min(corners[0].x, corners[1].x, corners[2].x, corners[3].x));
        const maxX = Math.min(width - 1, Math.max(corners[0].x, corners[1].x, corners[2].x, corners[3].x));
        const minY = Math.max(0, Math.min(corners[0].y, corners[1].y, corners[2].y, corners[3].y));
        const maxY = Math.min(height - 1, Math.max(corners[0].y, corners[1].y, corners[2].y, corners[3].y));

        let totalPixels = 0;
        let glarePixelsCount = 0;
        const glareOverlayData = [];

        // Check if a point is inside the quadrilateral
        function isPointInQuad(px, py, p) {
            // Ray casting or triangle splitting
            // A simple way is to check the cross product sign of vectors
            const crossProduct = (ax, ay, bx, by, cx, cy) => {
                return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
            };

            const s1 = crossProduct(p[0].x, p[0].y, p[1].x, p[1].y, px, py);
            const s2 = crossProduct(p[1].x, p[1].y, p[2].x, p[2].y, px, py);
            const s3 = crossProduct(p[2].x, p[2].y, p[3].x, p[3].y, px, py);
            const s4 = crossProduct(p[3].x, p[3].y, p[0].x, p[0].y, px, py);

            return (s1 >= 0 && s2 >= 0 && s3 >= 0 && s4 >= 0) || 
                   (s1 <= 0 && s2 <= 0 && s3 <= 0 && s4 <= 0);
        }

        // We step to avoid checking millions of pixels at 60fps (downsample scanning)
        const step = 2; 
        for (let y = minY; y <= maxY; y += step) {
            for (let x = minX; x <= maxX; x += step) {
                if (isPointInQuad(x, y, corners)) {
                    totalPixels++;
                    const idx = (y * width + x) * 4;
                    const r = data[idx];
                    const g = data[idx + 1];
                    const b = data[idx + 2];

                    // Pure white threshold (10% auto-glare trigger is RGB = 255, 255, 255)
                    // We check if RGB are all >= 250 to catch near-saturation glare
                    if (r >= 250 && g >= 250 && b >= 250) {
                        glarePixelsCount++;
                        glareOverlayData.push({ x, y });
                    }
                }
            }
        }

        const ratio = totalPixels > 0 ? (glarePixelsCount / totalPixels) : 0;
        return {
            ratio: ratio,
            glarePixels: glareOverlayData
        };
    },

    // Stage 4: Component A - Homography Matrix Solver (Perspective Warp)
    solveHomography(src, dst) {
        // src and dst are arrays of 4 points: [{x, y}, ...]
        // Solve the 8x8 system Ah = B to compute perspective projection matrix
        const A = [];
        const B = [];

        for (let i = 0; i < 4; i++) {
            const sx = src[i].x;
            const sy = src[i].y;
            const dx = dst[i].x;
            const dy = dst[i].y;

            A.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx]);
            B.push(dx);

            A.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy]);
            B.push(dy);
        }

        // Gaussian elimination solver
        const n = 8;
        for (let i = 0; i < n; i++) {
            let maxEl = Math.abs(A[i][i]);
            let maxRow = i;
            for (let k = i + 1; k < n; k++) {
                if (Math.abs(A[k][i]) > maxEl) {
                    maxEl = Math.abs(A[k][i]);
                    maxRow = k;
                }
            }

            // Swap rows
            const tmpRow = A[maxRow];
            A[maxRow] = A[i];
            A[i] = tmpRow;

            const tmpVal = B[maxRow];
            B[maxRow] = B[i];
            B[i] = tmpVal;

            // Eliminate
            for (let k = i + 1; k < n; k++) {
                const c = -A[k][i] / A[i][i];
                for (let j = i; j < n; j++) {
                    if (i === j) {
                        A[k][j] = 0;
                    } else {
                        A[k][j] += c * A[i][j];
                    }
                }
                B[k] += c * B[i];
            }
        }

        // Back substitution
        const h = new Array(n).fill(0);
        for (let i = n - 1; i >= 0; i--) {
            h[i] = B[i] / A[i][i];
            for (let k = i - 1; k >= 0; k--) {
                B[k] -= A[k][i] * h[i];
            }
        }

        // Return full 3x3 projection matrix (h8 = 1.0)
        return [
            [h[0], h[1], h[2]],
            [h[3], h[4], h[5]],
            [h[6], h[7], 1.0]
        ];
    },

    // Invert a 3x3 matrix to perform backward warping mapping
    invertMatrix3x3(m) {
        const det = m[0][0] * (m[1][1] * m[2][2] - m[2][1] * m[1][2]) -
                    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
                    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);

        if (Math.abs(det) < 1e-8) return null;

        const invdet = 1.0 / det;
        const inv = [
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0]
        ];

        inv[0][0] = (m[1][1] * m[2][2] - m[2][1] * m[1][2]) * invdet;
        inv[0][1] = (m[0][2] * m[2][1] - m[0][1] * m[2][2]) * invdet;
        inv[0][2] = (m[0][1] * m[1][2] - m[0][2] * m[1][1]) * invdet;

        inv[1][0] = (m[1][2] * m[2][0] - m[1][0] * m[2][2]) * invdet;
        inv[1][1] = (m[0][0] * m[2][2] - m[0][2] * m[2][0]) * invdet;
        inv[1][2] = (m[0][2] * m[1][0] - m[0][0] * m[1][2]) * invdet;

        inv[2][0] = (m[1][0] * m[2][1] - m[2][0] * m[1][1]) * invdet;
        inv[2][1] = (m[2][0] * m[0][1] - m[0][0] * m[2][1]) * invdet;
        inv[2][2] = (m[0][0] * m[1][1] - m[0][1] * m[1][0]) * invdet;

        return inv;
    },

    // Warps source canvas onto destination canvas using inverse perspective transformation
    warpPerspective(srcCanvas, dstCanvas, corners) {
        const srcCtx = srcCanvas.getContext('2d');
        const dstCtx = dstCanvas.getContext('2d');

        const srcWidth = srcCanvas.width;
        const srcHeight = srcCanvas.height;
        const dstWidth = dstCanvas.width;
        const dstHeight = dstCanvas.height;

        const srcData = srcCtx.getImageData(0, 0, srcWidth, srcHeight);
        const dstData = dstCtx.createImageData(dstWidth, dstHeight);

        // Destination corners matching the output dimensions
        const dstCorners = [
            { x: 0, y: 0 },
            { x: dstWidth, y: 0 },
            { x: dstWidth, y: dstHeight },
            { x: 0, y: dstHeight }
        ];

        // Solve homography and compute inverse matrix G = H^-1
        const H = this.solveHomography(corners, dstCorners);
        const G = this.invertMatrix3x3(H);
        if (!G) return;

        const srcPixels = srcData.data;
        const dstPixels = dstData.data;

        // Perform backward mapping with bilinear interpolation
        for (let y = 0; y < dstHeight; y++) {
            for (let x = 0; x < dstWidth; x++) {
                // Denominator
                const w = G[2][0] * x + G[2][1] * y + G[2][2];
                // Projective coordinates
                const sx = (G[0][0] * x + G[0][1] * y + G[0][2]) / w;
                const sy = (G[1][0] * x + G[1][1] * y + G[1][2]) / w;

                const dIdx = (y * dstWidth + x) * 4;

                if (sx >= 0 && sx < srcWidth - 1 && sy >= 0 && sy < srcHeight - 1) {
                    // Bilinear interpolation
                    const x0 = Math.floor(sx);
                    const x1 = x0 + 1;
                    const y0 = Math.floor(sy);
                    const y1 = y0 + 1;

                    const dx = sx - x0;
                    const dy = sy - y0;

                    const w00 = (1 - dx) * (1 - dy);
                    const w10 = dx * (1 - dy);
                    const w01 = (1 - dx) * dy;
                    const w11 = dx * dy;

                    const idx00 = (y0 * srcWidth + x0) * 4;
                    const idx10 = (y0 * srcWidth + x1) * 4;
                    const idx01 = (y1 * srcWidth + x0) * 4;
                    const idx11 = (y1 * srcWidth + x1) * 4;

                    for (let c = 0; c < 3; c++) {
                        dstPixels[dIdx + c] = Math.round(
                            srcPixels[idx00 + c] * w00 +
                            srcPixels[idx10 + c] * w10 +
                            srcPixels[idx01 + c] * w01 +
                            srcPixels[idx11 + c] * w11
                        );
                    }
                    dstPixels[dIdx + 3] = 255; // Alpha
                } else {
                    // Out of bounds
                    dstPixels[dIdx + 3] = 0; // Transparent
                }
            }
        }

        dstCtx.putImageData(dstData, 0, 0);
    },

    // Stage 4: Component B - Fading Matrix (Dynamic Histogram Stretch)
    restoreFading(canvas) {
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        const imgData = ctx.getImageData(0, 0, width, height);
        const data = imgData.data;

        // Step 1: Find cumulative distribution to stretch contrast
        let minR = 255, maxR = 0;
        let minG = 255, maxG = 0;
        let minB = 255, maxB = 0;

        // Sample pixels to compute robust min/max bounds (cut out noise spikes via 1% and 99%)
        const histR = new Array(256).fill(0);
        const histG = new Array(256).fill(0);
        const histB = new Array(256).fill(0);
        const total = width * height;

        for (let i = 0; i < data.length; i += 4) {
            histR[data[i]]++;
            histG[data[i + 1]]++;
            histB[data[i + 2]]++;
        }

        // Compute cutoffs at 1% and 99%
        const lowCut = Math.floor(total * 0.01);
        const highCut = Math.floor(total * 0.99);

        // Find min/max cutoffs
        let sumR = 0, sumG = 0, sumB = 0;
        for (let val = 0; val < 256; val++) {
            sumR += histR[val];
            if (sumR >= lowCut && minR === 255) minR = val;
            if (sumR >= highCut && maxR === 0) maxR = val;

            sumG += histG[val];
            if (sumG >= lowCut && minG === 255) minG = val;
            if (sumG >= highCut && maxG === 0) maxG = val;

            sumB += histB[val];
            if (sumB >= lowCut && minB === 255) minB = val;
            if (sumB >= highCut && maxB === 0) maxB = val;
        }
        if (maxR === 0) maxR = 255;
        if (maxG === 0) maxG = 255;
        if (maxB === 0) maxB = 255;

        // Apply dynamic stretch
        for (let i = 0; i < data.length; i += 4) {
            data[i] = Math.max(0, Math.min(255, ((data[i] - minR) * 255) / (maxR - minR)));
            data[i + 1] = Math.max(0, Math.min(255, ((data[i + 1] - minG) * 255) / (maxG - minG)));
            data[i + 2] = Math.max(0, Math.min(255, ((data[i + 2] - minB) * 255) / (maxB - minB)));
        }

        ctx.putImageData(imgData, 0, 0);
    },

    // Stage 4: Component B - Age Matrix (Color Temperature Correction)
    // Shift yellow oxidized tints towards cooler balances
    restoreAge(canvas) {
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        const imgData = ctx.getImageData(0, 0, width, height);
        const data = imgData.data;

        // Calculate average R, G, B channels
        let sumR = 0, sumG = 0, sumB = 0;
        const len = data.length;
        const totalPixels = len / 4;

        for (let i = 0; i < len; i += 4) {
            sumR += data[i];
            sumG += data[i + 1];
            sumB += data[i + 2];
        }

        const avgR = sumR / totalPixels;
        const avgG = sumG / totalPixels;
        const avgB = sumB / totalPixels;

        // Detect yellowing: Red and Green channels significantly out-weigh Blue channel
        const yellowRatio = (avgR + avgG) / (2 * avgB || 1);

        if (yellowRatio > 1.08) {
            // Apply compensatory cooling vector
            // Boost blue, suppress red slightly to balance yellow cast
            const coolingFactor = Math.min(0.25, (yellowRatio - 1.0) * 0.8);

            for (let i = 0; i < len; i += 4) {
                // Adjust channels
                data[i] = Math.max(0, Math.min(255, data[i] * (1 - coolingFactor * 0.4)));     // Red down
                data[i + 1] = Math.max(0, Math.min(255, data[i + 1] * (1 - coolingFactor * 0.1))); // Green down slightly
                data[i + 2] = Math.max(0, Math.min(255, data[i + 2] * (1 + coolingFactor * 0.9))); // Blue boosted
            }
        }

        ctx.putImageData(imgData, 0, 0);
    },

    // Stage 4: Component B - Frequency Matrix (Inpainting Scratch Fix)
    // Uses Laplacian high-pass thresholding to detect thin surface scratches
    // and repairs them using bilateral interpolation of neighboring clean pixels
    restoreFrequency(canvas) {
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        const imgData = ctx.getImageData(0, 0, width, height);
        const data = imgData.data;

        const mask = new Uint8Array(width * height);

        // Detect scratches: high local variance compared to surrounding pixels
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = (y * width + x) * 4;
                const r = data[idx];
                const g = data[idx + 1];
                const b = data[idx + 2];
                const luma = 0.299 * r + 0.587 * g + 0.114 * b;

                // Simple horizontal and vertical Laplacian filter
                const idxL = (y * width + (x - 1)) * 4;
                const idxR = (y * width + (x + 1)) * 4;
                const idxU = ((y - 1) * width + x) * 4;
                const idxD = ((y + 1) * width + x) * 4;

                const lumaL = 0.299 * data[idxL] + 0.587 * data[idxL + 1] + 0.114 * data[idxL + 2];
                const lumaR = 0.299 * data[idxR] + 0.587 * data[idxR + 1] + 0.114 * data[idxR + 2];
                const lumaU = 0.299 * data[idxU] + 0.587 * data[idxU + 1] + 0.114 * data[idxU + 2];
                const lumaD = 0.299 * data[idxD] + 0.587 * data[idxD + 1] + 0.114 * data[idxD + 2];

                // Scratches are thin, bright or dark linear anomalies
                // We check if the pixel diverges sharply from both horizontal or vertical lines
                const diffH = Math.abs(luma - (lumaL + lumaR) / 2);
                const diffV = Math.abs(luma - (lumaU + lumaD) / 2);

                // Scratch threshold: difference from surroundings > 35
                if (diffH > 35 || diffV > 35) {
                    mask[y * width + x] = 1; // Flagged as scratch/dust
                }
            }
        }

        // Inpaint: for flagged pixels, average neighbors in a 5x5 box that are NOT flagged
        const maxIter = 2; // Iterations to handle thick scratches
        for (let iter = 0; iter < maxIter; iter++) {
            for (let y = 2; y < height - 2; y++) {
                for (let x = 2; x < width - 2; x++) {
                    const mIdx = y * width + x;
                    if (mask[mIdx] === 1) {
                        let sumR = 0, sumG = 0, sumB = 0;
                        let validCount = 0;

                        // Check neighbors in a 5x5 window
                        for (let dy = -2; dy <= 2; dy++) {
                            for (let dx = -2; dx <= 2; dx++) {
                                if (dx === 0 && dy === 0) continue;
                                const nIdx = (y + dy) * width + (x + dx);
                                if (mask[nIdx] === 0) {
                                    const pIdx = nIdx * 4;
                                    sumR += data[pIdx];
                                    sumG += data[pIdx + 1];
                                    sumB += data[pIdx + 2];
                                    validCount++;
                                }
                            }
                        }

                        if (validCount > 0) {
                            const idx = mIdx * 4;
                            data[idx] = Math.round(sumR / validCount);
                            data[idx + 1] = Math.round(sumG / validCount);
                            data[idx + 2] = Math.round(sumB / validCount);
                            mask[mIdx] = 0; // Unflag after repair
                        }
                    }
                }
            }
        }

        ctx.putImageData(imgData, 0, 0);
    }
};

// Export to window object for browser access
window.CVEngine = CVEngine;
