import { existsSync } from 'fs';
import { getLogger } from './logger';
import { buildXtreamXmltvUrl, parseCategoryFilter } from '../modules/iptv/parsers/xtream-parser';
import type { XtreamOutput } from '../modules/iptv/parsers/xtream-parser';
import { parseFrameRate, parseResolution } from '../modules/streaming/video-options';
import type { EncoderType } from '../modules/streaming/video-options';

const logger = getLogger();

class Config {
    PLAYLIST: string;
    XMLTV: string;
    XTREAM_HOST: string;
    XTREAM_USERNAME: string;
    XTREAM_PASSWORD: string;
    XTREAM_OUTPUT: XtreamOutput;
    XTREAM_CATEGORIES: string[];
    XTREAM_EPG: boolean;
    REFRESH_IPTV: number;
    XMLTV_DAYS: number;
    DEFAULT_STREAM_TIMEOUT: number;
    RAM_CACHE: boolean;
    DISCORD_BOT_TOKEN: string;
    DISCORD_USER_TOKEN: string;
    GUILD: string;
    DEBUG: boolean;
    CACHE_DIR: string;
    MINIMIZE_LATENCY: boolean;
    BITRATE_VIDEO: number;
    BITRATE_VIDEO_MAX: number;
    DISABLE_TRANSCODE: boolean;
    ENCODER: EncoderType;
    VAAPI_DEVICE: string;
    HARDWARE_DECODING: boolean;
    STREAM_RESOLUTION: number;
    STREAM_FPS: number;

    constructor() {
        logger.info('Loading environment variables');

        const env = process.env;

        // IPTV configuration
        this.PLAYLIST = env.PLAYLIST?.trim() || '';
        this.XMLTV = env.XMLTV?.trim() || '';

        // Xtream Codes API configuration (alternative or addition to PLAYLIST)
        this.XTREAM_HOST = env.XTREAM_HOST?.trim() || '';
        this.XTREAM_USERNAME = env.XTREAM_USERNAME?.trim() || '';
        this.XTREAM_PASSWORD = env.XTREAM_PASSWORD?.trim() || '';
        this.XTREAM_OUTPUT = env.XTREAM_OUTPUT?.trim().toLowerCase() === 'm3u8' ? 'm3u8' : 'ts';
        this.XTREAM_CATEGORIES = parseCategoryFilter(env.XTREAM_CATEGORIES);
        this.XTREAM_EPG = env.XTREAM_EPG?.trim().toLowerCase() !== 'false';

        // Use the provider's built-in EPG when no XMLTV URL is given
        if (this.XTREAM_ENABLED && !this.XMLTV && this.XTREAM_EPG) {
            this.XMLTV = buildXtreamXmltvUrl({
                host: this.XTREAM_HOST,
                username: this.XTREAM_USERNAME,
                password: this.XTREAM_PASSWORD,
            });
        }

        this.REFRESH_IPTV = parseInt(env.REFRESH_IPTV?.trim() || '1440');
        // Days of upcoming guide data to keep (0 = everything in the guide).
        const xmltvDays = parseFloat(env.XMLTV_DAYS?.trim() || '3');
        this.XMLTV_DAYS = Number.isFinite(xmltvDays) && xmltvDays >= 0 ? xmltvDays : 3;
        this.DEFAULT_STREAM_TIMEOUT = parseInt(env.DEFAULT_STREAM_TIMEOUT?.trim() || '10');

        // Cache configuration
        // RAM cache uses /dev/shm, which only exists on Linux. On other
        // platforms (or when /dev/shm is unavailable) fall back to disk.
        const ramCacheRequested = env.RAM_CACHE?.trim().toLowerCase() !== 'false';
        const ramCacheAvailable = existsSync('/dev/shm');
        this.RAM_CACHE = ramCacheRequested && ramCacheAvailable;
        if (this.RAM_CACHE) {
            this.CACHE_DIR = '/dev/shm/orbiscast';
        } else {
            this.CACHE_DIR = env.CACHE_DIR?.trim() || '../cache';
            if (ramCacheRequested && !ramCacheAvailable) {
                logger.warn('RAM_CACHE was requested but /dev/shm is not available; falling back to disk cache');
            }
        }

        // Discord configuration
        this.DISCORD_BOT_TOKEN = env.DISCORD_BOT_TOKEN?.trim() || '';
        this.DISCORD_USER_TOKEN = env.DISCORD_USER_TOKEN?.trim() || '';
        this.GUILD = env.GUILD?.trim() || '0';

        // Streaming configuration
        this.MINIMIZE_LATENCY = env.MINIMIZE_LATENCY?.trim().toLowerCase() !== 'false';
        this.BITRATE_VIDEO = parseInt(env.BITRATE_VIDEO?.trim() || '5000');
        this.BITRATE_VIDEO_MAX = parseInt(env.BITRATE_VIDEO_MAX?.trim() || '7500');
        this.DISABLE_TRANSCODE = env.DISABLE_TRANSCODE?.trim().toLowerCase() === 'true';

        // Transcoding configuration (only used when DISABLE_TRANSCODE is false)
        const encoder = env.ENCODER?.trim().toLowerCase() || 'software';
        if (encoder !== 'software' && encoder !== 'vaapi') {
            logger.warn(`Unknown ENCODER "${encoder}", using software`);
        }
        this.ENCODER = encoder === 'vaapi' ? 'vaapi' : 'software';
        this.VAAPI_DEVICE = env.VAAPI_DEVICE?.trim() || '/dev/dri/renderD128';
        // Hardware decoding defaults to on with a GPU encoder; set explicitly to override.
        const hwDecode = env.HARDWARE_DECODING?.trim().toLowerCase();
        this.HARDWARE_DECODING = hwDecode ? hwDecode === 'true' : this.ENCODER === 'vaapi';
        // Unset (or 0) keeps the source resolution / frame rate.
        this.STREAM_RESOLUTION = parseResolution(env.STREAM_RESOLUTION);
        this.STREAM_FPS = parseFrameRate(env.STREAM_FPS);
        if (env.STREAM_RESOLUTION?.trim() && !this.STREAM_RESOLUTION) {
            logger.warn(`Invalid STREAM_RESOLUTION "${env.STREAM_RESOLUTION}", keeping source resolution`);
        }
        if (env.STREAM_FPS?.trim() && !this.STREAM_FPS) {
            logger.warn(`Invalid STREAM_FPS "${env.STREAM_FPS}", keeping source frame rate`);
        }
        if (this.DISABLE_TRANSCODE && (this.ENCODER !== 'software' || this.STREAM_RESOLUTION || this.STREAM_FPS)) {
            logger.warn('ENCODER, STREAM_RESOLUTION and STREAM_FPS have no effect while DISABLE_TRANSCODE=true');
        }

        // Debug configuration
        this.DEBUG = env.DEBUG?.trim().toLowerCase() === 'true';

        logger.info(`Loaded GUILD ID: ${this.GUILD}`);

        if (!this.validateEnvVars()) {
            logger.error('Failed to load environment variables');
            logger.debug(`Environment variables: ${env}`);
            return;
        }

        logger.info('Successfully loaded environment variables');
        logger.info(`Debug mode is set to: ${this.DEBUG}`);
        logger.debug(`Configuration: ${JSON.stringify(this.getSanitizedConfig(), null, 2)}`);
    }

