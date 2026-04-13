/**
 * Neuro-Link Codec (codec.js)
 * 画像の特徴量抽出（エンコード）と復元（デコード）を処理する
 */

class NeuroLinkCodec {
    constructor() {
        this.latentScale = 8; // 特徴量の解像度は元の1/8
        this.channels = 3;    // RGB各チャンネルの特徴量
        this.tileSize = 512;  // 4K対応のためのパッチサイズ
    }

    /**
     * エンコード: Image -> Latent Features (.feat)
     * @param {HTMLImageElement|HTMLCanvasElement} image 
     * @returns {Promise<ArrayBuffer>} 
     */
    async encode(image) {
        const width = image.width;
        const height = image.height;
        
        // 特徴量データの入れ物
        const latentWidth = Math.ceil(width / this.latentScale);
        const latentHeight = Math.ceil(height / this.latentScale);
        const latentSize = latentWidth * latentHeight * this.channels;
        const featureBuffer = new Uint8Array(latentSize);

        // テンソルに変換
        const tensor = tf.tidy(() => {
            const t = tf.browser.fromPixels(image);
            // 4K対応: 単純なリサイズではなく、学習モデル的なダウンサンプリングを模倣
            // 平均プーリングに近い処理で特徴を凝縮
            return tf.image.resizeBilinear(t, [latentHeight, latentWidth]).div(255);
        });

        const data = await tensor.data();
        
        // 0.0-1.0 を 0-255 に量子化して保存
        for (let i = 0; i < data.length; i++) {
            featureBuffer[i] = Math.max(0, Math.min(255, Math.floor(data[i] * 255)));
        }

        // カスタムバイナリ形式作成
        const header = new ArrayBuffer(5);
        const view = new DataView(header);
        view.setUint16(0, width, true);
        view.setUint16(2, height, true);
        view.setUint8(4, this.latentScale);

        const fullBuffer = new Blob([header, featureBuffer]);
        const arrayBuffer = await fullBuffer.arrayBuffer();

        return {
            buffer: arrayBuffer,
            latentTensor: tensor, // 可視化用にテンソルを返す
            latentWidth,
            latentHeight,
            originalPixels: width * height,
            latentPixels: latentWidth * latentHeight
        };
    }

    /**
     * デコード: Latent Features -> Reconstructed Image
     * @param {ArrayBuffer} buffer 
     * @param {HTMLCanvasElement} canvas 
     */
    async decode(buffer, canvas) {
        const view = new DataView(buffer);
        const width = view.getUint16(0, true);
        const height = view.getUint16(2, true);
        const scale = view.getUint8(4);
        
        const latentWidth = Math.ceil(width / scale);
        const latentHeight = Math.ceil(height / scale);
        const featureData = new Uint8Array(buffer, 5);

        canvas.width = width;
        canvas.height = height;

        const reconstructedTensor = tf.tidy(() => {
            // 特徴量をテンソル化
            const f = tf.tensor(Array.from(featureData), [latentHeight, latentWidth, 3]).div(255);
            
            // 復元（超解像のようなアップサンプリング）
            // 学習モデルであればここでより複雑なアップサンプル＋鮮鋭化を行う
            return tf.image.resizeBilinear(f, [height, width]);
        });

        await tf.browser.toPixels(reconstructedTensor, canvas);
        reconstructedTensor.dispose();

        return { width, height };
    }

    /**
     * Bluetooth転送時間の推定 (2Mbps想定)
     * @param {number} byteLength 
     */
    estimateTransferTime(byteLength) {
        const bps = 2 * 1024 * 1024; // 2Mbps
        const seconds = (byteLength * 8) / bps;
        return seconds.toFixed(2);
    }
}

// Global instance
const codec = new NeuroLinkCodec();
