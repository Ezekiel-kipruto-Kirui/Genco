import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import {onValueWritten} from "firebase-functions/v2/database";
import {setGlobalOptions} from "firebase-functions/v2/options";
import {onSchedule} from "firebase-functions/v2/scheduler";
import nodemailer from "nodemailer";

setGlobalOptions({maxInstances: 10, region: "us-central1"});

admin.initializeApp();

const DEFAULT_HR_TIMEOUT_HOURS = 24;
const DEFAULT_HR_REJECTION_REASON =
  "Rejected by HR because no approval was provided in time.";
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_DIGITS_REGEX = /\D+/g;
const ROLE_HR_IDENTIFIERS = new Set([
  "hr",
  "human resource manager",
  "humman resource manager",
  "human resource manger",
  "humman resource manger",
]);
const ROLE_PROJECT_MANAGER_IDENTIFIERS = new Set(["project manager"]);
const ROLE_FINANCE_IDENTIFIERS = new Set(["finance"]);

interface RequisitionRecord {
  status?: string;
  type?: string;
  uid?: string;
  name?: string;
  userName?: string;
  username?: string;
  email?: string;
  requesterEmail?: string;
  userEmail?: string;
  programme?: string;
  phone?: string;
  phoneNumber?: string;
  mobile?: string;
  telephone?: string;
  contact?: string;
  submittedAt?: number | string;
  approvedAt?: number | string;
  approvedBy?: string;
  authorizedBy?: string;
  completedBy?: string;
  completedAt?: number | string;
  county?: string;
  subcounty?: string;
  tripPurpose?: string;
  fuelPurpose?: string;
  total?: number | string;
  fuelAmount?: number | string;
  rejectedBy?: string;
  rejectedAt?: number | string;
  rejectionReason?: string;
  rejectionSmsText?: string;
  hrAutoRejected?: boolean;
  [key: string]: unknown;
}

interface UserRecord {
  uid?: string;
  name?: string;
  email?: string;
  role?: string;
  status?: string;
  phone?: string;
  phoneNumber?: string;
  mobile?: string;
  telephone?: string;
  contact?: string;
  allowedProgrammes?: Record<string, boolean>;
  accessControl?: {
    customAttribute?: string;
    customAttributes?: Record<string, string>;
  };
  [key: string]: unknown;
}

let transporter: nodemailer.Transporter | null = null;

const getEnv = (name: string): string => (process.env[name] ?? "").trim();

const normalize = (value: unknown): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const isValidEmail = (value: string): boolean => EMAIL_REGEX.test(value.trim());

const parseNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const parseTimestampMs = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const fromNumeric = Number(value);
    if (Number.isFinite(fromNumeric)) return fromNumeric;
    const fromDate = new Date(value).getTime();
    if (Number.isFinite(fromDate)) return fromDate;
  }
  return null;
};

const normalizePhone = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;

  const hasPlus = raw.startsWith("+");
  let digits = raw.replace(PHONE_DIGITS_REGEX, "");
  if (!digits) return null;

  if (digits.startsWith("0") && digits.length === 10) {
    digits = `254${digits.slice(1)}`;
  } else if (digits.startsWith("7") && digits.length === 9) {
    digits = `254${digits}`;
  }

  if (digits.length < 9) return null;
  return hasPlus ? `+${digits}` : digits;
};

const getRoleTokens = (user: UserRecord): string[] => {
  const tokens = new Set<string>();
  const role = normalize(user.role);
  if (role) tokens.add(role);

  const customAttribute = normalize(user.accessControl?.customAttribute);
  if (customAttribute) tokens.add(customAttribute);

  const legacy = user.accessControl?.customAttributes;
  if (legacy && typeof legacy === "object") {
    for (const key of Object.keys(legacy)) {
      const token = normalize(key);
      if (token) tokens.add(token);
    }
  }

  return [...tokens];
};

