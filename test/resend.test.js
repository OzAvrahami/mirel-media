import test from 'node:test';
import assert from 'node:assert/strict';
import { sendResendEmail } from '../src/resend.js';

test('Resend sends the expected request and returns the response', async () => {
    const requests = [];
    const fakeResponse = new Response(
        JSON.stringify({ id: 'fake-email-id' }),
        { status: 200 }
    );

    const fakeFetch = async (url, options) => {
        requests.push({ url, options });
        return fakeResponse;
    };

    const config = {
        apiKey: 'fake-api-key',
        from: 'sender@example.com',
        to: 'recipient@example.com'
    };

    const message = {
        replyTo: 'visitor@example.com',
        subject: 'Test inquiry',
        text: 'Hello from the test.'
    };

    const response = await sendResendEmail(config, message, {
        fetchImpl: fakeFetch,
        idempotencyKey: 'test-inquiry-1'
    });

    assert.equal(requests.length, 1);
    assert.equal(response, fakeResponse);

    const { url, options } = requests[0];

    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer fake-api-key');
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.equal(options.headers['Idempotency-Key'], 'test-inquiry-1');

    assert.deepEqual(JSON.parse(options.body), {
        from: config.from,
        to: config.to,
        reply_to: message.replyTo,
        subject: message.subject,
        text: message.text
    });
});

test('Resend rejects invalid idempotency keys before sending', async () => {
    let requestCount = 0;

    const fakeFetch = async () => {
        requestCount += 1;
        return new Response('{}', { status: 200 });
    };

    const config = {
        apiKey: 'fake-api-key',
        from: 'sender@example.com',
        to: 'recipient@example.com'
    };

    const message = {
        replyTo: 'visitor@example.com',
        subject: 'Test inquiry',
        text: 'Hello from the test.'
    };

    const invalidKeys = [
        undefined,
        '',
        '   ',
        123,
        'x'.repeat(257), 'key\r\nInjected: value', 'key with spaces', 'non-ASCII-\u00e9'
    ];

    for (const idempotencyKey of invalidKeys) {
        await assert.rejects(
            () => sendResendEmail(config, message, {
                fetchImpl: fakeFetch,
                idempotencyKey
            }),
            { message: 'A valid idempotency key is required.' }
        );
    }

    assert.equal(requestCount, 0);
});
