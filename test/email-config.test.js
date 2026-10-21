import test from 'node:test';
import assert from 'node:assert/strict';
import { readEmailConfig, readEmailProvider, readGmailAuthorizationConfig } from '../src/email-config.js';

test('provider selection defaults to Resend, normalizes names and rejects unknown providers', () => {
    for (const value of [undefined, '', '   ', '\t\n', ' ReSeNd '])
        assert.equal(readEmailProvider({ EMAIL_PROVIDER: value }), 'resend');
    assert.equal(readEmailProvider({ EMAIL_PROVIDER: ' GMAIL ' }), 'gmail');
    assert.throws(() => readEmailConfig({ EMAIL_PROVIDER: 'unknown-secret-value' }),
        { message: 'EMAIL_PROVIDER must be "resend" or "gmail".' });
});

test('only selected credentials are read and incomplete settings fail closed', () => {
    const resend = { RESEND_API_KEY: 'fake-key', CONTACT_FROM: 'sender@example.com', CONTACT_TO: 'inbox@example.net',
        get GOOGLE_CLIENT_ID() { throw new Error('Must not read Gmail credentials'); } };
    assert.equal(readEmailConfig(resend).configured, true);
    for (const key of ['RESEND_API_KEY', 'CONTACT_FROM', 'CONTACT_TO'])
        for (const value of ['', ' ', 'bad\r\nvalue']) {
            const invalid = Object.create(null, Object.getOwnPropertyDescriptors(resend));
            invalid[key] = value;
            assert.equal(readEmailConfig(invalid).configured, false);
        }
    const gmail = { EMAIL_PROVIDER: 'gmail', GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret',
        GOOGLE_REFRESH_TOKEN: 'test-refresh', GMAIL_SENDER: 'sender@example.com', CONTACT_TO: 'inbox@example.net',
        get RESEND_API_KEY() { throw new Error('Must not read Resend credentials'); } };
    assert.equal(readEmailConfig(gmail).configured, true);
});

test('Gmail authorization config is independent of provider, recipient and refresh token', () => {
    const env = { EMAIL_PROVIDER: 'resend', GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret',
        GMAIL_SENDER: 'operator@example.org', get GOOGLE_REFRESH_TOKEN() { throw new Error('Must not read token'); },
        get CONTACT_TO() { throw new Error('Must not read recipient'); } };
    assert.deepEqual(readGmailAuthorizationConfig(env), {clientId:'test-client', clientSecret:'test-secret', sender:'operator@example.org'});
    assert.throws(() => readGmailAuthorizationConfig({ GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret' }), /GMAIL_SENDER/);
});

test('Resend configuration validates sender and recipient addresses', () => {
    const env = {
        EMAIL_PROVIDER: 'resend',
        RESEND_API_KEY: 'fake-key-for-testing',
        CONTACT_FROM: 'sender@example.com',
        CONTACT_TO: 'recipient@example.com'
    };

    assert.equal(readEmailConfig(env).configured, true);

    assert.equal(
        readEmailConfig({ ...env, CONTACT_FROM: 'not-an-email' }).configured,
        false
    );

    assert.equal(
        readEmailConfig({ ...env, CONTACT_TO: 'not-an-email' }).configured,
        false
    );
});

test('Gmail configuration validates credentials and addresses', () => {
    const env = {
        EMAIL_PROVIDER: 'gmail',
        GOOGLE_CLIENT_ID: 'fake-key-for-testing',
        GOOGLE_CLIENT_SECRET: 'abcd-1234',
        GOOGLE_REFRESH_TOKEN: 'dsldjasfsd-1213cs#!#!dn',
        GMAIL_SENDER: 'sender@example.com',
        CONTACT_TO: 'recipient@example.com'
    }

    assert.equal(readEmailConfig(env).configured, true);

    assert.equal(
        readEmailConfig({ ...env, GOOGLE_CLIENT_ID: '' }).configured,
        false
    );

    assert.equal(
        readEmailConfig({ ...env, GOOGLE_CLIENT_SECRET: 'abcd 1234' }).configured,
        false
    );

    assert.equal(
        readEmailConfig({ ...env, GOOGLE_REFRESH_TOKEN: '' }).configured,
        false
    );

    assert.equal(
        readEmailConfig({ ...env, GMAIL_SENDER: 'not-an-email' }).configured,
        false
    );

    assert.equal(
        readEmailConfig({ ...env, CONTACT_TO: 'not-an-email' }).configured,
        false
    );

});