const hasAnyRoleToken = (user: UserRecord, allowedTokens: Set<string>): boolean =>
  getRoleTokens(user).some((token) => allowedTokens.has(token));

const getUserPhone = (user: UserRecord): string | null => {
  const phoneCandidates = [
    user.phoneNumber,
    user.phone,
    user.mobile,
    user.telephone,
    user.contact,
  ];
  for (const candidate of phoneCandidates) {
    const normalizedPhone = normalizePhone(candidate);
    if (normalizedPhone) return normalizedPhone;
  }
  return null;
};

const getRequesterPhone = (record: RequisitionRecord): string | null => {
  const phoneCandidates = [
    record.phoneNumber,
    record.phone,
    record.mobile,
    record.telephone,
    record.contact,
  ];
  for (const candidate of phoneCandidates) {
    const normalizedPhone = normalizePhone(candidate);
    if (normalizedPhone) return normalizedPhone;
  }
  return null;
};

const getRequesterName = (record: RequisitionRecord): string =>
  record.name || record.userName || record.username || "Requester";

const getUserByKey = async (userKey: string): Promise<UserRecord | null> => {
  const key = userKey.trim();
  if (!key) return null;

  const snapshot = await admin.database().ref(`users/${key}`).get();
  if (!snapshot.exists()) return null;

  return snapshot.val() as UserRecord;
};

const getFirstUserByChild = async (
  childKey: string,
  value: string,
): Promise<UserRecord | null> => {
  const trimmedValue = value.trim();
  if (!trimmedValue) return null;

  const snapshot = await admin
    .database()
    .ref("users")
    .orderByChild(childKey)
    .equalTo(trimmedValue)
    .limitToFirst(1)
    .get();

  if (!snapshot.exists()) return null;

  const data = snapshot.val() as Record<string, UserRecord>;
  const first = Object.values(data)[0];
  return first || null;
};

const resolveRequesterPhone = async (
  record: RequisitionRecord,
): Promise<string | null> => {
  const direct = getRequesterPhone(record);
  if (direct) return direct;

  const uid = typeof record.uid === "string" ? record.uid.trim() : "";
  const keyCandidates = [
    uid,
    typeof record.username === "string" ? record.username.trim() : "",
    typeof record.userName === "string" ? record.userName.trim() : "",
  ].filter((value) => value.length > 0);

  try {
    for (const key of keyCandidates) {
      const userData = await getUserByKey(key);
      if (!userData) continue;
      const phone = getUserPhone(userData);
      if (phone) return phone;
    }

    if (uid) {
      const userByUid = await getFirstUserByChild("uid", uid);
      const phoneByUid = userByUid ? getUserPhone(userByUid) : null;
      if (phoneByUid) return phoneByUid;
    }

    const emailCandidates = [
      record.email,
      record.requesterEmail,
      record.userEmail,
    ]
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    for (const email of emailCandidates) {
      const userByEmail = await getFirstUserByChild("email", email);
      const phoneByEmail = userByEmail ? getUserPhone(userByEmail) : null;
      if (phoneByEmail) return phoneByEmail;

      const emailLower = email.toLowerCase();
      if (emailLower !== email) {
        const userByLowerEmail = await getFirstUserByChild("email", emailLower);
        const phoneByLowerEmail = userByLowerEmail ? getUserPhone(userByLowerEmail) : null;
        if (phoneByLowerEmail) return phoneByLowerEmail;
      }
    }
  } catch (error) {
    logger.error("Failed requester phone lookup in /users", {uid, error});
  }

  return null;
};

const formatAmount = (record: RequisitionRecord): string => {
  const amount = parseNumber(record.total) ?? parseNumber(record.fuelAmount);
  if (amount == null) return "N/A";
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 2,
  }).format(amount);
};

