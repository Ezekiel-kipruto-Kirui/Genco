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
  submittedAt?: number | string;
  approvedAt?: number | string;
  approvedBy?: string;
  authorizedBy?: string;
  county?: string;
  subcounty?: string;
  tripPurpose?: string;
  fuelPurpose?: string;
  total?: number | string;
  fuelAmount?: number | string;
  rejectedBy?: string;
  rejectedAt?: number | string;
  rejectionReason?: string;
  hrAutoRejected?: boolean;
  [key: string]: unknown;
}

interface UserRecord {
  uid?: string;
  name?: string;
  email?: string;
  role?: string;
  status?: string;
  allowedProgrammes?: Record<string, boolean>;
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

const getRequesterName = (record: RequisitionRecord): string =>
  record.name || record.userName || record.username || "Requester";

const getRequesterEmail = (record: RequisitionRecord): string | null => {
  const candidates = [
    record.email,
    record.requesterEmail,
    record.userEmail,
    record.username,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (isValidEmail(trimmed)) return trimmed;
  }
  return null;
};

const resolveRequesterEmail = async (
  record: RequisitionRecord,
): Promise<string | null> => {
  const direct = getRequesterEmail(record);
  if (direct) return direct;

  const uid = typeof record.uid === "string" ? record.uid.trim() : "";
  if (uid) {
    try {
      const directUserSnapshot = await admin
        .database()
        .ref(`users/${uid}`)
        .get();
      if (directUserSnapshot.exists()) {
        const userData = directUserSnapshot.val() as UserRecord;
        const userEmail = typeof userData.email === "string" ?
          userData.email.trim() :
          "";
        if (isValidEmail(userEmail)) return userEmail;
      }
    } catch (error) {
      logger.error("Failed requester UID lookup in /users", {uid, error});
    }
  }

  const identifiers = new Set(
    [
      record.uid,
      record.name,
      record.userName,
      record.username,
      record.email,
      record.requesterEmail,
      record.userEmail,
    ]
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0),
  );

  if (identifiers.size === 0) return null;

  try {
    const usersSnapshot = await admin.database().ref("users").get();
    if (!usersSnapshot.exists()) return null;

    const users = usersSnapshot.val() as Record<string, UserRecord>;
    for (const [userId, user] of Object.entries(users)) {
      const email = typeof user.email === "string" ? user.email.trim() : "";
      if (!isValidEmail(email)) continue;

      const userTokens = [
        userId,
        user.uid,
        user.name,
        user.email,
      ]
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim().toLowerCase());

      if (userTokens.some((token) => identifiers.has(token))) return email;
    }
  } catch (error) {
    logger.error("Failed requester fallback lookup in /users", {error});
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

const getFallbackHrEmails = (): string[] => {
  const raw = getEnv("HR_NOTIFICATION_EMAILS");
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((email) => isValidEmail(email));
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

const getHrRecipientEmails = async (
  programme: string | undefined,
): Promise<string[]> => {
  const recipients = new Set<string>(getFallbackHrEmails());

  try {
    const snapshot = await admin.database().ref("users").get();
    if (!snapshot.exists()) return [...recipients];

    const users = snapshot.val() as Record<string, UserRecord>;
    for (const user of Object.values(users)) {
      if (normalize(user.role) !== "hr") continue;
      if (normalize(user.status) === "inactive") continue;
      if (!userCanHandleProgramme(user, programme)) continue;

      const email = typeof user.email === "string" ? user.email.trim() : "";
      if (isValidEmail(email)) recipients.add(email);
    }
  } catch (error) {
    logger.error("Failed to load HR recipients from /users", {error});
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
  const hrRecipients = await getHrRecipientEmails(record.programme);

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

const sendRequesterApprovedEmail = async (
  requisitionId: string,
  record: RequisitionRecord,
): Promise<void> => {
  const requesterEmail = await resolveRequesterEmail(record);
  if (!requesterEmail) {
    logger.warn(
      "Requester email missing for approved requisition",
      {requisitionId},
    );
    return;
  }

  const subject = `Your requisition ${requisitionId} was approved`;
  const text = [
    `Hello ${getRequesterName(record)},`,
    "",
    "Your requisition has been approved.",
    "HR has been notified for final authorization.",
    "",
    buildDetailsText(requisitionId, record),
  ].join("\n");
  const html = [
    `<p>Hello ${getRequesterName(record)},</p>`,
    "<p>Your requisition has been approved.</p>",
    "<p>HR has been notified for final authorization.</p>",
    `<p><strong>Requisition ID:</strong> ${requisitionId}<br/>`,
    "<strong>Status:</strong> Approved</p>",
  ].join("");

  await sendEmail([requesterEmail], subject, text, html);
};

const sendRequesterRejectedEmail = async (
  requisitionId: string,
  record: RequisitionRecord,
): Promise<void> => {
  const requesterEmail = await resolveRequesterEmail(record);
  if (!requesterEmail) {
    logger.warn(
      "Requester email missing for rejected requisition",
      {requisitionId},
    );
    return;
  }

  const rejectedByHr =
    normalize(record.rejectedBy) === "hr" || record.hrAutoRejected === true;

  const rejectionReason = typeof record.rejectionReason === "string" &&
      record.rejectionReason.trim() ?
    record.rejectionReason.trim() :
    (
      rejectedByHr ?
        DEFAULT_HR_REJECTION_REASON :
        "No rejection reason provided."
    );

  const heading = rejectedByHr ?
    "Your requisition was rejected by HR." :
    "Your requisition was rejected.";

  const subject = `Your requisition ${requisitionId} was rejected`;
  const text = [
    `Hello ${getRequesterName(record)},`,
    "",
    heading,
    `Reason: ${rejectionReason}`,
    "",
    `Requisition ID: ${requisitionId}`,
    "Status: Rejected",
  ].join("\n");
  const html = [
    `<p>Hello ${getRequesterName(record)},</p>`,
    `<p>${heading}</p>`,
    `<p><strong>Reason:</strong> ${rejectionReason}</p>`,
    `<p><strong>Requisition ID:</strong> ${requisitionId}<br/>`,
    "<strong>Status:</strong> Rejected</p>",
  ].join("");

  await sendEmail([requesterEmail], subject, text, html);
};

export const notifyRequisitionStatusEmails = onValueWritten(
  "/requisitions/{requisitionId}",
  async (event): Promise<void> => {
    const before = event.data.before.val() as RequisitionRecord | null;
    const after = event.data.after.val() as RequisitionRecord | null;

    if (!after) return;

    const previousStatus = normalize(before?.status);
    const nextStatus = normalize(after.status);
    if (previousStatus === nextStatus) return;

    const requisitionId = String(event.params.requisitionId);

    if (nextStatus === "approved") {
      await Promise.all([
        sendHrApprovalRequestEmail(requisitionId, after),
        sendRequesterApprovedEmail(requisitionId, after),
      ]);
      return;
    }

    if (nextStatus === "rejected") {
      await sendRequesterRejectedEmail(requisitionId, after);
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
