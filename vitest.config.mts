import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['test/**/*.test.ts'],
        env: {
            DISCORD_BOT_TOKEN: 'test-bot-token',
            DISCORD_USER_TOKEN: 'test-user-token',
            GUILD: '123456789012345678',
            PLAYLIST: 'http://example.com/playlist.m3u',
            RAM_CACHE: 'false',
            CACHE_DIR: './.cache-test',
            DEBUG: 'false'
        },
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov'],
            include: ['src/**/*.ts'],
            exclude: ['src/index.ts', 'src/**/index.ts']
        }
    }
});