const getTransporter = (): nodemailer.Transporter | null => {
  if (transporter) return transporter;

  const host = getEnv("SMTP_HOST");
  const user = getEnv("SMTP_USER");
  const pass = getEnv("SMTP_PASS");
  const portText = getEnv("SMTP_PORT");
  const secureText = normalize(getEnv("SMTP_SECURE"));

  if (!host || !user || !pass) {
    logger.warn(
      "Email skipped. Missing SMTP config. " +
      "Set SMTP_HOST, SMTP_USER, SMTP_PASS.",
    );
    return null;
  }

  const parsedPort = Number.parseInt(portText || "587", 10);
  const port = Number.isNaN(parsedPort) ? 587 : parsedPort;
  const secure = secureText === "true" || port === 465;

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {user, pass},
  });

  return transporter;
};

const getSenderAddress = (): string => {
  const sender = getEnv("SMTP_FROM");
  if (sender && isValidEmail(sender)) return sender;
  return getEnv("SMTP_USER");
};

const sendEmail = async (
  recipients: string[],
  subject: string,
  text: string,
  html: string,
): Promise<void> => {
  const validRecipients = [...new Set(
    recipients
      .map((email) => email.trim())
      .filter((email) => isValidEmail(email)),
  )];

  if (validRecipients.length === 0) return;

  const sender = getSenderAddress();
  if (!isValidEmail(sender)) {
    logger.warn("Email skipped. SMTP_FROM/SMTP_USER is missing or invalid.");
    return;
  }

  const activeTransporter = getTransporter();
  if (!activeTransporter) return;

  try {
    await activeTransporter.sendMail({
      from: sender,
      to: validRecipients.join(","),
      subject,
      text,
      html,
    });
    logger.info("Email sent", {subject, recipients: validRecipients.length});
  } catch (error) {
    logger.error("Failed to send email", {subject, error});
  }
};

const sendSms = async (phoneNumbers: string[], message: string): Promise<void> => {
  const recipients = [...new Set(
    phoneNumbers
      .map((phone) => normalizePhone(phone))
      .filter((phone): phone is string => !!phone),
  )];

  if (!message.trim() || recipients.length === 0) return;

  const apiKey = getEnv("ROAMTECH_API_KEY");
  const partnerId = getEnv("ROAMTECH_PARTNER_ID");
  const shortcode = getEnv("SHORTCODE");
  const smsUrl = getEnv("ROAMTECH_SMS_URL") || "https://sms.roamtech.co.ke/api/services/sendsms/";

  if (!apiKey || !partnerId || !shortcode) {
    logger.warn(
      "SMS skipped. Missing ROAMTECH_API_KEY, ROAMTECH_PARTNER_ID or SHORTCODE env vars.",
    );
    return;
  }

  try {
    const response = await fetch(smsUrl, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        apikey: apiKey,
        partnerID: partnerId,
        mobile: recipients.join(","),
        message,
        shortcode,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      logger.error("Failed to send SMS", {
        status: response.status,
        body: text,
        recipients: recipients.length,
      });
      return;
    }

    logger.info("SMS sent", {recipients: recipients.length});
  } catch (error) {
    logger.error("Failed to send SMS", {error, recipients: recipients.length});
  }
};

const userCanHandleProgramme = (
  user: UserRecord,
  programme: string | undefined,
): boolean => {
  if (!programme) return true;
  if (!user.allowedProgrammes) return true;

  const entries = Object.entries(user.allowedProgrammes);
  if (entries.length === 0) return true;

  const target = programme.trim().toLowerCase();
  return entries.some(
    ([key, allowed]) => allowed && key.trim().toLowerCase() === target,
  );
};

