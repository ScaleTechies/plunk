import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('../../app/constants.js', () => ({
  DASHBOARD_URI: 'https://dashboard.example.com',
  EMAIL_DAILY_LIMIT: 5000,
  EMAIL_RATE_LIMIT_PER_SECOND: 2,
  ZEPTOMAIL_API_URL: 'https://api.zeptomail.test/v1.1/email',
  ZEPTOMAIL_SEND_TOKEN: 'test-token',
}));

import {getSendingQuota, sendRawEmail} from '../SESService.js';

describe('ZeptoMail-backed SESService compatibility layer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            request_id: 'zepto-request-123',
          }),
          {status: 200},
        ),
      ),
    );
  });

  it('sends the expected ZeptoMail payload', async () => {
    const result = await sendRawEmail({
      from: {name: 'Sender', email: 'sender@example.com'},
      to: [{name: 'Recipient', email: 'recipient@example.com'}],
      content: {
        subject: 'Test subject',
        html: '<p>Hello <a href="https://dashboard.example.com/unsubscribe/00000000-0000-0000-0000-000000000001">unsubscribe</a></p>',
      },
      reply: 'reply@example.com',
      headers: {'X-Test': 'true'},
      tracking: false,
      clientReference: 'email-id-123',
      attachments: [
        {
          filename: 'invoice.pdf',
          content: 'ZmFrZQ==',
          contentType: 'application/pdf',
          disposition: 'attachment',
        },
        {
          filename: 'logo.png',
          content: 'aW1hZ2U=',
          contentType: 'image/png',
          contentId: 'logo',
          disposition: 'inline',
        },
      ],
    });

    expect(result).toEqual({messageId: 'zepto-request-123'});
    expect(fetch).toHaveBeenCalledWith(
      'https://api.zeptomail.test/v1.1/email',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: 'Zoho-enczapikey test-token',
        }),
      }),
    );

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const payload = JSON.parse(String(init?.body));

    expect(payload).toMatchObject({
      from: {address: 'sender@example.com', name: 'Sender'},
      to: [{email_address: {address: 'recipient@example.com', name: 'Recipient'}}],
      reply_to: [{address: 'reply@example.com'}],
      subject: 'Test subject',
      htmlbody: expect.stringContaining('Hello'),
      track_opens: false,
      track_clicks: false,
      client_reference: 'email-id-123',
      mime_headers: {
        'X-Test': 'true',
        'List-Unsubscribe': '<https://dashboard.example.com/unsubscribe/00000000-0000-0000-0000-000000000001>',
      },
      attachments: [{name: 'invoice.pdf', content: 'ZmFrZQ==', mime_type: 'application/pdf'}],
      inline_images: [{name: 'logo.png', content: 'aW1hZ2U=', mime_type: 'image/png', cid: 'logo'}],
    });
  });

  it('returns nested ZeptoMail email reference when request_id is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              {
                additional_info: {
                  email_reference: 'email-ref-123',
                },
              },
            ],
          }),
          {status: 200},
        ),
      ),
    );

    await expect(
      sendRawEmail({
        from: {name: 'Sender', email: 'sender@example.com'},
        to: ['recipient@example.com'],
        content: {subject: 'Test', html: '<p>Hello</p>'},
      }),
    ).resolves.toEqual({messageId: 'email-ref-123'});
  });

  it('throws useful errors for ZeptoMail failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              message: 'Invalid sender',
            },
          }),
          {status: 400},
        ),
      ),
    );

    await expect(
      sendRawEmail({
        from: {name: 'Sender', email: 'sender@example.com'},
        to: ['recipient@example.com'],
        content: {subject: 'Test', html: '<p>Hello</p>'},
      }),
    ).rejects.toThrow('Invalid sender');
  });

  it('reports static env quota', async () => {
    await expect(getSendingQuota()).resolves.toEqual({
      maxSendRate: 2,
      max24HourSend: 5000,
      sentLast24Hours: 0,
    });
  });
});
