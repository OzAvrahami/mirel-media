// The same serialization is used for fingerprinting and sending. Do not add
// timestamps or other changing fields without updating the fingerprint contract.
export function resendPayload(config, message) {
    return {
        from: config.from,
        to: config.to,
        reply_to: message.replyTo,
        subject: message.subject,
        text: message.text
    };
}

export async function sendResendEmail(config, message, {
    fetchImpl = fetch,
    sendTimeoutMs = 10_000,
    idempotencyKey
} = {}) {

    if (typeof idempotencyKey !== 'string' || !/^[\x21-\x7e]{1,256}$/.test(idempotencyKey)) {
        throw new Error('A valid idempotency key is required.');
    }

    const payload = resendPayload(config, message);

    const response = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(sendTimeoutMs),
        headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify(payload)
    });

    return response;
}
