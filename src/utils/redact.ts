/**
 * Masks credentials in IPTV URLs so they can be logged safely.
 * Handles `username=`/`password=` query parameters, Xtream stream paths
 * (`/live/<user>/<pass>/<id>`) and `user:pass@host` userinfo.
 *
 * @param url - URL that may contain credentials
 * @returns URL with credentials replaced by `***`
 */
export function redactUrl(url: string): string {
    if (!url) {
        return url;
    }
    return url
        .replace(/(\/\/)[^/@\s'"]+@/g, '$1***@')
        .replace(/([?&](?:username|password|user|pass|token)=)[^&#\s]*/gi, '$1***')
        .replace(/(\/(?:live|movie|series|timeshift)\/)[^/\s]+\/[^/\s]+\//gi, '$1***/***/');
}
