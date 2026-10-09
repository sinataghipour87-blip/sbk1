/**
 * 🗜️ ماژول فشرده‌سازی بی‌زیان (Lossless Data Compression) برای حافظه IndexedDB ۵ مغز
 * Native GZIP Compression Stream & Bit-Packing Engine for Browser IndexedDB Storage
 */

export interface CompressionResult {
  compressedData: string; // Base64 encoded GZIP or packed string
  originalSizeBytes: number;
  compressedSizeBytes: number;
  compressionRatioPct: number;
  algorithm: 'GZIP_STREAM' | 'BIT_PACKING_LZW';
}

export class IndexedDbCompressionEngine {
  private static instance: IndexedDbCompressionEngine;

  public static getInstance(): IndexedDbCompressionEngine {
    if (!IndexedDbCompressionEngine.instance) {
      IndexedDbCompressionEngine.instance = new IndexedDbCompressionEngine();
    }
    return IndexedDbCompressionEngine.instance;
  }

  /**
   * فشرده‌سازی بی‌زیان شیء یا رشته ورودی با استفاده از GZIP CompressionStream مرورگر
   */
  public async compress<T>(data: T): Promise<CompressionResult> {
    const jsonStr = typeof data === 'string' ? data : JSON.stringify(data);
    const originalSizeBytes = new TextEncoder().encode(jsonStr).length;

    // استفاده از CompressionStream نیتیو مرورگر در صورت پشتیبانی
    if (typeof CompressionStream !== 'undefined') {
      try {
        const stream = new Blob([jsonStr]).stream();
        const compressedStream = stream.pipeThrough(new CompressionStream('gzip'));
        const response = new Response(compressedStream);
        const arrayBuffer = await response.arrayBuffer();

        // تبدیل به Base64 برای ذخیره‌سازی ایمن در IndexedDB
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const compressedBase64 = btoa(binary);
        const compressedSizeBytes = new TextEncoder().encode(compressedBase64).length;

        const ratio = Math.round((1 - (compressedSizeBytes / Math.max(1, originalSizeBytes))) * 100);

        return {
          compressedData: compressedBase64,
          originalSizeBytes,
          compressedSizeBytes,
          compressionRatioPct: Math.max(0, ratio),
          algorithm: 'GZIP_STREAM'
        };
      } catch (e) {
        // بازگشت به فشرده‌سازی LZW در صورت عدم پشتیبانی یا خطا
      }
    }

    // الگوریتم جایگزین LZW Bit-Packing
    const compressedStr = this.lzwCompress(jsonStr);
    const compressedSizeBytes = new TextEncoder().encode(compressedStr).length;
    const ratio = Math.round((1 - (compressedSizeBytes / Math.max(1, originalSizeBytes))) * 100);

    return {
      compressedData: compressedStr,
      originalSizeBytes,
      compressedSizeBytes,
      compressionRatioPct: Math.max(0, ratio),
      algorithm: 'BIT_PACKING_LZW'
    };
  }

  /**
   * خروج از فشرده‌سازی و بازیابی دقیق داده‌ها (Decompress)
   */
  public async decompress<T>(compressedResult: CompressionResult | string): Promise<T | null> {
    const compressedStr = typeof compressedResult === 'string' ? compressedResult : compressedResult.compressedData;

    if (typeof DecompressionStream !== 'undefined') {
      try {
        const binaryStr = atob(compressedStr);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }

        const stream = new Blob([bytes]).stream();
        const decompressedStream = stream.pipeThrough(new DecompressionStream('gzip'));
        const response = new Response(decompressedStream);
        const text = await response.text();

        return JSON.parse(text) as T;
      } catch (e) {
        // بازگشت به خروج فشرده‌سازی LZW
      }
    }

    try {
      const text = this.lzwDecompress(compressedStr);
      return JSON.parse(text) as T;
    } catch (e) {
      console.error('Failed to decompress IndexedDB state:', e);
      return null;
    }
  }

  // الگوریتم LZW
  private lzwCompress(uncompressed: string): string {
    const dict: { [key: string]: number } = {};
    for (let i = 0; i < 256; i++) {
      dict[String.fromCharCode(i)] = i;
    }

    let c = '';
    const out: number[] = [];
    let dictSize = 256;

    for (let i = 0; i < uncompressed.length; i++) {
      const char = uncompressed.charAt(i);
      const wc = c + char;
      if (Object.prototype.hasOwnProperty.call(dict, wc)) {
        c = wc;
      } else {
        out.push(dict[c]);
        dict[wc] = dictSize++;
        c = char;
      }
    }

    if (c !== '') {
      out.push(dict[c]);
    }

    return out.map(code => String.fromCharCode(code)).join('');
  }

  private lzwDecompress(compressed: string): string {
    const dict: { [key: number]: string } = {};
    for (let i = 0; i < 256; i++) {
      dict[i] = String.fromCharCode(i);
    }

    let entry = '';
    let w = String.fromCharCode(compressed.charCodeAt(0));
    let result = w;
    let dictSize = 256;

    for (let i = 1; i < compressed.length; i++) {
      const k = compressed.charCodeAt(i);
      if (dict[k]) {
        entry = dict[k];
      } else {
        if (k === dictSize) {
          entry = w + w.charAt(0);
        } else {
          return '';
        }
      }

      result += entry;
      dict[dictSize++] = w + entry.charAt(0);
      w = entry;
    }

    return result;
  }
}

export const indexedDbCompressor = IndexedDbCompressionEngine.getInstance();
