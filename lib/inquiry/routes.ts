// Route: POST /api/public/inquiries, POST /api/public/applications (công khai);
// GET /api/app/inquiries (sales), GET /api/app/applications (hr) — S-WEB-05 tách quyền ứng viên.
import { getPool } from "../db/index.ts";
import { authorize, clientIp, json, publicRoute, readJson, withActor } from "../http/index.ts";
import { siteCompanyId } from "../site/index.ts";
import { ApplicationInput, checkRate, InquiryInput, submitApplication, submitInquiry } from "./index.ts";
import { fetchLimit, parsePage, toPage } from "../nen/pagination.ts";
import { kb } from "../nen/units.ts";

export const postInquiry = publicRoute(async ({ req, requestId }) => {
  const ip = clientIp(req);
  await checkRate(getPool(), "inquiry", ip);
  const input = InquiryInput.parse(await readJson(req, kb(16)));
  const r = await submitInquiry(getPool(), siteCompanyId(), input, { ip, requestId });
  return json({ code: r.code }, r.created ? 201 : 200);
});

export const postApplication = publicRoute(async ({ req, requestId }) => {
  const ip = clientIp(req);
  await checkRate(getPool(), "application", ip);
  const input = ApplicationInput.parse(await readJson(req, kb(24)));
  const r = await submitApplication(getPool(), siteCompanyId(), input, { ip, requestId });
  return json({ code: r.code }, r.created ? 201 : 200);
});

export const listInquiries = withActor(async (ctx) => {
  await authorize(ctx, "inquiry.manage", { companyId: ctx.actor.companyId }, { type: "inquiry" });
  const page = parsePage(new URL(ctx.req.url).searchParams);
  const { rows } = await getPool().query(
    `SELECT id, code, name, email, phone, message, service_slug, status, assignee_user_id, due_at, suspected_spam, created_at
     FROM inquiry WHERE company_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
    [ctx.actor.companyId, fetchLimit(page), page.offset],
  );
  return json(toPage(rows, page));
});

export const listApplications = withActor(async (ctx) => {
  await authorize(ctx, "application.read", { companyId: ctx.actor.companyId }, { type: "job_application" });
  const page = parsePage(new URL(ctx.req.url).searchParams);
  const { rows } = await getPool().query(
    `SELECT id, code, job_page_id, name, email, phone, status, suspected_spam, created_at
     FROM job_application WHERE company_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
    [ctx.actor.companyId, fetchLimit(page), page.offset],
  );
  return json(toPage(rows, page));
});
