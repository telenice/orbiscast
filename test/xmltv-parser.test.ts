import { mkdtemp, rm, writeFile } from 'fs/promises';
import { Readable } from 'stream';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractXMLTVData, parseXMLTVStream } from '../src/modules/iptv/parsers/xmltv-parser';

const SAMPLE_XMLTV = `<?xml version="1.0" encoding="UTF-8"?>
<tv generator-info-name="test">
  <channel id="bbc1">
    <display-name>BBC One</display-name>
    <display-name>101</display-name>
    <icon src="http://example.com/bbc1.png" />
  </channel>
  <channel id="cnn">
    <display-name>CNN</display-name>
    <display-name>202</display-name>
  </channel>
  <programme start="20240101120000 +0000" stop="20240101130000 +0000" channel="bbc1">
    <title>News</title>
    <desc>Daily news bulletin</desc>
    <category>News</category>
    <episode-num system="xmltv_ns">0.4.0/1</episode-num>
  </programme>
  <programme start="20240101130000 +0000" stop="20240101140000 +0000" channel="cnn">
    <title>CNN: The Movie</title>
  </programme>
</tv>`;

let workDir: string;
let xmlPath: string;

beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'orbiscast-xmltv-'));
    xmlPath = join(workDir, 'guide.xml');
    await writeFile(xmlPath, SAMPLE_XMLTV, 'utf8');
});

afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
});

describe('extractXMLTVData', () => {
    it('extracts channels with names, numbers and icons', async () => {
        const parsed = await extractXMLTVData(xmlPath);

        expect(parsed.channels).toHaveLength(2);
        const bbc = parsed.channels.find(channel => channel.tvg_id === 'bbc1');
        expect(bbc?.tvg_name).toBe('BBC One');
        expect(bbc?.xui_id).toBe(101);
        expect(bbc?.tvg_logo).toBe('http://example.com/bbc1.png');
    });

    it('extracts programmes with parsed timestamps and episode info', async () => {
        const parsed = await extractXMLTVData(xmlPath);

        expect(parsed.programmes).toHaveLength(2);

        const news = parsed.programmes.find(programme => programme.channel === 'bbc1');
        expect(news?.title).toBe('News');
        expect(news?.description).toBe('Daily news bulletin');
        expect(news?.start_timestamp).toBe(1704110400);
        expect(news?.stop_timestamp).toBe(1704114000);
        expect(news?.season).toBe(1);
        expect(news?.episode).toBe(5);
    });

    it('strips a duplicated channel name prefix from titles', async () => {
        const parsed = await extractXMLTVData(xmlPath);
        const movie = parsed.programmes.find(programme => programme.channel === 'cnn');
        expect(movie?.title).toBe('The Movie');
    });

    it('returns empty output for invalid XMLTV', async () => {
        const invalidPath = join(workDir, 'invalid.xml');
        await writeFile(invalidPath, '<not-tv></not-tv>', 'utf8');

        const parsed = await extractXMLTVData(invalidPath);
        expect(parsed.channels).toEqual([]);
        expect(parsed.programmes).toEqual([]);
    });
});

describe('parseXMLTVStream filtering', () => {
    const now = Math.floor(Date.now() / 1000);
    const fmt = (t: number) => new Date(t * 1000).toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000';
    const guide = `<?xml version="1.0"?>
<tv>
  <channel id="bbc1.uk"><display-name>BBC One</display-name></channel>
  <channel id="itv1.uk"><display-name>ITV1</display-name></channel>
  <channel id="other.us"><display-name>Other</display-name></channel>
  <programme start="${fmt(now - 7200)}" stop="${fmt(now - 3600)}" channel="bbc1.uk"><title>Old</title></programme>
  <programme start="${fmt(now)}" stop="${fmt(now + 3600)}" channel="bbc1.uk"><title>Current &amp; Next</title></programme>
  <programme start="${fmt(now)}" stop="${fmt(now + 3600)}" channel="itv1.uk"><title>Corrie</title></programme>
  <programme start="${fmt(now)}" stop="${fmt(now + 3600)}" channel="other.us"><title>Dropped</title></programme>
</tv>`;

    const parse = (xml: string, options = {}) => parseXMLTVStream(Readable.from([xml]), options);

    it('keeps only wanted channels by id or display name', async () => {
        const parsed = await parse(guide, { wanted: new Set(['BBC1.UK', 'itv1']) });
        expect(parsed.channels.map(c => c.tvg_id)).toEqual(['bbc1.uk', 'itv1.uk']);
        expect(parsed.programmes.map(p => p.channel).sort()).toEqual(['bbc1.uk', 'bbc1.uk', 'itv1.uk']);
    });

    it('drops programmes that already ended', async () => {
        const parsed = await parse(guide, { wanted: new Set(['bbc1.uk']), dropEndedBefore: now });
        expect(parsed.programmes.map(p => p.title)).toEqual(['Current & Next']);
    });

    it('drops programmes starting too far ahead', async () => {
        const parsed = await parse(guide, { dropStartingAfter: now - 3600 });
        expect(parsed.programmes.map(p => p.title)).toEqual(['Old']);
    });

    it('keeps everything when no filter is given', async () => {
        const parsed = await parse(guide);
        expect(parsed.channels).toHaveLength(3);
        expect(parsed.programmes).toHaveLength(4);
    });

    it('survives an unescaped ampersand', async () => {
        const parsed = await parse(guide.replace('Corrie', 'Tom & Jerry'));
        expect(parsed.channels).toHaveLength(3);
        expect(parsed.programmes.length).toBeGreaterThanOrEqual(3);
    });

    it('handles input split into many small chunks', async () => {
        const chunks = guide.match(/[\s\S]{1,7}/g) ?? [];
        const parsed = await parseXMLTVStream(Readable.from(chunks), {});
        expect(parsed.programmes).toHaveLength(4);
    });

    it('keeps multi-byte characters split across chunks', async () => {
        const buf = Buffer.from(guide.replace('Corrie', 'Café Société'), 'utf8');
        const chunks: Buffer[] = [];
        for (let i = 0; i < buf.length; i += 5) chunks.push(buf.subarray(i, i + 5));
        const parsed = await parseXMLTVStream(Readable.from(chunks), {});
        expect(parsed.programmes.map(p => p.title)).toContain('Café Société');
    });
});
