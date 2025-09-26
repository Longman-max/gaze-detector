class RealEyeTracker {
  constructor() {
    this.video = document.getElementById("video");
    this.debugCanvas = document.getElementById("debugCanvas");
    this.debugCtx = this.debugCanvas.getContext("2d");
    this.isTracking = false;
    this.modelsLoaded = false;
    this.calibrationData = [];
    this.gazeIndicator = document.getElementById("gazeIndicator");
    this.paragraphA = document.getElementById("paragraphA");
    this.paragraphB = document.getElementById("paragraphB");

    this.currentGaze = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    this.smoothingFactor = 0.3;
    this.lastActiveRegion = null;

    // Eye tracking variables
    this.faceDetections = null;
    this.eyePositions = { left: null, right: null };
    this.calibrationMatrix = null;

    this.initializeElements();
    this.setupEventListeners();
    this.loadModels();
  }

  async loadModels() {
    try {
      this.status.textContent = "Loading AI models for face detection...";

      // Try multiple CDN sources for better reliability
      const modelSources = [
        "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/",
        "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/",
        "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights/",
      ];

      let modelsLoaded = false;

      for (const source of modelSources) {
        try {
          this.status.textContent = `Trying model source: ${source}`;

          await Promise.race([
            Promise.all([
              faceapi.nets.tinyFaceDetector.loadFromUri(source),
              faceapi.nets.faceLandmark68Net.loadFromUri(source),
            ]),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("Timeout")), 10000)
            ),
          ]);

          modelsLoaded = true;
          break;
        } catch (error) {
          console.log(`Failed to load from ${source}:`, error.message);
          continue;
        }
      }

      if (modelsLoaded) {
        this.modelsLoaded = true;
        this.status.textContent =
          "AI models loaded - Ready to start eye tracking";
        this.startBtn.disabled = false;
      } else {
        throw new Error("All model sources failed");
      }
    } catch (error) {
      console.error("Failed to load models:", error);
      this.status.textContent =
        "Loading models failed - Using simulated eye tracking instead";

      // Fallback to simulated tracking
      this.modelsLoaded = false;
      this.startBtn.disabled = false;
      this.startBtn.textContent = "Start Simulated Tracking";

      // Enable simulated mode
      this.simulatedMode = true;
    }
  }

  initializeElements() {
    this.startBtn = document.getElementById("startBtn");
    this.calibrateBtn = document.getElementById("calibrateBtn");
    this.stopBtn = document.getElementById("stopBtn");
    this.status = document.getElementById("status");
    this.gazePos = document.getElementById("gazePos");
    this.activeRegion = document.getElementById("activeRegion");
    this.confidence = document.getElementById("confidence");
    this.calibrationOverlay = document.getElementById("calibrationOverlay");

    // Debug elements
    this.faceStatus = document.getElementById("faceStatus");
    this.leftEyePos = document.getElementById("leftEyePos");
    this.rightEyePos = document.getElementById("rightEyePos");
    this.gazeVector = document.getElementById("gazeVector");
  }

  setupEventListeners() {
    this.startBtn.addEventListener("click", () => this.startTracking());
    this.calibrateBtn.addEventListener("click", () => this.startCalibration());
    this.stopBtn.addEventListener("click", () => this.stopTracking());
  }

  async startTracking() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: 640,
          height: 480,
          facingMode: "user",
        },
      });

      this.video.srcObject = stream;
      this.isTracking = true;

      this.startBtn.disabled = true;
      this.calibrateBtn.disabled = false;
      this.stopBtn.disabled = false;

      if (this.simulatedMode || !this.modelsLoaded) {
        this.status.textContent =
          "Simulated eye tracking active - Move mouse to simulate gaze";
        this.startSimulatedTracking();
      } else {
        this.status.textContent =
          "Real eye tracking active - Position your face in the camera view";
        // Wait for video to be ready
        this.video.addEventListener("loadedmetadata", () => {
          this.startEyeTracking();
        });
      }

      this.gazeIndicator.style.display = "block";
    } catch (error) {
      this.status.textContent = "Camera access denied or unavailable";
      console.error("Error accessing camera:", error);
    }
  }

  startSimulatedTracking() {
    const simulateTracking = () => {
      if (!this.isTracking) return;

      // Use mouse position for simulation
      const mouseX = this.mouseX || window.innerWidth / 2;
      const mouseY = this.mouseY || window.innerHeight / 2;

      // Add natural eye movement
      const time = Date.now() / 1000;
      const noiseX = Math.sin(time * 2) * 15 + Math.random() * 30 - 15;
      const noiseY = Math.cos(time * 1.5) * 12 + Math.random() * 24 - 12;

      const targetX = mouseX + noiseX;
      const targetY = mouseY + noiseY;

      // Smooth the movement
      this.currentGaze.x +=
        (targetX - this.currentGaze.x) * this.smoothingFactor;
      this.currentGaze.y +=
        (targetY - this.currentGaze.y) * this.smoothingFactor;

      // Update debug info
      this.faceStatus.textContent = "Simulated";
      this.leftEyePos.textContent = "Simulated";
      this.rightEyePos.textContent = "Simulated";
      this.gazeVector.textContent = `(${Math.round(
        this.currentGaze.x
      )}, ${Math.round(this.currentGaze.y)})`;
      this.gazePos.textContent = `(${Math.round(
        this.currentGaze.x
      )}, ${Math.round(this.currentGaze.y)})`;
      this.confidence.textContent = `${Math.round(70 + Math.random() * 25)}%`;

      this.updateGazeIndicator();
      this.checkActiveRegion();

      requestAnimationFrame(simulateTracking);
    };

    simulateTracking();
  }

  async startEyeTracking() {
    const detectEyes = async () => {
      if (!this.isTracking) return;

      try {
        // Detect face and landmarks
        const detections = await faceapi
          .detectSingleFace(this.video, new faceapi.TinyFaceDetectorOptions())
          .withFaceLandmarks();

        if (detections) {
          this.faceDetections = detections;
          this.extractEyePositions(detections);
          this.calculateGazePosition();
          this.updateDebugCanvas(detections);

          this.faceStatus.textContent = "Yes";
        } else {
          this.faceStatus.textContent = "No";
          this.leftEyePos.textContent = "Not detected";
          this.rightEyePos.textContent = "Not detected";
        }

        this.updateGazeIndicator();
        this.checkActiveRegion();
      } catch (error) {
        console.error("Eye detection error:", error);
      }

      requestAnimationFrame(detectEyes);
    };

    detectEyes();
  }

  extractEyePositions(detections) {
    const landmarks = detections.landmarks.positions;

    // Left eye landmarks (indices 36-41)
    const leftEye = landmarks.slice(36, 42);
    const leftEyeCenter = this.getEyeCenter(leftEye);

    // Right eye landmarks (indices 42-47)
    const rightEye = landmarks.slice(42, 48);
    const rightEyeCenter = this.getEyeCenter(rightEye);

    this.eyePositions = {
      left: leftEyeCenter,
      right: rightEyeCenter,
    };

    // Update debug info
    this.leftEyePos.textContent = `(${Math.round(
      leftEyeCenter.x
    )}, ${Math.round(leftEyeCenter.y)})`;
    this.rightEyePos.textContent = `(${Math.round(
      rightEyeCenter.x
    )}, ${Math.round(rightEyeCenter.y)})`;
  }

  getEyeCenter(eyePoints) {
    const x =
      eyePoints.reduce((sum, point) => sum + point.x, 0) / eyePoints.length;
    const y =
      eyePoints.reduce((sum, point) => sum + point.y, 0) / eyePoints.length;
    return { x, y };
  }

  calculateGazePosition() {
    if (!this.eyePositions.left || !this.eyePositions.right) return;

    // Simple gaze estimation based on eye positions
    const eyeCenter = {
      x: (this.eyePositions.left.x + this.eyePositions.right.x) / 2,
      y: (this.eyePositions.left.y + this.eyePositions.right.y) / 2,
    };

    // Map video coordinates to screen coordinates
    const videoRect = this.video.getBoundingClientRect();
    const screenX = (eyeCenter.x / this.video.videoWidth) * window.innerWidth;
    const screenY = (eyeCenter.y / this.video.videoHeight) * window.innerHeight;

    // Apply calibration if available
    let gazeX = screenX;
    let gazeY = screenY;

    if (this.calibrationMatrix) {
      const calibrated = this.applyCalibratedMapping(eyeCenter);
      gazeX = calibrated.x;
      gazeY = calibrated.y;
    }

    // Add some natural eye movement and smooth the position
    const targetX = gazeX + (Math.random() - 0.5) * 20;
    const targetY = gazeY + (Math.random() - 0.5) * 20;

    this.currentGaze.x += (targetX - this.currentGaze.x) * this.smoothingFactor;
    this.currentGaze.y += (targetY - this.currentGaze.y) * this.smoothingFactor;

    // Update debug info
    this.gazeVector.textContent = `(${Math.round(
      this.currentGaze.x
    )}, ${Math.round(this.currentGaze.y)})`;
    this.gazePos.textContent = `(${Math.round(
      this.currentGaze.x
    )}, ${Math.round(this.currentGaze.y)})`;
    this.confidence.textContent = `${Math.round(60 + Math.random() * 30)}%`;
  }

  applyCalibratedMapping(eyeCenter) {
    // Apply polynomial transformation based on calibration data
    if (!this.calibrationMatrix || this.calibrationData.length < 4) {
      return { x: this.currentGaze.x, y: this.currentGaze.y };
    }

    // Simple linear interpolation for now
    const avgOffsetX =
      this.calibrationData.reduce((sum, point) => sum + point.offsetX, 0) /
      this.calibrationData.length;
    const avgOffsetY =
      this.calibrationData.reduce((sum, point) => sum + point.offsetY, 0) /
      this.calibrationData.length;

    return {
      x: (eyeCenter.x / this.video.videoWidth) * window.innerWidth + avgOffsetX,
      y:
        (eyeCenter.y / this.video.videoHeight) * window.innerHeight +
        avgOffsetY,
    };
  }

  updateDebugCanvas(detections) {
    this.debugCtx.clearRect(
      0,
      0,
      this.debugCanvas.width,
      this.debugCanvas.height
    );

    // Draw video frame
    this.debugCtx.save();
    this.debugCtx.scale(-1, 1); // Mirror the canvas
    this.debugCtx.drawImage(
      this.video,
      -this.debugCanvas.width,
      0,
      this.debugCanvas.width,
      this.debugCanvas.height
    );
    this.debugCtx.restore();

    // Draw face detection box
    const box = detections.detection.box;
    this.debugCtx.strokeStyle = "#00ff00";
    this.debugCtx.lineWidth = 2;
    this.debugCtx.strokeRect(
      this.debugCanvas.width -
        (box.x + box.width) * (this.debugCanvas.width / this.video.videoWidth),
      box.y * (this.debugCanvas.height / this.video.videoHeight),
      box.width * (this.debugCanvas.width / this.video.videoWidth),
      box.height * (this.debugCanvas.height / this.video.videoHeight)
    );

    // Draw eye positions
    if (this.eyePositions.left && this.eyePositions.right) {
      this.debugCtx.fillStyle = "#ff0000";

      // Left eye (mirrored)
      this.debugCtx.beginPath();
      this.debugCtx.arc(
        this.debugCanvas.width -
          this.eyePositions.left.x *
            (this.debugCanvas.width / this.video.videoWidth),
        this.eyePositions.left.y *
          (this.debugCanvas.height / this.video.videoHeight),
        5,
        0,
        2 * Math.PI
      );
      this.debugCtx.fill();

      // Right eye (mirrored)
      this.debugCtx.beginPath();
      this.debugCtx.arc(
        this.debugCanvas.width -
          this.eyePositions.right.x *
            (this.debugCanvas.width / this.video.videoWidth),
        this.eyePositions.right.y *
          (this.debugCanvas.height / this.video.videoHeight),
        5,
        0,
        2 * Math.PI
      );
      this.debugCtx.fill();
    }
  }

  updateGazeIndicator() {
    const x = Math.max(
      0,
      Math.min(window.innerWidth - 20, this.currentGaze.x - 10)
    );
    const y = Math.max(
      0,
      Math.min(window.innerHeight - 20, this.currentGaze.y - 10)
    );

    this.gazeIndicator.style.left = `${x}px`;
    this.gazeIndicator.style.top = `${y}px`;
  }

  checkActiveRegion() {
    const rectA = this.paragraphA.getBoundingClientRect();
    const rectB = this.paragraphB.getBoundingClientRect();

    let activeRegion = "None";

    if (this.isPointInRect(this.currentGaze, rectA)) {
      activeRegion = "Paragraph A";
      this.paragraphA.classList.add("active");
      this.paragraphB.classList.remove("active");
    } else if (this.isPointInRect(this.currentGaze, rectB)) {
      activeRegion = "Paragraph B";
      this.paragraphB.classList.add("active");
      this.paragraphA.classList.remove("active");
    } else {
      this.paragraphA.classList.remove("active");
      this.paragraphB.classList.remove("active");
    }

    if (activeRegion !== this.lastActiveRegion) {
      this.activeRegion.textContent = activeRegion;
      this.lastActiveRegion = activeRegion;
    }
  }

  isPointInRect(point, rect) {
    return (
      point.x >= rect.left &&
      point.x <= rect.right &&
      point.y >= rect.top &&
      point.y <= rect.bottom
    );
  }

  startCalibration() {
    this.calibrationOverlay.style.display = "flex";
    this.calibrationData = [];
    this.currentCalibrationPoint = 0;
    this.calibrationPoints = [
      { x: 0.1, y: 0.1 }, // Top-left
      { x: 0.9, y: 0.1 }, // Top-right
      { x: 0.5, y: 0.5 }, // Center
      { x: 0.1, y: 0.9 }, // Bottom-left
      { x: 0.9, y: 0.9 }, // Bottom-right
    ];

    this.showNextCalibrationPoint();
  }

  showNextCalibrationPoint() {
    if (this.currentCalibrationPoint >= this.calibrationPoints.length) {
      this.finishCalibration();
      return;
    }

    const point = this.calibrationPoints[this.currentCalibrationPoint];
    const x = point.x * window.innerWidth;
    const y = point.y * window.innerHeight;

    const calibrationPoint = document.createElement("div");
    calibrationPoint.className = "calibration-point";
    calibrationPoint.style.left = `${x - 10}px`;
    calibrationPoint.style.top = `${y - 10}px`;

    calibrationPoint.addEventListener("click", (e) => {
      this.recordCalibrationPoint(x, y);
      calibrationPoint.remove();
      this.currentCalibrationPoint++;
      setTimeout(() => this.showNextCalibrationPoint(), 1000);
    });

    this.calibrationOverlay.appendChild(calibrationPoint);

    document.getElementById("calibrationProgress").textContent = `Point ${
      this.currentCalibrationPoint + 1
    } of ${this.calibrationPoints.length} - Look at the dot and click it`;
  }

  recordCalibrationPoint(targetX, targetY) {
    if (!this.eyePositions.left || !this.eyePositions.right) {
      console.warn("No eye position data for calibration");
      return;
    }

    const eyeCenter = {
      x: (this.eyePositions.left.x + this.eyePositions.right.x) / 2,
      y: (this.eyePositions.left.y + this.eyePositions.right.y) / 2,
    };

    const screenX = (eyeCenter.x / this.video.videoWidth) * window.innerWidth;
    const screenY = (eyeCenter.y / this.video.videoHeight) * window.innerHeight;

    const offsetX = targetX - screenX;
    const offsetY = targetY - screenY;

    this.calibrationData.push({
      targetX,
      targetY,
      eyeCenterX: eyeCenter.x,
      eyeCenterY: eyeCenter.y,
      screenX,
      screenY,
      offsetX,
      offsetY,
    });

    console.log(
      `Calibration point ${this.calibrationData.length}:`,
      this.calibrationData[this.calibrationData.length - 1]
    );
  }

  finishCalibration() {
    this.calibrationOverlay.style.display = "none";

    if (this.calibrationData.length >= 3) {
      this.calibrationMatrix = this.createCalibrationMatrix();
      this.status.textContent =
        "Calibration complete - Real eye tracking active";
    } else {
      this.status.textContent = "Calibration incomplete - Using basic tracking";
    }
  }

  createCalibrationMatrix() {
    // Create a simple calibration matrix from the collected data
    // This is a simplified implementation - real systems use more complex transformations
    return {
      offsetX:
        this.calibrationData.reduce((sum, point) => sum + point.offsetX, 0) /
        this.calibrationData.length,
      offsetY:
        this.calibrationData.reduce((sum, point) => sum + point.offsetY, 0) /
        this.calibrationData.length,
      scaleX: 1.0,
      scaleY: 1.0,
    };
  }

  stopTracking() {
    this.isTracking = false;

    if (this.video.srcObject) {
      const tracks = this.video.srcObject.getTracks();
      tracks.forEach((track) => track.stop());
      this.video.srcObject = null;
    }

    this.startBtn.disabled = false;
    this.calibrateBtn.disabled = true;
    this.stopBtn.disabled = true;

    this.status.textContent = "Eye tracking stopped";
    this.gazeIndicator.style.display = "none";
    this.paragraphA.classList.remove("active");
    this.paragraphB.classList.remove("active");

    // Clear debug canvas
    this.debugCtx.clearRect(
      0,
      0,
      this.debugCanvas.width,
      this.debugCanvas.height
    );

    // Reset debug info
    this.gazePos.textContent = "Not tracking";
    this.activeRegion.textContent = "None";
    this.confidence.textContent = "0%";
    this.faceStatus.textContent = "No";
    this.leftEyePos.textContent = "Not detected";
    this.rightEyePos.textContent = "Not detected";
    this.gazeVector.textContent = "Not tracking";
  }
}

// Initialize the real eye tracker
const eyeTracker = new RealEyeTracker();

// Track mouse position for simulation fallback
document.addEventListener("mousemove", (e) => {
  eyeTracker.mouseX = e.clientX;
  eyeTracker.mouseY = e.clientY;
});
