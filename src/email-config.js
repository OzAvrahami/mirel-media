import { emailAddress } from './email-address.js';

function isCredential(value) {
    return typeof value === 'string' && /^[\x21-\x7e]+$/.test(value);
}

export class EmailConfigurationError extends Error {}

export function readEmailProvider(env = process.env) {

    const providerValue  = (env.EMAIL_PROVIDER || '').trim().toLowerCase();
    const emailProvider = providerValue || 'resend';

    if ((emailProvider !== 'resend') && (emailProvider !== 'gmail')) {
        throw new EmailConfigurationError('EMAIL_PROVIDER must be "resend" or "gmail".');
    }

    return emailProvider;
}

export function readEmailConfig(env = process.env) {
    const provider = readEmailProvider(env);

    const to = emailAddress((env.CONTACT_TO || '').trim());

    if (provider === 'resend') {
        const apiKey = (env.RESEND_API_KEY || '').trim();
        const from = emailAddress((env.CONTACT_FROM || '').trim());

        const configured = isCredential(apiKey) && Boolean(from && to);

        return {
            provider,
            apiKey,
            from,
            to,
            configured
        };
    } else if (provider === 'gmail') {
        const clientId = (env.GOOGLE_CLIENT_ID || '').trim();
        const clientSecret = (env.GOOGLE_CLIENT_SECRET || '').trim();
        const refreshToken = (env.GOOGLE_REFRESH_TOKEN || '').trim();
        const from = emailAddress((env.GMAIL_SENDER || '').trim());

        const configured = isCredential(clientId) &&
            isCredential(clientSecret) &&
            isCredential(refreshToken)
            && Boolean(from && to);

        return {
            provider,
            clientId,
            clientSecret,
            refreshToken,
            from,
            to,
            configured
        };
    }
}

// Authorization is independent of EMAIL_PROVIDER, CONTACT_TO and an existing token.
export function readGmailAuthorizationConfig(env = process.env) {
    const clientId = (env.GOOGLE_CLIENT_ID || '').trim();
    const clientSecret = (env.GOOGLE_CLIENT_SECRET || '').trim();
    const sender = emailAddress((env.GMAIL_SENDER || '').trim());
    if (!isCredential(clientId) || !isCredential(clientSecret) || !sender) {
        throw new EmailConfigurationError('Set valid GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GMAIL_SENDER before authorizing Gmail.');
    }
    return { clientId, clientSecret, sender };
}