const getEmailsByRole = async (
  roleTokens: Set<string>,
  programme: string | undefined,
): Promise<string[]> => {
  const recipients = new Set<string>();

  try {
    const snapshot = await admin.database().ref("users").get();
    if (!snapshot.exists()) return [...recipients];

    const users = snapshot.val() as Record<string, UserRecord>;
    for (const user of Object.values(users)) {
      if (!hasAnyRoleToken(user, roleTokens)) continue;
      if (normalize(user.status) === "inactive") continue;
      if (!userCanHandleProgramme(user, programme)) continue;

      const email = typeof user.email === "string" ? user.email.trim() : "";
      if (isValidEmail(email)) recipients.add(email);
    }
  } catch (error) {
    logger.error("Failed to load role-based email recipients from /users", {error});
  }

  return [...recipients];
};

const getPhonesByRole = async (
  roleTokens: Set<string>,
  programme: string | undefined,
): Promise<string[]> => {
  const recipients = new Set<string>();

  try {
    const snapshot = await admin.database().ref("users").get();
    if (!snapshot.exists()) return [...recipients];

    const users = snapshot.val() as Record<string, UserRecord>;
    for (const user of Object.values(users)) {
      if (!hasAnyRoleToken(user, roleTokens)) continue;
      if (normalize(user.status) === "inactive") continue;
      if (!userCanHandleProgramme(user, programme)) continue;

      const phone = getUserPhone(user);
      if (phone) recipients.add(phone);
    }
  } catch (error) {
    logger.error("Failed to load role-based phone recipients from /users", {error});
  }

  return [...recipients];
};

const buildDetailsText = (id: string, record: RequisitionRecord): string => {
  const purpose = record.type === "fuel and Service" ?
    (record.fuelPurpose || "N/A") :
    (record.tripPurpose || "N/A");

  return [
    `Requisition ID: ${id}`,
    `Requester: ${getRequesterName(record)}`,
    `Type: ${record.type || "N/A"}`,
    `Programme: ${record.programme || "N/A"}`,
    `County: ${record.county || "N/A"}`,
    `Subcounty: ${record.subcounty || "N/A"}`,
    `Purpose: ${purpose}`,
    `Amount: ${formatAmount(record)}`,
  ].join("\n");
};

const sendHrApprovalRequestEmail = async (
  requisitionId: string,
  record: RequisitionRecord,
): Promise<void> => {
  const hrRecipients = await getEmailsByRole(
    ROLE_HR_IDENTIFIERS,
    record.programme,
  );

  if (hrRecipients.length === 0) {
    logger.warn("No HR recipients found for approved requisition", {
      requisitionId,
      programme: record.programme || "N/A",
    });
    return;
  }

  const details = buildDetailsText(requisitionId, record);
  const subject = `HR action required: approved requisition ${requisitionId}`;
  const text = [
    "A requisition has been approved and now requires HR authorization.",
    "",
    details,
    "",
    `Approved by: ${record.approvedBy || "System"}`,
  ].join("\n");
  const html = [
    "<p>A requisition has been approved and now requires HR authorization.</p>",
    `<p><strong>Requisition ID:</strong> ${requisitionId}<br/>`,
    `<strong>Requester:</strong> ${getRequesterName(record)}<br/>`,
    `<strong>Type:</strong> ${record.type || "N/A"}<br/>`,
    `<strong>Programme:</strong> ${record.programme || "N/A"}<br/>`,
    `<strong>Amount:</strong> ${formatAmount(record)}<br/>`,
    `<strong>Approved by:</strong> ${record.approvedBy || "System"}</p>`,
  ].join("");

  await sendEmail(hrRecipients, subject, text, html);
};

const sendProjectManagerNewRequisitionSms = async (
  requisitionId: string,
  record: RequisitionRecord,
): Promise<void> => {
  const pmPhones = await getPhonesByRole(
    ROLE_PROJECT_MANAGER_IDENTIFIERS,
    record.programme,
  );
  if (pmPhones.length === 0) {
    logger.warn(
      "Project Manager phone recipients missing for new requisition",
      {requisitionId, programme: record.programme || "N/A"},
    );
    return;
  }

  const message = [
    "New requisition submitted.",
    `ID: ${requisitionId}`,
    `Requester: ${getRequesterName(record)}`,
    `Programme: ${record.programme || "N/A"}`,
    `Amount: ${formatAmount(record)}`,
  ].join(" ");

  await sendSms(pmPhones, message);
};