    /**
     * Whether a complete set of Xtream credentials is configured
     */
    get XTREAM_ENABLED(): boolean {
        return Boolean(this.XTREAM_HOST && this.XTREAM_USERNAME && this.XTREAM_PASSWORD);
    }

    /**
     * Validates that all required environment variables are set
     * @returns True if all required variables are set, false otherwise
     */
    private validateEnvVars(): boolean {
        const requiredVars = ['DISCORD_BOT_TOKEN', 'DISCORD_USER_TOKEN', 'GUILD'];
        let allVarsSet = true;

        requiredVars.forEach(varName => {
            const value = this[varName as keyof Config];
            // GUILD defaults to the sentinel "0", which means it was not set.
            const isSet = varName === 'GUILD' ? value !== '0' : Boolean(value);
            if (!isSet) {
                logger.error(`${varName} environment variable not set`);
                allVarsSet = false;
            }
        });

        const xtreamVars = ['XTREAM_HOST', 'XTREAM_USERNAME', 'XTREAM_PASSWORD'] as const;
        const xtreamSet = xtreamVars.filter(varName => Boolean(this[varName]));
        if (xtreamSet.length > 0 && xtreamSet.length < xtreamVars.length) {
            const missing = xtreamVars.filter(varName => !this[varName]);
            logger.error(`Incomplete Xtream configuration, missing: ${missing.join(', ')}`);
            allVarsSet = false;
        }

        if (!this.PLAYLIST && !this.XTREAM_ENABLED) {
            logger.error('No IPTV source configured: set PLAYLIST or XTREAM_HOST, XTREAM_USERNAME and XTREAM_PASSWORD');
            allVarsSet = false;
        }

        return allVarsSet;
    }

    /**
     * Creates a sanitized version of the config for logging, with sensitive values hidden
     * @returns Sanitized configuration object
     */
    private getSanitizedConfig(): Record<string, any> {
        const sanitized = { ...this };

        if (sanitized.PLAYLIST) {
            sanitized.PLAYLIST = this.obfuscateString(sanitized.PLAYLIST, true);
        }
        if (sanitized.XMLTV) {
            sanitized.XMLTV = this.obfuscateString(sanitized.XMLTV, true);
        }

        if (sanitized.XTREAM_USERNAME) {
            sanitized.XTREAM_USERNAME = this.obfuscateString(sanitized.XTREAM_USERNAME, true);
        }
        if (sanitized.XTREAM_PASSWORD) {
            sanitized.XTREAM_PASSWORD = this.obfuscateString(sanitized.XTREAM_PASSWORD, true);
        }

        if (sanitized.DISCORD_BOT_TOKEN) {
            sanitized.DISCORD_BOT_TOKEN = this.obfuscateString(sanitized.DISCORD_BOT_TOKEN);
        }
        if (sanitized.DISCORD_USER_TOKEN) {
            sanitized.DISCORD_USER_TOKEN = this.obfuscateString(sanitized.DISCORD_USER_TOKEN);
        }

        return sanitized;
    }

    /**
     * Obfuscates a string for display in logs
     * @param input - The string to obfuscate
     * @param full_obfuscation - Whether to obfuscate the entire string or leave the last 4 characters visible
     * @returns Obfuscated string
     */
    private obfuscateString(input: string, full_obfuscation: boolean = false): string {
        if (full_obfuscation) {
            return '*'.repeat(input.length);
        }
        // Keep the last 4 characters visible so tokens can still be identified.
        const visibleLength = Math.min(4, input.length);
        return '*'.repeat(input.length - visibleLength) + input.slice(input.length - visibleLength);
    }
}

export const config = new Config();
