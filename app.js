/**
 * App Logic (app.js)
 * UIのイベント制御とコーデックの呼び出しを担当
 */

document.addEventListener('DOMContentLoaded', async () => {
    const loadingOverlay = document.getElementById('loading-overlay');
    const imageDropZone = document.getElementById('image-drop-zone');
    const featDropZone = document.getElementById('feat-drop-zone');
    const downloadBtn = document.getElementById('download-feat-btn');
    const outputCanvas = document.getElementById('output-canvas');
    const latentCanvas = document.getElementById('latent-canvas');
    const previewPlaceholder = document.getElementById('preview-placeholder');

    // UI Elements for Stats
    const origPixelsEl = document.getElementById('orig-pixels');
    const latentPixelsEl = document.getElementById('latent-pixels');
    const dataKeptEl = document.getElementById('data-kept');
    const btTimeEl = document.getElementById('bt-transfer-time');

    let currentFeatBuffer = null;
    let currentFeatName = 'image.feat';

    // TF.jsの初期化待ち
    try {
        await tf.ready();
        loadingOverlay.classList.add('hidden');
    } catch (e) {
        document.getElementById('loading-text').innerText = 'TF.jsの初期化に失敗しました';
        console.error(e);
    }

    // --- Drag & Drop Setup ---

    const setupDropZone = (zone, onFile) => {
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
            const file = e.dataTransfer.files[0];
            if (file) onFile(file);
        });
    };

    // Encoder: Image Drop
    setupDropZone(imageDropZone, async (file) => {
        if (!file.type.startsWith('image/')) return alert('画像ファイルを選択してください');

        const originalSize = file.size;
        origSizeEl.innerText = `${(originalSize / 1024).toFixed(1)} KB`;

        const img = new Image();
        img.src = URL.createObjectURL(file);
        img.onload = async () => {
            loadingOverlay.classList.remove('hidden');
            document.getElementById('loading-text').innerText = '特徴量を抽出中 (Encoding)...';

            try {
                const buffer = await codec.encode(img);
                currentFeatBuffer = buffer;
                currentFeatName = file.name.split('.')[0] + '.feat';
                
                const latentSize = buffer.byteLength;
                latentSizeEl.innerText = `${(latentSize / 1024).toFixed(1)} KB`;
                
                const ratio = (latentSize / originalSize) * 100;
                ratioEl.innerText = `${ratio.toFixed(1)} %`;
                
                downloadBtn.disabled = false;
                downloadBtn.innerText = '特徴量ファイルを保存';
            } catch (err) {
                alert('エンコードに失敗しました: ' + err.message);
            } finally {
                loadingOverlay.classList.add('hidden');
            }
        };
    });

    // Decoder: Feat Drop
    setupDropZone(featDropZone, async (file) => {
        if (!file.name.endsWith('.feat')) return alert('.featファイルを選択してください');

        loadingOverlay.classList.remove('hidden');
        document.getElementById('loading-text').innerText = '画像を復元中 (Decoding)...';

        try {
            const buffer = await file.arrayBuffer();
            const { width, height } = await codec.decode(buffer, outputCanvas);
            
            previewPlaceholder.classList.add('hidden');
            
            // Bluetooth推定時間の更新
            const btSeconds = codec.estimateTransferTime(buffer.byteLength);
            btTimeEl.innerText = `${btSeconds} 秒`;
            
        } catch (err) {
            alert('デコードに失敗しました。ファイル形式が正しくない可能性があります。');
        } finally {
            loadingOverlay.classList.add('hidden');
        }
    });

    // Download Handler
    downloadBtn.addEventListener('click', () => {
        if (!currentFeatBuffer) return;
        const blob = new Blob([currentFeatBuffer], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = currentFeatName;
        a.click();
        URL.revokeObjectURL(url);
    });

    // Click to select file fallback
    const triggerFileInput = (accept, onFile) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (file) onFile(file);
        };
        input.click();
    };

    imageDropZone.addEventListener('click', () => {
        triggerFileInput('image/*', (file) => {
            // Dropイベントと同様の処理を手動で呼び出し
            const dropEvent = { dataTransfer: { files: [file] }, preventDefault: () => {}, stopPropagation: () => {} };
            // 実際には直接処理関数を呼ぶのがクリーン
        });
        // 直接ハンドラを共通化
    });

    // 共通処理関数の抽出
    async function handleImageFile(file) {
        if (!file.type.startsWith('image/')) return alert('画像ファイルを選択してください');

        const img = new Image();
        img.src = URL.createObjectURL(file);
        img.onload = async () => {
            loadingOverlay.classList.remove('hidden');
            document.getElementById('loading-text').innerText = '特徴量を抽出中 (Encoding)...';

            try {
                const result = await codec.encode(img);
                const { buffer, latentTensor, latentWidth, latentHeight, originalPixels, latentPixels } = result;

                currentFeatBuffer = buffer;
                currentFeatName = file.name.split('.')[0] + '.feat';
                
                // 統計の更新
                origPixelsEl.innerText = `${originalPixels.toLocaleString()} px`;
                latentPixelsEl.innerText = `${latentPixels.toLocaleString()} px`;
                const keptRatio = (latentPixels / originalPixels) * 100;
                dataKeptEl.innerText = `${keptRatio.toFixed(2)} %`;

                // 特徴量マップの可視化
                latentCanvas.width = latentWidth;
                latentCanvas.height = latentHeight;
                await tf.browser.toPixels(latentTensor, latentCanvas);
                latentTensor.dispose(); // 描画後に破棄
                
                downloadBtn.disabled = false;
                downloadBtn.innerText = '特徴量ファイルを保存';
            } catch (err) {
                alert('エンコードに失敗しました: ' + err.message);
                console.error(err);
            } finally {
                loadingOverlay.classList.add('hidden');
            }
        };
    }

    async function handleFeatFile(file) {
        if (!file.name.endsWith('.feat')) return alert('.featファイルを選択してください');

        loadingOverlay.classList.remove('hidden');
        document.getElementById('loading-text').innerText = '画像を復元中 (Decoding)...';

        try {
            const buffer = await file.arrayBuffer();
            const { width, height } = await codec.decode(buffer, outputCanvas);
            
            previewPlaceholder.classList.add('hidden');
            
            const btSeconds = codec.estimateTransferTime(buffer.byteLength);
            btTimeEl.innerText = `${btSeconds} 秒`;
            
        } catch (err) {
            alert('デコードに失敗しました。ファイル形式が正しくない可能性があります。');
        } finally {
            loadingOverlay.classList.add('hidden');
        }
    }

    // イベントリスナーの再設定
    imageDropZone.addEventListener('drop', (e) => {
        const file = e.dataTransfer.files[0];
        if (file) handleImageFile(file);
    });

    featDropZone.addEventListener('drop', (e) => {
        const file = e.dataTransfer.files[0];
        if (file) handleFeatFile(file);
    });

    imageDropZone.addEventListener('click', () => triggerFileInput('image/*', handleImageFile));
    featDropZone.addEventListener('click', () => triggerFileInput('.feat', handleFeatFile));
});