const sendRequesterRejectedSms = async (
  requisitionId: string,
  record: RequisitionRecord,
): Promise<void> => {
  const requesterPhone = await resolveRequesterPhone(record);
  if (!requesterPhone) {
    logger.warn(
      "Requester phone missing for rejected requisition SMS",
      {requisitionId},
    );
    return;
  }

  const customSmsText = typeof record.rejectionSmsText === "string" ?
    record.rejectionSmsText.trim() :
    "";

  if (customSmsText) {
    await sendSms([requesterPhone], customSmsText);
    return;
  }

  const rejectionReason = typeof record.rejectionReason === "string" &&
      record.rejectionReason.trim() ?
    record.rejectionReason.trim() :
    DEFAULT_HR_REJECTION_REASON;

  const message = [
    `Hello ${getRequesterName(record)}.`,
    `Your requisition ${requisitionId} was rejected by Human Resource Manager.`,
    `Reason: ${rejectionReason}`,
  ].join(" ");

  await sendSms([requesterPhone], message);
};

const sendRequesterAuthorizedSms = async (
  requisitionId: string,
  record: RequisitionRecord,
): Promise<void> => {
  const requesterPhone = await resolveRequesterPhone(record);
  if (!requesterPhone) {
    logger.warn(
      "Requester phone missing for authorized requisition SMS",
      {requisitionId},
    );
    return;
  }

  const message = [
    `Hello ${getRequesterName(record)}.`,
    `Your requisition ${requisitionId} has been authorized and is now being processed.`,
    "Finance has been notified.",
  ].join(" ");

  await sendSms([requesterPhone], message);
};

const sendRequesterCompletedSms = async (
  requisitionId: string,
  record: RequisitionRecord,
): Promise<void> => {
  const requesterPhone = await resolveRequesterPhone(record);
  if (!requesterPhone) {
    logger.warn(
      "Requester phone missing for completed requisition SMS",
      {requisitionId},
    );
    return;
  }

  const message = [
    `Hello ${getRequesterName(record)}.`,
    `Your requisition ${requisitionId} transaction has been made successfully.`,
    `Amount: ${formatAmount(record)}.`,
  ].join(" ");

  await sendSms([requesterPhone], message);
};

const sendFinanceAuthorizedEmail = async (
  requisitionId: string,
  record: RequisitionRecord,
): Promise<void> => {
  const financeRecipients = await getEmailsByRole(
    ROLE_FINANCE_IDENTIFIERS,
    record.programme,
  );

  if (financeRecipients.length === 0) {
    logger.warn("No Finance recipients found for authorized requisition", {
      requisitionId,
      programme: record.programme || "N/A",
    });
    return;
  }

  const details = buildDetailsText(requisitionId, record);
  const subject = `Finance action required: authorized requisition ${requisitionId}`;
  const text = [
    "A requisition has been authorized by HR.",
    "Please process the transaction.",
    "",
    details,
    "",
    `Authorized by: ${record.authorizedBy || "HR"}`,
  ].join("\n");
  const html = [
    "<p>A requisition has been authorized by HR.</p>",
    "<p><strong>Please process the transaction.</strong></p>",
    `<p><strong>Requisition ID:</strong> ${requisitionId}<br/>`,
    `<strong>Requester:</strong> ${getRequesterName(record)}<br/>`,
    `<strong>Programme:</strong> ${record.programme || "N/A"}<br/>`,
    `<strong>Amount:</strong> ${formatAmount(record)}<br/>`,
    `<strong>Authorized by:</strong> ${record.authorizedBy || "HR"}</p>`,
  ].join("");

  await sendEmail(financeRecipients, subject, text, html);
};

