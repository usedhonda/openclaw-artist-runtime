import { getClerkToken } from "../auth/clerk.js";
import { resolvePathConfig } from "../config/paths.js";
import { FeedClient } from "../http/feed.js";
import { LedgerStore } from "../ledger/store.js";
export async function createCommandContext(options = {}) {
    const pathOptions = {};
    if (options.dataDir)
        pathOptions.dataDir = options.dataDir;
    if (options.cookieFile)
        pathOptions.cookieFile = options.cookieFile;
    const paths = resolvePathConfig(pathOptions);
    const authOptions = { sessionFile: paths.sessionFile };
    if (options.cookie)
        authOptions.cookie = options.cookie;
    if (options.jwt)
        authOptions.jwt = options.jwt;
    if (paths.cookieFile)
        authOptions.cookieFile = paths.cookieFile;
    const token = await getClerkToken(authOptions);
    return {
        ledger: new LedgerStore(paths.ledgerPath),
        feed: new FeedClient({ jwt: token.jwt }),
        dataDir: paths.dataDir
    };
}
