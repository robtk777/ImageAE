/**
 * App Logic (app.js)
 * UIのイベント制御とコーデックの呼び出しを担当
 */

document.addEventListener('DOMContentLoaded', async () => {
    const loadingOverlay = document.getElementById('loading-overlay');
    const imageDropZone = document.getElementById('image-drop-zone');
    const featDropZone = document.getElementById('feat-drop-zone');
    const downloadBtn = document.getElementById('download-feat-btn');
    const downloadOutputBtn = document.getElementById('download-output-btn');
    const outputCanvas = document.getElementById('output-canvas');
    const latentCanvas = document.getElementById('latent-canvas');
    const previewPlaceholder = document.getElementById('preview-placeholder');

    // Batch UI Elements
    const encoderBatchPanel = document.getElementById('encoder-batch-panel');
    const decoderBatchPanel = document.getElementById('decoder-batch-panel');
    const encoderFileList = document.getElementById('encoder-file-list');
    const decoderFileList = document.getElementById('decoder-file-list');
    const encoderCount = document.getElementById('encoder-count');
    const decoderCount = document.getElementById('decoder-count');

    // UI Elements for Stats
    const origPixelsEl = document.getElementById('orig-pixels');
    const latentPixelsEl = document.getElementById('latent-pixels');
    const dataKeptEl = document.getElementById('data-kept');
    const btTimeEl = document.getElementById('bt-transfer-time');

    let currentResults = []; // Stores current batch results
    let currentFeatName = 'batch'; 
    let isProcessing = false;

    // TF.jsの初期化待ち
    try {
        await tf.ready();
        loadingOverlay.classList.add('hidden');
    } catch (e) {
        document.getElementById('loading-text').innerText = 'TF.jsの初期化に失敗しました';
        console.error(e);
    }

    // --- Utility Functions ---

    const setupDropZone = (zone, onFiles) => {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
            zone.addEventListener(evt, (e) => {
                e.preventDefault();
                e.stopPropagation();
            }, false);
        });

        zone.addEventListener('dragover', () => zone.classList.add('active'));
        zone.addEventListener('dragleave', () => zone.classList.remove('active'));
        zone.addEventListener('drop', (e) => {
            zone.classList.remove('active');
            const files = Array.from(e.dataTransfer.files);
            if (files.length > 0) onFiles(files);
        });
    };

    const triggerFileInput = (accept, onFiles) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = accept;
        input.onchange = (e) => {
            const files = Array.from(e.target.files);
            if (files.length > 0) onFiles(files);
        };
        input.click();
    };

    const createListElement = (filename) => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${filename}</span><span class="status pending">待機中</span>`;
        return li;
    };

    const updateListStatus = (li, status, text) => {
        const statusEl = li.querySelector('.status');
        statusEl.className = `status ${status}`;
        statusEl.innerText = text;
    };

    // --- Batch Handlers ---

    async function handleImages(files) {
        if (isProcessing) return;
        const imageFiles = files.filter(f => f.type.startsWith('image/'));
        if (imageFiles.length === 0) return alert('画像ファイルが見つかりません');

        isProcessing = true;
        encoderBatchPanel.classList.remove('hidden');
        encoderFileList.innerHTML = '';
        currentResults = [];
        downloadBtn.disabled = true;

        for (let i = 0; i < imageFiles.length; i++) {
            const file = imageFiles[i];
            const li = createListElement(file.name);
            encoderFileList.appendChild(li);
            encoderCount.innerText = `${i + 1} / ${imageFiles.length}`;
            updateListStatus(li, 'ongoing', '処理中...');

            try {
                const img = await loadImage(file);
                const result = await codec.encode(img);
                
                // 最後の1枚をプレビュー表示
                if (i === imageFiles.length - 1) {
                    updateStatsDisplay(result, img);
                    await renderLatent(result.latentTensor);
                } else {
                    result.latentTensor.dispose();
                }

                currentResults.push({ name: file.name.split('.')[0] + '.feat', data: result.buffer });
                updateListStatus(li, 'done', '完了');
            } catch (err) {
                console.error(err);
                updateListStatus(li, 'error', 'エラー');
            }
        }
        downloadBtn.disabled = false;
        downloadBtn.innerText = imageFiles.length > 1 ? '一括保存 (ZIP)' : '特徴量ファイルを保存';
        isProcessing = false;
    }

    async function handleFeats(files) {
        if (isProcessing) return;
        const featFiles = files.filter(f => f.name.endsWith('.feat'));
        if (featFiles.length === 0) return alert('.featファイルが見つかりません');

        isProcessing = true;
        decoderBatchPanel.classList.remove('hidden');
        decoderFileList.innerHTML = '';
        currentResults = [];
        downloadOutputBtn.disabled = true;

        for (let i = 0; i < featFiles.length; i++) {
            const file = featFiles[i];
            const li = createListElement(file.name);
            decoderFileList.appendChild(li);
            decoderCount.innerText = `${i + 1} / ${featFiles.length}`;
            updateListStatus(li, 'ongoing', '復元中...');

            try {
                const buffer = await file.arrayBuffer();
                const canvas = i === featFiles.length - 1 ? outputCanvas : document.createElement('canvas');
                const { width, height } = await codec.decode(buffer, canvas);
                
                if (i === featFiles.length - 1) {
                    previewPlaceholder.classList.add('hidden');
                    const btSeconds = codec.estimateTransferTime(buffer.byteLength);
                    btTimeEl.innerText = `${btSeconds} 秒`;
                }

                const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
                currentResults.push({ name: file.name.replace('.feat', '.jpg'), data: blob });
                
                updateListStatus(li, 'done', '完了');
            } catch (err) {
                console.error(err);
                updateListStatus(li, 'error', 'エラー');
            }
        }
        downloadOutputBtn.disabled = false;
        downloadOutputBtn.innerText = featFiles.length > 1 ? '一括保存 (ZIP)' : '復元画像を保存';
        isProcessing = false;
    }

    // --- Helper Functions ---

    function loadImage(file) {
        return new Promise((resolve) => {
            const img = new Image();
            img.src = URL.createObjectURL(file);
            img.onload = () => resolve(img);
        });
    }

    async function renderLatent(tensor) {
        latentCanvas.width = tensor.shape[1];
        latentCanvas.height = tensor.shape[0];
        await tf.browser.toPixels(tensor, latentCanvas);
        tensor.dispose();
    }

    function updateStatsDisplay(result, img) {
        const { originalPixels, latentPixels } = result;
        origPixelsEl.innerText = `${originalPixels.toLocaleString()} px`;
        latentPixelsEl.innerText = `${latentPixels.toLocaleString()} px`;
        const keptRatio = (latentPixels / originalPixels) * 100;
        dataKeptEl.innerText = `${keptRatio.toFixed(2)} %`;
    }

    // --- Download Handling (ZIP Support) ---

    async function handleDownload(type) {
        if (currentResults.length === 0) return;

        const defaultName = type === 'encode' ? 'compressed_features' : 'reconstructed_images';
        const zipName = prompt('ZIPファイル名を入力してください（拡張子不要）', defaultName);
        if (!zipName) return;

        if (currentResults.length === 1) {
            const isEncode = type === 'encode';
            const blob = isEncode ? new Blob([currentResults[0].data], { type: 'application/octet-stream' }) : currentResults[0].data;
            saveAs(blob, currentResults[0].name);
        } else {
            const zip = new JSZip();
            currentResults.forEach(res => {
                zip.file(res.name, res.data);
            });
            const content = await zip.generateAsync({ type: 'blob' });
            saveAs(content, `${zipName}.zip`);
        }
    }

    function saveAs(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    // --- Listeners ---

    setupDropZone(imageDropZone, handleImages);
    setupDropZone(featDropZone, handleFeats);

    imageDropZone.addEventListener('click', () => triggerFileInput('image/*', handleImages));
    featDropZone.addEventListener('click', () => triggerFileInput('.feat', handleFeats));

    downloadBtn.addEventListener('click', () => handleDownload('encode'));
    downloadOutputBtn.addEventListener('click', () => handleDownload('decode'));
});
