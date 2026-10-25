import axios from 'axios';
import type { Readable } from 'stream';
import { createGunzip } from 'zlib';
import { getLogger } from '../../utils/logger';
import { cacheFile, getCachedFile } from '../../utils/cache';
import { redactUrl } from '../../utils/redact';

const logger = getLogger();

/**
 * Fetches data from a URL with retry logic and exponential backoff.
 * Implements automatic timeout handling and memory cleanup.
 * 
 * @param url - URL to fetch data from
 * @param cacheFileName - Name to use when caching the file
 * @returns Fetched content as Buffer or null if all retries failed
 */
export async function fetchWithRetry(url: string, cacheFileName: string): Promise<Buffer | null> {
    const maxRetries = 3;
    let retryDelay = 5;

    logger.info(`Downloading from ${redactUrl(url)} to cache as ${cacheFileName}`);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        let abortController: AbortController | null = null;

        try {
            // Create abort controller for proper timeout handling
            abortController = new AbortController();
            const timeoutId = setTimeout(() => {
                abortController?.abort();
            }, 30000);

            logger.info(`Download attempt ${attempt}/${maxRetries}...`);
            const response = await axios.get(url, {
                timeout: 30000,
                responseType: 'arraybuffer',  // Ensure binary data is handled correctly
                signal: abortController.signal,
                maxContentLength: 50 * 1024 * 1024, // 50MB limit
                maxBodyLength: 50 * 1024 * 1024
            });

            clearTimeout(timeoutId);

            if (response.data) {
                const content = Buffer.from(response.data);
                // Release response data from memory after conversion
                response.data = null;
                logger.info(`Downloaded ${content.length} bytes, caching as ${cacheFileName}`);
                try {
                    await cacheFile(cacheFileName, content);
                    logger.debug(`Successfully cached file ${cacheFileName}`);
                } catch (cacheError) {
                    logger.error(`Error caching file: ${cacheError}`);
                }
                return content;
            } else {
                logger.warn('Downloaded content was empty');
            }
        } catch (error) {
            // Check if request was aborted due to timeout
            if (axios.isCancel(error) || (error as any).name === 'AbortError') {
                logger.warn(`Request timeout on attempt ${attempt}`);
            } else if (axios.isAxiosError(error) && (error.code === 'ECONNABORTED' || (error.response?.status ?? 0) >= 500)) {
                logger.warn(`Connection error on attempt ${attempt}: ${redactUrl(error.message)}`);
            } else if (String((error as any)?.message).includes('maxContentLength')) {
                logger.error(`Download from ${redactUrl(url)} is larger than 50 MB; not retrying`);
                return await getCachedFile(cacheFileName);
            } else {
                logger.error(`Request error on attempt ${attempt}: ${redactUrl(String((error as any).message))}`);
            }

            if (attempt < maxRetries) {
                logger.info(`Retrying in ${retryDelay} seconds...`);
                await new Promise(resolve => setTimeout(resolve, retryDelay * 1000));
                retryDelay *= 2;
            } else {
                logger.error('Maximum retries reached. Could not download content.');
                return await getCachedFile(cacheFileName);
            }
        } finally {
            // Clean up abort controller
            if (abortController) {
                abortController = null;
            }
        }
    }
    return null;
}

/**
 * Opens a URL as a stream and hands it to `handler`, retrying with exponential
 * backoff if the connection fails or the stream breaks part-way through.
 * Nothing is buffered in memory or limited in size, which makes this suitable
 * for very large files such as full-provider XMLTV guides. Gzipped files
 * (`.gz` or a gzip content type) are decompressed on the fly.
 *
 * @param url - URL to stream
 * @param handler - Consumes the stream and resolves with a result
 * @returns The handler's result, or null if every attempt failed
 */
export async function streamWithRetry<T>(url: string, handler: (stream: Readable) => Promise<T>): Promise<T | null> {
    const maxRetries = 3;
    let retryDelay = 5;

    logger.info(`Streaming from ${redactUrl(url)}`);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        let response: any = null;
        try {
            logger.info(`Stream attempt ${attempt}/${maxRetries}...`);
            response = await axios.get(url, {
                timeout: 60000,
                responseType: 'stream',
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
            });

            const body: Readable = response.data;
            // Abort if the server stops sending data for a minute.
            (body as any).setTimeout?.(60000, () => body.destroy(new Error('Stream idle for 60s')));

            const contentType = String(response.headers?.['content-type'] || '');
            const path = url.split('?')[0] || '';
            const isGzip = /gzip/i.test(contentType) || path.endsWith('.gz');
            const stream: Readable = isGzip ? body.pipe(createGunzip()) : body;
            if (isGzip) body.on('error', err => stream.destroy(err));

            let streamError: Error | null = null;
            let bytes = 0;
            body.on('data', (chunk: Buffer) => { bytes += chunk.length; });
            stream.on('error', err => { streamError = err; });

            const result = await handler(stream);
            if (streamError) {
                throw streamError;
            }
            logger.info(`Streamed ${(bytes / 1024 / 1024).toFixed(1)} MB`);
            return result;
        } catch (error) {
            logger.warn(`Stream attempt ${attempt} failed: ${redactUrl(String((error as any)?.message ?? error))}`);
            response?.data?.destroy?.();
            if (attempt < maxRetries) {
                logger.info(`Retrying in ${retryDelay} seconds...`);
                await new Promise(resolve => setTimeout(resolve, retryDelay * 1000));
                retryDelay *= 2;
            }
        }
    }

    logger.error('Maximum retries reached. Could not stream content.');
    return null;
}