export const notifyRequisitionStatusEmails = onValueWritten(
  "/requisitions/{requisitionId}",
  async (event: any): Promise<void> => {
    const before = event.data.before.val() as RequisitionRecord | null;
    const after = event.data.after.val() as RequisitionRecord | null;

    if (!after) return;

    const requisitionId = String(event.params.requisitionId);
    const previousStatus = normalize(before?.status);
    const nextStatus = normalize(after.status);
    const previousAuthorizedBy = normalize(before?.authorizedBy);
    const nextAuthorizedBy = normalize(after.authorizedBy);

    if (!before && after) {
      await sendProjectManagerNewRequisitionSms(requisitionId, after);
      return;
    }

    if (nextStatus === "approved") {
      if (previousStatus !== nextStatus) {
        await sendHrApprovalRequestEmail(requisitionId, after);
      }
    }

    if (
      nextStatus === "rejected" &&
      previousStatus !== nextStatus
    ) {
      await sendRequesterRejectedSms(requisitionId, after);
    }

    if (
      nextStatus === "complete" &&
      previousStatus !== nextStatus
    ) {
      await sendRequesterCompletedSms(requisitionId, after);
      return;
    }

    if (!previousAuthorizedBy && !!nextAuthorizedBy) {
      await Promise.all([
        sendRequesterAuthorizedSms(requisitionId, after),
        sendFinanceAuthorizedEmail(requisitionId, after),
      ]);
      return;
    }
  },
);

const getHrTimeoutMs = (): number => {
  const raw = getEnv("HR_APPROVAL_TIMEOUT_HOURS");
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_HR_TIMEOUT_HOURS * 60 * 60 * 1000;
  }
  return parsed * 60 * 60 * 1000;
};

export const autoRejectUnapprovedRequisitions = onSchedule(
  {
    schedule: "every 60 minutes",
    timeZone: "Africa/Nairobi",
  },
  async (): Promise<void> => {
    const now = Date.now();
    const cutoffTime = now - getHrTimeoutMs();

    const snapshot = await admin.database()
      .ref("requisitions")
      .orderByChild("status")
      .equalTo("approved")
      .get();

    if (!snapshot.exists()) {
      logger.info("HR auto-rejection job found no approved requisitions.");
      return;
    }

    const requisitions = snapshot.val() as Record<string, RequisitionRecord>;
    const jobs: Array<Promise<boolean>> = [];

    for (const [requisitionId, record] of Object.entries(requisitions)) {
      if (!record || typeof record !== "object") continue;
      if (
        typeof record.authorizedBy === "string" &&
        record.authorizedBy.trim()
      ) {
        continue;
      }

      const approvedAtMs = parseTimestampMs(record.approvedAt);
      if (approvedAtMs === null || approvedAtMs > cutoffTime) continue;

      jobs.push((async (): Promise<boolean> => {
        try {
          const requisitionRef = admin
            .database()
            .ref(`requisitions/${requisitionId}`);
          await requisitionRef.update({
            status: "rejected",
            rejectedBy: "HR",
            rejectedAt: now,
            rejectionReason: DEFAULT_HR_REJECTION_REASON,
            hrAutoRejected: true,
            hrAutoRejectedAt: now,
          });

          await requisitionRef.child("history").push({
            action: "Rejected",
            actor: "HR System",
            timestamp: now,
            details: "Automatically rejected after HR approval timeout.",
          });

          return true;
        } catch (error) {
          logger.error(
            "Failed auto-rejecting requisition",
            {requisitionId, error},
          );
          return false;
        }
      })());
    }

    const outcomes = await Promise.all(jobs);
    const rejectedCount = outcomes.filter((result) => result).length;

    logger.info("HR auto-rejection job completed", {
      scanned: Object.keys(requisitions).length,
      rejectedCount,
      timeoutHours: getHrTimeoutMs() / (60 * 60 * 1000),
    });
  },
);
