import crypto from 'node:crypto';

import {EmailStatus} from '@plunk/db';
import type {Request, Response} from 'express';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {factories, getPrismaClient} from '../../../../../test/helpers';

vi.mock('../../app/constants.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../app/constants.js')>();
  return {
    ...actual,
    ZEPTOMAIL_WEBHOOK_AUTH_KEY: 'webhook-secret',
    ZEPTOMAIL_WEBHOOK_MAX_AGE_SECONDS: 300,
  };
});

vi.mock('../../services/NtfyService.js', () => ({
  NtfyService: {
    notifyEmailBounce: vi.fn().mockResolvedValue(undefined),
    notifyEmailComplaint: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../services/SecurityService.js', () => ({
  SecurityService: {
    checkAndEnforceSecurityLimits: vi.fn().mockResolvedValue(undefined),
    verifySnsSignature: vi.fn().mockResolvedValue(true),
  },
}));

import {Webhooks} from '../Webhooks.js';

function signedHeader(payload: string, secret = 'webhook-secret') {
  const timestamp = Date.now();
  const signature = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('base64');
  return `ts=${timestamp};s=${encodeURIComponent(signature)};s-algorithm=HmacSHA256`;
}

function makeReq(payload: Record<string, unknown>, signature = signedHeader(JSON.stringify(payload))) {
  const body = Buffer.from(JSON.stringify(payload));

  return {
    body,
    get: (header: string) => {
      if (header.toLowerCase() === 'producer-signature') return signature;
      if (header.toLowerCase() === 'content-type') return 'application/json';
      return undefined;
    },
  } as unknown as Request;
}

function makeRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status: vi.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
    json: vi.fn((body: unknown) => {
      res.body = body;
      return res;
    }),
  };

  return res as unknown as Response & {statusCode: number; body: unknown};
}

function zeptoPayload(eventName: string, emailId: string) {
  return {
    event_name: eventName,
    event_message: {
      email_info: {
        client_reference: emailId,
        email_reference: 'zepto-email-ref',
        subject: 'Subject',
      },
      request_id: 'zepto-request-id',
    },
    webhook_request_id: 'webhook-request-id',
  };
}

describe('ZeptoMail webhooks', () => {
  const prisma = getPrismaClient();
  const controller = new Webhooks();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts a valid delivered event and updates email status', async () => {
    const {project} = await factories.createUserWithProject();
    const contact = await factories.createContact({projectId: project.id});
    const email = await factories.createEmail(project.id, contact.id, {
      status: EmailStatus.SENT,
      messageId: 'zepto-request-id',
    });

    const payload = zeptoPayload('Delivered', email.id);
    const res = makeRes();

    await controller.receiveZeptoMailWebhook(makeReq(payload), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({success: true});

    const updated = await prisma.email.findUnique({where: {id: email.id}});
    expect(updated?.status).toBe(EmailStatus.DELIVERED);
    expect(updated?.deliveredAt).not.toBeNull();

    const event = await prisma.event.findFirst({
      where: {emailId: email.id, name: 'email.delivery'},
    });
    expect(event).not.toBeNull();
  });

  it('rejects invalid signatures before mutating email state', async () => {
    const {project} = await factories.createUserWithProject();
    const contact = await factories.createContact({projectId: project.id});
    const email = await factories.createEmail(project.id, contact.id, {
      status: EmailStatus.SENT,
      messageId: 'zepto-request-id',
    });

    const payload = zeptoPayload('Delivered', email.id);
    const res = makeRes();

    await controller.receiveZeptoMailWebhook(makeReq(payload, signedHeader(JSON.stringify(payload), 'wrong-secret')), res);

    expect(res.statusCode).toBe(403);

    const updated = await prisma.email.findUnique({where: {id: email.id}});
    expect(updated?.status).toBe(EmailStatus.SENT);
    expect(updated?.deliveredAt).toBeNull();
  });

  it('hard bounces unsubscribe contacts', async () => {
    const {project} = await factories.createUserWithProject();
    const contact = await factories.createContact({projectId: project.id, subscribed: true});
    const email = await factories.createEmail(project.id, contact.id, {
      status: EmailStatus.SENT,
      messageId: 'zepto-request-id',
    });

    const payload = zeptoPayload('Hard Bounce', email.id);
    const res = makeRes();

    await controller.receiveZeptoMailWebhook(makeReq(payload), res);

    expect(res.statusCode).toBe(200);

    const updatedEmail = await prisma.email.findUnique({where: {id: email.id}});
    expect(updatedEmail?.status).toBe(EmailStatus.BOUNCED);
    expect(updatedEmail?.bouncedAt).not.toBeNull();

    const updatedContact = await prisma.contact.findUnique({where: {id: contact.id}});
    expect(updatedContact?.subscribed).toBe(false);
  });

  it('soft bounces track an event without unsubscribing contacts', async () => {
    const {project} = await factories.createUserWithProject();
    const contact = await factories.createContact({projectId: project.id, subscribed: true});
    const email = await factories.createEmail(project.id, contact.id, {
      status: EmailStatus.SENT,
      messageId: 'zepto-request-id',
    });

    const payload = zeptoPayload('Soft Bounce', email.id);
    const res = makeRes();

    await controller.receiveZeptoMailWebhook(makeReq(payload), res);

    expect(res.statusCode).toBe(200);

    const updatedEmail = await prisma.email.findUnique({where: {id: email.id}});
    expect(updatedEmail?.status).toBe(EmailStatus.SENT);

    const updatedContact = await prisma.contact.findUnique({where: {id: contact.id}});
    expect(updatedContact?.subscribed).toBe(true);

    const event = await prisma.event.findFirst({
      where: {emailId: email.id, name: 'email.bounce'},
    });
    expect(event).not.toBeNull();
  });
});
