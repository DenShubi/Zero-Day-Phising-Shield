# ==============================================================================
# VisiKartika Shield — Phase 5 Minimal Footprint & Isolated Chromium Container
# ==============================================================================
# Build Profiles (--build-arg TORCH_PROFILE=...):
#   1. TORCH_PROFILE=none (Default — Ultra-Slim Railway/VPS, ~0 MB PyTorch bloat;
#      uses fast Tesseract ind+eng + PyZbar + OpenCV vectorized SSIM)
#   2. TORCH_PROFILE=cpu  (Minimal PyTorch CPU-only wheels + EasyOCR, saves ~2.3 GB CUDA bloat)
#   3. TORCH_PROFILE=gpu  (PyTorch CUDA 12.4 + EasyOCR GPU inference for NVIDIA servers)
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Isolated Python Wheel / Venv Builder
# ------------------------------------------------------------------------------
FROM python:3.12-slim-bookworm AS builder

ARG TORCH_PROFILE=none

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /build

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt requirements-easyocr.txt ./

RUN pip install --upgrade pip && \
    pip install -r requirements.txt && \
    if [ "$TORCH_PROFILE" = "cpu" ]; then \
        pip install --index-url https://download.pytorch.org/whl/cpu torch>=2.2.0 torchvision>=0.17.0 && \
        pip install easyocr>=1.7.1; \
    elif [ "$TORCH_PROFILE" = "gpu" ]; then \
        pip install --index-url https://download.pytorch.org/whl/cu124 torch>=2.2.0 torchvision>=0.17.0 && \
        pip install easyocr>=1.7.1; \
    fi && \
    find /opt/venv -type d -name "__pycache__" -prune -exec rm -rf {} + && \
    find /opt/venv -type d -name "tests" -prune -exec rm -rf {} +

# ------------------------------------------------------------------------------
# Stage 2: Hardened Runtime (Chromium-Only + Tini PID-1 + Non-Root pwuser)
# ------------------------------------------------------------------------------
FROM python:3.12-slim-bookworm AS runtime

ARG TORCH_PROFILE=none

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    PLAYWRIGHT_BROWSERS_PATH="/ms-playwright" \
    # Memory & CPU thread contention caps for 1-2 vCPU containers
    MALLOC_ARENA_MAX=2 \
    OMP_NUM_THREADS=2 \
    MKL_NUM_THREADS=2 \
    OPENBLAS_NUM_THREADS=2 \
    VECLIB_MAXIMUM_THREADS=2 \
    NUMEXPR_NUM_THREADS=2 \
    TORCH_NUM_THREADS=2 \
    VK_OPENCV_THREADS=2 \
    # VisiKartika Sandbox & Torch profile metadata
    VK_CONTAINER_MODE=1 \
    VK_TORCH_PROFILE="${TORCH_PROFILE}" \
    VK_EASYOCR_GPU="auto" \
    VK_MAX_CONCURRENT_CONTEXTS=2 \
    VK_BROWSER_MAX_SCANS=60 \
    VK_V8_MAX_OLD_SPACE_MB=256 \
    # Pre-allow local dev + deployed Vercel SOC dashboard (override via env in production)
    CORS_ORIGINS="http://localhost:3000,http://127.0.0.1:3000,https://zero-day-phising-shield.vercel.app"

WORKDIR /app

COPY --from=builder /opt/venv /opt/venv

# Install ONLY Chromium (+ OS deps), Tesseract (ind+eng), ZBar (libzbar0), and Tini (PID-1 reaper).
# Skipping Firefox & WebKit cuts >1.0 GB from the container footprint.
RUN groupadd --gid 10001 pwuser && \
    useradd --uid 10001 --gid pwuser --shell /usr/sbin/nologin --create-home pwuser && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
        tini \
        tesseract-ocr \
        tesseract-ocr-ind \
        libzbar0 \
        ca-certificates \
        fonts-liberation \
        fonts-noto-color-emoji && \
    playwright install --with-deps chromium && \
    chmod -R o+rx /ms-playwright && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* /root/.cache

COPY --chown=pwuser:pwuser . .

RUN mkdir -p /app/storage/screenshots /app/storage/annotated /home/pwuser/.EasyOCR && \
    chown -R pwuser:pwuser /app/storage /home/pwuser

USER pwuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=6s --start-period=20s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\", \"8000\")}/health', timeout=5)"

ENTRYPOINT ["/usr/bin/tini", "--"]

CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --limit-concurrency 16 --timeout-keep-alive 15"]
